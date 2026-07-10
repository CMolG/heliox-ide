/**
 * arena-runner.ts — Fluxor Arena orchestrator
 *
 * Mass-benchmarks LLMs from OpenRouter against the Performance Frontier (PF)
 * suites and emits a leaderboard. For every model it runs each configured suite
 * independently; the model's `finalArenaScore` is the arithmetic mean of the
 * per-suite scores. Network failures (429/502 from free models, etc.) are
 * isolated per suite so a single bad model never halts the Arena.
 *
 * Run with: `npm run pf:arena`
 *
 * Env knobs:
 *   ARENA_SEED            PF case seed (default 1)
 *   ARENA_FREE_LIMIT      max number of free models to benchmark (default 6)
 *   ARENA_SUITES          comma list overriding suites (e.g. "architecture,assembler")
 *   ARENA_MODELS          comma list pinning the exact roster (e.g. "z-ai/glm-5.2");
 *                         bypasses free discovery and forced injection
 *   ARENA_OUTPUT_DIR      output dir (default .fluxor/performance-frontier)
 *   OPENROUTER_API_KEY    required to reach the OpenRouter models + inference API
 */
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { loadDotEnv } from '../env';
import { runPerformanceFrontier } from '../runner';
import type { PFRunResult, PFSuite } from '../types';
import { calculateExecutionCost } from '../telemetry/cost-calculator';
import {
  ARENA_FORCED_MODEL_IDS,
  buildArenaModelList,
  fetchArenaModels,
  type ArenaModel,
} from './model-fetcher';

export type ArenaScoreKey = 'architecture' | 'teamWork' | 'assembler';

export type ArenaScoreBreakdown = Record<ArenaScoreKey, number | null>;

export interface ArenaSuiteConfig {
  suite: PFSuite;
  scoreKey: ArenaScoreKey;
}

/** Suites each model is evaluated against, mapped to leaderboard score keys. */
export const ARENA_SUITES: ArenaSuiteConfig[] = [
  { suite: 'architecture', scoreKey: 'architecture' },
  { suite: 'team-work', scoreKey: 'teamWork' },
  { suite: 'flow-assembler', scoreKey: 'assembler' },
];

export interface ArenaLeaderboardEntry {
  modelId: string;
  name: string;
  status: 'completed' | 'api_error';
  scores: ArenaScoreBreakdown;
  finalArenaScore: number;
  totalTokens: number;
  executionCostUsd: number;
  /** Per-suite failure messages, present only when something went wrong. */
  errors?: string[];
  /** Average wall-clock latency in ms across successful suites; absent when all suites failed. */
  avgLatencyMs?: number;
}

const DEFAULT_SEED = 1;
const DEFAULT_FREE_LIMIT = 6;
const DEFAULT_SUITE_MAX_SCORE = 90;

/**
 * Normalize a suite's raw semanticScore to a comparable 0–100 scale. Suites have
 * different maxima (architecture 90, flow-assembler 150), so the raw scores are
 * not directly averageable — normalizing makes the per-suite mean meaningful.
 */
export function normalizeSemanticScore(result: Pick<PFRunResult, 'semanticScore' | 'semanticMaxScore'>): number {
  const max = result.semanticMaxScore && result.semanticMaxScore > 0
    ? result.semanticMaxScore
    : DEFAULT_SUITE_MAX_SCORE;
  return Math.round((result.semanticScore / max) * 100);
}

/** Arithmetic mean of the non-null per-suite scores, rounded. 0 when none. */
export function computeFinalArenaScore(scores: ArenaScoreBreakdown): number {
  const values = Object.values(scores).filter((value): value is number => value !== null);
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(mean);
}

