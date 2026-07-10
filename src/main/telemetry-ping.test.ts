/**
 * telemetry-ping.test.ts — Anonymous opt-in install/launch ping (audit 1.8b)
 *
 * Covers the three required scenarios (default-off, opt-in+endpoint fires,
 * opt-in-without-endpoint no-op) plus endpoint precedence, anonymousId
 * persistence, and the telemetry:getOptIn/setOptIn IPC surface.
 *
 * settings-store is mocked with an in-memory record standing in for
 * electron-store (same reasoning as mcp-command-policy.test.ts — electron-store
 * calls app.getPath() internally, unavailable outside a running Electron
 * process). `fetch` is injected explicitly per call — never the real network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeSettings {
  telemetryOptIn: boolean;
  telemetryAnonymousId: string | null;
  telemetryEndpoint: string | null;
}

const { getSettings, setSetting, resetSettings } = vi.hoisted(() => {
  let settings: FakeSettings = {
    telemetryOptIn: false,
    telemetryAnonymousId: null,
    telemetryEndpoint: null,
  };
  return {
    getSettings: () => settings,
    setSetting: (key: keyof FakeSettings, value: FakeSettings[keyof FakeSettings]) => {
      settings = { ...settings, [key]: value };
    },
    resetSettings: () => {
      settings = { telemetryOptIn: false, telemetryAnonymousId: null, telemetryEndpoint: null };
    },
  };
});

vi.mock('../types', () => ({
  errMsg: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock('./storage/settings-store', () => ({
  settingsGet: (key: keyof FakeSettings) => getSettings()[key],
  settingsSet: (key: keyof FakeSettings, value: FakeSettings[keyof FakeSettings]) => setSetting(key, value),
}));

const { handlers, fakeApp } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const fakeApp = { getVersion: () => '0.1.0' };
  return { handlers, fakeApp };
});

vi.mock('electron', () => ({
  app: fakeApp,
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));

import { registerTelemetryIpcHandlers, sendTelemetryLaunchPing } from './telemetry-ping';

function makeFetchMock(status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    body: { cancel: vi.fn() },
  })) as unknown as typeof fetch;
}

/**
 * `fetch`'s real type has an optional `init` with broad `HeadersInit`/`BodyInit`
 * unions — fine for callers, unwieldy for asserting on exactly what this
 * module always passes. This narrows one captured call to that concrete
 * shape instead of reaching for `any`.
 */
interface CapturedFetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function capturedFetchCall(fetchMock: typeof fetch, callIndex = 0): CapturedFetchCall {
  const [url, init] = vi.mocked(fetchMock).mock.calls[callIndex]!;
  const typedInit = init as { method: string; headers: Record<string, string>; body: string };
  return { url: String(url), method: typedInit.method, headers: typedInit.headers, body: typedInit.body };
}

