import { createOpenAI } from '@ai-sdk/openai';
import {
  generateObject as aiGenerateObject,
  generateText as aiGenerateText,
  NoObjectGeneratedError,
  type LanguageModel,
} from 'ai';
import type { PFJudgeInput, PFJudgeResult, PFSuite, PFTelemetryEfficiencyEvaluation } from '../types';
import { normalizeUsage } from '../telemetry/normalize-usage';
import { logProviderHeaders, normalizeProviderHeaders } from '../telemetry/provider-headers';
import {
  businessKnowledgeJudgeSchema,
  designJudgeSchema,
  developmentJudgeSchema,
  flowAssemblerJudgeSchema,
  judgeSchema,
  progressionJudgeSchema,
  type SemanticJudgeResult,
} from './judge-schema';
import { buildJudgePrompts } from './judge-prompt';
import { resolveHarnessModel } from '../../harness-engine/llm-runner';

/** Semantic max score per suite = sum of the maxima of its applicable dimensions. */
const SUITE_SEMANTIC_MAX_SCORE: Record<PFSuite, number> = {
  architecture: 90,
  analysis: 90,
  business: 90,
  'team-work': 90,
  'flow-assembler': 150, // base 90 + dag/component/instruction (3 × 20)
  development: 110, // base 90 + algorithmicAccuracy (20)
  'business-knowledge': 110, // base 90 + domainLogicAdherence (20)
  design: 130, // base 90 + uxUiFidelity + accessibilityScore (2 × 20)
  progression: 120, // base 90 + regressionScore (30)
  'from-scratch': 150, // base 90 + uxUiFidelity + accessibilityScore + algorithmicAccuracy (3 × 20)
};

function resolveSemanticSchema(suite: PFSuite) {
  switch (suite) {
    case 'flow-assembler':
      return flowAssemblerJudgeSchema;
    case 'development':
      return developmentJudgeSchema;
    case 'business-knowledge':
      return businessKnowledgeJudgeSchema;
    case 'design':
      return designJudgeSchema;
    case 'progression':
      return progressionJudgeSchema;
    default:
      return judgeSchema;
  }
}

export type GenerateObjectLike = (options: unknown) => Promise<{
  object: SemanticJudgeResult;
  usage?: unknown;
  response?: {
    headers?: unknown;
  };
}>;

export type GenerateTextLike = (options: unknown) => Promise<{
  text: string;
  usage?: unknown;
  response?: {
    headers?: unknown;
  };
}>;

export interface RunJudgeOptions extends PFJudgeInput {
  model?: LanguageModel;
  generateObject?: GenerateObjectLike;
  generateText?: GenerateTextLike;
  /** Maximum number of attempts to get a valid semantic evaluation. Defaults to 3. Can also be set via HELIOX_JUDGE_MAX_ATTEMPTS env var. */
  judgeMaxAttempts?: number;
}

function resolveMimoJudgeModel(): LanguageModel {
  const apiKey = process.env.MIMO_API_KEY ?? process.env.AGENT_API_KEY;
  if (!apiKey) {
    throw new Error('MIMO_API_KEY or AGENT_API_KEY is required to run the Performance Frontier judge.');
  }

  const mimoProvider = createOpenAI({
    baseURL: 'https://token-plan-ams.xiaomimimo.com/v1',
    apiKey,
  });

  return mimoProvider.chat('mimo-v2.5-pro');
}

/**
 * Resolves the judge model.
 * If HELIOX_JUDGE_MODEL is set, routes through resolveHarnessModel (supports
 * anthropic/openai/openrouter/mimo providers) to avoid self-judging bias.
 * Otherwise falls back to the Mimo default (resolveMimoJudgeModel).
 */