function roundCost(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface EvaluateArenaModelOptions {
  seed: number;
  suites: ArenaSuiteConfig[];
  /** Injectable PF runner (defaults to runPerformanceFrontier) — eases testing. */
  runSuite?: (suite: PFSuite, modelId: string, seed: number) => Promise<PFRunResult>;
  onSuiteResult?: (entry: { modelId: string; suite: PFSuite; score: number; costUsd: number }) => void;
}

/**
 * Evaluate a single model across every suite, isolating each suite call in its
 * own try/catch. A model is `completed` if at least one suite succeeded,
 * otherwise `api_error`.
 */
export async function evaluateArenaModel(
  model: ArenaModel,
  options: EvaluateArenaModelOptions,
): Promise<ArenaLeaderboardEntry> {
  // Route the model through the OpenRouter provider in the harness engine.
  const harnessModelId = `openrouter/${model.id}`;
  const runSuite = options.runSuite
    ?? ((suite: PFSuite, modelId: string, seed: number) => runPerformanceFrontier({ suite, modelId, seed }));

  const scores: ArenaScoreBreakdown = { architecture: null, teamWork: null, assembler: null };
  const errors: string[] = [];
  let totalTokens = 0;
  let executionCostUsd = 0;
  let totalLatencyMs = 0;
  let successfulSuites = 0;
  let anySuccess = false;

  for (const { suite, scoreKey } of options.suites) {
    try {
      const result = await runSuite(suite, harnessModelId, options.seed);
      const score = normalizeSemanticScore(result);
      scores[scoreKey] = score;
      totalTokens += result.telemetry.totalTokens;
      totalLatencyMs += result.telemetry.latencyMs;
      successfulSuites += 1;
      const cost = calculateExecutionCost(
        {
          promptTokens: result.telemetry.inputTokens,
          // OpenRouter bills reasoning tokens at the completion rate, and the
          // normalizer reports them separately from visible output tokens.
          completionTokens: result.telemetry.outputTokens + (result.telemetry.reasoningTokens ?? 0),
        },
        model.pricing,
      );
      executionCostUsd += cost.executionCostUsd;
      anySuccess = true;
      options.onSuiteResult?.({ modelId: model.id, suite, score, costUsd: cost.executionCostUsd });
    } catch (error) {
      // 429 / 502 / model-not-found etc. — record and keep going.
      errors.push(`${suite}: ${errorMessage(error)}`);
    }
  }

  const avgLatencyMs = successfulSuites > 0 ? Math.round(totalLatencyMs / successfulSuites) : undefined;

  return {
    modelId: model.id,
    name: model.name,
    status: anySuccess ? 'completed' : 'api_error',
    scores,
    finalArenaScore: computeFinalArenaScore(scores),
    totalTokens,
    executionCostUsd: roundCost(executionCostUsd),
    ...(errors.length > 0 ? { errors } : {}),
    ...(avgLatencyMs !== undefined ? { avgLatencyMs } : {}),
  };
}

/** Sort: highest score first, with api_error models sinking to the bottom. */
export function sortLeaderboard(entries: ArenaLeaderboardEntry[]): ArenaLeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'completed' ? -1 : 1;
    return b.finalArenaScore - a.finalArenaScore;
  });
}

export interface RunArenaOptions {
  seed?: number;
  freeModelLimit?: number;
  suites?: ArenaSuiteConfig[];
  outputDir?: string;
  models?: ArenaModel[];
  /** Pin the roster to exactly these OpenRouter ids (skips free discovery). */
  modelIds?: string[];
}

