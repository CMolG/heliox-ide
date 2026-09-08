/**
 * ipc-pty.ts — IPC surface for agent-session terminals (Cockpit F1)
 *
 * Responsibility:
 * - Exposes the PtyManager to the renderer: spawn / write / resize / kill /
 *   list, plus the vendor availability probe the picker renders.
 * - Pushes `fluxor:pty-data` and `fluxor:pty-exit` to the renderer as the
 *   process produces them.
 *
 * Boundaries:
 * - Owns: channel names, payload validation, the manager's lifetime.
 * - Does NOT own: argv (vendors.ts) or process mechanics (pty-manager.ts).
 *
 * Architectural role:
 * - Registered from `src/main/index.ts` alongside the other registrars, and
 *   torn down from the app's `will-quit`.
 *
 * Why the manager is a LAZY singleton: `node-pty` is the only native module in
 * this feature. Resolving it at import time would make `import`ing this file —
 * or anything that transitively reaches it — load a `.node` binary, which is
 * exactly what keeps the unit tests off the native path.
 */
import { app, ipcMain, type BrowserWindow } from 'electron';
import path from 'node:path';
import { PtyManager, type PtyInfo, type PtyDataEvent, type PtyExitEvent, type PtySpawnFn } from './pty-manager';
import { AGENT_VENDORS, detectVendors, resolveVendorBin, whichBin, type AgentVendor, type AgentVendorId } from './vendors';

export interface PtySpawnPayload {
  sessionId: string;
  vendor: AgentVendorId;
  cwd: string;
  prompt?: string;
  cols: number;
  rows: number;
}

/**
 * A missing binary is the single most likely failure of this whole feature —
 * the user simply has not installed that CLI. It comes back as a value, not a
 * thrown error, so the session window can render an actionable state (which
 * binary, and the two ways to fix it) instead of a stack trace.
 */
export interface VendorNotFoundError {
  error: 'vendor_not_found';
  vendor: AgentVendorId;
  bin: string;
}

/**
 * `promptDelivery` rides along on the spawn response because the RENDERER is
 * what has to act on it: a `'type'` vendor's prompt is typed into the live PTY
 * after its TUI comes up, and only the renderer sees the first output chunk.
 * Sending it here keeps the vendor registry the single source of that fact —
 * the alternative was a second copy of the table on the renderer side, which
 * is exactly the drift this avoids (the renderer cannot import this module:
 * `vendors.ts` reaches `node:child_process`).
 */
export type PtySpawnSuccess = PtyInfo & { promptDelivery: AgentVendor['promptDelivery'] };

export type PtySpawnResult = PtySpawnSuccess | VendorNotFoundError;

export function isVendorNotFound(r: PtySpawnResult): r is VendorNotFoundError {
  return 'error' in r && r.error === 'vendor_not_found';
}

let manager: PtyManager | null = null;

function getManager(): PtyManager {
  if (manager) return manager;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePty = require('node-pty') as { spawn: PtySpawnFn };
  manager = new PtyManager({
    spawn: nodePty.spawn,
    sessionsDir: path.join(app.getPath('userData'), 'sessions'),
  });
  return manager;
}

export function registerPtyIpcHandlers(mainWindow: BrowserWindow): void {
  const mgr = getManager();

  const push = (channel: string, payload: unknown) => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  };

  mgr.on('data', (e: PtyDataEvent) => push('fluxor:pty-data', e));
  mgr.on('exit', (e: PtyExitEvent) => push('fluxor:pty-exit', e));

  ipcMain.handle('fluxor:pty-spawn', async (_event, payload: PtySpawnPayload): Promise<PtySpawnResult> => {
    const vendor = AGENT_VENDORS[payload.vendor];
    if (!vendor) throw new Error(`Unknown agent vendor: ${payload.vendor}`);

    const bin = resolveVendorBin(vendor);
    // Pre-flight, not a post-mortem: node-pty reports a missing binary and an
    // unreachable cwd with the SAME opaque `posix_spawnp failed.`, so the only
    // way to answer "which one was it" is to ask before spawning.
    if (!(await whichBin(bin))) {
      return { error: 'vendor_not_found', vendor: payload.vendor, bin };
    }

    // `promptDelivery: 'type'` vendors have no initial-prompt flag, so their
    // prompt never enters argv — the renderer types it into the live PTY.
    const prompt = vendor.promptDelivery === 'arg' ? payload.prompt : undefined;
    const args = vendor.buildArgs({ prompt });

    const info = mgr.spawn({
      sessionId: payload.sessionId,
      command: bin,
      args,
      cwd: payload.cwd,
      cols: payload.cols,
      rows: payload.rows,
    });
    return { ...info, promptDelivery: vendor.promptDelivery };
  });

  ipcMain.handle('fluxor:pty-write', async (_event, sessionId: string, data: string) => {
    mgr.write(sessionId, data);
    return { success: true };
  });

  ipcMain.handle('fluxor:pty-resize', async (_event, sessionId: string, cols: number, rows: number) => {
    mgr.resize(sessionId, cols, rows);
    return { success: true };
  });

  ipcMain.handle('fluxor:pty-kill', async (_event, sessionId: string, signal?: string) => {
    mgr.kill(sessionId, signal);
    return { success: true };
  });

  ipcMain.handle('fluxor:pty-list', async (): Promise<PtyInfo[]> => mgr.list());

  ipcMain.handle('fluxor:agents-detect', async () => detectVendors());
}

/** Called from the app's `will-quit` — no orphaned agent processes. */
export function disposePtySessions(): void {
  manager?.disposeAll();
}
