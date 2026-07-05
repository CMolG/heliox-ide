/**
 * loop-plan.ts — Bounded loop-back edge expansion planner
 *
 * Expands an `AgenticFlow` (forward graph + `flow.loops`) into a per-iteration
 * instance graph the executor's Kahn scheduler can drive directly, one
 * `StepInstance` per pass of every step. Pure and side-effect free by design —
 * the executor is the only caller that performs I/O; this module is exhaustively
 * unit tested in isolation.
 *
 * This is the normative algorithm — equivalent Python/Java runtimes mirror it,
 * so keep it clean and faithful rather than optimizing for speed:
 *
 *   1. Validate every loop (defensive — `harness-compiler.ts` already validates
 *      canvas-authored flows, but a hand-built or persisted flow may not have
 *      gone through the compiler): source/target exist, source !== target,
 *      target forward-reaches source, and loop bodies are pairwise disjoint.
 *   2. For every step `s`, `N(s)` = the (clamped) `maxIterations` of the loop
 *      whose body contains it, else 1. Create one `StepInstance` `s@k` for
 *      `k = 1..N(s)`.
 *   3. Instance edges — for each forward edge `a → b`: if `a` and `b` sit in
 *      the SAME loop body, fan the edge out per-iteration (`a@k → b@k`);
 *      otherwise connect `a`'s LAST pass to `b`'s FIRST pass. That single rule
 *      uniformly covers plain edges, loop-entry edges, loop-exit edges, and
 *      edges crossing between two disjoint loops.
 *   4. Chain edges — for each loop `(u → t, N)`, add `u@k → t@(k+1)` for
 *      `k = 1..N-1`, i.e. completing a pass re-triggers the loop body.
 *   5. Build Kahn-ready structures: an in-degree map, an adjacency map, and a
 *      deterministically-sorted seed of in-degree-0 keys.
 */
import { clampLoopIterations, type AgenticFlow } from '../../types/harness';

/** One scheduled pass of a step. `key` is the unique node id in the expanded instance graph. */
export interface StepInstance {
  key: string;
  stepId: string;
  iteration: number;
  /** Present only when this instance belongs to a loop body. */
  loop?: { id: string; totalIterations: number };
}

/** The expanded, Kahn-scheduler-ready instance graph for one `AgenticFlow`. */
export interface ExecutionPlan {
  instances: Map<string, StepInstance>;
  remainingDeps: Map<string, number>;
  nextKeys: Map<string, string[]>;
  /** In-degree-0 keys, sorted ascending by (stepId, iteration). */
  readyKeys: string[];
  rootKey: string;
}

function instanceKey(stepId: string, iteration: number): string {
  return `${stepId}@${iteration}`;
}

