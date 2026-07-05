import { describe, expect, it } from 'vitest';
import type { CanvasGraphNode, FrameGraphNode, MentalGraphEdge, MentalGraphNode, StepGraphNode } from '@/types/desktop';
import { collectDownstreamStepIds, compileFlowFromCanvas, wouldCreateStepCycle } from '../lib/harness-compiler';

function stepNode(id: string, title: string, data: Partial<StepGraphNode['data']> = {}): StepGraphNode {
  return {
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    width: 300,
    height: 190,
    text: title,
    color: '#111111',
    shape: 'square',
    data: {
      title,
      description: `${title} prompt`,
      mods: [],
      roles: [],
      ...data,
    },
    createdAt: 1,
  };
}

function edge(id: string, sourceId: string, targetId: string): MentalGraphEdge {
  return {
    id,
    sourceId,
    targetId,
    type: 'link',
    color: '#7C3AED',
    createdAt: 1,
  };
}

function loopEdge(id: string, sourceId: string, targetId: string, maxIterations?: number): MentalGraphEdge {
  return {
    id,
    sourceId,
    targetId,
    type: 'loop',
    ...(maxIterations !== undefined ? { maxIterations } : {}),
    color: '#7C3AED',
    createdAt: 1,
  };
}

function frameNode(id: string, title: string, data: Partial<FrameGraphNode['data']> = {}): FrameGraphNode {
  return {
    id,
    type: 'frame',
    position: { x: 0, y: 0 },
    width: 400,
    height: 300,
    text: title,
    color: '#7C3AED',
    shape: 'square',
    data: {
      title,
      childIds: [],
      ...data,
    },
    createdAt: 1,
  };
}

function mentalNode(id: string): MentalGraphNode {
  return {
    id,
    type: 'mental',
    position: { x: 0, y: 0 },
    width: 160,
    height: 100,
    text: 'note',
    color: '#EDE9FE',
    shape: 'square',
    createdAt: 1,
  };
}

describe('compileFlowFromCanvas', () => {
  it('compiles step nodes into a visual-metadata-free DAG AST', () => {
    const nodes: CanvasGraphNode[] = [
      stepNode('step-a', 'Plan', {
        description: 'Plan the implementation',
        stepType: 'router',
        tools: [{ id: 'repo-search', name: 'Repo Search', config: { limit: 5 }, icon: 'Search' }],
        mods: [{
          id: 'strict-linting',
          name: 'Strict Linting',
          type: 'pre_process',
          config: { maxWarnings: 0 },
          icon: 'MdRule',
          iconLibrary: 'md',
          description: 'Fail on lint drift',
          tags: ['quality'],
        } as any],
        roles: [{
          id: 'architect',
          name: 'Architect',
          systemPrompt: 'Protect boundaries and state contracts.',
          icon: 'MdAccountTree',
          iconLibrary: 'md',
          color: '#E87040',
          description: 'Designs software boundaries',
          tags: ['architecture'],
        } as any],
      }),
      stepNode('step-b', 'Implement'),
      stepNode('step-c', 'Review'),
      {
        id: 'mental-in',
        type: 'mental',
        position: { x: 0, y: 0 },
        width: 220,
        height: 120,
        text: 'Existing Zustand store is visual-only.',
        color: '#EDE9FE',
        shape: 'square',
        createdAt: 1,
      },
      {
        id: 'mental-out',
        type: 'mental',
        position: { x: 0, y: 0 },
        width: 220,
        height: 120,
        text: 'Export JSON for SDK handoff.',
        color: '#FBCFE8',
        shape: 'circle',
        createdAt: 1,
      },
    ];

    const flow = compileFlowFromCanvas(nodes, [
      edge('e-a-b', 'step-a', 'step-b'),
      edge('e-a-c', 'step-a', 'step-c'),
      edge('e-mental-a', 'mental-in', 'step-a'),
      edge('e-a-mental', 'step-a', 'mental-out'),
    ]);

    expect(flow).toEqual({
      id: 'flow-step-a',
      name: 'Plan',
      rootStepId: 'step-a',
      stepsRecord: {
        'step-a': {
          id: 'step-a',
          type: 'router',
          prompt: 'Plan the implementation',
          description: 'Plan the implementation',
          tools: [{ id: 'repo-search', name: 'Repo Search', config: { limit: 5 } }],
          prevStepIds: [],
          nextStepIds: ['step-b', 'step-c'],
          mods: [{
            id: 'strict-linting',
            name: 'Strict Linting',
            type: 'pre_process',
            config: { maxWarnings: 0 },
          }],
          roles: [{
            id: 'architect',
            name: 'Architect',
            systemPrompt: 'Protect boundaries and state contracts.',
          }],
          mentalContext: [
            { id: 'mental-in', text: 'Existing Zustand store is visual-only.', relationToStep: 'incoming' },
            { id: 'mental-out', text: 'Export JSON for SDK handoff.', relationToStep: 'outgoing' },
          ],
        },
        'step-b': {
          id: 'step-b',
          type: 'llm_call',
          prompt: 'Implement prompt',
          description: 'Implement prompt',
          tools: [],
          prevStepIds: ['step-a'],
          nextStepIds: [],
          mods: [],
          roles: [],
          mentalContext: [],
        },
        'step-c': {
          id: 'step-c',
          type: 'llm_call',
          prompt: 'Review prompt',
          description: 'Review prompt',
          tools: [],
          prevStepIds: ['step-a'],
          nextStepIds: [],
          mods: [],
          roles: [],
          mentalContext: [],
        },
      },
    });

    const serialized = JSON.stringify(flow);
    expect(serialized).not.toContain('icon');
    expect(serialized).not.toContain('iconLibrary');
    expect(serialized).not.toContain('color');
    expect(serialized).not.toContain('position');
  });

  it('rejects cyclic step graphs', () => {
    expect(() => compileFlowFromCanvas(
      [stepNode('step-a', 'A'), stepNode('step-b', 'B')],
      [edge('e-a-b', 'step-a', 'step-b'), edge('e-b-a', 'step-b', 'step-a')],
    )).toThrow(/cycle/i);
  });

  it('rejects multiple disconnected root steps', () => {
    expect(() => compileFlowFromCanvas(
      [stepNode('step-a', 'A'), stepNode('step-b', 'B')],
      [],
    )).toThrow(/multiple root/i);
  });
});