export function parseModelIdsEnv(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const ids = raw.split(',').map((part) => part.trim()).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

function parseSuitesEnv(raw: string | undefined): ArenaSuiteConfig[] | undefined {
  if (!raw) return undefined;
  const requested = raw.split(',').map((part) => part.trim()).filter(Boolean);
  const matched = requested
    .map((name) => (name === 'assembler' ? 'flow-assembler' : name))
    .map((suite) => ARENA_SUITES.find((config) => config.suite === suite))
    .filter((config): config is ArenaSuiteConfig => config !== undefined);
  return matched.length > 0 ? matched : undefined;
}

export async function runArena(options: RunArenaOptions = {}): Promise<ArenaLeaderboardEntry[]> {
  const seed = options.seed ?? Number(process.env.ARENA_SEED ?? DEFAULT_SEED);
  const freeModelLimit = options.freeModelLimit
    ?? Number(process.env.ARENA_FREE_LIMIT ?? DEFAULT_FREE_LIMIT);
  const suites = options.suites ?? parseSuitesEnv(process.env.ARENA_SUITES) ?? ARENA_SUITES;
  const outputDir = options.outputDir
    ?? process.env.ARENA_OUTPUT_DIR
    ?? join(process.cwd(), '.fluxor', 'performance-frontier');
  const leaderboardPath = join(outputDir, 'fluxor-leaderboard.json');

  // An explicit roster (option or ARENA_MODELS) pins exactly which models run,
  // using live catalog pricing; otherwise we discover free models + forced ones.
  const explicitModelIds = options.modelIds ?? parseModelIdsEnv(process.env.ARENA_MODELS);

  // Model discovery is resilient: if OpenRouter is unreachable we still benchmark
  // the pinned/forced models so the Arena always produces a leaderboard.
  let models = options.models;
  if (!models) {
    try {
      models = explicitModelIds
        ? await fetchArenaModels({ forcedModelIds: explicitModelIds, freeModelLimit: 0 })
        : await fetchArenaModels({ freeModelLimit });
    } catch (error) {
      console.warn(`[Arena] Model discovery failed, falling back to pinned/forced models only: ${errorMessage(error)}`);
      models = buildArenaModelList([], explicitModelIds ?? ARENA_FORCED_MODEL_IDS);
    }
  }

  console.log(`[Arena] Benchmarking ${models.length} models across ${suites.length} suites (seed ${seed}).`);

  const leaderboard: ArenaLeaderboardEntry[] = [];
  for (const [index, model] of models.entries()) {
    console.log(`[Arena] (${index + 1}/${models.length}) ${model.id}`);
    let entry: ArenaLeaderboardEntry;
    try {
      entry = await evaluateArenaModel(model, {
        seed,
        suites,
        onSuiteResult: ({ suite, score, costUsd }) => {
          console.log(`    ✓ ${suite}: ${score}/100${costUsd > 0 ? ` ($${costUsd.toFixed(6)})` : ' (free)'}`);
        },
      });
    } catch (error) {
      // Defensive: evaluateArenaModel already isolates suites, but never let an
      // unexpected throw abort the whole Arena.
      entry = {
        modelId: model.id,
        name: model.name,
        status: 'api_error',
        scores: { architecture: null, teamWork: null, assembler: null },
        finalArenaScore: 0,
        totalTokens: 0,
        executionCostUsd: 0,
        errors: [errorMessage(error)],
      };
    }

    if (entry.status === 'api_error') {
      console.warn(`    ✗ ${model.id} → api_error${entry.errors ? `: ${entry.errors[0]}` : ''}`);
    } else {
      console.log(`    → finalArenaScore ${entry.finalArenaScore}/100, ${entry.totalTokens} tokens, $${entry.executionCostUsd.toFixed(6)}`);
    }
    leaderboard.push(entry);
  }

  const sorted = sortLeaderboard(leaderboard);
  await mkdir(outputDir, { recursive: true });
  await writeFile(leaderboardPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf-8');
  console.log(`[Arena] Leaderboard written to ${leaderboardPath}`);

  return sorted;
}

async function main(): Promise<void> {
  await loadDotEnv();
  await runArena();
}

// Execute only when run directly (not when imported by tests).
const isDirectRun = typeof process !== 'undefined'
  && Array.isArray(process.argv)
  && /arena-runner\.(ts|js)$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  main().catch((error) => {
    console.error(`[Fluxor Arena] ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
