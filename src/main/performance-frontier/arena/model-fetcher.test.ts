import { describe, expect, it, vi } from 'vitest';
import {
  ARENA_FORCED_MODEL_IDS,
  buildArenaModelList,
  fetchArenaModels,
} from './model-fetcher';

const RAW_PAYLOAD = {
  data: [
    {
      id: 'free/alpha',
      name: 'Alpha (free)',
      context_length: 128000,
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'paid/beta',
      name: 'Beta',
      context_length: 64000,
      pricing: { prompt: '0.0000005', completion: '0.0000015' },
    },
    {
      id: 'free/gamma',
      name: 'Gamma (free)',
      context_length: 32000,
      pricing: { prompt: '0', completion: '0' },
    },
    // A forced model that DOES exist in the catalog as a paid model.
    {
      id: 'deepseek/deepseek-v4-pro',
      name: 'DeepSeek V4 Pro',
      context_length: 200000,
      pricing: { prompt: '0.0000003', completion: '0.0000009' },
    },
  ],
};

describe('buildArenaModelList', () => {
  it('keeps only 100%-free models and appends forced models', () => {
    const models = buildArenaModelList(RAW_PAYLOAD.data);
    const ids = models.map((model) => model.id);

    expect(ids).toContain('free/alpha');
    expect(ids).toContain('free/gamma');
    expect(ids).not.toContain('paid/beta');
    for (const forced of ARENA_FORCED_MODEL_IDS) {
      expect(ids).toContain(forced);
    }
  });

  it('maps OpenRouter fields onto the ArenaModel shape', () => {
    const [alpha] = buildArenaModelList(RAW_PAYLOAD.data);
    expect(alpha).toEqual({
      id: 'free/alpha',
      name: 'Alpha (free)',
      contextLength: 128000,
      pricing: { prompt: '0', completion: '0' },
    });
  });

  it('uses live catalog pricing for forced models when present', () => {
    const models = buildArenaModelList(RAW_PAYLOAD.data);
    const deepseek = models.find((model) => model.id === 'deepseek/deepseek-v4-pro');
    expect(deepseek?.pricing).toEqual({ prompt: '0.0000003', completion: '0.0000009' });
    expect(deepseek?.contextLength).toBe(200000);
  });

  it('stubs forced models that are missing from the catalog', () => {
    const models = buildArenaModelList(RAW_PAYLOAD.data);
    const glm = models.find((model) => model.id === 'z-ai/glm-5.2');
    expect(glm).toEqual({
      id: 'z-ai/glm-5.2',
      name: 'z-ai/glm-5.2',
      contextLength: 0,
      pricing: { prompt: '0', completion: '0' },
    });
  });

  it('never duplicates a forced model that is also free', () => {
    const models = buildArenaModelList(RAW_PAYLOAD.data, ['free/alpha']);
    const occurrences = models.filter((model) => model.id === 'free/alpha');
    expect(occurrences).toHaveLength(1);
  });

  it('caps the number of free models but always keeps forced ones', () => {
    const models = buildArenaModelList(RAW_PAYLOAD.data, ARENA_FORCED_MODEL_IDS, 1);
    const freeIds = models.filter((model) => model.id.startsWith('free/'));
    expect(freeIds).toHaveLength(1);
    for (const forced of ARENA_FORCED_MODEL_IDS) {
      expect(models.map((model) => model.id)).toContain(forced);
    }
  });
});

describe('fetchArenaModels', () => {
  it('requests the OpenRouter models endpoint and builds the roster', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(RAW_PAYLOAD), { status: 200 }));

    const models = await fetchArenaModels({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'sk-test' });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      }),
    );
    expect(models.map((model) => model.id)).toContain('free/alpha');
  });

  it('throws a descriptive error on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }));
    await expect(
      fetchArenaModels({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/429/);
  });
});
