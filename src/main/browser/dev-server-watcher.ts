/**
 * dev-server-watcher.ts — Main Process Module
 *
 * Responsibility:
 * - Polls a fixed set of candidate ports on 127.0.0.1 to detect local dev servers.
 * - Emits 'fluxor:dev-server-detected' once per newly-up port, and re-emits
 *   after a port that went down comes back up.
 * - Reads vite.config.* / package.json best-effort to prioritise the project's
 *   configured port without failing if those files are absent.
 * - Exposes IPC handlers so the renderer can start/stop watching per project.
 *
 * Boundaries:
 * - Main process only — no renderer imports, no DOM/React.
 * - Does NOT open any remote-debugging-port (that belongs to M2).
 *
 * IPC channels (both follow the {success, data?, error?} convention):
 *   'devserver:start-watch'  → startDevServerWatch(mainWindow, projectPath)
 *   'devserver:stop-watch'   → stopDevServerWatch(projectPath?)
 *
 * Push event emitted to renderer:
 *   'fluxor:dev-server-detected'  payload: { url: string; port: number }
 */
// src/main/browser/dev-server-watcher.ts — Dev server auto-detection for M1 preview windows

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { readFile } from 'fs/promises';
import path from 'path';

// Vite injects the IDE's own renderer dev-server URL in development (it is
// undefined in packaged production builds). We must exclude its port from
// probing so the watcher never auto-opens a preview of Fluxor *itself* while
// dogfooding via `npm start` (Vite's default 5173 collides with our candidates).
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

// ─── Constants ────────────────────────────────────────────────────────────────

/** Ports probed in order. Vite default is first; others follow descending by popularity. */
const CANDIDATE_PORTS = [5173, 5174, 3000, 3001, 4321, 8080, 4200] as const;

/** How often to probe all ports (ms). Aggressive enough for responsive auto-open. */
const POLL_INTERVAL_MS = 2500;

/** Timeout for a single probe request — short so we don't queue up stale checks. */
const PROBE_TIMEOUT_MS = 800;

// ─── Module-level state ───────────────────────────────────────────────────────

/**
 * Map of projectPath → interval handle.
 * A null key '' is used when the renderer calls start without a project path
 * (treated as "global" watcher).
 */
const activeIntervals = new Map<string, ReturnType<typeof setInterval>>();

/**
 * Liveness tracker per watcher.
 * Key: projectPath (or ''). Value: Set of ports currently known to be UP.
 * This enforces the "emit once per newly-up port, re-emit after down→up" rule.
 */
const livePortSets = new Map<string, Set<number>>();

// ─── Port probe ───────────────────────────────────────────────────────────────

/**
 * Probe a single port on 127.0.0.1 with a short AbortController timeout.
 * Returns true if any HTTP response is received (any status code counts as
 * "the server is listening"). Returns false on network error or timeout.
 *
 * Pattern mirrors api-verifier.ts: AbortController + fetch + void body cancel.
 */
