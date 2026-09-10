/**
 * pty-manager.ts — Live PTY sessions in the main process (Cockpit F1)
 *
 * Responsibility:
 * - Spawns a vendor CLI inside a pseudo-terminal, keeps it addressable by
 *   `sessionId`, and re-emits its output and exit as events.
 * - Appends every byte the process writes to a per-session log file, so a
 *   window that was closed (or an app that was restarted) still leaves a
 *   readable transcript behind.
 *
 * Boundaries:
 * - Owns: the live process table, the log stream, resize/write/kill plumbing.
 * - Does NOT own: which binary to run (vendors.ts), IPC wiring (ipc-pty.ts),
 *   or any policy about when a session should exist.
 *
 * Architectural role:
 * - Main-process service. The `spawn` function is INJECTED rather than
 *   imported: `node-pty` is a native module, and importing it from this file
 *   would drag a `.node` binary into every unit test that touches the manager.
 *   The real binding is resolved once, lazily, in ipc-pty.ts.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type * as NodePty from 'node-pty';

export interface PtySpawnRequest {
  sessionId: string;
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  cols: number;
  rows: number;
}

export interface PtyInfo {
  sessionId: string;
  pid: number;
  command: string;
  cwd: string;
  logPath: string;
  startedAt: number;
  /** `null` while the process is alive; the process's exit code once it ends. */
  exitCode: number | null;
}

export interface PtyDataEvent {
  sessionId: string;
  data: string;
}

export interface PtyExitEvent {
  sessionId: string;
  exitCode: number;
  signal?: number;
}

export type PtySpawnFn = typeof NodePty.spawn;

interface LiveSession {
  info: PtyInfo;
  proc: NodePty.IPty;
  log: fs.WriteStream;
}

export class PtyManager extends EventEmitter {
  private readonly spawnFn: PtySpawnFn;
  private readonly sessionsDir: string;
  private readonly sessions = new Map<string, LiveSession>();

  constructor(deps: { spawn: PtySpawnFn; sessionsDir: string }) {
    super();
    this.spawnFn = deps.spawn;
    this.sessionsDir = deps.sessionsDir;
  }

  spawn(req: PtySpawnRequest): PtyInfo {
    if (this.sessions.has(req.sessionId)) {
      throw new Error(`PTY session already running: ${req.sessionId}`);
    }

    fs.mkdirSync(this.sessionsDir, { recursive: true });
    const logPath = path.join(this.sessionsDir, `${req.sessionId}.log`);
    const log = fs.createWriteStream(logPath, { flags: 'a' });
    // A transcript is a nice-to-have; a failed write to it must never take the
    // session down with it.
    log.on('error', () => { /* transcript best-effort — the session outlives it */ });

    // `process.env.TERM` is whatever launched the IDE, and under a CI runner or
    // a non-interactive parent that is `dumb` — which makes a TUI agent render
    // as a wall of plain text. The PTY always gets a real terminal type; an
    // explicit `req.env` still wins, so a caller can override it deliberately.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      ...(req.env ?? {}),
    };

    const proc = this.spawnFn(req.command, req.args, {
      name: 'xterm-256color',
      cols: req.cols,
      rows: req.rows,
      cwd: req.cwd,
      env: env as { [key: string]: string },
    });

    const info: PtyInfo = {
      sessionId: req.sessionId,
      pid: proc.pid,
      command: req.command,
      cwd: req.cwd,
      logPath,
      startedAt: Date.now(),
      exitCode: null,
    };

    const session: LiveSession = { info, proc, log };
    this.sessions.set(req.sessionId, session);

    proc.onData((data) => {
      log.write(data);
      this.emit('data', { sessionId: req.sessionId, data } satisfies PtyDataEvent);
    });

    proc.onExit(({ exitCode, signal }) => {
      info.exitCode = exitCode;
      log.end();
      this.sessions.delete(req.sessionId);
      this.emit('exit', { sessionId: req.sessionId, exitCode, signal } satisfies PtyExitEvent);
    });

    return { ...info };
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.proc.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    // node-pty throws on a zero/negative geometry, which a hidden or
    // mid-layout window produces routinely (a ResizeObserver fires at 0x0
    // before the first paint). Clamping here keeps that off the caller.
    session.proc.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)));
  }

  kill(sessionId: string, signal?: string): void {
    this.sessions.get(sessionId)?.proc.kill(signal);
  }

  get(sessionId: string): PtyInfo | undefined {
    const info = this.sessions.get(sessionId)?.info;
    return info ? { ...info } : undefined;
  }

  list(): PtyInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }));
  }

  /** Kills every live session — the app's `will-quit` path. */
  disposeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      try {
        this.kill(sessionId);
      } catch {
        // Already dead between the snapshot and the kill — nothing to do.
      }
    }
  }
}
