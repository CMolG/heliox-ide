import { describe, expect, it, vi } from 'vitest';
import { flowAssemblerJudgeSchema, judgeSchema, type SemanticJudgeResult } from './judge-schema';
import { buildJudgePrompts } from './judge-prompt';
import { runJudge, resolveJudgeModel, aggregateSemanticResults } from './judge-runner';
import { verifyDesign } from '../execution/design-verifier';

const semanticJudgeResult: SemanticJudgeResult = {
  runId: 'pf-run-1',
  evaluations: {
    searchEfficiency: {
      score: 18,
      justification: 'Read only relevant files.',
      unnecessaryFilesRead: [],
    },
    toolMastery: {
      score: 17,
      justification: 'Tool calls were valid.',
      syntaxErrorsCount: 0,
    },
    errorRecovery: {
      score: 16,
      justification: 'Recovered from one failed read.',
      loopDetected: false,
    },
    pipelineCohesion: {
      score: 19,
      justification: 'Step C preserved Step A copy and Step B theme choices.',
      handoffBreaks: [],
    },
    outputQuality: {
      score: 9,
      justification: 'Generated a polished zero-build Tailwind HTML page.',
      edgeCasesMissed: [],
    },
  },
  finalJudgeScore: 79,
  verdict: 'pass',
  criticalFailures: [],
};

const telemetry = {
  inputTokens: 1_500,
  outputTokens: 500,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 2_000,
  latencyMs: 2_000,
  stepCount: 1,
  toolCallsCount: 2,
  toolResultsCount: 2,
  mcpToolCalls: 2,
  mcpSuccessfulToolCalls: 2,
  mcpInterceptedToolCalls: 0,
  mcpSchemaErrors: 0,
  mcpSyntaxPrecision: 1,
};

const flowAssemblerSemanticJudgeResult: SemanticJudgeResult = {
  ...semanticJudgeResult,
  evaluations: {
    ...semanticJudgeResult.evaluations,
    dagValidity: {
      score: 20,
      justification: 'All step ids are unique, dependencies exist, and no cycle is present.',
      missingDependencyIds: [],
      cycleDetected: false,
    },
    componentSelection: {
      score: 19,
      justification: 'The generated AST uses only discovered role and mod ids.',
      inappropriateRoleIds: [],
      inappropriateModIds: [],
    },
    instructionQuality: {
      score: 18,
      justification: 'Step prompts are delegated and bounded.',
      weakStepIds: [],
      selfSolvingDetected: false,
    },
  },
  finalJudgeScore: 136,
};