describe('compileFlowFromCanvas — loop-back edges', () => {
  it('compiles a loop-back edge into flow.loops without contributing to prev/next', () => {
    const nodes = [stepNode('root', 'Root'), stepNode('a', 'A'), stepNode('b', 'B')];
    const edges = [
      edge('e-root-a', 'root', 'a'),
      edge('e-a-b', 'a', 'b'),
      loopEdge('loop-1', 'b', 'a', 5),
    ];

    const flow = compileFlowFromCanvas(nodes, edges);

    expect(flow.loops).toEqual([
      { id: 'loop-1', sourceStepId: 'b', targetStepId: 'a', maxIterations: 5 },
    ]);
    expect(flow.stepsRecord.a.prevStepIds).toEqual(['root']);
    expect(flow.stepsRecord.a.nextStepIds).toEqual(['b']);
    expect(flow.stepsRecord.b.nextStepIds).toEqual([]);
  });

  it('defaults maxIterations to 3 when the loop edge omits a count', () => {
    const nodes = [stepNode('root', 'Root'), stepNode('a', 'A')];
    const edges = [edge('e-root-a', 'root', 'a'), loopEdge('loop-1', 'a', 'root')];

    const flow = compileFlowFromCanvas(nodes, edges);

    expect(flow.loops).toEqual([
      { id: 'loop-1', sourceStepId: 'a', targetStepId: 'root', maxIterations: 3 },
    ]);
  });

  it('clamps an over-cap maxIterations down to 50', () => {
    const nodes = [stepNode('root', 'Root'), stepNode('a', 'A')];
    const edges = [edge('e-root-a', 'root', 'a'), loopEdge('loop-1', 'a', 'root', 999)];

    expect(compileFlowFromCanvas(nodes, edges).loops?.[0].maxIterations).toBe(50);
  });

  it('clamps a sub-floor maxIterations up to 1', () => {
    const nodes = [stepNode('root', 'Root'), stepNode('a', 'A')];
    const edges = [edge('e-root-a', 'root', 'a'), loopEdge('loop-1', 'a', 'root', 0)];

    expect(compileFlowFromCanvas(nodes, edges).loops?.[0].maxIterations).toBe(1);
  });

  it('compiles a loop edge that points back to the root step without giving it in-degree', () => {
    const nodes = [stepNode('root', 'Root'), stepNode('a', 'A'), stepNode('b', 'B')];
    const edges = [
      edge('e-root-a', 'root', 'a'),
      edge('e-a-b', 'a', 'b'),
      loopEdge('loop-1', 'b', 'root', 4),
    ];

    const flow = compileFlowFromCanvas(nodes, edges);

    expect(flow.rootStepId).toBe('root');
    expect(flow.stepsRecord.root.prevStepIds).toEqual([]);
    expect(flow.loops).toEqual([{ id: 'loop-1', sourceStepId: 'b', targetStepId: 'root', maxIterations: 4 }]);
  });

  it('rejects a loop edge connecting a step to itself', () => {
    const nodes = [stepNode('root', 'Root'), stepNode('a', 'A')];
    const edges = [edge('e-root-a', 'root', 'a'), loopEdge('loop-1', 'a', 'a')];

    expect(() => compileFlowFromCanvas(nodes, edges)).toThrow(/cannot connect a step to itself/i);
  });

  it('rejects a loop edge whose target does not forward-reach the source', () => {
    const nodes = [stepNode('root', 'Root'), stepNode('a', 'A'), stepNode('b', 'B')];
    const edges = [
      edge('e-root-a', 'root', 'a'),
      edge('e-root-b', 'root', 'b'),
      // 'b' is a's sibling, not its forward descendant — 'b' cannot reach 'a'.
      loopEdge('loop-1', 'a', 'b'),
    ];

    expect(() => compileFlowFromCanvas(nodes, edges)).toThrow(/must point back to an upstream step/i);
  });

  it('rejects two overlapping loop bodies, naming both loop ids in the error', () => {
    const nodes = ['root', 'a', 'b', 'c', 'd'].map((id) => stepNode(id, id.toUpperCase()));
    const edges = [
      edge('e-root-a', 'root', 'a'),
      edge('e-a-b', 'a', 'b'),
      edge('e-b-c', 'b', 'c'),
      edge('e-c-d', 'c', 'd'),
      loopEdge('loop-1', 'c', 'a'), // body {a, b, c}
      loopEdge('loop-2', 'd', 'b'), // body {b, c, d} — overlaps loop-1 on b, c
    ];

    expect(() => compileFlowFromCanvas(nodes, edges)).toThrow(/nested or overlapping loops/i);
    expect(() => compileFlowFromCanvas(nodes, edges)).toThrow(/loop "loop-1"/);
    expect(() => compileFlowFromCanvas(nodes, edges)).toThrow(/loop "loop-2"/);
  });

  it('drops the loop when includeIds excludes one of its endpoints', () => {
    const nodes = [stepNode('root', 'Root'), stepNode('a', 'A'), stepNode('b', 'B')];
    const edges = [
      edge('e-root-a', 'root', 'a'),
      edge('e-a-b', 'a', 'b'),
      loopEdge('loop-1', 'b', 'a'),
    ];

    const flow = compileFlowFromCanvas(nodes, edges, { includeIds: new Set(['root', 'a']) });

    expect(flow.loops).toBeUndefined();
    expect(Object.keys(flow.stepsRecord).sort()).toEqual(['a', 'root']);
  });
});

