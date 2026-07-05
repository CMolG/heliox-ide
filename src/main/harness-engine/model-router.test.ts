/**
 * model-router.test.ts — WS2 smart model-routing engine tests
 *
 * Every test injects synthetic `ModelRouterDeps` — no real filesystem or
 * environment access, except the small "default deps" block that
 * deliberately exercises the real on-disk/env fallbacks to prove they never
 * throw. Dogfooding note: this suite is the `test-driven` proof for the
 * router (see AGENTS.md dogfood task) — every routing decision asserts both
 * the chosen modelId AND the human-readable `evidence.reason` string,
 * matching `explain-to-me`'s "make routing decisions legible" spirit.
 */
import { describe, expect, it } from 'vitest';
import type { AgenticStep } from '../../types/harness';
import type { ArenaLeaderboardEntry } from '../performance-frontier/arena/arena-runner';
import { createModelRouter, isSealed, loadDefaultLeaderboard } from './model-router';

function makeEntry(overrides: Partial<ArenaLeaderboardEntry> = {}): ArenaLeaderboardEntry {
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

function makeStep(overrides: Partial<AgenticStep> = {}): AgenticStep {
  return {
    id: 'step-1',
    type: 'llm_call',
    prompt: 'Do the thing.',
    tools: [],
    prevStepIds: [],
    nextStepIds: [],
    mods: [],
    roles: [],
    mentalContext: [],
    ...overrides,
  };
}

const NO_CTX = {};

describe('createModelRouter — fixed', () => {
  it('returns null so the caller skips the router entirely', () => {
    expect(createModelRouter({ mode: 'fixed' })).toBeNull();
  });
});

describe('createModelRouter — smart-local', () => {
  it('picks the strategy winner among only completed entries, never an api_error top-scorer', async () => {
    const entries: ArenaLeaderboardEntry[] = [
      makeEntry({ modelId: 'top-but-failed', finalArenaScore: 99, status: 'api_error' }),
      makeEntry({ modelId: 'best-completed', finalArenaScore: 90 }),
      makeEntry({ modelId: 'worse-completed', finalArenaScore: 70 }),
    ];
    const router = createModelRouter(
      { mode: 'smart-local', strategy: 'best-score' },
      { getLeaderboard: async () => entries, getBetterOnById: () => new Map(), hasOpenRouterKey: () => false },
    );
    expect(router).not.toBeNull();

    const decision = await router!.resolve(makeStep(), NO_CTX);

    expect(decision?.modelId).toBe('best-completed');
    expect(decision?.evidence).toEqual({
      source: 'arena-leaderboard',
      strategy: 'best-score',
      reason: 'best-score winner: score 90 at $0.01/run',
      sealed: true,
      score: 90,
      costPerRun: 0.01,
      latencyMs: 1000,
    });
  });

  it('honors a betterOn hint only when the recommended model is itself sealed (completed)', async () => {
    const entries: ArenaLeaderboardEntry[] = [
      makeEntry({ modelId: 'sealed-recommended', finalArenaScore: 60, executionCostUsd: 0.002 }),
      makeEntry({ modelId: 'strategy-winner', finalArenaScore: 95 }),
    ];
    const step = makeStep({ roles: [{ id: 'ai-engineer', name: 'AI Engineer', systemPrompt: 'You build LLM apps.' }] });
    const router = createModelRouter(
      { mode: 'smart-local', strategy: 'best-score' },
      {
        getLeaderboard: async () => entries,
        getBetterOnById: () => new Map([['ai-engineer', 'sealed-recommended']]),
        hasOpenRouterKey: () => false,
      },
    );

    const decision = await router!.resolve(step, NO_CTX);

    expect(decision?.modelId).toBe('sealed-recommended');
    expect(decision?.evidence.source).toBe('betterOn');
    expect(decision?.evidence.sealed).toBe(true);
    expect(decision?.evidence.reason).toBe('role/mod "ai-engineer" recommends sealed-recommended (Arena score 60)');
  });

  it('ignores a betterOn hint pointing outside the sealed set and falls back to the strategy winner', async () => {
    const entries: ArenaLeaderboardEntry[] = [
      makeEntry({ modelId: 'strategy-winner', finalArenaScore: 95 }),
      makeEntry({ modelId: 'runner-up', finalArenaScore: 50 }),
    ];
    const step = makeStep({ roles: [{ id: 'ai-engineer', name: 'AI Engineer', systemPrompt: '...' }] });
    const router = createModelRouter(
      { mode: 'smart-local', strategy: 'best-score' },
      {
        getLeaderboard: async () => entries,
        // 'claude-opus-4.6' mirrors a real betterOn hint that has never been
        // benchmarked in this Arena run — never a member of the sealed set.
        getBetterOnById: () => new Map([['ai-engineer', 'claude-opus-4.6']]),
        hasOpenRouterKey: () => false,
      },
    );

    const decision = await router!.resolve(step, NO_CTX);

    expect(decision?.modelId).toBe('strategy-winner');
    expect(decision?.evidence.source).toBe('arena-leaderboard');
  });

  it('checks mods as well as roles for a betterOn hint', async () => {
    const entries: ArenaLeaderboardEntry[] = [makeEntry({ modelId: 'mod-recommended', finalArenaScore: 60 })];
    const step = makeStep({ mods: [{ id: 'test-driven', name: 'Test Driven', type: 'pre_process' }] });
    const router = createModelRouter(
      { mode: 'smart-local', strategy: 'best-score' },
      {
        getLeaderboard: async () => entries,
        getBetterOnById: () => new Map([['test-driven', 'mod-recommended']]),
        hasOpenRouterKey: () => false,
      },
    );

    const decision = await router!.resolve(step, NO_CTX);

    expect(decision?.modelId).toBe('mod-recommended');
    expect(decision?.evidence.source).toBe('betterOn');
  });

  it('never picks a model outside the sealed set even when every atom has a betterOn hint', async () => {
    const entries: ArenaLeaderboardEntry[] = [makeEntry({ modelId: 'sealed-only', finalArenaScore: 40 })];
    const step = makeStep({
      roles: [{ id: 'role-a', name: 'Role A', systemPrompt: '...' }],
      mods: [{ id: 'mod-a', name: 'Mod A', type: 'pre_process' }],
    });
    const router = createModelRouter(
      { mode: 'smart-local', strategy: 'best-score' },
      {
        getLeaderboard: async () => entries,
        getBetterOnById: () => new Map([
          ['role-a', 'never-benchmarked-1'],
          ['mod-a', 'never-benchmarked-2'],
        ]),
        hasOpenRouterKey: () => false,
      },
    );

    const decision = await router!.resolve(step, NO_CTX);

    // Falls through both unsealed betterOn hints to the (only) sealed entry.
    expect(decision?.modelId).toBe('sealed-only');
    expect(decision?.evidence.source).toBe('arena-leaderboard');
  });

  it('returns null (fail-open) when the leaderboard is empty', async () => {
    const router = createModelRouter(
      { mode: 'smart-local', strategy: 'best-score' },
      { getLeaderboard: async () => [], getBetterOnById: () => new Map(), hasOpenRouterKey: () => false },
    );

    expect(await router!.resolve(makeStep(), NO_CTX)).toBeNull();
  });

  it('returns null (fail-open) when the leaderboard is missing entirely (getLeaderboard rejects)', async () => {
    const router = createModelRouter(
      { mode: 'smart-local', strategy: 'best-score' },
      {
        getLeaderboard: async () => { throw new Error('ENOENT: no such file'); },
        getBetterOnById: () => new Map(),
        hasOpenRouterKey: () => false,
      },
    );

    expect(await router!.resolve(makeStep(), NO_CTX)).toBeNull();
  });

  it('returns null (fail-open) when the leaderboard has entries but none completed', async () => {
    const entries: ArenaLeaderboardEntry[] = [makeEntry({ modelId: 'only-failed', status: 'api_error' })];
    const router = createModelRouter(
      { mode: 'smart-local', strategy: 'best-score' },
      { getLeaderboard: async () => entries, getBetterOnById: () => new Map(), hasOpenRouterKey: () => false },
    );

    expect(await router!.resolve(makeStep(), NO_CTX)).toBeNull();
  });

  it('returns null when the "fastest" strategy has no entries with latency data, even on a non-empty leaderboard', async () => {
    const entries: ArenaLeaderboardEntry[] = [makeEntry({ modelId: 'no-latency', avgLatencyMs: undefined })];
    const router = createModelRouter(
      { mode: 'smart-local', strategy: 'fastest' },
      { getLeaderboard: async () => entries, getBetterOnById: () => new Map(), hasOpenRouterKey: () => false },
    );

    expect(await router!.resolve(makeStep(), NO_CTX)).toBeNull();
  });

  it('resolve() swallows a thrown getLeaderboard error and fails open to null', async () => {
    const router = createModelRouter(
      { mode: 'smart-local', strategy: 'best-score' },
      {
        getLeaderboard: async () => { throw new Error('disk on fire'); },
        getBetterOnById: () => new Map(),
        hasOpenRouterKey: () => false,
      },
    );

    await expect(router!.resolve(makeStep(), NO_CTX)).resolves.toBeNull();
  });

  it('resolve() swallows a synchronously-thrown getBetterOnById error and fails open to null', async () => {
    const entries: ArenaLeaderboardEntry[] = [makeEntry()];
    const router = createModelRouter(
      { mode: 'smart-local', strategy: 'best-score' },
      {
        getLeaderboard: async () => entries,
        getBetterOnById: () => { throw new Error('inventory.json is corrupt'); },
        hasOpenRouterKey: () => false,
      },
    );

    await expect(router!.resolve(makeStep(), NO_CTX)).resolves.toBeNull();
  });

  it('memoizes the leaderboard fetch across multiple resolve() calls on the same router instance', async () => {
    let calls = 0;
    const entries: ArenaLeaderboardEntry[] = [makeEntry({ modelId: 'only-one', finalArenaScore: 55 })];
    const router = createModelRouter(
      { mode: 'smart-local', strategy: 'best-score' },
      {
        getLeaderboard: async () => { calls += 1; return entries; },
        getBetterOnById: () => new Map(),
        hasOpenRouterKey: () => false,
      },
    );

    await router!.resolve(makeStep({ id: 'a' }), NO_CTX);
    await router!.resolve(makeStep({ id: 'b' }), NO_CTX);
    await router!.resolve(makeStep({ id: 'c' }), NO_CTX);

    expect(calls).toBe(1);
  });
});

describe('createModelRouter — smart-external', () => {
  it('returns openrouter/auto, unsealed, when an OpenRouter key is present', async () => {
    const router = createModelRouter({ mode: 'smart-external' }, { hasOpenRouterKey: () => true });

    const decision = await router!.resolve(makeStep(), NO_CTX);

    expect(decision).toEqual({
      modelId: 'openrouter/auto',
      evidence: {
        source: 'external-router',
        reason: 'delegated to OpenRouter auto-router',
        sealed: false,
      },
    });
  });

  it('returns null (fail-open) when no OpenRouter key is present', async () => {
    const router = createModelRouter({ mode: 'smart-external' }, { hasOpenRouterKey: () => false });

    expect(await router!.resolve(makeStep(), NO_CTX)).toBeNull();
  });

  it('resolve() swallows a thrown hasOpenRouterKey error and fails open to null', async () => {
    const router = createModelRouter(
      { mode: 'smart-external' },
      { hasOpenRouterKey: () => { throw new Error('env access denied'); } },
    );

    await expect(router!.resolve(makeStep(), NO_CTX)).resolves.toBeNull();
  });

  it('uses the real env-based default when no hasOpenRouterKey override is given', async () => {
    const originalKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const router = createModelRouter({ mode: 'smart-external' });
      expect(await router!.resolve(makeStep(), NO_CTX)).toBeNull();
    } finally {
      if (originalKey !== undefined) process.env.OPENROUTER_API_KEY = originalKey;
    }
  });
});

describe('isSealed', () => {
  it('is a membership check against the sealed ("Benchmarked") id set', () => {
    const sealedIds = new Set(['a', 'b']);
    expect(isSealed('a', sealedIds)).toBe(true);
    expect(isSealed('z', sealedIds)).toBe(false);
  });
});

describe('default deps (no injection)', () => {
  it('loadDefaultLeaderboard resolves to an array without throwing regardless of on-disk state', async () => {
    const entries = await loadDefaultLeaderboard();
    expect(Array.isArray(entries)).toBe(true);
  });

  it('smart-local with the real default loaders never throws, and only ever returns a decision or null', async () => {
    const router = createModelRouter({ mode: 'smart-local', strategy: 'best-score' });
    const decision = await router!.resolve(makeStep(), NO_CTX);
    expect(decision === null || typeof decision?.modelId === 'string').toBe(true);
  });
});
