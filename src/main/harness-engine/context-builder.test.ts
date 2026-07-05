import { describe, expect, it, vi } from 'vitest';
import type { AgenticStep } from '../../types/harness';
import { buildStepContext, validateStepAtoms } from './context-builder';

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
  it('promotes a single role into the primary system prompt as structured heuristics', async () => {
    const context = await buildStepContext(makeStep({
      roles: [
        { id: 'architect', name: 'Architect', systemPrompt: 'Preserve system boundaries.' },
      ],
    }));

    expect(context.systemPrompt).toContain('<role_heuristics>');
    expect(context.systemPrompt).toContain('[Architect]');
    expect(context.systemPrompt).toContain('Preserve system boundaries.');
  });

  it('throws when more than one role is attached (Single Persona rule)', async () => {
    const step = makeStep({
      roles: [
        { id: 'architect', name: 'Architect', systemPrompt: 'Preserve system boundaries.' },
        { id: 'reviewer', name: 'Reviewer', systemPrompt: 'Flag unsafe assumptions.' },
      ],
    });

    await expect(buildStepContext(step)).rejects.toThrow(/step-1/);
    await expect(buildStepContext(step)).rejects.toThrow(/Single Persona/i);
  });

  it('resolves pre_process mods sequentially and promotes config.inject outputs into <execution_constraints>', async () => {
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

    // Resolution stays sequential and every onModStatus event still fires,
    // exactly as before this change.
    expect(calls).toEqual(['first', 'second']);
    expect(modStatuses).toEqual([
      'first:running',
      'first:completed',
      'second:running',
      'second:completed',
    ]);

    // New reparto: static `config.inject` mods land in the system prompt's
    // <execution_constraints>, in resolution order — not in the user prompt.
    expect(context.systemPrompt).toContain('<execution_constraints>');
    expect(context.systemPrompt).toContain('[first]');
    expect(context.systemPrompt).toContain('resolved:first');
    expect(context.systemPrompt).toContain('[second]');
    expect(context.systemPrompt).toContain('resolved:second');
    expect(context.systemPrompt.indexOf('resolved:first')).toBeLessThan(context.systemPrompt.indexOf('resolved:second'));

    expect(context.userPrompt).not.toContain('<pre_process_context>');
    expect(context.userPrompt).not.toContain('resolved:first');
    expect(context.userPrompt).not.toContain('resolved:second');
  });

  it('includes the precedence preamble whenever execution constraints are present', async () => {
    const context = await buildStepContext(makeStep({
      mods: [
        { id: 'security-first', name: 'SecurityFirst', type: 'pre_process', config: { inject: 'Never log secrets.' } },
      ],
    }));

    expect(context.systemPrompt).toContain('binding execution constraints for this step');
    expect(context.systemPrompt).toContain('law, not reference material');
    expect(context.systemPrompt).toContain('precedence is: (1) security and safety rules');
    expect(context.systemPrompt).toContain('If a constraint cannot be satisfied, state it explicitly in the response');
  });

  it('keeps a pre_process mod without a static inject string in <pre_process_context> in the user prompt', async () => {
    const context = await buildStepContext(makeStep({
      mods: [
        { id: 'contextual', name: 'Contextual', type: 'pre_process', config: { context: 'x' } },
      ],
    }));

    expect(context.userPrompt).toContain('<pre_process_context>');
    expect(context.userPrompt).toContain('[contextual]');
    expect(context.systemPrompt).not.toContain('<execution_constraints>');
  });

  it('captures every resolved pre_process output — constraints and context alike — in preProcessOutputs', async () => {
    const context = await buildStepContext(makeStep({
      mods: [
        { id: 'constraint-mod', name: 'ConstraintMod', type: 'pre_process', config: { inject: 'alpha' } },
        { id: 'context-mod', name: 'ContextMod', type: 'pre_process', config: { context: 'beta' } },
      ],
    }));

    expect(context.preProcessOutputs).toEqual([
      { modId: 'constraint-mod', output: 'alpha' },
      { modId: 'context-mod', output: 'beta' },
    ]);
  });

  it('throws when two attached mods declare each other incompatible, in either direction', async () => {
    const aDeclares = makeStep({
      mods: [
        { id: 'mod-a', name: 'ModA', type: 'pre_process', config: { inject: 'a', incompatibleWith: ['ModB'] } },
        { id: 'mod-b', name: 'ModB', type: 'pre_process', config: { inject: 'b' } },
      ],
    });
    await expect(buildStepContext(aDeclares)).rejects.toThrow(/ModA/);
    await expect(buildStepContext(aDeclares)).rejects.toThrow(/ModB/);

    // Only the *other* side declares the pairing this time (by id, not name).
    const bDeclares = makeStep({
      mods: [
        { id: 'mod-a', name: 'ModA', type: 'pre_process', config: { inject: 'a' } },
        { id: 'mod-b', name: 'ModB', type: 'pre_process', config: { inject: 'b', incompatibleWith: ['mod-a'] } },
      ],
    });
    await expect(buildStepContext(bDeclares)).rejects.toThrow(/ModA/);
    await expect(buildStepContext(bDeclares)).rejects.toThrow(/ModB/);
  });

  it('throws when two attached mods share an exclusiveGroup', async () => {
    const step = makeStep({
      mods: [
        { id: 'ds-alpha', name: 'DsAlpha', type: 'pre_process', config: { inject: 'a', exclusiveGroup: 'design-system' } },
        { id: 'ds-beta', name: 'DsBeta', type: 'pre_process', config: { inject: 'b', exclusiveGroup: 'design-system' } },
      ],
    });

    await expect(buildStepContext(step)).rejects.toThrow(/DsAlpha/);
    await expect(buildStepContext(step)).rejects.toThrow(/DsBeta/);
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

describe('validateStepAtoms', () => {
  it('allows zero or exactly one role', () => {
    expect(() => validateStepAtoms(makeStep())).not.toThrow();
    expect(() => validateStepAtoms(makeStep({
      roles: [{ id: 'architect', name: 'Architect', systemPrompt: 'x' }],
    }))).not.toThrow();
  });

  it('throws citing the step id and the Single Persona rule for two roles', () => {
    expect(() => validateStepAtoms(makeStep({
      id: 'plan-step',
      roles: [
        { id: 'architect', name: 'Architect', systemPrompt: 'x' },
        { id: 'reviewer', name: 'Reviewer', systemPrompt: 'y' },
      ],
    }))).toThrow(/plan-step.*Single Persona/s);
  });

  it('allows an empty mods array or a single mod with no config (no pair to conflict)', () => {
    expect(() => validateStepAtoms(makeStep({ mods: [] }))).not.toThrow();
    expect(() => validateStepAtoms(makeStep({
      mods: [{ id: 'lonely', name: 'Lonely', type: 'pre_process' }],
    }))).not.toThrow();
  });

  it('is defensive against malformed incompatibleWith / exclusiveGroup values (never crashes, never falsely conflicts)', () => {
    const step = makeStep({
      mods: [
        {
          id: 'mod-a',
          name: 'ModA',
          type: 'pre_process',
          // Non-array incompatibleWith — must be tolerated as "no constraint".
          config: { incompatibleWith: 'not-an-array' as unknown as string[] },
        },
        {
          id: 'mod-b',
          name: 'ModB',
          type: 'pre_process',
          // Non-string entries (number/null) must be filtered, not matched, and
          // a non-string exclusiveGroup must be treated as absent.
          config: { incompatibleWith: [42, null, 'SomeOtherMod'] as unknown as string[], exclusiveGroup: 7 as unknown as string },
        },
        { id: 'mod-c', name: 'ModC', type: 'pre_process', config: { exclusiveGroup: 8 as unknown as string } },
      ],
    });

    expect(() => validateStepAtoms(step)).not.toThrow();
  });
});
