/**
 * model-selector.ts — Arena-informed model selection for `heliox serve`
 *
 * Reads the latest Arena leaderboard and picks the best model for a given
 * deployment strategy. Accepts an injectable results source so it can be
 * unit-tested with a synthetic ledger without touching the filesystem.
 *
 * Strategy semantics:
 *   best-score   → highest `finalArenaScore` (conservative: uses score as-is,
 *                   which the Arena already normalises across suites).
 *   cheapest     → lowest `executionCostUsd`; free models (0) rank equally so
 *                   the tie-breaker is `finalArenaScore` descending.
 *   fastest      → lowest `avgLatencyMs`; entries without latency data are
 *                   excluded (all suites failed for that model).
 *   best-value   → highest `finalArenaScore / executionCostUsd`; free models
 *                   are treated as infinite value, tie-broken by score.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArenaLeaderboardEntry } from '../performance-frontier/arena/arena-runner';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SelectionStrategy = 'best-score' | 'cheapest' | 'fastest' | 'best-value';

export interface ModelSelectionEvidence {
  /** Normalised Arena score (0-100). */
  score: number;
  /** Execution cost in USD for the benchmark run. */
  costPerRun: number;
  /** Average wall-clock latency in ms (undefined when not available). */
  latencyMs: number | undefined;
}

export interface ModelSelection {
  modelId: string;
  evidence: ModelSelectionEvidence;
}

/**
 * Injectable source of Arena leaderboard entries.
 * Defaults to reading the on-disk ledger at
 * `.heliox/performance-frontier/heliox-leaderboard.json`.
 */
export type LedgerSource = () => Promise<ArenaLeaderboardEntry[]>;

// ---------------------------------------------------------------------------
// Default on-disk ledger loader
// ---------------------------------------------------------------------------

const DEFAULT_LEDGER_PATH = join(
  process.cwd(),
  '.heliox',
  'performance-frontier',
  'heliox-leaderboard.json',
);

async function loadDefaultLedger(): Promise<ArenaLeaderboardEntry[]> {
  const raw = await readFile(DEFAULT_LEDGER_PATH, 'utf-8');
  return JSON.parse(raw) as ArenaLeaderboardEntry[];
}

// ---------------------------------------------------------------------------
// Strategy implementations
// ---------------------------------------------------------------------------

/** Only consider completed entries (api_error models are excluded). */
function completedEntries(ledger: ArenaLeaderboardEntry[]): ArenaLeaderboardEntry[] {
  return ledger.filter((e) => e.status === 'completed');
}

function toBestScore(entries: ArenaLeaderboardEntry[]): ArenaLeaderboardEntry | undefined {
  // highest finalArenaScore; tie-break by lower cost
  return entries.reduce<ArenaLeaderboardEntry | undefined>((best, e) => {
    if (!best) return e;
    if (e.finalArenaScore > best.finalArenaScore) return e;
    if (e.finalArenaScore === best.finalArenaScore && e.executionCostUsd < best.executionCostUsd) return e;
    return best;
  }, undefined);
}

function toCheapest(entries: ArenaLeaderboardEntry[]): ArenaLeaderboardEntry | undefined {
  // lowest cost; tie-break by highest score
  return entries.reduce<ArenaLeaderboardEntry | undefined>((best, e) => {
    if (!best) return e;
    if (e.executionCostUsd < best.executionCostUsd) return e;
    if (e.executionCostUsd === best.executionCostUsd && e.finalArenaScore > best.finalArenaScore) return e;
    return best;
  }, undefined);
}

function toFastest(entries: ArenaLeaderboardEntry[]): ArenaLeaderboardEntry | undefined {
  // lowest avgLatencyMs; only entries that have latency data qualify
  const withLatency = entries.filter(
    (e): e is ArenaLeaderboardEntry & { avgLatencyMs: number } => e.avgLatencyMs !== undefined,
  );
  return withLatency.reduce<ArenaLeaderboardEntry | undefined>((best, e) => {
    if (!best) return e;
    if (e.avgLatencyMs! < (best.avgLatencyMs ?? Infinity)) return e;
    // tie-break: higher score
    if (e.avgLatencyMs === best.avgLatencyMs && e.finalArenaScore > best.finalArenaScore) return e;
    return best;
  }, undefined);
}

/**
 * Value = score / cost.  Free (zero-cost) models are assigned the maximum
 * finite value so they always win on value (they are both good and free);
 * if multiple free models exist they are tie-broken by score.
 */
function valueScore(e: ArenaLeaderboardEntry): number {
  if (e.executionCostUsd === 0) return Number.MAX_SAFE_INTEGER;
  return e.finalArenaScore / e.executionCostUsd;
}

function toBestValue(entries: ArenaLeaderboardEntry[]): ArenaLeaderboardEntry | undefined {
  return entries.reduce<ArenaLeaderboardEntry | undefined>((best, e) => {
    if (!best) return e;
    const eVal = valueScore(e);
    const bestVal = valueScore(best);
    if (eVal > bestVal) return e;
    if (eVal === bestVal && e.finalArenaScore > best.finalArenaScore) return e;
    return best;
  }, undefined);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Select the best model for a given `flowId` using the supplied `strategy`.
 *
 * @param flowId   - The flow's id.  Currently unused for filtering because the
 *                   Arena leaderboard is global (not per-flow).  The parameter
 *                   is part of the public contract so callers can opt-in to
 *                   per-flow filtering in a future card without breaking the API.
 * @param strategy - One of the four selection strategies.
 * @param getLedger - Optional injectable source of Arena entries; defaults to
 *                   reading `.heliox/performance-frontier/heliox-leaderboard.json`.
 *
 * @returns A `ModelSelection` with the winning model id and evidence, or
 *          `null` when no suitable Arena data is available.
 */
export async function selectModel(
  flowId: string,
  strategy: SelectionStrategy,
  getLedger: LedgerSource = loadDefaultLedger,
): Promise<ModelSelection | null> {
  // flowId is reserved for future per-flow filtering; suppress the lint warning.
  void flowId;

  let ledger: ArenaLeaderboardEntry[];
  try {
    ledger = await getLedger();
  } catch {
    // Ledger does not exist yet (first run, CI, etc.) — fall back gracefully.
    return null;
  }

  const candidates = completedEntries(ledger);
  if (candidates.length === 0) return null;

  let winner: ArenaLeaderboardEntry | undefined;

  switch (strategy) {
    case 'best-score':
      winner = toBestScore(candidates);
      break;
    case 'cheapest':
      winner = toCheapest(candidates);
      break;
    case 'fastest':
      winner = toFastest(candidates);
      break;
    case 'best-value':
      winner = toBestValue(candidates);
      break;
    default: {
      // Exhaustive check — TypeScript should make this unreachable.
      const _exhaustive: never = strategy;
      void _exhaustive;
      return null;
    }
  }

  if (!winner) return null;

  return {
    modelId: winner.modelId,
    evidence: {
      score: winner.finalArenaScore,
      costPerRun: winner.executionCostUsd,
      latencyMs: winner.avgLatencyMs,
    },
  };
}
