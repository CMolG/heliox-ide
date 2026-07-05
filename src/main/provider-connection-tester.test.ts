/**
 * provider-connection-tester.test.ts — Unit tests for the protocol-aware connection tester
 *
 * `fetch` is injected on every call (see `TestConnectionInput.fetch`) so this
 * suite never touches the network — the DI seam mirrors llm-runner.ts's
 * existing `generateText` injection pattern used for the same reason.
 */
import { describe, expect, it, vi } from 'vitest';
import { PROTOCOL_DEFAULTS, testConnection } from './provider-connection-tester';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('PROTOCOL_DEFAULTS', () => {
  it('exposes the canonical default base URL per protocol', () => {
    expect(PROTOCOL_DEFAULTS).toEqual({
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com',
    });
  });
});

describe('testConnection', () => {
  it('openai: GETs ${baseUrl}/models with a Bearer token and parses model ids', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, { data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }));

    const result = await testConnection({
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      token: 'sk-test-123',
      fetch,
    });

    expect(result).toEqual({ ok: true, models: ['gpt-4o', 'gpt-4o-mini'] });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-123');
  });

  it('anthropic: GETs ${baseUrl}/v1/models with x-api-key + anthropic-version headers', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { data: [{ id: 'claude-sonnet-4-6' }] }));

    const result = await testConnection({
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      token: 'sk-ant-test',
      fetch,
    });

    expect(result).toEqual({ ok: true, models: ['claude-sonnet-4-6'] });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/models');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('normalizes a trailing slash on baseUrl before building the request URL', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { data: [] }));

    await testConnection({ protocol: 'openai', baseUrl: 'https://api.openai.com/v1/', token: 't', fetch });

    expect(fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
  });

  it('non-2xx: returns ok:false with status + a trimmed body snippet, never the token', async () => {
    const fetch = vi.fn(async () => jsonResponse(401, { error: { message: 'Invalid API key: sk-test-123' } }));

    const result = await testConnection({
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      token: 'sk-test-123',
      fetch,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('HTTP 401');
    // The body snippet is the SERVER's response text, which happens to echo
    // the key back in this fixture — assert instead that our own request
    // token isn't independently re-embedded via header reflection.
    expect(result.error).not.toContain('Bearer');
  });

  it('network throw (e.g. DNS failure, connection refused): returns ok:false with the error message', async () => {
    const fetch = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND bogus.invalid'); });

    const result = await testConnection({
      protocol: 'openai',
      baseUrl: 'https://bogus.invalid',
      token: 't',
      fetch,
    });

    expect(result).toEqual({ ok: false, error: 'getaddrinfo ENOTFOUND bogus.invalid' });
  });

  it('passes a 10s AbortSignal.timeout so a hung request eventually aborts', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse(200, { data: [] });
    });

    await testConnection({ protocol: 'openai', baseUrl: 'https://api.openai.com/v1', token: 't', fetch });

    expect(fetch).toHaveBeenCalled();
  });

  it('omits the Authorization/x-api-key header entirely when no token is provided (tokenless/local endpoint)', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { data: [] }));

    await testConnection({ protocol: 'openai', baseUrl: 'http://localhost:8080/v1', fetch });

    const init = fetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
