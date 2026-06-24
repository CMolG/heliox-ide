export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readLooseNumber(value: unknown): number {
  if (typeof value === 'string') {
    const parsed = Number(value.replaceAll(',', '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return readNumber(value);
}

function getPath(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, record);
}

function readFirstNumber(record: Record<string, unknown>, paths: string[]): number {
  for (const path of paths) {
    const value = readLooseNumber(getPath(record, path));
    if (value > 0) return value;
  }
  return 0;
}

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

function readHeaderTokenTotal(headers: Record<string, unknown>): number {
  let total = readFirstNumber(headers, [
    'x-usage-total-tokens',
    'x-mimo-total-tokens',
    'x-total-tokens',
  ]);

  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    if (!normalized.includes('token')) continue;
    if (!normalized.includes('total') && !normalized.includes('usage')) continue;
    total = Math.max(total, readLooseNumber(value));
  }

  return total;
}

function assignOptional(result: NormalizedUsage, key: keyof NormalizedUsage, value: number): void {
  if (value > 0) {
    result[key] = value;
  }
}

export function normalizeUsage(
  usage: unknown,
  responseHeaders?: Record<string, string>,
): NormalizedUsage {
  if ((!usage || typeof usage !== 'object') && !responseHeaders) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  const record = usage && typeof usage === 'object' ? usage as Record<string, unknown> : {};
  const headers = normalizeHeaders(responseHeaders);
  const headerRecord = headers as Record<string, unknown>;
  const inputTokens = readFirstNumber(record, [
    'inputTokens',
    'promptTokens',
    'prompt_tokens',
    'usage.prompt_tokens',
    'raw.prompt_tokens',
  ]) || readFirstNumber(headerRecord, [
    'x-usage-prompt-tokens',
    'x-usage-input-tokens',
    'x-mimo-prompt-tokens',
    'x-mimo-input-tokens',
  ]);
  const outputTokens = readFirstNumber(record, [
    'outputTokenDetails.textTokens',
    'completionTokensDetails.textTokens',
    'completion_tokens_details.text_tokens',
    'raw.completion_tokens_details.text_tokens',
    'usage.completion_tokens_details.text_tokens',
    'outputTokens',
    'completionTokens',
    'completion_tokens',
    'usage.completion_tokens',
    'raw.completion_tokens',
  ]) || readFirstNumber(headerRecord, [
    'x-usage-completion-tokens',
    'x-usage-output-tokens',
    'x-mimo-completion-tokens',
    'x-mimo-output-tokens',
  ]);
  const reasoningTokens = readFirstNumber(record, [
    'outputTokenDetails.reasoningTokens',
    'reasoningTokens',
    'completionTokensDetails.reasoningTokens',
    'completion_tokens_details.reasoning_tokens',
    'usage.completion_tokens_details.reasoning_tokens',
    'raw.completion_tokens_details.reasoning_tokens',
    'raw.output_token_details.reasoning_tokens',
    'raw.outputTokenDetails.reasoningTokens',
  ]) || readFirstNumber(headerRecord, [
    'x-usage-reasoning-tokens',
    'x-mimo-reasoning-tokens',
    'x-reasoning-tokens',
  ]);
  const cacheReadTokens = readFirstNumber(record, [
    'inputTokenDetails.cacheReadTokens',
    'cachedInputTokens',
    'promptTokensDetails.cachedTokens',
    'prompt_tokens_details.cached_tokens',
    'usage.prompt_tokens_details.cached_tokens',
    'raw.prompt_tokens_details.cached_tokens',
  ]) || readFirstNumber(headerRecord, [
    'x-usage-cache-read-tokens',
    'x-mimo-cache-read-tokens',
    'x-cached-input-tokens',
  ]);
  const cacheWriteTokens = readFirstNumber(record, [
    'inputTokenDetails.cacheWriteTokens',
    'promptTokensDetails.cacheWriteTokens',
    'prompt_tokens_details.cache_write_tokens',
    'usage.prompt_tokens_details.cache_write_tokens',
    'raw.prompt_tokens_details.cache_write_tokens',
  ]) || readFirstNumber(headerRecord, [
    'x-usage-cache-write-tokens',
    'x-mimo-cache-write-tokens',
  ]);
  const reportedTotalTokens = readFirstNumber(record, [
    'totalTokens',
    'total_tokens',
    'usage.total_tokens',
    'raw.total_tokens',
  ]);
  const headerTotalTokens = readHeaderTokenTotal(headerRecord);
  const computedTotalTokens = inputTokens + outputTokens + reasoningTokens;
  const totalTokens = Math.max(reportedTotalTokens, headerTotalTokens, computedTotalTokens);

  const result: NormalizedUsage = { inputTokens, outputTokens, totalTokens };
  assignOptional(result, 'reasoningTokens', reasoningTokens);
  assignOptional(result, 'cacheReadTokens', cacheReadTokens);
  assignOptional(result, 'cacheWriteTokens', cacheWriteTokens);
  return result;
}
