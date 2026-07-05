import { describe, expect, it } from 'vitest';
import type { AgenticFlow, AgenticStep } from '../../types/harness';
import { buildExecutionPlan } from './loop-plan';

function makeStep(id: string, prevStepIds: string[], nextStepIds: string[]): AgenticStep {
  return {
    id,
    type: 'llm_call',
    prompt: `Prompt for ${id}`,
    tools: [],
    prevStepIds,
    nextStepIds,
    mods: [],
    roles: [],
    mentalContext: [],
  };
}

function makeFlow(
  stepsRecord: Record<string, AgenticStep>,
  rootStepId: string,
  loops?: AgenticFlow['loops'],
): AgenticFlow {
  return {
    id: 'flow-test',
    name: 'Test Flow',
    rootStepId,
    stepsRecord,
    ...(loops ? { loops } : {}),
  };
}

describe('buildExecutionPlan — loop-free parity', () => {
  it('yields exactly one instance per step with remainingDeps equal to prevStepIds.length', () => {
    const stepsRecord = {
      root: makeStep('root', [], ['branch-a', 'branch-b']),
      'branch-a': makeStep('branch-a', ['root'], ['merge']),
      'branch-b': makeStep('branch-b', ['root'], ['merge']),
      merge: makeStep('merge', ['branch-a', 'branch-b'], []),
    };
    const flow = makeFlow(stepsRecord, 'root');

    const plan = buildExecutionPlan(flow);

    expect(plan.instances.size).toBe(4);
    for (const step of Object.values(stepsRecord)) {
      const key = `${step.id}@1`;
      expect(plan.instances.get(key)).toEqual({ key, stepId: step.id, iteration: 1 });
      expect(plan.remainingDeps.get(key)).toBe(step.prevStepIds.length);
    }
    expect(plan.rootKey).toBe('root@1');
    expect(plan.readyKeys).toEqual(['root@1']);
  });

  it('handles a flow with no loops field at all (undefined, not just empty array)', () => {
    const stepsRecord = { root: makeStep('root', [], []) };
    const flow = makeFlow(stepsRecord, 'root');
    expect(flow.loops).toBeUndefined();

    const plan = buildExecutionPlan(flow);

    expect(plan.instances.size).toBe(1);
    expect(plan.instances.get('root@1')?.loop).toBeUndefined();
  });
});

