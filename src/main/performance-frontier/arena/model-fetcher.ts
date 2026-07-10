/**
 * model-fetcher.ts — Fluxor Arena model discovery
 *
 * Discovers candidate models for the Arena from the OpenRouter catalog. Every
 * 100%-free model (prompt and completion priced at "0") is included, plus a set
 * of explicitly forced paid models we always want to benchmark.
 */
import type { ModelPricingSchema } from '../telemetry/cost-calculator';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** Paid models we always inject into the Arena, regardless of pricing. */
export const ARENA_FORCED_MODEL_IDS = [
  'z-ai/glm-5.2',
  'minimax/minimax-m3',
  'deepseek/deepseek-v4-pro',
] as const;

export interface ArenaModelPricing extends ModelPricingSchema {
  prompt: string;
  completion: string;
}

export interface ArenaModel {
  id: string;
  name: string;
  contextLength: number;
  pricing: ArenaModelPricing;
}

export interface FetchArenaModelsOptions {
  /** OpenRouter API key. Defaults to process.env.OPENROUTER_API_KEY. The models
   *  endpoint is public, but a key is forwarded when available. */
  apiKey?: string;
  /** Injectable fetch for testing. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Override the forced model id list (mainly for tests). */
  forcedModelIds?: readonly string[];
  /** Cap the number of discovered free models (forced models are always kept). */
  freeModelLimit?: number;
  signal?: AbortSignal;
}

interface OpenRouterRawModel {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

function isFreeRawModel(model: OpenRouterRawModel): boolean {
  // Strict string equality per the OpenRouter free-tier contract.
  return model.pricing?.prompt === '0' && model.pricing?.completion === '0';
}

function toArenaModel(model: OpenRouterRawModel): ArenaModel {
  const id = String(model.id);
  return {
    id,
    name: typeof model.name === 'string' && model.name.trim() ? model.name : id,
    contextLength: typeof model.context_length === 'number' ? model.context_length : 0,
    pricing: {
      prompt: model.pricing?.prompt ?? '0',
      completion: model.pricing?.completion ?? '0',
    },
  };
}

/**
 * Stub used when a forced model is not present in the live catalog (e.g. a model
 * that does not exist yet). Pricing is left at "0" — the run will fail fast at
 * inference time and be recorded as `api_error`, so this cost is never charged.
 */
function stubForcedModel(id: string): ArenaModel {
  return {
    id,
    name: id,
    contextLength: 0,
    pricing: { prompt: '0', completion: '0' },
  };
}

/**
 * Build the Arena model list directly from a raw OpenRouter `/models` payload.
 * Exposed separately so it can be unit-tested without the network.
 */
export function buildArenaModelList(
  rawModels: OpenRouterRawModel[],
  forcedIds: readonly string[] = ARENA_FORCED_MODEL_IDS,
  freeModelLimit?: number,
): ArenaModel[] {
  const catalog = new Map<string, OpenRouterRawModel>();
  for (const model of rawModels) {
    if (typeof model?.id === 'string') catalog.set(model.id, model);
  }

  const freeModels = rawModels
    .filter((model) => typeof model?.id === 'string' && isFreeRawModel(model))
    .map(toArenaModel);

  const limitedFree = typeof freeModelLimit === 'number' && freeModelLimit >= 0
    ? freeModels.slice(0, freeModelLimit)
    : freeModels;

  // Dedupe by id; forced models win their slot but never appear twice.
  const result = new Map<string, ArenaModel>();
  for (const model of limitedFree) result.set(model.id, model);
  for (const id of forcedIds) {
    if (result.has(id)) continue;
    const raw = catalog.get(id);
    result.set(id, raw ? toArenaModel(raw) : stubForcedModel(id));
  }

  return [...result.values()];
}

/**
 * Fetch the live Arena model roster from OpenRouter.
 *
 * @throws when the OpenRouter request fails (non-2xx response). Callers in the
 * orchestrator are expected to fall back to forced-only models on failure.
 */
export async function fetchArenaModels(options: FetchArenaModelsOptions = {}): Promise<ArenaModel[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  const forcedIds = options.forcedModelIds ?? ARENA_FORCED_MODEL_IDS;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetchImpl(OPENROUTER_MODELS_URL, {
    method: 'GET',
    headers,
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(
      `OpenRouter models request failed: ${response.status} ${response.statusText}`.trim(),
    );
  }

  const payload = (await response.json()) as { data?: OpenRouterRawModel[] } | OpenRouterRawModel[];
  const rawModels = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  return buildArenaModelList(rawModels, forcedIds, options.freeModelLimit);
}
