/**
 * cost-calculator.ts — inference cost telemetry
 *
 * Translates a model's token usage into a precise USD execution cost using the
 * OpenRouter pricing schema. OpenRouter quotes `pricing.prompt` and
 * `pricing.completion` as per-token USD rates encoded as strings (e.g.
 * "0.0000005"), with "0" meaning free. Free models always resolve to 0.0.
 */

export interface ModelPricingSchema {
  /** Per-token USD rate for prompt/input tokens (string or number, "0" when free). */
  prompt: string | number;
  /** Per-token USD rate for completion/output tokens (string or number, "0" when free). */
  completion: string | number;
}

export interface TokenUsageInput {
  promptTokens: number;
  completionTokens: number;
}

export interface ExecutionCostBreakdown {
  promptCostUsd: number;
  completionCostUsd: number;
  executionCostUsd: number;
}

/**
 * Parse a pricing value into a non-negative finite per-token rate. Anything that
 * is not a positive finite number (NaN, empty string, negative) collapses to 0,
 * so malformed pricing never produces a phantom cost.
 */
function toRate(value: string | number | undefined | null): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return 0;
}

function toTokens(value: number | undefined | null): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * A model is treated as free when both its prompt and completion rates are zero.
 * Mirrors OpenRouter's `pricing.prompt === "0" && pricing.completion === "0"`
 * but tolerates numeric encodings as well.
 */
export function isFreeModel(pricing: ModelPricingSchema | undefined | null): boolean {
  if (!pricing) return true;
  return toRate(pricing.prompt) === 0 && toRate(pricing.completion) === 0;
}

/**
 * Compute the exact execution cost for a single inference run.
 *
 * @example
 * calculateExecutionCost(
 *   { promptTokens: 1000, completionTokens: 500 },
 *   { prompt: '0.0000005', completion: '0.0000015' },
 * ); // => { promptCostUsd: 0.0005, completionCostUsd: 0.00075, executionCostUsd: 0.00125 }
 */
export function calculateExecutionCost(
  usage: TokenUsageInput,
  pricing: ModelPricingSchema | undefined | null,
): ExecutionCostBreakdown {
  if (isFreeModel(pricing)) {
    return { promptCostUsd: 0, completionCostUsd: 0, executionCostUsd: 0 };
  }

  const promptCostUsd = toTokens(usage.promptTokens) * toRate(pricing!.prompt);
  const completionCostUsd = toTokens(usage.completionTokens) * toRate(pricing!.completion);

  return {
    promptCostUsd,
    completionCostUsd,
    executionCostUsd: promptCostUsd + completionCostUsd,
  };
}