describe('telemetry-ping', () => {
  const originalEndpointEnv = process.env.FLUXOR_TELEMETRY_ENDPOINT;

  beforeEach(() => {
    resetSettings();
    delete process.env.FLUXOR_TELEMETRY_ENDPOINT;
  });

  afterEach(() => {
    if (originalEndpointEnv === undefined) {
      delete process.env.FLUXOR_TELEMETRY_ENDPOINT;
    } else {
      process.env.FLUXOR_TELEMETRY_ENDPOINT = originalEndpointEnv;
    }
  });

  describe('default-off', () => {
    it('does not fetch when telemetryOptIn is false, even with an endpoint configured', async () => {
      process.env.FLUXOR_TELEMETRY_ENDPOINT = 'https://telemetry.example/ping';
      const fetchMock = makeFetchMock();

      await sendTelemetryLaunchPing(fetchMock);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('opt-in without endpoint', () => {
    it('is a no-op when opted in but no endpoint is configured anywhere', async () => {
      setSetting('telemetryOptIn', true);
      const fetchMock = makeFetchMock();

      await sendTelemetryLaunchPing(fetchMock);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('opt-in + endpoint fires', () => {
    it('POSTs the minimal payload to the env-configured endpoint', async () => {
      setSetting('telemetryOptIn', true);
      process.env.FLUXOR_TELEMETRY_ENDPOINT = 'https://telemetry.example/ping';
      const fetchMock = makeFetchMock();

      await sendTelemetryLaunchPing(fetchMock);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = capturedFetchCall(fetchMock);
      expect(call.url).toBe('https://telemetry.example/ping');
      expect(call.method).toBe('POST');
      expect(call.headers['Content-Type']).toBe('application/json');

      const payload = JSON.parse(call.body);
      expect(payload).toEqual({
        anonymousId: expect.any(String),
        appVersion: '0.1.0',
        platform: process.platform,
        arch: process.arch,
        event: 'launch',
      });
    });

    it('falls back to the settings-key endpoint when the env var is absent', async () => {
      setSetting('telemetryOptIn', true);
      setSetting('telemetryEndpoint', 'https://self-hosted.example/ping');
      const fetchMock = makeFetchMock();

      await sendTelemetryLaunchPing(fetchMock);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(capturedFetchCall(fetchMock).url).toBe('https://self-hosted.example/ping');
    });

    it('prefers the env var over the settings-key endpoint when both are set', async () => {
      setSetting('telemetryOptIn', true);
      setSetting('telemetryEndpoint', 'https://self-hosted.example/ping');
      process.env.FLUXOR_TELEMETRY_ENDPOINT = 'https://telemetry.example/ping';
      const fetchMock = makeFetchMock();

      await sendTelemetryLaunchPing(fetchMock);

      expect(capturedFetchCall(fetchMock).url).toBe('https://telemetry.example/ping');
    });

    it('generates the anonymous id once and reuses it on subsequent pings', async () => {
      setSetting('telemetryOptIn', true);
      process.env.FLUXOR_TELEMETRY_ENDPOINT = 'https://telemetry.example/ping';
      const fetchMock = makeFetchMock();

      await sendTelemetryLaunchPing(fetchMock);
      await sendTelemetryLaunchPing(fetchMock);

      const firstId = JSON.parse(capturedFetchCall(fetchMock, 0).body).anonymousId;
      const secondId = JSON.parse(capturedFetchCall(fetchMock, 1).body).anonymousId;
      expect(firstId).toBe(secondId);
      expect(getSettings().telemetryAnonymousId).toBe(firstId);
    });

    it('swallows fetch rejections silently (offline, timeout, etc.)', async () => {
      setSetting('telemetryOptIn', true);
      process.env.FLUXOR_TELEMETRY_ENDPOINT = 'https://telemetry.example/ping';
      const fetchMock = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;

      await expect(sendTelemetryLaunchPing(fetchMock)).resolves.toBeUndefined();
    });
  });

  describe('telemetry:getOptIn / telemetry:setOptIn IPC', () => {
    it('registers both handlers exactly once, idempotently', () => {
      registerTelemetryIpcHandlers();
      registerTelemetryIpcHandlers();
      expect(handlers.has('telemetry:getOptIn')).toBe(true);
      expect(handlers.has('telemetry:setOptIn')).toBe(true);
    });

    it('getOptIn reflects the current setting and setOptIn updates it', () => {
      registerTelemetryIpcHandlers();
      const getOptIn = handlers.get('telemetry:getOptIn')!;
      const setOptIn = handlers.get('telemetry:setOptIn')!;

      // These IPC handlers are synchronous (settings-store is synchronous
      // electron-store under the hood) — Electron's real ipcMain.handle
      // accepts either a plain value or a Promise, but calling the
      // registered function directly here (bypassing IPC) returns exactly
      // what it returns, so no `.resolves`/`await` is needed.
      expect(getOptIn({})).toEqual({ success: true, data: false });

      const setResult = setOptIn({}, true);
      expect(setResult).toEqual({ success: true, data: true });
      expect(getOptIn({})).toEqual({ success: true, data: true });
    });

    it('setOptIn rejects a non-boolean payload without touching settings', async () => {
      registerTelemetryIpcHandlers();
      const setOptIn = handlers.get('telemetry:setOptIn')!;

      const result = await setOptIn({}, 'yes' as unknown as boolean);
      expect(result).toEqual({ success: false, error: expect.stringContaining('boolean') });
      expect(getSettings().telemetryOptIn).toBe(false);
    });
  });
});