describe('collectDownstreamStepIds — loop edges', () => {
  it('does not traverse a loop-back edge', () => {
    const nodes = [stepNode('root', 'Root'), stepNode('a', 'A'), stepNode('b', 'B')];
    const edges = [
      edge('e-root-a', 'root', 'a'),
      edge('e-a-b', 'a', 'b'),
      loopEdge('loop-1', 'b', 'a'),
    ];

    // From 'b', the only forward edges are... none (b has no non-loop outgoing
    // edges) — the loop-back edge to 'a' must NOT be followed.
    expect(collectDownstreamStepIds('b', nodes, edges)).toEqual(new Set(['b']));
    // From 'root', the forward subgraph is unaffected by the loop edge.
    expect(collectDownstreamStepIds('root', nodes, edges)).toEqual(new Set(['root', 'a', 'b']));
  });
});

describe('wouldCreateStepCycle', () => {
  it('truth table: forward pair, back pair, self, and non-step endpoints', () => {
    const nodes: CanvasGraphNode[] = [stepNode('a', 'A'), stepNode('b', 'B'), mentalNode('m')];
    const edges = [edge('e-a-b', 'a', 'b')];

    // Forward pair: a→b already exists; proposing a→b again does not cycle.
    expect(wouldCreateStepCycle('a', 'b', nodes, edges)).toBe(false);
    // Back pair: a→b exists, so proposing b→a would close a 2-cycle.
    expect(wouldCreateStepCycle('b', 'a', nodes, edges)).toBe(true);
    // Self: always a cycle, regardless of the existing graph.
    expect(wouldCreateStepCycle('a', 'a', nodes, edges)).toBe(true);
    // Non-step endpoints (a mental node on either side) are never a cycle.
    expect(wouldCreateStepCycle('m', 'a', nodes, edges)).toBe(false);
    expect(wouldCreateStepCycle('a', 'm', nodes, edges)).toBe(false);
  });

  it('ignores existing loop edges when computing reachability', () => {
    const nodes = [stepNode('a', 'A'), stepNode('b', 'B'), stepNode('c', 'C')];
    // A loop edge c→a already exists (back-edge); it must not be treated as a
    // forward edge when deciding whether a NEW a→c connection would cycle.
    const edges = [edge('e-a-b', 'a', 'b'), edge('e-b-c', 'b', 'c'), loopEdge('loop-1', 'c', 'a')];

    expect(wouldCreateStepCycle('a', 'c', nodes, edges)).toBe(false);
  });
});

