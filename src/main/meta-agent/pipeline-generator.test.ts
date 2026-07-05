import { describe, expect, it, vi } from 'vitest';
import { assemblePipeline, pipelineAssemblySchema, pipelineAssemblyStepSchema, sanitizeLoopBacks } from './pipeline-generator';

describe('pipeline generator', () => {
  it('requires missing capability telemetry in the structured assembly schema', () => {
    expect(pipelineAssemblySchema.parse({
      frameTitle: 'Jira Pipeline',
      description: 'Ticket to code.',
      missingCapabilitiesRequested: ['Jira integration'],
      steps: [{
        id: 'read-ticket',
        prompt: 'Extract implementation requirements from the Jira ticket before any code is written.',
        roleId: 'confident-executor',
        modIds: [],
        prevStepIds: [],
      }],
    }).missingCapabilitiesRequested).toEqual(['Jira integration']);
  });

  it('pushes the Meta-Agent toward context-rich step prompts', async () => {
    const generateObject = vi.fn(async (_options: unknown) => ({
      object: {
        frameTitle: 'Unit Test Pipeline',
        description: 'Extract requirements, write tests, and implement.',
        missingCapabilitiesRequested: [],
        steps: [{
          id: 'extract-requirements',
          prompt: 'Read the provided ticket and extract explicit acceptance criteria, edge cases, and constraints for downstream implementation work.',
          roleId: 'confident-executor',
          modIds: [],
          prevStepIds: [],
        }],
      },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    }));

    await assemblePipeline('Crea un pipeline para tests e implementación.', {
      model: {} as any,
      generateObject,
    });

    const call = generateObject.mock.calls[0]?.[0] as { system?: string };
    expect(call.system).toContain('Unbreakable instructionQuality rule');
    expect(call.system).toContain('Never write generic prompts');
    expect(call.system).toContain('Utiliza los requerimientos extraídos');
  });

  it('fires anonymous intent telemetry when the generated AST reports missing capabilities', async () => {
    const telemetryFetch = vi.fn(async () => new Response(null, { status: 202 }));
    const generateObject = vi.fn(async () => ({
      object: {
        frameTitle: 'Jira Pipeline',
        description: 'Ticket to code.',
        missingCapabilitiesRequested: ['Jira integration', 'GitHub PR creator'],
        steps: [{
          id: 'read-ticket',
          prompt: 'Extract Jira ticket requirements, acceptance criteria, and implementation constraints for the next coding steps.',
          roleId: 'confident-executor',
          modIds: [],
          prevStepIds: [],
        }],
      },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    }));

    await assemblePipeline('Crea un pipeline desde Jira hasta un PR de GitHub.', {
      model: {} as any,
      generateObject,
      telemetryFetch,
    });

    expect(telemetryFetch).toHaveBeenCalledWith(
      'https://api.javadaba.com/v1/heliox/ticket',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intent: 'Crea un pipeline desde Jira hasta un PR de GitHub.',
          missingCapabilities: ['Jira integration', 'GitHub PR creator'],
        }),
      }),
    );
  });

  it('does not send intent telemetry when no capabilities are missing', async () => {
    const telemetryFetch = vi.fn(async () => new Response(null, { status: 202 }));
    const generateObject = vi.fn(async () => ({
      object: {
        frameTitle: 'Local Pipeline',
        description: 'Use available components only.',
        missingCapabilitiesRequested: [],
        steps: [{
          id: 'plan-work',
          prompt: 'Plan the work using only the discovered catalog and produce a bounded handoff for the next step.',
          roleId: 'confident-executor',
          modIds: [],
          prevStepIds: [],
        }],
      },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    }));

    await assemblePipeline('Crea un pipeline con los componentes actuales.', {
      model: {} as any,
      generateObject,
      telemetryFetch,
    });

    expect(telemetryFetch).not.toHaveBeenCalled();
  });
});