describe('buildExecutionPlan — loop body computation and instance edges', () => {
  it('expands a simple chain loop: instance counts and every edge class', () => {
    const stepsRecord = {
      root: makeStep('root', [], ['b1']),
      b1: makeStep('b1', ['root'], ['b2']),
      b2: makeStep('b2', ['b1'], ['down']),
      down: makeStep('down', ['b2'], []),
    };
    const flow = makeFlow(stepsRecord, 'root', [
      { id: 'loop-1', sourceStepId: 'b2', targetStepId: 'b1', maxIterations: 3 },
    ]);

    const plan = buildExecutionPlan(flow);

    expect(plan.instances.size).toBe(8);
    expect([...plan.instances.keys()].sort()).toEqual(
      ['root@1', 'b1@1', 'b1@2', 'b1@3', 'b2@1', 'b2@2', 'b2@3', 'down@1'].sort(),
    );
    for (const k of [1, 2, 3]) {
      expect(plan.instances.get(`b1@${k}`)?.loop).toEqual({ id: 'loop-1', totalIterations: 3 });
      expect(plan.instances.get(`b2@${k}`)?.loop).toEqual({ id: 'loop-1', totalIterations: 3 });
    }
    expect(plan.instances.get('root@1')?.loop).toBeUndefined();
    expect(plan.instances.get('down@1')?.loop).toBeUndefined();

    // Entry edge: root (not in body) -> head of the loop, always @1.
    expect(plan.nextKeys.get('root@1')).toEqual(['b1@1']);
    // Same-body edges fan out per-iteration.
    expect(plan.nextKeys.get('b1@1')).toEqual(['b2@1']);
    expect(plan.nextKeys.get('b1@2')).toEqual(['b2@2']);
    expect(plan.nextKeys.get('b1@3')).toEqual(['b2@3']);
    // Chain edges: completing pass k re-triggers pass k+1 of the loop head.
    expect(plan.nextKeys.get('b2@1')).toEqual(['b1@2']);
    expect(plan.nextKeys.get('b2@2')).toEqual(['b1@3']);
    // Exit edge: only the LAST pass of the tail connects onward.
    expect(plan.nextKeys.get('b2@3')).toEqual(['down@1']);
    expect(plan.nextKeys.get('down@1')).toEqual([]);

    expect(plan.remainingDeps.get('root@1')).toBe(0);
    expect(plan.remainingDeps.get('b1@1')).toBe(1); // root@1
    expect(plan.remainingDeps.get('b2@1')).toBe(1); // b1@1
    expect(plan.remainingDeps.get('b1@2')).toBe(1); // b2@1 (chain)
    expect(plan.remainingDeps.get('b2@2')).toBe(1); // b1@2
    expect(plan.remainingDeps.get('b1@3')).toBe(1); // b2@2 (chain)
    expect(plan.remainingDeps.get('b2@3')).toBe(1); // b1@3
    expect(plan.remainingDeps.get('down@1')).toBe(1); // b2@3

    expect(plan.readyKeys).toEqual(['root@1']);
  });

  it('expands a diamond-shaped loop body without mixing iterations across branches', () => {
    // root -> t -> x -> {y, z} -> u -> down, loop u -> t (source=u, target=t).
    const stepsRecord = {
      root: makeStep('root', [], ['t']),
      t: makeStep('t', ['root'], ['x']),
      x: makeStep('x', ['t'], ['y', 'z']),
      y: makeStep('y', ['x'], ['u']),
      z: makeStep('z', ['x'], ['u']),
      u: makeStep('u', ['y', 'z'], ['down']),
      down: makeStep('down', ['u'], []),
    };
    const flow = makeFlow(stepsRecord, 'root', [
      { id: 'loop-1', sourceStepId: 'u', targetStepId: 't', maxIterations: 2 },
    ]);

    const plan = buildExecutionPlan(flow);

    // Diamond body {t, x, y, z, u} each get 2 passes; root/down get 1.
    expect(plan.instances.size).toBe(1 + 2 * 5 + 1);
    for (const stepId of ['t', 'x', 'y', 'z', 'u']) {
      expect(plan.instances.get(`${stepId}@1`)?.loop).toEqual({ id: 'loop-1', totalIterations: 2 });
      expect(plan.instances.get(`${stepId}@2`)?.loop).toEqual({ id: 'loop-1', totalIterations: 2 });
    }

    // Branch fan-out stays within the same iteration.
    expect(plan.nextKeys.get('x@1')).toEqual(['y@1', 'z@1']);
    expect(plan.nextKeys.get('x@2')).toEqual(['y@2', 'z@2']);
    // Merge stays within the same iteration too.
    expect(plan.remainingDeps.get('u@1')).toBe(2); // y@1, z@1
    expect(plan.remainingDeps.get('u@2')).toBe(2); // y@2, z@2

    // Chain edge only fires from the loop's declared source (u), not mid-body.
    expect(plan.nextKeys.get('u@1')).toEqual(['t@2']);
    // Exit edge fires only from the tail's LAST pass.
    expect(plan.nextKeys.get('u@2')).toEqual(['down@1']);

    expect(plan.readyKeys).toEqual(['root@1']);
  });

  it('connects the tail of one loop directly to the head of a second disjoint loop', () => {
    const stepsRecord = {
      root: makeStep('root', [], ['a1']),
      a1: makeStep('a1', ['root'], ['a2']),
      a2: makeStep('a2', ['a1'], ['b1']),
      b1: makeStep('b1', ['a2'], ['b2']),
      b2: makeStep('b2', ['b1'], ['down']),
      down: makeStep('down', ['b2'], []),
    };
    const flow = makeFlow(stepsRecord, 'root', [
      { id: 'loop-1', sourceStepId: 'a2', targetStepId: 'a1', maxIterations: 2 },
      { id: 'loop-2', sourceStepId: 'b2', targetStepId: 'b1', maxIterations: 2 },
    ]);

    const plan = buildExecutionPlan(flow);

    // Cross-disjoint-loop edge: tail of loop-1 (a2@2) -> head of loop-2 (b1@1).
    expect(plan.nextKeys.get('a2@2')).toEqual(['b1@1']);
    // The chain edge stays internal to loop-1.
    expect(plan.nextKeys.get('a2@1')).toEqual(['a1@2']);
  });
});

