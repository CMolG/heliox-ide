/**
 * model-selector.ts — Arena-informed model selection for `fluxor serve`
 *
 * Reads the latest Arena leaderboard and picks the best model for a given
 * deployment strategy. Accepts an injectable results source so it can be
 * unit-tested with a synthetic ledger without touching the filesystem.
 *
 * Strategy semantics (best-score / cheapest / fastest / best-value) are
 * defined once in `../performance-frontier/arena/selection-strategies.ts`
 * and shared with the Performance Frontier Arena IPC handler — see that file
 * for the per-strategy tie-break rules.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArenaLeaderboardEntry } from '../performance-frontier/arena/arena-runner';
import { completedEntries, selectByStrategy, toEvidence } from '../performance-frontier/arena/selection-strategies';
import type { SelectionStrategy, ModelSelectionEvidence } from '../../types/ipc-events';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

// Re-exported for backward compat: the canonical definitions now live in the
// shared IPC types layer (so main and renderer share one definition), but
// existing importers (e.g. `serve/cli.ts`) pull these from this module.
export type { SelectionStrategy, ModelSelectionEvidence };

export interface ModelSelection {
  modelId: string;
  evidence: ModelSelectionEvidence;
}

/**
 * Injectable source of Arena leaderboard entries.
 * Defaults to reading the on-disk ledger at
 * `.fluxor/performance-frontier/fluxor-leaderboard.json`.
 */
export type LedgerSource = () => Promise<ArenaLeaderboardEntry[]>;

// ---------------------------------------------------------------------------
// Default on-disk ledger loader
// ---------------------------------------------------------------------------

const DEFAULT_LEDGER_PATH = join(
  process.cwd(),
  '.fluxor',
  'performance-frontier',
  'fluxor-leaderboard.json',
);

async function loadDefaultLedger(): Promise<ArenaLeaderboardEntry[]> {
  const raw = await readFile(DEFAULT_LEDGER_PATH, 'utf-8');
  return JSON.parse(raw) as ArenaLeaderboardEntry[];
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
 *                   reading `.fluxor/performance-frontier/fluxor-leaderboard.json`.
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

  const winner = selectByStrategy(candidates, strategy);
  if (!winner) return null;

  return {
    modelId: winner.modelId,
    evidence: toEvidence(winner),
  };
}
