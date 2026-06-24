export function normalizeProviderHeaders(headers: unknown): Record<string, string> {
  if (!headers) return {};

  if (headers instanceof Headers) {
    return Object.fromEntries([...headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [String(key).toLowerCase(), String(value)]));
  }

  if (typeof headers === 'object') {
    return Object.fromEntries(
      Object.entries(headers as Record<string, unknown>).map(([key, value]) => [
        key.toLowerCase(),
        String(value),
      ]),
    );
  }

  return {};
}

export function selectUsageHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => (
    key.startsWith('x-usage-')
    || key.startsWith('x-mimo-')
    || key.startsWith('x-ratelimit-')
    || key.includes('token')
    || key.includes('usage')
  )));
}

export function logProviderHeaders(
  headers: Record<string, string>,
  metrics: Record<string, unknown>,
  source = 'agent',
): void {
  if (Object.keys(headers).length === 0) return;
  console.log({
    type: 'pf_provider_headers',
    source,
    headers,
    usageHeaders: selectUsageHeaders(headers),
    metrics,
  });
}
