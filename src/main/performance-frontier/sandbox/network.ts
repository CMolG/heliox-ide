import {
  fetch as undiciFetch,
  MockAgent,
  type RequestInfo,
  type RequestInit,
  type Response,
} from 'undici';

export interface SandboxNetworkMock {
  origin: string;
  path: string;
  method?: string;
  statusCode: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface SandboxNetwork {
  fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  destroy: () => void;
}

const DEFAULT_NETWORK_MOCKS: SandboxNetworkMock[] = [{
  origin: 'https://api.javadaba.com',
  path: '/v1/fluxor/ticket',
  method: 'POST',
  statusCode: 202,
  body: { ok: true, intercepted: true },
}];

function targetToString(input: RequestInfo): string {
  if (typeof input === 'string') return input;
  if ('url' in input) return input.url;
  return input.toString();
}

export function createSandboxNetwork(mocks: SandboxNetworkMock[] = []): SandboxNetwork {
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();

  for (const mock of [...DEFAULT_NETWORK_MOCKS, ...mocks]) {
    mockAgent
      .get(mock.origin)
      .intercept({
        path: mock.path,
        method: mock.method ?? 'GET',
      })
      .reply(mock.statusCode, mock.body ?? '', {
        headers: {
          ...(mock.body && typeof mock.body === 'object' ? { 'content-type': 'application/json' } : {}),
          ...mock.headers,
        },
      });
  }

  return {
    fetch: async (input, init) => {
      try {
        return await undiciFetch(input, {
          ...init,
          dispatcher: mockAgent,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Network call to "${targetToString(input)}" blocked by Performance Frontier sandbox: ${message}`,
        );
      }
    },
    destroy: () => {
      void mockAgent.close();
    },
  };
}
