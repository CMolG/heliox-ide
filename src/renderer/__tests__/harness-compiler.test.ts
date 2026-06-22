import { describe, expect, it } from 'vitest';
import type { CanvasGraphNode, MentalGraphEdge, StepGraphNode } from '@/types/desktop';
import { compileFlowFromCanvas } from '../lib/harness-compiler';

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
