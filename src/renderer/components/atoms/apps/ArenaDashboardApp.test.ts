/**
 * ArenaDashboardApp.test.ts — Unit tests for Arena Dashboard pure helpers
 *
 * Tests the three exported pure functions:
 *   - sortEntries   (sorting by various keys, stable, null-last guarantee)
 *   - costPer1kTokens (division, zero-token guard)
 *   - tierOf        (Free vs Paid classification)
 *
 * These helpers carry the business logic for the leaderboard table and must
 * remain free of React / DOM dependencies so they can run in Vitest directly.
 */
import { describe, it, expect } from 'vitest';
import { sortEntries, costPer1kTokens, tierOf } from './ArenaDashboardApp';
import type { ArenaLeaderboardEntry } from '@/types/arena';

// ─── Fixtures ─────────────────────────────────────────────────────

function makeEntry(
  overrides: Partial<ArenaLeaderboardEntry> & Pick<ArenaLeaderboardEntry, 'modelId' | 'name'>,
): ArenaLeaderboardEntry {
  return {
    status: 'completed',
    scores: { architecture: 80, teamWork: 70, assembler: 75 },
    finalArenaScore: 75,
    totalTokens: 10000,
    executionCostUsd: 0.01,
    ...overrides,
  };
}

const ALPHA = makeEntry({ modelId: 'alpha', name: 'Alpha Model', finalArenaScore: 90, totalTokens: 50000, executionCostUsd: 0.05 });
const BETA  = makeEntry({ modelId: 'beta',  name: 'Beta Model',  finalArenaScore: 70, totalTokens: 20000, executionCostUsd: 0 });
const GAMMA = makeEntry({ modelId: 'gamma', name: 'Gamma Model', finalArenaScore: 80, totalTokens: 0,     executionCostUsd: 0 });
const ERROR_ENTRY = makeEntry({ modelId: 'err', name: 'Error Model', status: 'api_error', finalArenaScore: 0, scores: { architecture: null, teamWork: null, assembler: null } });

const ALL = [ALPHA, BETA, GAMMA, ERROR_ENTRY];

// ─── tierOf ───────────────────────────────────────────────────────

describe('tierOf', () => {
  it('classifies zero-cost entries as Free', () => {
    expect(tierOf(BETA)).toBe('Free');
    expect(tierOf(GAMMA)).toBe('Free');
  });

  it('classifies non-zero-cost entries as Paid', () => {
    expect(tierOf(ALPHA)).toBe('Paid');
  });

  it('treats a very small cost as Paid', () => {
    const entry = makeEntry({ modelId: 'x', name: 'X', executionCostUsd: 0.000001 });
    expect(tierOf(entry)).toBe('Paid');
  });
});

// ─── costPer1kTokens ─────────────────────────────────────────────

describe('costPer1kTokens', () => {
  it('returns zero when tokens are zero (guard against divide-by-zero)', () => {
    expect(costPer1kTokens(GAMMA)).toBe(0);
  });

  it('correctly computes cost per 1k tokens', () => {
    // ALPHA: $0.05 / (50000/1000) = $0.05 / 50 = 0.001
    expect(costPer1kTokens(ALPHA)).toBeCloseTo(0.001, 6);
  });

  it('returns zero for a free model with tokens', () => {
    // BETA: $0 / anything = 0
    expect(costPer1kTokens(BETA)).toBe(0);
  });

  it('handles fractional costs correctly', () => {
    const entry = makeEntry({ modelId: 'x', name: 'X', totalTokens: 106835, executionCostUsd: 0.1734061 });
    const expected = 0.1734061 / (106835 / 1000);
    expect(costPer1kTokens(entry)).toBeCloseTo(expected, 8);
  });
});

// ─── sortEntries ─────────────────────────────────────────────────

describe('sortEntries', () => {
  it('sorts by finalArenaScore descending (default Arena sort)', () => {
    const result = sortEntries(ALL, 'finalArenaScore', 'desc');
    const scores = result.map(e => e.finalArenaScore);
    // Expect descending: 90 ≥ 80 ≥ 70 ≥ 0
    expect(scores[0]).toBe(90);
    expect(scores[1]).toBe(80);
    expect(scores[2]).toBe(70);
    expect(scores[3]).toBe(0);
  });

  it('sorts by finalArenaScore ascending', () => {
    const result = sortEntries(ALL, 'finalArenaScore', 'asc');
    const scores = result.map(e => e.finalArenaScore);
    expect(scores[0]).toBe(0);
    expect(scores[scores.length - 1]).toBe(90);
  });

  it('sorts by executionCostUsd ascending', () => {
    const result = sortEntries(ALL, 'executionCostUsd', 'asc');
    // zero-cost entries first, then ALPHA
    expect(result[result.length - 1].modelId).toBe('alpha');
  });

  it('sorts by executionCostUsd descending', () => {
    const result = sortEntries(ALL, 'executionCostUsd', 'desc');
    expect(result[0].modelId).toBe('alpha');
  });

  it('does not mutate the original array', () => {
    const original = [...ALL];
    sortEntries(ALL, 'finalArenaScore', 'asc');
    expect(ALL).toEqual(original);
  });

  it('places null score values at the end regardless of direction', () => {
    const asc  = sortEntries(ALL, 'architecture', 'asc');
    const desc = sortEntries(ALL, 'architecture', 'desc');
    // ERROR_ENTRY has architecture: null — must be last in both
    expect(asc[asc.length - 1].modelId).toBe('err');
    expect(desc[desc.length - 1].modelId).toBe('err');
  });

  it('sorts by name alphabetically ascending', () => {
    const result = sortEntries(ALL, 'name', 'asc');
    const names = result.map(e => e.name);
    expect(names[0]).toBe('Alpha Model');
    expect(names[1]).toBe('Beta Model');
  });

  it('sorts by name alphabetically descending', () => {
    const result = sortEntries(ALL, 'name', 'desc');
    const names = result.map(e => e.name);
    expect(names[0]).toMatch(/^G|^E/); // Gamma or Error
  });

  it('is stable — equal finalArenaScore values preserve insertion order', () => {
    const a = makeEntry({ modelId: 'a', name: 'A', finalArenaScore: 50 });
    const b = makeEntry({ modelId: 'b', name: 'B', finalArenaScore: 50 });
    const c = makeEntry({ modelId: 'c', name: 'C', finalArenaScore: 50 });
    const result = sortEntries([a, b, c], 'finalArenaScore', 'desc');
    // All have the same score; original order must be preserved
    expect(result.map(e => e.modelId)).toEqual(['a', 'b', 'c']);
  });

  it('handles an empty array without throwing', () => {
    expect(sortEntries([], 'finalArenaScore', 'desc')).toEqual([]);
  });

  it('sorts by costPer1k descending', () => {
    const result = sortEntries([ALPHA, BETA, GAMMA], 'costPer1k', 'desc');
    // ALPHA has the highest costPer1k; BETA and GAMMA are 0
    expect(result[0].modelId).toBe('alpha');
  });
});
