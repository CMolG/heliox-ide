/**
 * provider-connection-tester.ts — Main process
 *
 * Responsibility:
 * - Probe a connection profile's model-listing endpoint
 *   (`${baseUrl}/models` for openai, `${baseUrl}/v1/models` for anthropic)
 *   and report the model ids it advertises, or a token-free error message.
 *
 * Boundaries:
 * - Owns: the HTTP probe only. Persistence lives in provider-connections.ts;
 *   this module never reads or writes the connection-profile file.
 * - `fetch` is injected on every call so tests never hit the network — the
 *   same DI seam llm-runner.ts uses for `generateText`.
 */
import { PROTOCOL_DEFAULTS } from '../types/ipc-events';
import type { ConnectionProtocol, ConnectionTestResult } from '../types/ipc-events';

// Re-exported so the plan's own call sites (and provider-connection-tester's
// own tests) get a single source of truth shared with the renderer — see
// `ConnectionsSection.tsx`, which imports the same constant directly from
// `@/types/ipc-events` (main-process modules are never imported by the
// renderer bundle, so the canonical definition lives in the shared types
// layer and this module just re-exports it for main-process callers).
export { PROTOCOL_DEFAULTS };

const TIMEOUT_MS = 10_000;
/** How much of a non-2xx response body to surface in the error message. */
const ERROR_BODY_SNIPPET_CHARS = 200;

export interface TestConnectionInput {
  protocol: ConnectionProtocol;
  baseUrl: string;
  /** Omit for a tokenless/local endpoint — no Authorization/x-api-key header is sent. */
  token?: string;
  /**
   * Injectable fetch implementation — required in tests, defaults to the
   * global `fetch`. Narrowed to the exact shape this module calls (a string
   * URL, never a `Request`/`URL` object) rather than the full overloaded DOM
   * `typeof fetch`, so a plain `vi.fn(async (url, init) => ...)` satisfies it
   * without a cast.
   */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function buildRequest(input: TestConnectionInput): { url: string; headers: Record<string, string> } {
  const base = normalizeBaseUrl(input.baseUrl);
  if (input.protocol === 'anthropic') {
    return {
      url: `${base}/v1/models`,
      headers: {
        ...(input.token ? { 'x-api-key': input.token } : {}),
        'anthropic-version': '2023-06-01',
      },
    };
  }
  return {
    url: `${base}/models`,
    headers: {
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
    },
  };
}

interface ModelsListResponseBody {
  data?: Array<{ id?: unknown }>;
}

/**
 * Probe a connection's model-listing endpoint. Never throws — every failure
 * mode (non-2xx, network error, malformed body) resolves to `{ ok: false,
 * error }`, and `error` is always built from the SERVER's response (status +
 * a trimmed body snippet) or the thrown error's message — our own request
 * headers (which carry the token) are never echoed back into it.
 */
export async function testConnection(input: TestConnectionInput): Promise<ConnectionTestResult> {
  const { url, headers } = buildRequest(input);
  const doFetch = input.fetch ?? fetch;

  try {
    const res = await doFetch(url, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      const snippet = bodyText.slice(0, ERROR_BODY_SNIPPET_CHARS).trim();
      return { ok: false, error: `HTTP ${res.status}${snippet ? ` — ${snippet}` : ''}` };
    }

    const json = await res.json() as ModelsListResponseBody;
    const models = Array.isArray(json.data)
      ? json.data.map((m) => m.id).filter((id): id is string => typeof id === 'string')
      : [];
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
