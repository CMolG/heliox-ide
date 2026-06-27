/**
 * model-selector.test.ts — ARCH-065 acceptance tests
 *
 * All tests use a SYNTHETIC ledger passed as the injectable `getLedger`
 * argument.  No real Arena files are read.
 *
 * Covered:
 *   - 'best-score'  → model with highest finalArenaScore wins
 *   - 'cheapest'    → model with lowest executionCostUsd wins
 *   - 'fastest'     → model with lowest avgLatencyMs wins
 *   - 'best-value'  → model with best score/cost ratio wins (free model bias)
 *   - Null returns on empty ledger, no completed entries, no latency data (fastest)
 *   - getLedger rejection (file not found) returns null
 */

import { describe, expect, it } from 'vitest';
import type { ArenaLeaderboardEntry } from '../performance-frontier/arena/arena-runner';
import { selectModel } from './model-selector';

// ---------------------------------------------------------------------------
// Synthetic ledger helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<ArenaLeaderboardEntry>): ArenaLeaderboardEntry {
  return {
    modelId: 'default/model',
    name: 'Default Model',
    status: 'completed',
    scores: { architecture: 80, teamWork: 80, assembler: 80 },
    finalArenaScore: 80,
    totalTokens: 10000,
    executionCostUsd: 0.01,
    avgLatencyMs: 1000,
    ...overrides,
  };
}

function makeLedger(entries: ArenaLeaderboardEntry[]) {
  return async () => entries;
}

// ---------------------------------------------------------------------------
// Synthetic ledger with 3 clearly differentiated models
// ---------------------------------------------------------------------------

/**
 * - alpha: highest score (95), medium cost, medium latency
 * - beta:  lowest cost (0.001), lower score, fastest latency (200 ms)
 * - gamma: moderate score/cost but best value ratio; slowest latency
 */
const ALPHA = makeEntry({
  modelId: 'alpha/model',
  name: 'Alpha',
  finalArenaScore: 95,
  executionCostUsd: 0.05,
  avgLatencyMs: 600,
});

const BETA = makeEntry({
  modelId: 'beta/model',
  name: 'Beta',
  finalArenaScore: 70,
  executionCostUsd: 0.001,
  avgLatencyMs: 200,
});

// gamma: value = 80 / 0.01 = 8 000; alpha: value = 95 / 0.05 = 1 900; beta: value = 70 / 0.001 = 70 000
// So beta has best value too — let's make gamma have a free model to win best-value absolutely.
const GAMMA = makeEntry({
  modelId: 'gamma/model',
  name: 'Gamma (free)',
  finalArenaScore: 75,
  executionCostUsd: 0,        // free → infinite value
  avgLatencyMs: 1500,
});

const RICH_LEDGER = [ALPHA, BETA, GAMMA];

// ---------------------------------------------------------------------------
// Describe blocks
// ---------------------------------------------------------------------------

describe('selectModel — best-score', () => {
  it('returns the model with the highest finalArenaScore', async () => {
    const result = await selectModel('any-flow', 'best-score', makeLedger(RICH_LEDGER));
    expect(result).not.toBeNull();
    expect(result!.modelId).toBe('alpha/model');
    expect(result!.evidence.score).toBe(95);
  });

  it('includes cost and latency in evidence', async () => {
    const result = await selectModel('any-flow', 'best-score', makeLedger(RICH_LEDGER));
    expect(result!.evidence.costPerRun).toBe(0.05);
    expect(result!.evidence.latencyMs).toBe(600);
  });
});

describe('selectModel — cheapest', () => {
  it('returns the free model (cost 0) as cheapest', async () => {
    const result = await selectModel('any-flow', 'cheapest', makeLedger(RICH_LEDGER));
    expect(result).not.toBeNull();
    expect(result!.modelId).toBe('gamma/model');
    expect(result!.evidence.costPerRun).toBe(0);
  });

  it('tie-breaks equal costs by highest score', async () => {
    const A = makeEntry({ modelId: 'a', finalArenaScore: 90, executionCostUsd: 0.01 });
    const B = makeEntry({ modelId: 'b', finalArenaScore: 80, executionCostUsd: 0.01 });
    const result = await selectModel('flow', 'cheapest', makeLedger([A, B]));
    expect(result!.modelId).toBe('a');
  });
});

describe('selectModel — fastest', () => {
  it('returns the model with the lowest avgLatencyMs', async () => {
    const result = await selectModel('any-flow', 'fastest', makeLedger(RICH_LEDGER));
    expect(result).not.toBeNull();
    expect(result!.modelId).toBe('beta/model');
    expect(result!.evidence.latencyMs).toBe(200);
  });

  it('tie-breaks equal latency by highest score', async () => {
    const A = makeEntry({ modelId: 'a', finalArenaScore: 90, avgLatencyMs: 300 });
    const B = makeEntry({ modelId: 'b', finalArenaScore: 70, avgLatencyMs: 300 });
    const result = await selectModel('flow', 'fastest', makeLedger([A, B]));
    expect(result!.modelId).toBe('a');
  });

  it('returns null when no entries have avgLatencyMs', async () => {
    const noLatency = [ALPHA, BETA, GAMMA].map((e) => {
      const { avgLatencyMs: _, ...rest } = e;
      return rest as ArenaLeaderboardEntry;
    });
    const result = await selectModel('flow', 'fastest', makeLedger(noLatency));
    expect(result).toBeNull();
  });
});

describe('selectModel — best-value', () => {
  it('returns the free model as best-value (infinite ratio)', async () => {
    const result = await selectModel('any-flow', 'best-value', makeLedger(RICH_LEDGER));
    expect(result).not.toBeNull();
    expect(result!.modelId).toBe('gamma/model');
  });

  it('computes score/cost ratio correctly when no free models', async () => {
    // alpha: 95/0.05 = 1 900; beta: 70/0.001 = 70 000 → beta wins
    const result = await selectModel('flow', 'best-value', makeLedger([ALPHA, BETA]));
    expect(result!.modelId).toBe('beta/model');
  });

  it('tie-breaks equal value by highest score', async () => {
    // same cost, same score/cost — but A has higher score
    const A = makeEntry({ modelId: 'a', finalArenaScore: 90, executionCostUsd: 0 });
    const B = makeEntry({ modelId: 'b', finalArenaScore: 80, executionCostUsd: 0 });
    const result = await selectModel('flow', 'best-value', makeLedger([A, B]));
    expect(result!.modelId).toBe('a');
  });
});

describe('selectModel — null / no-data cases', () => {
  it('returns null for an empty ledger', async () => {
    const result = await selectModel('flow', 'best-score', makeLedger([]));
    expect(result).toBeNull();
  });

  it('returns null when all entries have status api_error', async () => {
    const failed = RICH_LEDGER.map((e) => ({ ...e, status: 'api_error' as const }));
    const result = await selectModel('flow', 'best-score', makeLedger(failed));
    expect(result).toBeNull();
  });

  it('returns null when getLedger rejects (file not found)', async () => {
    const broken = async () => { throw new Error('ENOENT: no such file'); };
    const result = await selectModel('flow', 'best-score', broken);
    expect(result).toBeNull();
  });

  it('excludes api_error entries from all strategies', async () => {
    const mixedLedger = [
      makeEntry({ modelId: 'good', finalArenaScore: 70, status: 'completed' }),
      makeEntry({ modelId: 'bad', finalArenaScore: 99, status: 'api_error' }),
    ];
    const result = await selectModel('flow', 'best-score', makeLedger(mixedLedger));
    expect(result!.modelId).toBe('good');
  });
});