export function resolveJudgeModel(): LanguageModel {
  const envModel = process.env.HELIOX_JUDGE_MODEL;
  if (envModel) {
    return resolveHarnessModel(envModel);
  }
  return resolveMimoJudgeModel();
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

async function repairJsonText({ text }: { text: string }): Promise<string | null> {
  return extractJsonObject(text);
}

type SemanticJudgeParser = {
  parse: (value: unknown) => SemanticJudgeResult;
};

function parseSemanticJudgeText(
  text: string | undefined,
  schema: SemanticJudgeParser = judgeSchema,
): SemanticJudgeResult | null {
  if (!text) return null;
  const json = extractJsonObject(text);
  if (!json) return null;
  try {
    return schema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

function suiteExtraDimensionLines(suite: PFSuite): string[] {
  switch (suite) {
    case 'flow-assembler':
      return [
        '    "dagValidity": { "score": 0, "justification": "string", "missingDependencyIds": [], "cycleDetected": false }, // score 0-20',
        '    "componentSelection": { "score": 0, "justification": "string", "inappropriateRoleIds": [], "inappropriateModIds": [] }, // score 0-20',
        '    "instructionQuality": { "score": 0, "justification": "string", "weakStepIds": [], "selfSolvingDetected": false } // score 0-20',
      ];
    case 'development':
      return ['    "algorithmicAccuracy": { "score": 0, "justification": "string", "edgeCasesCovered": [], "edgeCasesMissed": [] } // score 0-20'];
    case 'business-knowledge':
      return ['    "domainLogicAdherence": { "score": 0, "justification": "string", "violatedRules": [] } // score 0-20'];
    case 'design':
      return [
        '    "uxUiFidelity": { "score": 0, "justification": "string", "themeViolations": [] }, // score 0-20',
        '    "accessibilityScore": { "score": 0, "justification": "string", "a11yViolations": [] } // score 0-20',
      ];
    case 'progression':
      return ['    "regressionScore": { "score": 0, "justification": "string", "brokenEpoch1Features": [], "unintendedDependencyChanges": [] } // score 0-30'];
    case 'from-scratch':
      return [
        '    "uxUiFidelity": { "score": 0, "justification": "string", "themeViolations": [] }, // score 0-20',
        '    "accessibilityScore": { "score": 0, "justification": "string", "a11yViolations": [] }, // score 0-20',
        '    "algorithmicAccuracy": { "score": 0, "justification": "string", "edgeCasesCovered": [], "edgeCasesMissed": [] } // score 0-20',
      ];
    default:
      return [];
  }
}

function buildRawJsonFallbackPrompt(prompt: string, suite: PFSuite): string {
  const extraDimensions = suiteExtraDimensionLines(suite);
  const hasExtras = extraDimensions.length > 0;

  return [
    prompt,
    '',
    'Return ONLY a raw JSON object. No Markdown. No prose.',
    'The JSON must match this exact TypeScript shape:',
    '{',
    '  "runId": "string",',
    '  "evaluations": {',
    '    "searchEfficiency": { "score": 0, "justification": "string", "unnecessaryFilesRead": [] }, // score 0-20',
    '    "toolMastery": { "score": 0, "justification": "string", "syntaxErrorsCount": 0 }, // score 0-20',
    '    "errorRecovery": { "score": 0, "justification": "string", "loopDetected": false }, // score 0-20',
    '    "pipelineCohesion": { "score": 0, "justification": "string", "handoffBreaks": [] }, // score 0-20',
    hasExtras
      ? '    "outputQuality": { "score": 0, "justification": "string", "edgeCasesMissed": [] }, // score 0-10'
      : '    "outputQuality": { "score": 0, "justification": "string", "edgeCasesMissed": [] } // score 0-10',
    ...extraDimensions,
    '  },',
    '  "finalJudgeScore": 0, // exact SUM of the scores above, never an average',
    '  "verdict": "pass",',
    '  "criticalFailures": []',
    '}',
  ].join('\n');
}

function calculateSemanticScore(semantic: SemanticJudgeResult): number {
  return (
    semantic.evaluations.searchEfficiency.score
    + semantic.evaluations.toolMastery.score
    + semantic.evaluations.errorRecovery.score
    + semantic.evaluations.pipelineCohesion.score
    + semantic.evaluations.outputQuality.score
    + (semantic.evaluations.dagValidity?.score ?? 0)
    + (semantic.evaluations.componentSelection?.score ?? 0)
    + (semantic.evaluations.instructionQuality?.score ?? 0)
    + (semantic.evaluations.algorithmicAccuracy?.score ?? 0)
    + (semantic.evaluations.domainLogicAdherence?.score ?? 0)
    + (semantic.evaluations.uxUiFidelity?.score ?? 0)
    + (semantic.evaluations.accessibilityScore?.score ?? 0)
    + (semantic.evaluations.regressionScore?.score ?? 0)
  );
}

function calculateSemanticMaxScore(input: PFJudgeInput): number {
  return SUITE_SEMANTIC_MAX_SCORE[input.suite] ?? 90;
}

function logJudgeProviderHeaders(response: { headers?: unknown } | undefined, usage: unknown): void {
  const providerHeaders = normalizeProviderHeaders(response?.headers);
  const normalizedUsage = normalizeUsage(usage ?? null, providerHeaders);
  logProviderHeaders(providerHeaders, {
    inputTokens: normalizedUsage.inputTokens,
    outputTokens: normalizedUsage.outputTokens,
    reasoningTokens: normalizedUsage.reasoningTokens ?? 0,
    totalTokens: normalizedUsage.totalTokens,
  }, 'judge');
}

export function calculateTelemetryEfficiencyScore(
  telemetry: PFJudgeInput['telemetry'],
): PFTelemetryEfficiencyEvaluation {
  let score = 10;

  if (telemetry.totalTokens > 30_000) score -= 5;
  else if (telemetry.totalTokens > 12_000) score -= 3;
  else if (telemetry.totalTokens > 6_000) score -= 1;

  if (telemetry.latencyMs > 120_000) score -= 4;
  else if (telemetry.latencyMs > 45_000) score -= 2;
  else if (telemetry.latencyMs > 15_000) score -= 1;

  if (telemetry.mcpSyntaxPrecision < 0.75) score -= 4;
  else if (telemetry.mcpSyntaxPrecision < 0.9) score -= 2;
  else if (telemetry.mcpSyntaxPrecision < 1) score -= 1;

  const bounded = Math.max(0, Math.min(10, score));
  return {
    score: bounded,
    justification: `Computed from latency ${Math.round(telemetry.latencyMs)}ms, ${telemetry.totalTokens} total tokens, and MCP syntax precision ${telemetry.mcpSyntaxPrecision.toFixed(3)}.`,
    latencyMs: telemetry.latencyMs,
    totalTokens: telemetry.totalTokens,
  };
}

/**
 * Attempts one semantic evaluation cycle:
 * 1. generateObject (with experimental_repairText)
 * 2. On NoObjectGeneratedError → try inline text repair
 * 3. On any other failure → generateText raw-JSON fallback
 * Returns the parsed SemanticJudgeResult or throws the last error.
 */
async function attemptSemanticEvaluation(
  model: LanguageModel,
  prompts: { system: string; prompt: string },
  semanticSchema: { parse: (v: unknown) => SemanticJudgeResult },
  suite: PFSuite,
  generateObject: GenerateObjectLike,
  generateText: GenerateTextLike,
): Promise<SemanticJudgeResult> {
  try {
    const result = await generateObject({
      model,
      schema: semanticSchema,
      schemaName: 'PerformanceFrontierJudgeResult',
      schemaDescription: 'Strict cognitive evaluation of an agentic coding run. Return only this object.',
      system: prompts.system,
      prompt: prompts.prompt,
      temperature: 0,
      experimental_repairText: repairJsonText,
    });
    logJudgeProviderHeaders(result.response, result.usage ?? null);
    return semanticSchema.parse(result.object);
  } catch (error) {
    const repaired = NoObjectGeneratedError.isInstance(error)
      ? parseSemanticJudgeText(error.text, semanticSchema)
      : null;
    if (repaired) {
      return repaired;
    }
    // Text fallback — ask model to return raw JSON without schema enforcement
    const fallback = await generateText({
      model,
      system: prompts.system,
      prompt: buildRawJsonFallbackPrompt(prompts.prompt, suite),
      temperature: 0,
    });
    logJudgeProviderHeaders(fallback.response, fallback.usage ?? null);
    const fallbackSemantic = parseSemanticJudgeText(fallback.text, semanticSchema);
    if (!fallbackSemantic) throw error;
    return fallbackSemantic;
  }
}

export async function runJudge(options: RunJudgeOptions): Promise<PFJudgeResult> {
  const prompts = buildJudgePrompts(options);
  const semanticSchema = resolveSemanticSchema(options.suite);
  const generateObject = options.generateObject ?? aiGenerateObject as unknown as GenerateObjectLike;
  const generateText = options.generateText ?? aiGenerateText as unknown as GenerateTextLike;
  const model = options.model ?? resolveJudgeModel();

  const envMaxAttempts = process.env.HELIOX_JUDGE_MAX_ATTEMPTS
    ? parseInt(process.env.HELIOX_JUDGE_MAX_ATTEMPTS, 10)
    : undefined;
  const maxAttempts = options.judgeMaxAttempts ?? (envMaxAttempts && envMaxAttempts > 0 ? envMaxAttempts : 3);

  let semantic: SemanticJudgeResult | null = null;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      semantic = await attemptSemanticEvaluation(
        model,
        prompts,
        semanticSchema,
        options.suite,
        generateObject,
        generateText,
      );
      break; // success — exit retry loop
    } catch (error) {
      lastError = error;
    }
  }

  const telemetryEfficiency = calculateTelemetryEfficiencyScore(options.telemetry);
  const semanticMaxScore = calculateSemanticMaxScore(options);

  if (!semantic) {
    // All attempts exhausted — return a DEGRADED result; never throw.
    const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
    return {
      runId: options.runId,
      caseId: options.caseId,
      suite: options.suite,
      modelUnderTest: options.modelUnderTest,
      verdict: 'fail',
      finalScore: 0,
      semanticScore: 0,
      semanticMaxScore,
      telemetryScore: telemetryEfficiency.score,
      evaluations: {
        telemetryEfficiency,
      },
      criticalFailures: [
        `JUDGE_ERROR: judge failed to produce a valid evaluation after ${maxAttempts} attempt${maxAttempts === 1 ? '' : 's'}: ${errorMessage}`,
      ],
      telemetry: options.telemetry,
      cognitiveTrace: options.cognitiveTrace,
      ...(options.flowAssembler !== undefined ? { flowAssembler: options.flowAssembler } : {}),
      ...(options.progression !== undefined ? { progression: options.progression } : {}),
      ...(options.groundTruth !== undefined ? { groundTruth: options.groundTruth } : {}),
      judgeError: true,
    };
  }

  const semanticScore = calculateSemanticScore(semantic);
  const finalScore = Math.round(((semanticScore + telemetryEfficiency.score) / (semanticMaxScore + 10)) * 100);

  return {
    runId: options.runId,
    caseId: options.caseId,
    suite: options.suite,
    modelUnderTest: options.modelUnderTest,
    verdict: semantic.verdict,
    finalScore,
    semanticScore,
    semanticMaxScore,
    telemetryScore: telemetryEfficiency.score,
    evaluations: {
      ...semantic.evaluations,
      telemetryEfficiency,
    },
    criticalFailures: semantic.criticalFailures,
    telemetry: options.telemetry,
    cognitiveTrace: options.cognitiveTrace,
  };
}