describe('performance frontier judge', () => {
  it('enforces the cognitive judge schema', () => {
    expect(judgeSchema.parse(semanticJudgeResult)).toMatchObject({
      finalJudgeScore: 79,
      verdict: 'pass',
    });
    expect(() => judgeSchema.parse({
      ...semanticJudgeResult,
      evaluations: {
        ...semanticJudgeResult.evaluations,
        outputQuality: { score: 11, justification: 'too high', edgeCasesMissed: [] },
      },
    })).toThrow();
  });

  it('documents the required scoring scale in every cognitive score field', () => {
    const shape = judgeSchema.shape.evaluations.shape;

    expect(shape.searchEfficiency.shape.score.description).toContain('0 al 20');
    expect(shape.searchEfficiency.shape.score.description).toContain('OBLIGATORIO');
    expect(shape.toolMastery.shape.score.description).toContain('0 al 20');
    expect(shape.errorRecovery.shape.score.description).toContain('0 al 20');
    expect(shape.pipelineCohesion.shape.score.description).toContain('0 al 20');
    expect(shape.pipelineCohesion.shape.justification.description).toContain('Step C');
    expect(shape.outputQuality.shape.score.description).toContain('0 al 10');
    expect(shape.outputQuality.shape.justification.description).toContain('index.html');
    expect(shape.outputQuality.shape.justification.description).toContain('sin build step');
    expect(shape.dagValidity.unwrap().shape.score.description).toContain('0 al 20');
    expect(shape.dagValidity.unwrap().shape.justification.description).toContain('DAG valido');
    expect(shape.componentSelection.unwrap().shape.justification.description).toContain('catalogo descubierto');
    expect(shape.instructionQuality.unwrap().shape.justification.description).toContain('delegarla');
    expect(flowAssemblerJudgeSchema.parse(flowAssemblerSemanticJudgeResult).evaluations.dagValidity?.score).toBe(20);
  });

  it('builds a strict prompt with telemetry, VFS snapshot, and tool history', () => {
    const prompts = buildJudgePrompts({
      runId: 'pf-run-1',
      caseId: 'case-1',
      suite: 'architecture',
      modelUnderTest: 'mimo/mimo-v2.5-pro',
      userPrompt: 'Create an API.',
      conversation: [{ role: 'assistant', content: 'I used write_file.' }],
      cognitiveTrace: [{ type: 'tool_call', toolName: 'write_file', content: '{ "path": "package.json" }' }],
      vfsSnapshot: { '/workspace/package.json': '{}' },
      telemetry,
      toolEvents: [{ toolName: 'write_file', status: 'success', latencyMs: 5 }],
    });

    expect(prompts.system).toContain('Staff Engineer');
    expect(prompts.system).toContain('Cero indulgencia');
    expect(prompts.system).toContain('searchEfficiency: 0-20');
    expect(prompts.system).toContain('pipelineCohesion: 0-20');
    expect(prompts.system).toContain('outputQuality: 0-10');
    expect(prompts.system).toContain('Step C');
    expect(prompts.system).toContain('index.html');
    expect(prompts.system).toContain('sin build step');
    expect(prompts.system).toContain('React');
    expect(prompts.prompt).toContain('/workspace/package.json');
    expect(prompts.prompt).toContain('cognitive_execution_trace_json');
    expect(prompts.prompt).toContain('mcpSyntaxPrecision');
  });

  it('builds a Flow Assembler judge prompt with user intent and generated AST evidence', () => {
    const prompts = buildJudgePrompts({
      runId: 'pf-run-assembler',
      caseId: 'pf-flow-assembler-101',
      suite: 'flow-assembler',
      modelUnderTest: 'mimo/mimo-v2.5-pro',
      userPrompt: 'Crea un pipeline que reciba un ticket de Jira.',
      conversation: [],
      cognitiveTrace: [],
      vfsSnapshot: {},
      telemetry,
      toolEvents: [],
      flowAssembler: {
        userIntent: 'Crea un pipeline que reciba un ticket de Jira.',
        discoveredCatalog: {
          roles: [{ id: 'confident-executor', name: 'ConfidentExecutor', description: 'Executor', systemPrompt: 'Run efficiently.' }],
          mods: [{ id: 'anti-verification-interceptor', name: 'AntiVerificationInterceptor', type: 'system_override', description: 'Avoid verification noise.' }],
        },
        generatedAst: {
          frameTitle: 'Jira Implementation Pipeline',
          description: 'Turns a ticket into tests and implementation.',
          missingCapabilitiesRequested: [],
          steps: [
            { id: 'read-ticket', prompt: 'Analyze the ticket.', roleId: 'confident-executor', modIds: [], prevStepIds: [] },
            { id: 'write-tests', prompt: 'Write unit tests from the ticket.', roleId: 'confident-executor', modIds: ['anti-verification-interceptor'], prevStepIds: ['read-ticket'] },
          ],
        },
      },
    });

    expect(prompts.system).toContain('dagValidity: 0-20');
    expect(prompts.system).toContain('componentSelection: 0-20');
    expect(prompts.system).toContain('instructionQuality: 0-20');
    expect(prompts.prompt).toContain('flow_assembler_user_intent');
    expect(prompts.prompt).toContain('flow_assembler_generated_ast_json');
    expect(prompts.prompt).toContain('read-ticket');
    expect(prompts.prompt).toContain('anti-verification-interceptor');
  });

  it('sums cognitive dimensions before adding computed telemetry score', async () => {
    const generateObject = vi.fn(async () => ({
      object: {
        ...semanticJudgeResult,
        finalJudgeScore: 10,
      },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    }));

    const result = await runJudge({
      runId: 'pf-run-1',
      caseId: 'case-1',
      suite: 'architecture',
      modelUnderTest: 'mimo/mimo-v2.5-pro',
      userPrompt: 'Create an API.',
      conversation: [],
      cognitiveTrace: [],
      vfsSnapshot: {},
      telemetry,
      toolEvents: [],
      generateObject,
      model: {} as any,
    });

    expect(result.finalScore).toBe(89);
    expect(result.semanticScore).toBe(79);
    expect(result.evaluations.telemetryEfficiency.score).toBe(10);
    expect(generateObject).toHaveBeenCalledWith(expect.objectContaining({
      schema: judgeSchema,
    }));
  });

  it('logs provider headers returned by generateObject', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const generateObject = vi.fn(async () => ({
      object: semanticJudgeResult,
      usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
      response: {
        headers: {
          'x-mimo-total-tokens': '500000',
          'x-ratelimit-remaining-tokens': '42',
          'content-type': 'application/json',
        },
      },
    }));

    try {
      await runJudge({
        runId: 'pf-run-1',
        caseId: 'case-1',
        suite: 'team-work',
        modelUnderTest: 'mimo/mimo-v2.5-pro',
        userPrompt: 'Create a landing page.',
        conversation: [],
        cognitiveTrace: [],
        vfsSnapshot: {},
        telemetry,
        toolEvents: [],
        generateObject,
        model: {} as any,
      });

      expect(log).toHaveBeenCalledWith(expect.objectContaining({
        type: 'pf_provider_headers',
        source: 'judge',
        headers: expect.objectContaining({
          'x-mimo-total-tokens': '500000',
          'x-ratelimit-remaining-tokens': '42',
        }),
        usageHeaders: expect.objectContaining({
          'x-mimo-total-tokens': '500000',
          'x-ratelimit-remaining-tokens': '42',
        }),
        metrics: expect.objectContaining({
          totalTokens: 500000,
        }),
      }));
    } finally {
      log.mockRestore();
    }
  });

  it('scores each new suite dimension with the correct semantic maximum', async () => {
    const suiteCases = [
      {
        suite: 'development' as const,
        extra: { algorithmicAccuracy: { score: 18, justification: 'Handles edge cases.', edgeCasesCovered: ['div by zero'], edgeCasesMissed: [] } },
        max: 110,
        semantic: 79 + 18,
      },
      {
        suite: 'business-knowledge' as const,
        extra: { domainLogicAdherence: { score: 17, justification: 'Followed rules.md.', violatedRules: [] } },
        max: 110,
        semantic: 79 + 17,
      },
      {
        suite: 'design' as const,
        extra: {
          uxUiFidelity: { score: 16, justification: 'Respected theme.', themeViolations: [] },
          accessibilityScore: { score: 15, justification: 'Correct ARIA.', a11yViolations: [] },
        },
        max: 130,
        semantic: 79 + 16 + 15,
      },
      {
        suite: 'progression' as const,
        extra: { regressionScore: { score: 27, justification: 'No regressions.', brokenEpoch1Features: [], unintendedDependencyChanges: [] } },
        max: 120,
        semantic: 79 + 27,
      },
    ];

    for (const suiteCase of suiteCases) {
      const generateObject = vi.fn(async () => ({
        object: {
          ...semanticJudgeResult,
          evaluations: { ...semanticJudgeResult.evaluations, ...suiteCase.extra },
        },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }));

      const result = await runJudge({
        runId: 'pf-run-1',
        caseId: 'case-1',
        suite: suiteCase.suite,
        modelUnderTest: 'mimo/mimo-v2.5-pro',
        userPrompt: 'Do the task.',
        conversation: [],
        cognitiveTrace: [],
        vfsSnapshot: {},
        telemetry,
        toolEvents: [],
        generateObject,
        model: {} as any,
      });

      expect(result.semanticScore).toBe(suiteCase.semantic);
      expect(result.semanticMaxScore).toBe(suiteCase.max);
    }
  });

  it('injects the regression question and epoch snapshots into the progression judge prompt', () => {
    const prompts = buildJudgePrompts({
      runId: 'pf-run-prog',
      caseId: 'pf-progression-express-3',
      suite: 'progression',
      modelUnderTest: 'mimo/mimo-v2.5-pro',
      userPrompt: 'Brownfield mutation.',
      conversation: [],
      cognitiveTrace: [],
      vfsSnapshot: {},
      telemetry,
      toolEvents: [],
      progression: {
        epochs: [
          { id: 'epoch-1', label: 'Epoch 1', prompt: 'add avatar', vfsSnapshot: { '/workspace/src/routes/avatars.js': '// avatar' }, cognitiveTrace: [] },
          { id: 'epoch-2', label: 'Epoch 2', prompt: 'jwt refactor', vfsSnapshot: { '/workspace/src/middleware/auth.js': '// jwt' }, cognitiveTrace: [] },
        ],
      },
    });

    expect(prompts.system).toContain('regressionScore: 0-30');
    expect(prompts.prompt).toContain('progression_epochs_json');
    expect(prompts.prompt).toContain('avatars.js');
    expect(prompts.prompt).toContain('regressionScore');
  });

  it('includes ground_truth_test_results_json block in the prompt when groundTruth.tests is present', () => {
    const prompts = buildJudgePrompts({
      runId: 'pf-run-gt',
      caseId: 'pf-development-1',
      suite: 'development',
      modelUnderTest: 'mimo/mimo-v2.5-pro',
      userPrompt: 'Implement a calculator.',
      conversation: [],
      cognitiveTrace: [],
      vfsSnapshot: { '/workspace/calculator.ts': 'export function add(a: number, b: number) { return a + b; }' },
      telemetry,
      toolEvents: [],
      groundTruth: {
        tests: {
          ran: true,
          passed: 11,
          failed: 2,
          total: 13,
        },
      },
    });

    expect(prompts.prompt).toContain('ground_truth_test_results_json');
    expect(prompts.prompt).toContain('"passed": 11');
    expect(prompts.prompt).toContain('"failed": 2');
    expect(prompts.prompt).toContain('"total": 13');
    expect(prompts.system).toContain('algorithmicAccuracy');
    expect(prompts.system).toContain('GROUND TRUTH');
    expect(prompts.system).toContain('passed === total');
  });

  it('does not include ground_truth_test_results_json when groundTruth is absent', () => {
    const prompts = buildJudgePrompts({
      runId: 'pf-run-no-gt',
      caseId: 'pf-architecture-1',
      suite: 'architecture',
      modelUnderTest: 'mimo/mimo-v2.5-pro',
      userPrompt: 'Build an API.',
      conversation: [],
      cognitiveTrace: [],
      vfsSnapshot: {},
      telemetry,
      toolEvents: [],
    });

    expect(prompts.prompt).not.toContain('ground_truth_test_results_json');
    expect(prompts.system).not.toContain('GROUND TRUTH');
  });

  it('requires assembler dimensions and normalizes its expanded rubric to 100 points', async () => {
    const generateObject = vi.fn(async () => ({
      object: flowAssemblerSemanticJudgeResult,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    }));

    const result = await runJudge({
      runId: 'pf-run-assembler',
      caseId: 'pf-flow-assembler-101',
      suite: 'flow-assembler',
      modelUnderTest: 'mimo/mimo-v2.5-pro',
      userPrompt: 'Assemble a flow.',
      conversation: [],
      cognitiveTrace: [],
      vfsSnapshot: {},
      telemetry,
      toolEvents: [],
      generateObject,
      model: {} as any,
    });

    expect(result.semanticScore).toBe(136);
    expect(result.semanticMaxScore).toBe(150);
    expect(result.finalScore).toBe(91);
    expect(result.evaluations.dagValidity).toMatchObject({ score: 20 });
    expect(generateObject).toHaveBeenCalledWith(expect.objectContaining({
      schema: flowAssemblerJudgeSchema,
    }));
  });

  describe('judge resilience — retry and graceful degradation', () => {
    const baseOptions = {
      runId: 'pf-run-resilience',
      caseId: 'case-resilience',
      suite: 'architecture' as const,
      modelUnderTest: 'mimo/mimo-v2.5-pro',
      userPrompt: 'Build something.',
      conversation: [],
      cognitiveTrace: [],
      vfsSnapshot: {},
      telemetry,
      toolEvents: [],
      model: {} as any,
    };

    it('retry recovers: generateObject fails on attempt 1 and succeeds on attempt 2', async () => {
      let callCount = 0;
      const generateObject = vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error('boom');
        return {
          object: semanticJudgeResult,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      });

      // Make the text fallback also throw, so the only recovery path is the retry.
      const generateText = vi.fn(async () => {
        throw new Error('text fallback also broken');
      });

      const result = await runJudge({
        ...baseOptions,
        generateObject,
        generateText,
        judgeMaxAttempts: 3,
      });

      // Should be a normal (non-degraded) result.
      expect(result.judgeError).toBeFalsy();
      expect(result.verdict).toBe('pass');
      expect(result.semanticScore).toBe(79);
      expect(result.finalScore).toBeGreaterThan(0);
      // generateObject must have been called exactly twice (fail + succeed).
      expect(generateObject).toHaveBeenCalledTimes(2);
    });

    it('graceful degradation: all attempts fail → resolves with judgeError=true, never rejects', async () => {
      const generateObject = vi.fn(async () => {
        throw new Error('AI_NoObjectGeneratedError: mimo returned garbage');
      });

      // generateText returns unparseable text so the fallback also fails.
      const generateText = vi.fn(async () => ({
        text: 'not json at all — mimo is broken today',
        usage: null,
      }));

      // Must RESOLVE (not reject) — use await, not rejects.
      const result = await runJudge({
        ...baseOptions,
        generateObject,
        generateText,
        judgeMaxAttempts: 3,
      });

      expect(result.judgeError).toBe(true);
      expect(result.verdict).toBe('fail');
      expect(result.finalScore).toBe(0);
      expect(result.semanticScore).toBe(0);
      // At least one criticalFailures entry containing JUDGE_ERROR.
      expect(result.criticalFailures.some((f) => f.includes('JUDGE_ERROR'))).toBe(true);
      // Telemetry must be preserved in the degraded result.
      expect(result.telemetry).toEqual(telemetry);
      // generateObject was called maxAttempts times.
      expect(generateObject).toHaveBeenCalledTimes(3);
    });

    it('configurable model: resolveJudgeModel does not throw when FLUXOR_JUDGE_MODEL is unset and MIMO key is present', () => {
      const original = process.env.FLUXOR_JUDGE_MODEL;
      delete process.env.FLUXOR_JUDGE_MODEL;

      // Guard: skip assertion if neither API key is present (CI without secrets).
      const hasKey = !!(process.env.MIMO_API_KEY ?? process.env.AGENT_API_KEY);
      if (hasKey) {
        expect(() => resolveJudgeModel()).not.toThrow();
      } else {
        // Without a key, resolveMimoJudgeModel throws — that's expected behavior.
        expect(() => resolveJudgeModel()).toThrow(/MIMO_API_KEY/);
      }

      if (original !== undefined) {
        process.env.FLUXOR_JUDGE_MODEL = original;
      }
    });
  });

  it('aggregateSemanticResults: aggregates the ensemble by per-dimension median score and majority verdict', () => {
    const withSearchEfficiencyScore = (score: number): SemanticJudgeResult['evaluations']['searchEfficiency'] => ({
      ...semanticJudgeResult.evaluations.searchEfficiency,
      score,
    });

    const resultA: SemanticJudgeResult = {
      ...semanticJudgeResult,
      evaluations: { ...semanticJudgeResult.evaluations, searchEfficiency: withSearchEfficiencyScore(10) },
      verdict: 'pass',
      criticalFailures: ['left the sandbox root'],
    };
    const resultB: SemanticJudgeResult = {
      ...semanticJudgeResult,
      evaluations: { ...semanticJudgeResult.evaluations, searchEfficiency: withSearchEfficiencyScore(14) },
      verdict: 'pass',
      criticalFailures: ['left the sandbox root'],
    };
    const resultC: SemanticJudgeResult = {
      ...semanticJudgeResult,
      evaluations: { ...semanticJudgeResult.evaluations, searchEfficiency: withSearchEfficiencyScore(18) },
      verdict: 'fail',
      criticalFailures: [],
    };

    const aggregated = aggregateSemanticResults([resultA, resultB, resultC]);

    // Median of [10, 14, 18] is 14, contributed exactly by resultB.
    expect(aggregated.evaluations.searchEfficiency.score).toBe(14);
    // Majority verdict across ['pass', 'pass', 'fail'] is 'pass'.
    expect(aggregated.verdict).toBe('pass');
    // The duplicated criticalFailure is deduped to a single entry.
    expect(aggregated.criticalFailures).toEqual(['left the sandbox root']);
  });

  it('blinds the judge prompt to the model under test', () => {
    const prompts = buildJudgePrompts({
      runId: 'pf-run-blind',
      caseId: 'case-blind',
      suite: 'architecture',
      modelUnderTest: 'mimo/mimo-v2.5-pro',
      userPrompt: 'Create an API.',
      conversation: [],
      cognitiveTrace: [],
      vfsSnapshot: {},
      telemetry,
      toolEvents: [],
    });

    expect(prompts.prompt).toContain('<model_under_test>anonymous</model_under_test>');
    expect(prompts.prompt).not.toContain('mimo-v2.5-pro');
  });

  it('verifyDesign falls back to a bare index.html key when no /workspace path is present', async () => {
    const result = await verifyDesign({
      'index.html': '<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>x</h1></main></body></html>',
    });

    expect(result.ran).toBe(true);
  });
});