async function probePort(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal });
    // Any response means the server is bound — cancel body to avoid resource leak
    void res.body?.cancel();
    return true;
  } catch {
    // ECONNREFUSED, abort, or any network error → port not up
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Project config helpers ───────────────────────────────────────────────────

/**
 * Best-effort: read the project's vite.config.{js,ts,mjs,mts,cjs,cts} or
 * package.json to find an explicitly configured dev server port.
 *
 * Returns the configured port number, or null if none found / files absent.
 * Never throws — errors are silently swallowed per spec.
 */
async function inferProjectPort(projectPath: string): Promise<number | null> {
  // 1. Try vite.config.* — look for `port: <number>` or `"port": <number>`
  const viteExts = ['ts', 'js', 'mts', 'mjs', 'cjs', 'cts'];
  for (const ext of viteExts) {
    try {
      const configPath = path.join(projectPath, `vite.config.${ext}`);
      const content = await readFile(configPath, 'utf-8');
      // Match: port: 3000  or  "port": 3000  or  port:3000
      const match = content.match(/\bport\s*[:=]\s*(\d{4,5})/);
      if (match) {
        const p = parseInt(match[1], 10);
        if (p > 0 && p < 65536) return p;
      }
    } catch {
      // File does not exist or unreadable — continue
    }
  }

  // 2. Try package.json — look for scripts.dev / scripts.start port flags
  try {
    const pkgPath = path.join(projectPath, 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    const devScript = scripts['dev'] ?? scripts['start'] ?? scripts['serve'] ?? '';
    // e.g. "vite --port 3001" or "--port=3001"
    const match = devScript.match(/--port[= ](\d{4,5})/);
    if (match) {
      const p = parseInt(match[1], 10);
      if (p > 0 && p < 65536) return p;
    }
  } catch {
    // package.json absent or malformed — silently ignore
  }

  return null;
}

/**
 * The IDE's own renderer dev-server port (dev only), or null in production.
 * Excluded from probing so we never self-detect Fluxor as a previewable app.
 */
function getSelfDevServerPort(): number | null {
  try {
    if (!MAIN_WINDOW_VITE_DEV_SERVER_URL) return null;
    const port = Number(new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).port);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/**
 * Build the ordered probe list: inferred project port first (if found),
 * then the remaining candidates (skipping the inferred one to avoid duplicate).
 * The IDE's own dev-server port is always excluded.
 */
async function buildProbeOrder(projectPath: string): Promise<number[]> {
  const inferred = await inferProjectPort(projectPath);
  const selfPort = getSelfDevServerPort();
  const exclude = (ports: number[]) => ports.filter(p => p !== selfPort);

  if (inferred !== null && CANDIDATE_PORTS.includes(inferred as typeof CANDIDATE_PORTS[number])) {
    return exclude([inferred, ...CANDIDATE_PORTS.filter(p => p !== inferred)]);
  }
  if (inferred !== null) {
    // Not in the static list — still probe it first
    return exclude([inferred, ...CANDIDATE_PORTS]);
  }
  return exclude([...CANDIDATE_PORTS]);
}

// ─── Core watcher ────────────────────────────────────────────────────────────

/**
 * Start polling all candidate ports for the given project.
 *
 * Liveness semantics:
 *  - A port that becomes reachable → emits once → added to livePortSets.
 *  - A port that was live but is now unreachable → removed from livePortSets
 *    (no down-event; the renderer dedupes by boundPort so the window stays open).
 *  - A port in livePortSets that is still reachable → no event (deduped).
 *  - A port that went down and comes back up → emits again.
 *
 * Called from both the IPC handler and re-entrant cleanup is safe because
 * stopDevServerWatch removes the previous interval before starting a new one.
 */
export async function startDevServerWatch(
  mainWindow: BrowserWindow,
  projectPath: string,
): Promise<void> {
  // Stop any previous watcher for this project before starting a new one
  stopDevServerWatch(projectPath);

  // Initialise liveness set for this project key
  livePortSets.set(projectPath, new Set<number>());

  // Build ordered probe list once (best-effort config read); reuse for every tick
  const probeOrder = await buildProbeOrder(projectPath);

  // Run one probe cycle: check all ports and emit for newly-detected ones
  const tick = async () => {
    // Guard: if the window was closed while we were waiting, stop polling
    if (mainWindow.isDestroyed()) {
      stopDevServerWatch(projectPath);
      return;
    }

    const livePorts = livePortSets.get(projectPath);
    if (!livePorts) return; // watcher was stopped mid-tick

    const results = await Promise.all(
      probeOrder.map(async (port) => ({ port, up: await probePort(port) })),
    );

    for (const { port, up } of results) {
      if (up && !livePorts.has(port)) {
        // Newly up — mark live and emit
        livePorts.add(port);
        mainWindow.webContents.send('fluxor:dev-server-detected', {
          url: `http://localhost:${port}`,
          port,
        });
      } else if (!up && livePorts.has(port)) {
        // Went down — remove from live set so next up→ emits again
        livePorts.delete(port);
      }
    }
  };

  // Run immediately (don't wait for the first interval)
  void tick();

  const handle = setInterval(() => void tick(), POLL_INTERVAL_MS);
  activeIntervals.set(projectPath, handle);
}

/**
 * Stop polling for a specific project (or all projects if no path supplied).
 * Safe to call multiple times — idempotent.
 */
export function stopDevServerWatch(projectPath?: string): void {
  if (projectPath !== undefined) {
    const handle = activeIntervals.get(projectPath);
    if (handle !== undefined) {
      clearInterval(handle);
      activeIntervals.delete(projectPath);
      livePortSets.delete(projectPath);
    }
  } else {
    // Stop all active watchers
    for (const [key, handle] of activeIntervals) {
      clearInterval(handle);
      activeIntervals.delete(key);
      livePortSets.delete(key);
    }
  }
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

/**
 * Register IPC handlers for renderer → main dev-server watcher control.
 * Called from src/main/index.ts alongside the other registrar functions.
 *
 * Channels:
 *   'devserver:start-watch'  args: [projectPath: string]  → { success: true }
 *   'devserver:stop-watch'   args: []                    → { success: true }
 */
export function registerDevServerIpcHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('devserver:start-watch', async (_event, projectPath: string) => {
    try {
      await startDevServerWatch(mainWindow, projectPath ?? '');
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('devserver:stop-watch', (_event, projectPath?: string) => {
    try {
      stopDevServerWatch(projectPath);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  // Clean up all watchers when the window is destroyed to prevent dangling intervals
  mainWindow.on('closed', () => {
    stopDevServerWatch();
  });
}