describe('pipelineAssemblyStepSchema loopBackTo', () => {
  const validStep = {
    id: 'redraft',
    prompt: 'Apply the critique from the previous step to produce an improved draft.',
    roleId: 'confident-executor',
    modIds: [],
    prevStepIds: ['critique'],
  };

  it('accepts a step without loopBackTo (optional)', () => {
    expect(pipelineAssemblyStepSchema.parse(validStep).loopBackTo).toBeUndefined();
  });

  it('accepts a valid loopBackTo', () => {
    const parsed = pipelineAssemblyStepSchema.parse({
      ...validStep,
      loopBackTo: { stepId: 'draft', maxIterations: 3 },
    });
    expect(parsed.loopBackTo).toEqual({ stepId: 'draft', maxIterations: 3 });
  });

  it('rejects maxIterations above the 50-pass cap', () => {
    expect(() => pipelineAssemblyStepSchema.parse({
      ...validStep,
      loopBackTo: { stepId: 'draft', maxIterations: 51 },
    })).toThrow();
  });

  it('rejects maxIterations below 1', () => {
    expect(() => pipelineAssemblyStepSchema.parse({
      ...validStep,
      loopBackTo: { stepId: 'draft', maxIterations: 0 },
    })).toThrow();
  });
});

describe('assemblePipeline loopBackTo sanitize guard', () => {
  type LoopBackTo = { stepId: string; maxIterations: number };

  // draft -> critique -> redraft, with redraft optionally looping back.
  const pipelineSteps = (loopBackTo?: LoopBackTo) => [
    {
      id: 'draft',
      prompt: 'Draft the initial document from the requirements gathered so far.',
      roleId: 'confident-executor',
      modIds: [] as string[],
      prevStepIds: [] as string[],
    },
    {
      id: 'critique',
      prompt: 'Critique the draft against the acceptance criteria and list concrete revisions.',
      roleId: 'confident-executor',
      modIds: [] as string[],
      prevStepIds: ['draft'],
    },
    {
      id: 'redraft',
      prompt: 'Apply the critique to produce an improved draft.',
      roleId: 'confident-executor',
      modIds: [] as string[],
      prevStepIds: ['critique'],
      loopBackTo,
    },
  ];

  function mockAssembly(loopBackTo?: LoopBackTo) {
    return vi.fn(async () => ({
      object: {
        frameTitle: 'Refine Loop',
        description: 'Draft, critique, redraft.',
        missingCapabilitiesRequested: [],
        steps: pipelineSteps(loopBackTo),
      },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    }));
  }

  it('keeps a loopBackTo whose target is a genuine ancestor', async () => {
    // maxIterations must be in-schema range here (the outer pipelineAssemblySchema
    // already enforces 1-50 on every assemblePipeline return path via .parse());
    // the out-of-range CLAMP behavior of sanitizeLoopBacks is unit-tested directly
    // below, since a >50 value can never survive schema parsing to reach it here.
    const generateObject = mockAssembly({ stepId: 'draft', maxIterations: 4 });

    const result = await assemblePipeline('Draft, critique, and redraft a document up to a cap.', {
      model: {} as any,
      generateObject,
    });

    expect(result.steps.find((s) => s.id === 'redraft')?.loopBackTo).toEqual({ stepId: 'draft', maxIterations: 4 });
  });

  it('drops a loopBackTo pointing at an unknown step id', async () => {
    const generateObject = mockAssembly({ stepId: 'no-such-step', maxIterations: 3 });

    const result = await assemblePipeline('Draft, critique, and redraft a document.', {
      model: {} as any,
      generateObject,
    });

    expect(result.steps.find((s) => s.id === 'redraft')?.loopBackTo).toBeUndefined();
  });

  it('drops a self-referencing loopBackTo', async () => {
    const generateObject = mockAssembly({ stepId: 'redraft', maxIterations: 3 });

    const result = await assemblePipeline('Draft, critique, and redraft a document.', {
      model: {} as any,
      generateObject,
    });

    expect(result.steps.find((s) => s.id === 'redraft')?.loopBackTo).toBeUndefined();
  });

  it('drops a loopBackTo whose target is a forward descendant, not an ancestor', async () => {
    // 'draft' (the FIRST step) declares a loopBackTo to 'redraft', which comes
    // after it — 'redraft' is not an ancestor of 'draft', so this must be dropped.
    const generateObject = vi.fn(async () => ({
      object: {
        frameTitle: 'Refine Loop',
        description: 'Draft, critique, redraft.',
        missingCapabilitiesRequested: [],
        steps: [
          {
            id: 'draft',
            prompt: 'Draft the initial document from the requirements gathered so far.',
            roleId: 'confident-executor',
            modIds: [],
            prevStepIds: [],
            loopBackTo: { stepId: 'redraft', maxIterations: 3 },
          },
          {
            id: 'critique',
            prompt: 'Critique the draft against the acceptance criteria and list concrete revisions.',
            roleId: 'confident-executor',
            modIds: [],
            prevStepIds: ['draft'],
          },
          {
            id: 'redraft',
            prompt: 'Apply the critique to produce an improved draft.',
            roleId: 'confident-executor',
            modIds: [],
            prevStepIds: ['critique'],
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    }));

    const result = await assemblePipeline('Draft, critique, and redraft a document.', {
      model: {} as any,
      generateObject,
    });

    expect(result.steps.find((s) => s.id === 'draft')?.loopBackTo).toBeUndefined();
  });

  it('leaves a step with no loopBackTo untouched', async () => {
    const generateObject = mockAssembly(undefined);

    const result = await assemblePipeline('Draft, critique, and redraft a document.', {
      model: {} as any,
      generateObject,
    });

    expect(result.steps.find((s) => s.id === 'redraft')?.loopBackTo).toBeUndefined();
  });
});

describe('sanitizeLoopBacks (direct)', () => {
  // The outer pipelineAssemblySchema already rejects maxIterations > 50 at parse
  // time on every assemblePipeline return path, so the only way to exercise
  // sanitizeLoopBacks' own clamp (defense-in-depth, mirroring clampLoopIterations
  // usage elsewhere in the codebase) is to call it directly with an
  // already-parsed-shape object that carries an out-of-range value.
  it('clamps an over-cap maxIterations value to the 50-pass hard cap', () => {
    const assembly = {
      frameTitle: 'Refine Loop',
      description: 'Draft, critique, redraft.',
      missingCapabilitiesRequested: [],
      steps: [
        { id: 'draft', prompt: 'Draft the initial document.', roleId: 'confident-executor', modIds: [], prevStepIds: [] },
        {
          id: 'redraft',
          prompt: 'Apply the critique to produce an improved draft.',
          roleId: 'confident-executor',
          modIds: [],
          prevStepIds: ['draft'],
          loopBackTo: { stepId: 'draft', maxIterations: 999 },
        },
      ],
    };

    const sanitized = sanitizeLoopBacks(assembly);

    expect(sanitized.steps.find((s) => s.id === 'redraft')?.loopBackTo).toEqual({ stepId: 'draft', maxIterations: 50 });
  });

  it('drops a loopBackTo whose target is unknown, self, or a non-ancestor', () => {
    const assembly = {
      frameTitle: 'Broken Loops',
      description: 'Every loopBackTo here is invalid.',
      missingCapabilitiesRequested: [],
      steps: [
        { id: 'draft', prompt: 'Draft the initial document.', roleId: 'confident-executor', modIds: [], prevStepIds: [], loopBackTo: { stepId: 'redraft', maxIterations: 3 } },
        { id: 'critique', prompt: 'Critique the draft.', roleId: 'confident-executor', modIds: [], prevStepIds: ['draft'], loopBackTo: { stepId: 'ghost', maxIterations: 3 } },
        { id: 'redraft', prompt: 'Redraft using the critique.', roleId: 'confident-executor', modIds: [], prevStepIds: ['critique'], loopBackTo: { stepId: 'redraft', maxIterations: 3 } },
      ],
    };

    const sanitized = sanitizeLoopBacks(assembly);

    expect(sanitized.steps.find((s) => s.id === 'draft')?.loopBackTo).toBeUndefined(); // non-ancestor (forward descendant)
    expect(sanitized.steps.find((s) => s.id === 'critique')?.loopBackTo).toBeUndefined(); // unknown id
    expect(sanitized.steps.find((s) => s.id === 'redraft')?.loopBackTo).toBeUndefined(); // self
  });
});

describe('assemblePipeline loop authoring instructions', () => {
  it('includes the loopBackTo instruction in the system prompt and the assembler prompt', async () => {
    const generateObject = vi.fn(async (_options: unknown) => ({
      object: {
        frameTitle: 'Loop Pipeline',
        description: 'Iterative refinement pipeline.',
        missingCapabilitiesRequested: [],
        steps: [{
          id: 'draft',
          prompt: 'Draft the initial output from the gathered requirements.',
          roleId: 'confident-executor',
          modIds: [],
          prevStepIds: [],
        }],
      },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    }));

    await assemblePipeline('Draft then iteratively critique and redraft.', {
      model: {} as any,
      generateObject,
    });

    const call = generateObject.mock.calls[0]?.[0] as { system?: string; prompt?: string };
    expect(call.system).toContain('loopBackTo');
    expect(call.system).toContain('NEVER encode a loop through prevStepIds');
    expect(call.prompt).toContain('loopBackTo:{stepId,maxIterations}');
  });
});
