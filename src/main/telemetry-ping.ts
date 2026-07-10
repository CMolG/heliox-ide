/**
 * telemetry-ping.ts — Anonymous, opt-in install/launch ping (audit 1.8b)
 *
 * Distinct from crash reporting (src/main/index.ts's `crashReporter.start`,
 * which stays local — `uploadToServer: false`). This is the "how many people
 * actually use this" counter the audit calls out as currently unanswerable.
 *
 * Fires only when *both* are true:
 *  - `telemetryOptIn === true` in settings-store (default: false)
 *  - an endpoint is configured — FLUXOR_TELEMETRY_ENDPOINT env var (legacy
 *    compat: HELIOX_TELEMETRY_ENDPOINT, deprecated), or the
 *    `telemetryEndpoint` settings key as a fallback
 *
 * Payload is intentionally minimal: a random anonymous id (persisted so
 * repeat launches de-duplicate server-side, never derived from hardware or
 * account info), app version, platform, arch, and the event name. Network
 * failures are swallowed — telemetry must never surface an error to the user
 * or slow down boot.
 */
import { app, ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import { errMsg } from '../types';
import { settingsGet, settingsSet } from './storage/settings-store';
import { readBrandEnv } from './lib/env-compat';

const PING_TIMEOUT_MS = 3000;

export interface TelemetryPingPayload {
  anonymousId: string;
  appVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  event: 'launch';
}

function resolveEndpoint(): string | null {
  const fromEnv = readBrandEnv('FLUXOR_TELEMETRY_ENDPOINT');
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim();

  const fromSettings = settingsGet('telemetryEndpoint');
  return fromSettings && fromSettings.trim().length > 0 ? fromSettings.trim() : null;
}

function getOrCreateAnonymousId(): string {
  const existing = settingsGet('telemetryAnonymousId');
  if (existing) return existing;

  const id = randomUUID();
  settingsSet('telemetryAnonymousId', id);
  return id;
}

/**
 * Fire the anonymous launch ping. Resolves (never rejects) immediately as a
 * no-op unless the user has opted in AND an endpoint is configured.
 *
 * @param fetchImpl Injectable fetch for testing. Defaults to the global fetch
 *   (see arena/model-fetcher.ts for the same pattern elsewhere in this codebase).
 */
export async function sendTelemetryLaunchPing(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (settingsGet('telemetryOptIn') !== true) return;

  const endpoint = resolveEndpoint();
  if (!endpoint) return;

  const payload: TelemetryPingPayload = {
    anonymousId: getOrCreateAnonymousId(),
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    event: 'launch',
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    void res.body?.cancel();
  } catch {
    // Deliberately silent — see module header. Telemetry must never affect
    // boot or runtime behavior, and must never surface a network error.
  } finally {
    clearTimeout(timer);
  }
}

// ─── IPC — renderer surface for the opt-in toggle ───────────────────────────

let ipcRegistered = false;

/** Register telemetry:getOptIn / telemetry:setOptIn (idempotent). */
export function registerTelemetryIpcHandlers(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('telemetry:getOptIn', () => {
    try {
      return { success: true, data: settingsGet('telemetryOptIn') };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('telemetry:setOptIn', (_event, optIn: boolean) => {
    if (typeof optIn !== 'boolean') {
      return { success: false, error: 'optIn must be a boolean.' };
    }
    try {
      settingsSet('telemetryOptIn', optIn);
      return { success: true, data: optIn };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });
}