describe('compileFlowFromCanvas — per-step model override', () => {
  it('maps data.model onto AgenticStep.model so the routing precedence can honor it', () => {
    const flow = compileFlowFromCanvas([stepNode('s1', 'Only step', { model: 'openai/gpt-4o-mini' })], []);
    expect(flow.stepsRecord['s1'].model).toBe('openai/gpt-4o-mini');
  });

  it('omits model when unset or blank (stays optional)', () => {
    const plain = compileFlowFromCanvas([stepNode('s1', 'Only step')], []);
    expect(plain.stepsRecord['s1'].model).toBeUndefined();
    const blank = compileFlowFromCanvas([stepNode('s2', 'Blank override', { model: '   ' })], []);
    expect(blank.stepsRecord['s2'].model).toBeUndefined();
  });
});

describe('compileFlowFromCanvas — human-facing metadata (Phase 5)', () => {
  it('carries a step description onto the compiled AgenticStep', () => {
    const flow = compileFlowFromCanvas(
      [stepNode('s1', 'Only step', { description: 'Does the thing.' })],
      [],
    );
    expect(flow.stepsRecord['s1'].description).toBe('Does the thing.');
  });

  it('omits step description when unset or blank (stays optional)', () => {
    const absent = compileFlowFromCanvas([stepNode('s1', 'Only step', { description: undefined })], []);
    expect(absent.stepsRecord['s1'].description).toBeUndefined();
    expect('description' in absent.stepsRecord['s1']).toBe(false);

    const blank = compileFlowFromCanvas([stepNode('s2', 'Blank', { description: '   ' })], []);
    expect(blank.stepsRecord['s2'].description).toBeUndefined();
    expect('description' in blank.stepsRecord['s2']).toBe(false);
  });

  it("compiles a frame's description/tags/author/version onto the flow when it owns the root step via childIds", () => {
    const root = stepNode('root', 'Root');
    const frame = frameNode('frame-1', 'Onboarding Flow', {
      description: 'Handles new-user onboarding.',
      tags: ['onboarding', 'core'],
      author: 'Ada Lovelace',
      version: '1.2.0',
      childIds: ['root'],
    });

    const flow = compileFlowFromCanvas([frame, root], []);

    expect(flow.description).toBe('Handles new-user onboarding.');
    expect(flow.tags).toEqual(['onboarding', 'core']);
    expect(flow.author).toBe('Ada Lovelace');
    expect(flow.version).toBe('1.2.0');
  });

  it("finds the owning frame via the root step's parentId when childIds omits it", () => {
    const frame = frameNode('frame-1', 'Frame', { description: 'Via parentId.' });
    const root: StepGraphNode = { ...stepNode('root', 'Root'), parentId: 'frame-1' };

    const flow = compileFlowFromCanvas([frame, root], []);

    expect(flow.description).toBe('Via parentId.');
  });

  it('omits all four flow metadata keys when no frame owns the root step', () => {
    const flow = compileFlowFromCanvas([stepNode('root', 'Root')], []);
    expect(flow.description).toBeUndefined();
    expect(flow.tags).toBeUndefined();
    expect(flow.author).toBeUndefined();
    expect(flow.version).toBeUndefined();
    expect('description' in flow).toBe(false);
    expect('tags' in flow).toBe(false);
    expect('author' in flow).toBe(false);
    expect('version' in flow).toBe(false);
  });

  it('omits flow metadata keys the owning frame does not itself set', () => {
    const frame = frameNode('frame-1', 'Frame', { childIds: ['root'], description: 'Only a description.' });
    const root = stepNode('root', 'Root');

    const flow = compileFlowFromCanvas([frame, root], []);

    expect(flow.description).toBe('Only a description.');
    expect('tags' in flow).toBe(false);
    expect('author' in flow).toBe(false);
    expect('version' in flow).toBe(false);
  });

  it('ignores an empty tags array on the owning frame (stays optional, not an empty array)', () => {
    const frame = frameNode('frame-1', 'Frame', { childIds: ['root'], tags: [] });
    const root = stepNode('root', 'Root');

    const flow = compileFlowFromCanvas([frame, root], []);

    expect(flow.tags).toBeUndefined();
    expect('tags' in flow).toBe(false);
  });
});
