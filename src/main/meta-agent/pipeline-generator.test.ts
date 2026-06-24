import { describe, expect, it, vi } from 'vitest';
import { assemblePipeline, pipelineAssemblySchema } from './pipeline-generator';

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