/** BFS over `adjacency`, inclusive of `start`. */
function reachableSet(start: string, adjacency: Map<string, string[]>): Set<string> {
  const visited = new Set<string>([start]);
  const queue: string[] = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

function intersectSets<T>(a: Set<T>, b: Set<T>): Set<T> {
  const result = new Set<T>();
  for (const item of a) {
    if (b.has(item)) result.add(item);
  }
  return result;
}

function compareInstances(a: StepInstance, b: StepInstance): number {
  return a.stepId === b.stepId ? a.iteration - b.iteration : a.stepId.localeCompare(b.stepId);
}

interface ValidatedLoop {
  id: string;
  sourceStepId: string;
  targetStepId: string;
  maxIterations: number;
  /** Forward-descendants of target ∩ forward-ancestors of source, inclusive. */
  body: Set<string>;
}

/**
 * Defensively re-validates `flow.loops` (the compiler already validated
 * canvas-authored flows, but this runtime may receive a hand-built or
 * persisted flow) and recomputes each loop's body. Bodies are required to be
 * pairwise disjoint — nested/overlapping loops are not supported.
 */
function validateLoops(flow: AgenticFlow): ValidatedLoop[] {
  const loops = flow.loops ?? [];
  if (loops.length === 0) return [];

  const nextByStepId = new Map<string, string[]>();
  const prevByStepId = new Map<string, string[]>();
  for (const step of Object.values(flow.stepsRecord)) {
    nextByStepId.set(step.id, step.nextStepIds);
    prevByStepId.set(step.id, step.prevStepIds);
  }

  const validated: ValidatedLoop[] = [];
  const bodyByLoopId = new Map<string, Set<string>>();

  for (const loop of loops) {
    if (!flow.stepsRecord[loop.sourceStepId]) {
      throw new Error(`loop-plan: loop "${loop.id}" source step "${loop.sourceStepId}" does not exist in flow "${flow.id}".`);
    }
    if (!flow.stepsRecord[loop.targetStepId]) {
      throw new Error(`loop-plan: loop "${loop.id}" target step "${loop.targetStepId}" does not exist in flow "${flow.id}".`);
    }
    if (loop.sourceStepId === loop.targetStepId) {
      throw new Error(`loop-plan: loop "${loop.id}" source and target are the same step "${loop.sourceStepId}".`);
    }

    const reachFromTarget = reachableSet(loop.targetStepId, nextByStepId);
    if (!reachFromTarget.has(loop.sourceStepId)) {
      throw new Error(`loop-plan: loop "${loop.id}" source is not a forward-descendant of target`);
    }

    const coReachToSource = reachableSet(loop.sourceStepId, prevByStepId);
    const body = intersectSets(reachFromTarget, coReachToSource);

    for (const [otherLoopId, otherBody] of bodyByLoopId) {
      const shared = [...body].filter((stepId) => otherBody.has(stepId));
      if (shared.length > 0) {
        throw new Error(
          `loop-plan: nested or overlapping loops are not supported: steps ${shared.join(', ')} belong to both loop "${otherLoopId}" and loop "${loop.id}".`,
        );
      }
    }
    bodyByLoopId.set(loop.id, body);

    validated.push({
      id: loop.id,
      sourceStepId: loop.sourceStepId,
      targetStepId: loop.targetStepId,
      maxIterations: clampLoopIterations(loop.maxIterations),
      body,
    });
  }

  return validated;
}

/**
 * Expands `flow` into a per-iteration `ExecutionPlan`. A loop-free flow yields
 * exactly one `StepInstance` per step, with `remainingDeps` equal to
 * `prevStepIds.length` — structural parity with the pre-loop scheduler.
 *
 * Throws a plain `Error` when `flow.loops` is invalid (missing/self-referential
 * source or target, target does not forward-reach source, or overlapping loop
 * bodies) — see `validateLoops`.
 */
export function buildExecutionPlan(flow: AgenticFlow): ExecutionPlan {
  const validatedLoops = validateLoops(flow);

  const loopByStepId = new Map<string, ValidatedLoop>();
  for (const loop of validatedLoops) {
    for (const stepId of loop.body) {
      loopByStepId.set(stepId, loop);
    }
  }

  const countByStepId = new Map<string, number>();
  for (const stepId of Object.keys(flow.stepsRecord)) {
    countByStepId.set(stepId, loopByStepId.get(stepId)?.maxIterations ?? 1);
  }

  const instances = new Map<string, StepInstance>();
  for (const stepId of Object.keys(flow.stepsRecord)) {
    const loop = loopByStepId.get(stepId);
    const total = countByStepId.get(stepId)!;
    for (let k = 1; k <= total; k++) {
      const key = instanceKey(stepId, k);
      instances.set(key, {
        key,
        stepId,
        iteration: k,
        ...(loop ? { loop: { id: loop.id, totalIterations: total } } : {}),
      });
    }
  }

  const nextKeys = new Map<string, string[]>();
  const remainingDeps = new Map<string, number>();
  for (const key of instances.keys()) {
    nextKeys.set(key, []);
    remainingDeps.set(key, 0);
  }

  const addEdge = (fromKey: string, toKey: string): void => {
    nextKeys.get(fromKey)!.push(toKey);
    remainingDeps.set(toKey, (remainingDeps.get(toKey) ?? 0) + 1);
  };

  // Instance edges, derived from the forward graph.
  for (const step of Object.values(flow.stepsRecord)) {
    const aId = step.id;
    const aLoop = loopByStepId.get(aId);
    const aCount = countByStepId.get(aId)!;

    for (const bId of step.nextStepIds) {
      const bLoop = loopByStepId.get(bId);
      const sameBody = Boolean(aLoop && bLoop && aLoop.id === bLoop.id);

      if (sameBody) {
        for (let k = 1; k <= aCount; k++) {
          addEdge(instanceKey(aId, k), instanceKey(bId, k));
        }
      } else {
        const tailK = aLoop ? aCount : 1;
        addEdge(instanceKey(aId, tailK), instanceKey(bId, 1));
      }
    }
  }

  // Chain edges: completing pass k of the loop body re-triggers pass k+1.
  for (const loop of validatedLoops) {
    for (let k = 1; k < loop.maxIterations; k++) {
      addEdge(instanceKey(loop.sourceStepId, k), instanceKey(loop.targetStepId, k + 1));
    }
  }

  const readyKeys = [...instances.values()]
    .filter((instance) => (remainingDeps.get(instance.key) ?? 0) === 0)
    .sort(compareInstances)
    .map((instance) => instance.key);

  return {
    instances,
    remainingDeps,
    nextKeys,
    readyKeys,
    rootKey: instanceKey(flow.rootStepId, 1),
  };
}
