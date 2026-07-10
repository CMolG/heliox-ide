import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { readBrandEnv } from '../lib/env-compat';
import { executeAgenticFlow } from '../harness-engine/executor';
import { runLLMStep } from '../harness-engine/llm-runner';
import {
  assemblePipeline,
  discoverPipelineComponents,
  type AssemblePipelineOptions,
  type PipelineAssembly,
  type PipelineGenerationMetadata,
} from '../meta-agent/pipeline-generator';
import { createPerformanceCase } from './procedural/case-factory';
import { createPerformanceSandbox, exportSandboxArtifacts } from './sandbox/sandbox';
import { createSandboxNetwork } from './sandbox/network';
import { PerformanceTelemetryCollector } from './telemetry/collector';
import { normalizeUsage } from './telemetry/normalize-usage';
import { runJudge } from './judge/judge-runner';
import { appendLedgerRecord } from './report/ledger';
import { renderHtmlReport } from './report/html-report';
import { verifyDevelopment } from './execution/development-verifier';
import type { TestVerificationResult } from './execution/development-verifier';
import { verifyDesign } from './execution/design-verifier';
import type { A11yVerificationResult } from './execution/design-verifier';
import { verifyApi } from './execution/api-verifier';
import type { ApiVerificationResult } from './execution/api-verifier';
import type {
  PFCognitiveTraceEntry,
  PFContextMode,
  PFConversationEntry,
  PFGroundTruth,
  PFJudgeRunner,
  PFProgressionEpochEvidence,
  PFProgressionEvidence,
  PFRunResult,
  PFSuite,
  PFStepRunner,
} from './types';

export interface RunPerformanceFrontierOptions {
  seed?: number;
  suite?: PFSuite;
  outputDir?: string;
  modelId?: string;
  stepTimeoutMs?: number;
  runStep?: PFStepRunner;
  judge?: PFJudgeRunner;
  /**
   * Forces every step's `AgenticFlow.contextMode` for this run (Step P1:
   * docs/superpowers/plans/2026-07-10-flow-context-modes.md). Omitted:
   * whatever the suite's generated flow(s) already carry — today always
   * absent/blind, since `case-factory.ts` never sets it. Applied to every
   * epoch's flow for `progression`; a no-op for `flow-assembler` (it never
   * calls `executeAgenticFlow` — see the branch below), where the CLI layer
   * (cli.ts / bench/cli.ts) is responsible for warning the caller instead of
   * silently doing nothing.
   */
  contextMode?: PFContextMode;
  assemblePipeline?: (userIntent: string, options?: AssemblePipelineOptions) => Promise<PipelineAssembly>;
  verifyDevelopment?: (vfsSnapshot: Record<string, string>) => Promise<TestVerificationResult>;
  verifyDesign?: (vfsSnapshot: Record<string, string>) => Promise<A11yVerificationResult>;
  verifyApi?: (vfsSnapshot: Record<string, string>) => Promise<ApiVerificationResult>;
}

const DEFAULT_STEP_TIMEOUT_MS = 120_000;

/**
 * Per-step timeout for output-heavy suites. team-work runs 3 sequential agents,
 * design generates a full accessible component, and each progression epoch mutates
 * a multi-file project — all of which blow past the 120s default on slower models.
 */
const SUITE_STEP_TIMEOUT_MS: Partial<Record<PFSuite, number>> = {
  'team-work': 480_000,
  design: 600_000,
  progression: 300_000,
  // from-scratch chains 6 file-writing steps (scaffold → landing → auth → tests
  // → impl → review); each assembles multiple files, so it needs the wide budget.
  'from-scratch': 480_000,
};

function createRunId(seed: number): string {
  return `pf-${new Date().toISOString().replace(/[:.]/g, '-')}-${seed}`;
}

function summarizeResultUsage(result: Awaited<ReturnType<PFStepRunner>>) {
  const usage = normalizeUsage(result.usage);
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    totalTokens: usage.totalTokens,
    latencyMs: result.metrics?.latencyMs ?? 0,
    toolCallsCount: result.toolCalls.length,
    toolResultsCount: result.toolResults.length,
  };
}

