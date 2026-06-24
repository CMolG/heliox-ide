import { describe, expect, it, vi } from 'vitest';
import {
  ARENA_SUITES,
  computeFinalArenaScore,
  evaluateArenaModel,
  normalizeSemanticScore,
  parseModelIdsEnv,
  sortLeaderboard,
  type ArenaLeaderboardEntry,
} from './arena-runner';
import type { ArenaModel } from './model-fetcher';
import type { PFRunResult, PFSuite } from '../types';

function fakeRunResult(
  semanticScore: number,
  semanticMaxScore: number,
  tokens: number,
  reasoningTokens = 0,
): PFRunResult {
  return {
    semanticScore,
    semanticMaxScore,
    telemetry: {
      inputTokens: tokens / 2,
      outputTokens: tokens / 2,
      reasoningTokens,
      totalTokens: tokens + reasoningTokens,
    },
  } as unknown as PFRunResult;
}

const FREE_MODEL: ArenaModel = {
  id: 'free/alpha',
  name: 'Alpha',
  contextLength: 1000,
  pricing: { prompt: '0', completion: '0' },
};

const PAID_MODEL: ArenaModel = {
  id: 'paid/beta',
  name: 'Beta',
  contextLength: 1000,
  pricing: { prompt: '0.0000005', completion: '0.0000015' },
};

describe('normalizeSemanticScore', () => {
  it('normalizes raw semantic scores to a 0-100 scale by suite maximum', () => {
    expect(normalizeSemanticScore({ semanticScore: 72, semanticMaxScore: 90 })).toBe(80);
    expect(normalizeSemanticScore({ semanticScore: 120, semanticMaxScore: 150 })).toBe(80);
  });

  it('falls back to the default max when none is provided', () => {
    expect(normalizeSemanticScore({ semanticScore: 45, semanticMaxScore: undefined })).toBe(50);
  });
});

describe('computeFinalArenaScore', () => {
  it('averages the non-null suite scores', () => {
    expect(computeFinalArenaScore({ architecture: 80, teamWork: 95, assembler: 85 })).toBe(87);
  });

  it('ignores failed (null) suites', () => {
    expect(computeFinalArenaScore({ architecture: 80, teamWork: null, assembler: 90 })).toBe(85);
  });

  it('returns 0 when every suite failed', () => {
    expect(computeFinalArenaScore({ architecture: null, teamWork: null, assembler: null })).toBe(0);
  });
});

describe('evaluateArenaModel', () => {
  it('routes the model through openrouter and computes mean score + cost', async () => {
    const runSuite = vi.fn(async (suite: PFSuite, modelId: string) => {
      expect(modelId).toBe('openrouter/paid/beta');
      const byScore: Record<string, PFRunResult> = {
        architecture: fakeRunResult(72, 90, 1000), // -> 80
        'team-work': fakeRunResult(81, 90, 1000), // -> 90
        'flow-assembler': fakeRunResult(120, 150, 1000), // -> 80
      };
      return byScore[suite];
    });

    const entry = await evaluateArenaModel(PAID_MODEL, { seed: 1, suites: ARENA_SUITES, runSuite });

    expect(entry.status).toBe('completed');
    expect(entry.scores).toEqual({ architecture: 80, teamWork: 90, assembler: 80 });
    expect(entry.finalArenaScore).toBe(83);
    expect(entry.totalTokens).toBe(3000);
    // 3 suites * (500 prompt * 5e-7 + 500 completion * 1.5e-6) = 3 * 0.001 = 0.003
    expect(entry.executionCostUsd).toBeCloseTo(0.003, 8);
    expect(entry.errors).toBeUndefined();
  });

  it('bills reasoning tokens at the completion rate', async () => {
    const suites = [{ suite: 'architecture' as const, scoreKey: 'architecture' as const }];
    // 1000 tokens => 500 prompt + 500 output, plus 200 reasoning tokens.
    const runSuite = vi.fn(async () => fakeRunResult(72, 90, 1000, 200));

    const entry = await evaluateArenaModel(PAID_MODEL, { seed: 1, suites, runSuite });

    // 500 prompt * 5e-7 + (500 + 200) completion * 1.5e-6 = 0.00025 + 0.00105
    expect(entry.executionCostUsd).toBeCloseTo(0.0013, 8);
    expect(entry.totalTokens).toBe(1200);
  });

  it('reports 0.0 cost for free models', async () => {
    const runSuite = vi.fn(async () => fakeRunResult(45, 90, 1000));
    const entry = await evaluateArenaModel(FREE_MODEL, { seed: 1, suites: ARENA_SUITES, runSuite });
    expect(entry.executionCostUsd).toBe(0);
    expect(entry.status).toBe('completed');
  });

  it('isolates suite failures and keeps partial scores', async () => {
    const runSuite = vi.fn(async (suite: PFSuite) => {
      if (suite === 'team-work') throw new Error('429 Too Many Requests');
      return fakeRunResult(72, 90, 1000);
    });

    const entry = await evaluateArenaModel(FREE_MODEL, { seed: 1, suites: ARENA_SUITES, runSuite });

    expect(entry.status).toBe('completed');
    expect(entry.scores).toEqual({ architecture: 80, teamWork: null, assembler: 80 });
    expect(entry.errors).toEqual(['team-work: 429 Too Many Requests']);
    expect(entry.finalArenaScore).toBe(80);
  });

  it('marks the model api_error when every suite fails', async () => {
    const runSuite = vi.fn(async () => {
      throw new Error('502 Bad Gateway');
    });

    const entry = await evaluateArenaModel(PAID_MODEL, { seed: 1, suites: ARENA_SUITES, runSuite });

    expect(entry.status).toBe('api_error');
    expect(entry.finalArenaScore).toBe(0);
    expect(entry.scores).toEqual({ architecture: null, teamWork: null, assembler: null });
    expect(entry.errors).toHaveLength(3);
  });
});

describe('parseModelIdsEnv', () => {
  it('splits and trims a comma list', () => {
    expect(parseModelIdsEnv('z-ai/glm-5.2, deepseek/deepseek-v4-pro')).toEqual([
      'z-ai/glm-5.2',
      'deepseek/deepseek-v4-pro',
    ]);
  });

  it('returns undefined for empty or missing input', () => {
    expect(parseModelIdsEnv(undefined)).toBeUndefined();
    expect(parseModelIdsEnv('  ,  ')).toBeUndefined();
  });
});

describe('sortLeaderboard', () => {
  it('orders by score and sinks api_error entries to the bottom', () => {
    const entries: ArenaLeaderboardEntry[] = [
      { modelId: 'low', name: 'low', status: 'completed', scores: {} as never, finalArenaScore: 60, totalTokens: 0, executionCostUsd: 0 },
      { modelId: 'broken', name: 'broken', status: 'api_error', scores: {} as never, finalArenaScore: 0, totalTokens: 0, executionCostUsd: 0 },
      { modelId: 'high', name: 'high', status: 'completed', scores: {} as never, finalArenaScore: 90, totalTokens: 0, executionCostUsd: 0 },
    ];

    expect(sortLeaderboard(entries).map((entry) => entry.modelId)).toEqual(['high', 'low', 'broken']);
  });
});
