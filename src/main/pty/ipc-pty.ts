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
import fs from 'node:fs';
import path from 'node:path';
import { PtyManager, type PtyInfo, type PtyDataEvent, type PtyExitEvent, type PtySpawnFn } from './pty-manager';
import { AGENT_VENDORS, detectVendors, resolveVendorBin, whichBin, type AgentVendor, type AgentVendorId } from './vendors';

export interface PtySpawnPayload {
  sessionId: string;
  vendor: AgentVendorId;
  cwd: string;
  /**
   * The PROJECT the session belongs to — not necessarily where it runs. For an
   * attached session the two are the same path; for a worktree session `cwd` is
   * `<projectRoot>/.claude/worktrees/<name>` and this is what still says which
   * project that worktree belongs to. The attached-session rule below is
   * counted per project, so it needs the project, not the directory.
   */
  projectRoot: string;
  /** 'attached' = the main tree; 'worktree' = a dedicated git worktree. */
  mode: AgentSessionMode;
  prompt?: string;
  cols: number;
  rows: number;
}

export type AgentSessionMode = 'attached' | 'worktree';

/** One live PTY, as the attached-session rule and the dock picker see it. */
export interface LiveSessionEntry {
  sessionId: string;
  projectRoot: string;
  mode: AgentSessionMode;
}

/**
 * Two agents writing into the same working tree at once is the failure this
 * refuses: a shared git index, a stale `.next` after a `git mv`, and no error
 * message anywhere — they simply step on each other. It is invariant 16 of
 * javadaba-web's harness turned into a mechanism instead of a sentence.
 *
 * The SECOND session is not blocked, it is redirected: the window offers to
 * open in a worktree instead, which is exactly what the invariant asks for.
 */
export interface AttachedSessionExistsError {
  error: 'attached_session_exists';
  projectRoot: string;
  /** The session already holding the main tree — the window names its title. */
  sessionId: string;
}

/**
 * A worktree that was never created, or one someone deleted by hand. Cheap to
 * check and impossible to diagnose afterwards: node-pty reports an unreachable
 * cwd with the same `posix_spawnp failed.` it reports a missing binary with.
 */
export interface CwdNotFoundError {
  error: 'cwd_not_found';
  cwd: string;
}

/**
 * May an `attached` session open on `projectRoot` right now?
 *
 * Pure and exported so the rule is decided by a unit test rather than by
 * opening two terminals and watching what happens.
 */
export function canOpenAttached(
  live: Iterable<LiveSessionEntry>,
  projectRoot: string,
): { ok: true } | { ok: false; sessionId: string } {
  for (const entry of live) {
    if (entry.mode === 'attached' && entry.projectRoot === projectRoot) {
      return { ok: false, sessionId: entry.sessionId };
    }
  }
  return { ok: true };
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

export type PtySpawnResult =
  | PtySpawnSuccess
  | VendorNotFoundError
  | AttachedSessionExistsError
  | CwdNotFoundError;

export function isVendorNotFound(r: PtySpawnResult): r is VendorNotFoundError {
  return 'error' in r && r.error === 'vendor_not_found';
}

/**
 * Which sessions are live, and what each one is attached to.
 *
 * Module level rather than a field of the manager: `PtyManager` owns process
 * mechanics and knows nothing about projects or modes, and giving it a second
 * responsibility to satisfy one rule is how a manager becomes a god object.
 * Kept across a re-registration of the handlers for the same reason.
 */
const liveSessions = new Map<string, LiveSessionEntry>();

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
  mgr.on('exit', (e: PtyExitEvent) => {
    // Released here rather than where the window notices: the rule is about
    // live PROCESSES, and a closed window whose agent is still running must
    // keep holding the main tree.
    liveSessions.delete(e.sessionId);
    push('fluxor:pty-exit', e);
  });

  ipcMain.handle('fluxor:pty-spawn', async (_event, payload: PtySpawnPayload): Promise<PtySpawnResult> => {
    const vendor = AGENT_VENDORS[payload.vendor];
    if (!vendor) throw new Error(`Unknown agent vendor: ${payload.vendor}`);

    // Cheapest first, and the one F1 skipped: a worktree that was never
    // created looks exactly like a missing binary from inside node-pty.
    if (!fs.existsSync(payload.cwd)) {
      return { error: 'cwd_not_found', cwd: payload.cwd };
    }

    if (payload.mode === 'attached') {
      const verdict = canOpenAttached(liveSessions.values(), payload.projectRoot);
      if (!verdict.ok) {
        return {
          error: 'attached_session_exists',
          projectRoot: payload.projectRoot,
          sessionId: verdict.sessionId,
        };
      }
    }

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
    liveSessions.set(payload.sessionId, {
      sessionId: payload.sessionId,
      projectRoot: payload.projectRoot,
      mode: payload.mode,
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

  /**
   * What `pty-list` cannot say: which project each live session belongs to and
   * whether it is holding the main tree. The dock picker asks this to disable
   * "attached" WITH THE REASON instead of letting the spawn be refused after
   * the window is already open.
   */
  ipcMain.handle('fluxor:pty-live-sessions', async (): Promise<LiveSessionEntry[]> =>
    [...liveSessions.values()]);

  ipcMain.handle('fluxor:agents-detect', async () => detectVendors());
}

/** Called from the app's `will-quit` — no orphaned agent processes. */
export function disposePtySessions(): void {
  manager?.disposeAll();
  liveSessions.clear();
}