describe('buildExecutionPlan — degenerate maxIterations', () => {
  it('a maxIterations:1 loop degenerates to a single instance with no chain edge', () => {
    const stepsRecord = {
      root: makeStep('root', [], ['a']),
      a: makeStep('a', ['root'], ['b']),
      b: makeStep('b', ['a'], ['down']),
      down: makeStep('down', ['b'], []),
    };
    const flow = makeFlow(stepsRecord, 'root', [
      { id: 'loop-1', sourceStepId: 'b', targetStepId: 'a', maxIterations: 1 },
    ]);

    const plan = buildExecutionPlan(flow);

    expect(plan.instances.size).toBe(4); // no '@2' instance is ever created
    expect(plan.instances.has('a@2')).toBe(false);
    expect(plan.instances.has('b@2')).toBe(false);
    expect(plan.instances.get('a@1')?.loop).toEqual({ id: 'loop-1', totalIterations: 1 });
    expect(plan.instances.get('b@1')?.loop).toEqual({ id: 'loop-1', totalIterations: 1 });
    // No chain edge (k ranges 1..0) — b@1's only outgoing edge is the ordinary exit.
    expect(plan.nextKeys.get('b@1')).toEqual(['down@1']);
    expect(plan.readyKeys).toEqual(['root@1']);
  });
});

describe('buildExecutionPlan — validation', () => {
  it('throws when two loop bodies overlap, naming both loop ids', () => {
    const stepsRecord = {
      root: makeStep('root', [], ['a']),
      a: makeStep('a', ['root'], ['b']),
      b: makeStep('b', ['a'], ['c']),
      c: makeStep('c', ['b'], ['d']),
      d: makeStep('d', ['c'], []),
    };
    const flow = makeFlow(stepsRecord, 'root', [
      { id: 'loop-1', sourceStepId: 'c', targetStepId: 'a', maxIterations: 2 }, // body {a,b,c}
      { id: 'loop-2', sourceStepId: 'd', targetStepId: 'b', maxIterations: 2 }, // body {b,c,d} — overlaps
    ]);

    expect(() => buildExecutionPlan(flow)).toThrow(/nested or overlapping loops/i);
    expect(() => buildExecutionPlan(flow)).toThrow(/loop-1/);
    expect(() => buildExecutionPlan(flow)).toThrow(/loop-2/);
  });

  it('throws when the loop source is not a forward-descendant of the target', () => {
    const stepsRecord = {
      root: makeStep('root', [], ['a', 'b']),
      a: makeStep('a', ['root'], []),
      b: makeStep('b', ['root'], []),
    };
    const flow = makeFlow(stepsRecord, 'root', [
      { id: 'loop-1', sourceStepId: 'a', targetStepId: 'b', maxIterations: 2 },
    ]);

    expect(() => buildExecutionPlan(flow)).toThrow(/source is not a forward-descendant of target/);
  });

  it('throws on a self-referential loop', () => {
    const stepsRecord = { root: makeStep('root', [], []) };
    const flow = makeFlow(stepsRecord, 'root', [
      { id: 'loop-1', sourceStepId: 'root', targetStepId: 'root', maxIterations: 2 },
    ]);

    expect(() => buildExecutionPlan(flow)).toThrow(/same step/);
  });

  it('throws when a loop references a step id that does not exist', () => {
    const stepsRecord = { root: makeStep('root', [], []) };
    const flowMissingSource = makeFlow(stepsRecord, 'root', [
      { id: 'loop-1', sourceStepId: 'ghost', targetStepId: 'root', maxIterations: 2 },
    ]);
    expect(() => buildExecutionPlan(flowMissingSource)).toThrow(/does not exist/);

    const flowMissingTarget = makeFlow(stepsRecord, 'root', [
      { id: 'loop-1', sourceStepId: 'root', targetStepId: 'ghost', maxIterations: 2 },
    ]);
    expect(() => buildExecutionPlan(flowMissingTarget)).toThrow(/does not exist/);
  });

  it('clamps a non-finite or out-of-range maxIterations instead of throwing', () => {
    const stepsRecord = {
      root: makeStep('root', [], ['a']),
      a: makeStep('a', ['root'], ['b']),
      b: makeStep('b', ['a'], []),
    };
    const flow = makeFlow(stepsRecord, 'root', [
      { id: 'loop-1', sourceStepId: 'b', targetStepId: 'a', maxIterations: Number.NaN },
    ]);

    const plan = buildExecutionPlan(flow);

    expect(plan.instances.get('a@1')?.loop?.totalIterations).toBe(3); // LOOP_DEFAULT_MAX_ITERATIONS
  });
});

describe('buildExecutionPlan — determinism', () => {
  it('seeds readyKeys sorted ascending by (stepId, iteration)', () => {
    // Declared out of alphabetical order so a correct sort is actually exercised.
    const stepsRecord = {
      zeta: makeStep('zeta', [], []),
      alpha: makeStep('alpha', [], []),
      mid: makeStep('mid', [], []),
    };
    const flow = makeFlow(stepsRecord, 'alpha');

    const plan = buildExecutionPlan(flow);

    expect(plan.readyKeys).toEqual(['alpha@1', 'mid@1', 'zeta@1']);
  });
});
