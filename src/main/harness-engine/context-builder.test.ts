import { describe, expect, it, vi } from 'vitest';
import type { AgenticStep } from '../../types/harness';
import { buildStepContext } from './context-builder';

function makeStep(overrides: Partial<AgenticStep> = {}): AgenticStep {
  return {
    id: 'step-1',
    type: 'llm_call',
    prompt: 'Implement the feature.',
    tools: [],
    prevStepIds: [],
    nextStepIds: [],
    mods: [],
    roles: [],
    mentalContext: [],
    ...overrides,
  };
}

describe('buildStepContext', () => {
  it('promotes roles into the primary system prompt as structured heuristics', async () => {
    const context = await buildStepContext(makeStep({
      roles: [
        { id: 'architect', name: 'Architect', systemPrompt: 'Preserve system boundaries.' },
        { id: 'reviewer', name: 'Reviewer', systemPrompt: 'Flag unsafe assumptions.' },
      ],
    }));

    expect(context.systemPrompt).toContain('<role_heuristics>');
    expect(context.systemPrompt).toContain('[Architect]');
    expect(context.systemPrompt).toContain('Preserve system boundaries.');
    expect(context.systemPrompt).toContain('[Reviewer]');
    expect(context.systemPrompt).toContain('Flag unsafe assumptions.');
  });

  it('resolves pre_process mods sequentially before assembling the user prompt', async () => {
    const calls: string[] = [];
    const modStatuses: string[] = [];

    const context = await buildStepContext(makeStep({
      mods: [
        { id: 'first', name: 'First', type: 'pre_process', config: { inject: 'alpha' } },
        { id: 'second', name: 'Second', type: 'pre_process', config: { inject: 'beta' } },
      ],
    }), {
      resolvePreProcessMod: vi.fn(async (mod) => {
        calls.push(mod.id);
        return `resolved:${mod.id}`;
      }),
      onModStatus: (mod, status) => {
        modStatuses.push(`${mod.id}:${status}`);
      },
    });

    expect(calls).toEqual(['first', 'second']);
    expect(modStatuses).toEqual([
      'first:running',
      'first:completed',
      'second:running',
      'second:completed',
    ]);
    expect(context.userPrompt).toContain('<pre_process_context>');
    expect(context.userPrompt.indexOf('resolved:first')).toBeLessThan(context.userPrompt.indexOf('resolved:second'));
  });

  it('adds mental context inside explicit delimiters', async () => {
    const context = await buildStepContext(makeStep({
      mentalContext: [
        { id: 'idea-1', text: 'User prefers minimal UI.', relationToStep: 'incoming' },
      ],
    }));

    expect(context.userPrompt).toContain('<mental_context>');
    expect(context.userPrompt).toContain('[incoming] User prefers minimal UI.');
    expect(context.userPrompt).toContain('</mental_context>');
  });
});
