/**
 * selection-strategies.ts — Arena model-selection strategy logic
 *
 * Pure (no I/O) strategy reducers for the four Arena selection lenses, shared
 * verbatim by `fluxor serve`'s model-selector (src/main/serve/model-selector.ts)
 * and the Performance Frontier Arena IPC handler (../ipc.ts), so the strategy
 * math is defined exactly once and the CLI's `--select` output can never drift
 * from the renderer's recommendation panel.
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

import type { ArenaLeaderboardEntry } from './arena-runner';
import type { SelectionStrategy, ModelSelectionEvidence } from '../../../types/ipc-events';

// ---------------------------------------------------------------------------
// Strategy implementations
// ---------------------------------------------------------------------------

/** Only consider completed entries (api_error models are excluded). */
export function completedEntries(ledger: ArenaLeaderboardEntry[]): ArenaLeaderboardEntry[] {
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
 * Apply `strategy` over an already-`completedEntries`-filtered list and
 * return the winner. Pure — no I/O, no defaults, no fallback to another
 * strategy. Returns `undefined` when `entries` is empty or, for `fastest`,
 * when no entry carries latency data.
 */
export function selectByStrategy(
  entries: ArenaLeaderboardEntry[],
  strategy: SelectionStrategy,
): ArenaLeaderboardEntry | undefined {
  switch (strategy) {
    case 'best-score':
      return toBestScore(entries);
    case 'cheapest':
      return toCheapest(entries);
    case 'fastest':
      return toFastest(entries);
    case 'best-value':
      return toBestValue(entries);
    default: {
      // Exhaustive check — TypeScript should make this unreachable.
      const _exhaustive: never = strategy;
      void _exhaustive;
      return undefined;
    }
  }
}

/** Map a leaderboard entry to the JSON-serializable evidence shape shared over IPC. */
export function toEvidence(entry: ArenaLeaderboardEntry): ModelSelectionEvidence {
  return {
    score: entry.finalArenaScore,
    costPerRun: entry.executionCostUsd,
    latencyMs: entry.avgLatencyMs,
  };
}