export async function runPerformanceFrontier(
  options: RunPerformanceFrontierOptions = {},
): Promise<PFRunResult> {
  const seed = options.seed ?? Number(process.env.PF_SEED ?? 1);
  const suite = options.suite ?? 'architecture';
  const modelId = options.modelId ?? readBrandEnv('FLUXOR_PF_MODEL') ?? 'mimo/mimo-v2.5-pro';
  const outputDir = options.outputDir ?? join(process.cwd(), '.fluxor', 'performance-frontier');
  const stepTimeoutMs = options.stepTimeoutMs
    ?? Number(process.env.PF_STEP_TIMEOUT_MS ?? (SUITE_STEP_TIMEOUT_MS[suite] ?? DEFAULT_STEP_TIMEOUT_MS));
  const reportsDir = join(outputDir, 'reports');
  const ledgerPath = join(outputDir, 'pf-history.jsonl');
  const runId = createRunId(seed);
  const testCase = createPerformanceCase({ suite, seed });

  // `--context-mode` override (Step P1): forces the mode for every flow this
  // run will execute, taking precedence over whatever `case-factory.ts`
  // built. Skipped for `flow-assembler`, which never calls
  // `executeAgenticFlow` — setting it there would write a misleading
  // "feedback" ledger record for a run where nothing feedback-related
  // happened; the CLI layer warns the caller about this no-op instead.
  if (options.contextMode && suite !== 'flow-assembler') {
    if (suite === 'progression') {
      for (const epoch of testCase.epochs ?? []) {
        epoch.flow.contextMode = options.contextMode;
      }
    } else {
      testCase.flow.contextMode = options.contextMode;
    }
  }

  // Effective mode actually carried by `testCase.flow` after the override
  // above — absent reads as `'blind'` (Step P2's ledger contract: records
  // written before this field existed, or for flows that never set it,
  // default to blind on read). Recorded verbatim in every ledger branch below.
  const effectiveContextMode: PFContextMode = testCase.flow.contextMode ?? 'blind';

  const telemetry = new PerformanceTelemetryCollector();
  const conversation: PFConversationEntry[] = [];
  const cognitiveTrace: PFCognitiveTraceEntry[] = [];
  const baseRunStep = options.runStep ?? runLLMStep;

  if (suite === 'flow-assembler') {
    const network = createSandboxNetwork();
    let generationMetadata: PipelineGenerationMetadata | undefined;
    try {
      const runAssembler = options.assemblePipeline ?? assemblePipeline;
      const generatedAst = await runAssembler(testCase.prompt, {
        modelId,
        telemetryFetch: network.fetch as unknown as typeof fetch,
        onGeneration: (metadata) => {
          generationMetadata = metadata;
        },
      });
    const discoveredCatalog = generationMetadata?.discoveredCatalog ?? discoverPipelineComponents(testCase.prompt);
    const usage = normalizeUsage(generationMetadata?.usage ?? null);
    const summary = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens ?? 0,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      totalTokens: usage.totalTokens,
      latencyMs: generationMetadata?.latencyMs ?? 0,
      stepCount: 1,
      toolCallsCount: 0,
      toolResultsCount: 0,
      mcpToolCalls: 0,
      mcpSuccessfulToolCalls: 0,
      mcpInterceptedToolCalls: 0,
      mcpSchemaErrors: 0,
      mcpSyntaxPrecision: 1,
    };
    const flowAssembler = {
      userIntent: testCase.prompt,
      generatedAst,
      discoveredCatalog,
    };
    conversation.push({
      role: 'system',
      content: 'Fluxor Meta-Agent assembled a pipeline AST from a discovered Roles/Mods catalog.',
    });
    conversation.push({ role: 'user', content: testCase.prompt });
    conversation.push({ role: 'assistant', content: JSON.stringify(generatedAst, null, 2) });
    cognitiveTrace.push({
      type: 'thought',
      stepId: 'flow-assembler-probe',
      content: `Discovery selected roles: ${discoveredCatalog.roles.map((role) => role.id).join(', ') || 'none'}; mods: ${discoveredCatalog.mods.map((mod) => mod.id).join(', ') || 'none'}.`,
    });
    cognitiveTrace.push({
      type: 'thought',
      stepId: 'flow-assembler-probe',
      content: JSON.stringify(generatedAst, null, 2),
    });

    const judgeInput = {
      runId,
      caseId: testCase.id,
      suite: testCase.suite,
      modelUnderTest: modelId,
      userPrompt: testCase.prompt,
      conversation,
      vfsSnapshot: {},
      telemetry: summary,
      toolEvents: [],
      cognitiveTrace,
      flowAssembler,
    };
    const judgeResult = options.judge
      ? await options.judge(judgeInput)
      : await runJudge(judgeInput);
    const artifactsDir = join(outputDir, 'artifacts', runId);
    const reportResult = {
      ...judgeResult,
      cognitiveTrace,
      flowAssembler,
      generatedArtifacts: [],
      artifactsDir,
    };
    const reportPath = join(reportsDir, `${runId}.html`);

    await mkdir(reportsDir, { recursive: true });
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(reportPath, renderHtmlReport(reportResult), 'utf-8');
    await appendLedgerRecord(ledgerPath, {
      runId,
      timestamp: new Date().toISOString(),
      suite: testCase.suite,
      caseId: testCase.id,
      seed,
      modelId,
      contextMode: effectiveContextMode,
      finalScore: judgeResult.finalScore,
      semanticScore: judgeResult.semanticScore,
      telemetryScore: judgeResult.telemetryScore,
      verdict: judgeResult.verdict,
      telemetry: summary,
      flowAssembler,
      artifactsDir,
      generatedArtifacts: [],
      reportPath,
    });

    return {
      ...reportResult,
      reportPath,
      ledgerPath,
    };
    } finally {
      network.destroy();
    }
  }

  if (suite === 'progression') {
    const epochs = testCase.epochs ?? [];
    if (epochs.length === 0) {
      throw new Error(`Progression case "${testCase.id}" has no epochs.`);
    }

    // One sandbox seeded with the Epoch 0 project, mutated across epochs WITHOUT
    // being destroyed between them — so later epochs can regress earlier work.
    const sandbox = createPerformanceSandbox({ initialFiles: testCase.initialFiles });

    try {
      const epochEvidence: PFProgressionEpochEvidence[] = [];

      for (const epoch of epochs) {
        const epochTrace: PFCognitiveTraceEntry[] = [];
        conversation.push({ role: 'system', content: `=== ${epoch.label} ===` });

        await executeAgenticFlow(epoch.flow, {
          rootDir: sandbox.rootDir,
          fileSystem: sandbox.fileSystem,
          telemetrySink: (event) => telemetry.recordToolCall(event),
          onLLMStepTelemetry: (event) => telemetry.recordLLMStep(event),
          modelId,
          timeoutMs: stepTimeoutMs,
          runStep: async (input) => {
            conversation.push({ role: 'user', content: input.userPrompt });
            const result = await baseRunStep(input);
            conversation.push({ role: 'assistant', content: result.text });
            const taggedTrace = (result.cognitiveTrace ?? []).map((entry) => ({
              ...entry,
              stepId: entry.stepId ?? input.step.id,
              epoch: epoch.id,
            }));
            epochTrace.push(...taggedTrace);
            cognitiveTrace.push(...taggedTrace);

            if (!result.metrics) {
              telemetry.recordLLMStep({
                flowId: input.flowId,
                stepId: input.step.id,
                modelId,
                ...summarizeResultUsage(result),
              });
            }

            return result;
          },
        });

        epochEvidence.push({
          id: epoch.id,
          label: epoch.label,
          prompt: epoch.prompt,
          vfsSnapshot: sandbox.snapshot(),
          cognitiveTrace: epochTrace,
        });
      }

      const summary = telemetry.summary();
      const finalSnapshot = sandbox.snapshot();
      const artifactExport = await exportSandboxArtifacts({
        runId,
        outputDir,
        vfsSnapshot: finalSnapshot,
      });

      // --- API ground-truth verification (progression suite) ---
      let progressionGroundTruth: import('./types').PFGroundTruth | undefined;
      try {
        const runVerifyApi = options.verifyApi ?? verifyApi;
        const apiResult = await runVerifyApi(finalSnapshot);
        progressionGroundTruth = {
          api: {
            booted: apiResult.booted,
            checks: apiResult.checks.map((c) => ({
              name: c.name,
              ok: c.ok,
              status: c.status,
              detail: c.detail,
            })),
            errorMessage: apiResult.errorMessage,
          },
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        progressionGroundTruth = {
          api: {
            booted: false,
            checks: [],
            errorMessage: `verifyApi threw unexpectedly: ${msg}`,
          },
        };
      }

      const progression: PFProgressionEvidence = { epochs: epochEvidence };
      const judgeInput = {
        runId,
        caseId: testCase.id,
        suite: testCase.suite,
        modelUnderTest: modelId,
        userPrompt: testCase.prompt,
        conversation,
        vfsSnapshot: finalSnapshot,
        telemetry: summary,
        toolEvents: telemetry.toolCalls,
        cognitiveTrace,
        progression,
        groundTruth: progressionGroundTruth,
      };
      const judgeResult = options.judge
        ? await options.judge(judgeInput)
        : await runJudge(judgeInput);
      const reportResult = {
        ...judgeResult,
        cognitiveTrace,
        progression,
        groundTruth: progressionGroundTruth,
        generatedArtifacts: artifactExport.files,
        artifactsDir: artifactExport.artifactsDir,
      };
      const reportPath = join(reportsDir, `${runId}.html`);

      await mkdir(reportsDir, { recursive: true });
      await writeFile(reportPath, renderHtmlReport(reportResult), 'utf-8');
      await appendLedgerRecord(ledgerPath, {
        runId,
        timestamp: new Date().toISOString(),
        suite: testCase.suite,
        caseId: testCase.id,
        seed,
        modelId,
        contextMode: effectiveContextMode,
        finalScore: judgeResult.finalScore,
        semanticScore: judgeResult.semanticScore,
        telemetryScore: judgeResult.telemetryScore,
        verdict: judgeResult.verdict,
        telemetry: summary,
        artifactsDir: artifactExport.artifactsDir,
        generatedArtifacts: artifactExport.files,
        reportPath,
      });

      return {
        ...reportResult,
        reportPath,
        ledgerPath,
      };
    } finally {
      sandbox.destroy();
    }
  }

  const sandbox = createPerformanceSandbox({ initialFiles: testCase.initialFiles });

  try {
    await executeAgenticFlow(testCase.flow, {
      rootDir: sandbox.rootDir,
      fileSystem: sandbox.fileSystem,
      telemetrySink: (event) => telemetry.recordToolCall(event),
      onLLMStepTelemetry: (event) => telemetry.recordLLMStep(event),
      modelId,
      timeoutMs: stepTimeoutMs,
      runStep: async (input) => {
        conversation.push({ role: 'system', content: input.systemPrompt });
        conversation.push({ role: 'user', content: input.userPrompt });
        const result = await baseRunStep(input);
        conversation.push({ role: 'assistant', content: result.text });
        cognitiveTrace.push(...(result.cognitiveTrace ?? []).map((entry) => ({
          ...entry,
          stepId: entry.stepId ?? input.step.id,
        })));

        if (!result.metrics) {
          telemetry.recordLLMStep({
            flowId: input.flowId,
            stepId: input.step.id,
            modelId,
            ...summarizeResultUsage(result),
          });
        }

        return result;
      },
    });

    const summary = telemetry.summary();
    const vfsSnapshot = sandbox.snapshot();
    const artifactExport = await exportSandboxArtifacts({
      runId,
      outputDir,
      vfsSnapshot,
    });

    let groundTruth: PFGroundTruth | undefined;
    if (suite === 'development' || suite === 'from-scratch') {
      const runVerify = options.verifyDevelopment ?? verifyDevelopment;
      try {
        const verifyResult = await runVerify(vfsSnapshot);
        groundTruth = {
          tests: {
            ran: verifyResult.ran,
            passed: verifyResult.passed,
            failed: verifyResult.failed,
            total: verifyResult.total,
            errorMessage: verifyResult.errorMessage,
          },
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        groundTruth = {
          tests: {
            ran: false,
            passed: 0,
            failed: 0,
            total: 0,
            errorMessage: `verifyDevelopment threw unexpectedly: ${msg}`,
          },
        };
      }
    }

    if (suite === 'design') {
      const runVerify = options.verifyDesign ?? verifyDesign;
      try {
        const verifyResult = await runVerify(vfsSnapshot);
        groundTruth = {
          a11y: {
            ran: verifyResult.ran,
            violations: verifyResult.violations,
            critical: verifyResult.critical,
            passes: verifyResult.passes,
            errorMessage: verifyResult.errorMessage,
          },
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        groundTruth = {
          a11y: {
            ran: false,
            violations: 0,
            critical: [],
            passes: 0,
            errorMessage: `verifyDesign threw unexpectedly: ${msg}`,
          },
        };
      }
    }

    const judgeInput = {
      runId,
      caseId: testCase.id,
      suite: testCase.suite,
      modelUnderTest: modelId,
      userPrompt: testCase.prompt,
      conversation,
      vfsSnapshot,
      telemetry: summary,
      toolEvents: telemetry.toolCalls,
      cognitiveTrace,
      groundTruth,
    };
    const judgeResult = options.judge
      ? await options.judge(judgeInput)
      : await runJudge(judgeInput);
    const reportResult = {
      ...judgeResult,
      cognitiveTrace,
      groundTruth,
      generatedArtifacts: artifactExport.files,
      artifactsDir: artifactExport.artifactsDir,
    };
    const reportPath = join(reportsDir, `${runId}.html`);

    await mkdir(reportsDir, { recursive: true });
    await writeFile(reportPath, renderHtmlReport(reportResult), 'utf-8');
    await appendLedgerRecord(ledgerPath, {
      runId,
      timestamp: new Date().toISOString(),
      suite: testCase.suite,
      caseId: testCase.id,
      seed,
      modelId,
      contextMode: effectiveContextMode,
      finalScore: judgeResult.finalScore,
      semanticScore: judgeResult.semanticScore,
      telemetryScore: judgeResult.telemetryScore,
      verdict: judgeResult.verdict,
      telemetry: summary,
      artifactsDir: artifactExport.artifactsDir,
      generatedArtifacts: artifactExport.files,
      reportPath,
    });

    return {
      ...reportResult,
      reportPath,
      ledgerPath,
    };
  } finally {
    sandbox.destroy();
  }
}
