/**
 * logger.ts — Main process
 *
 * Safe multi-sink logger that prevents EIO/EPIPE crashes from terminating the process.
 * Falls back to file sink under app.getPath('userData') when console is unavailable.
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
import * as fs from 'fs';
import * as path from 'path';

let _electron: typeof import('electron') | null = null;
try { _electron = require('electron'); } catch { /* not in Electron context */ }

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

class SafeLogger {
  private consoleFailed = false;
  private fileSinkPath: string | null = null;
  private minLevel: LogLevel = 'debug';

  // ── Public API ──────────────────────────────────────────────────

  debug(...args: unknown[]): void { this.write('debug', args); }
  info(...args: unknown[]): void  { this.write('info', args); }
  warn(...args: unknown[]): void  { this.write('warn', args); }
  error(...args: unknown[]): void { this.write('error', args); }

  /**
   * Always-persisted error, for crash handlers only.
   *
   * `error()` prefers the console and only falls back to a file when the
   * console itself is broken. That is the wrong trade for a fatal: in dev the
   * console IS a terminal that dies with the process, so the one line that
   * explains why the app went away is exactly the line that gets lost. This
   * writes to BOTH sinks, synchronously, because the process may be
   * milliseconds from exiting.
   */
  fatal(...args: unknown[]): void {
    const line = this.format('fatal', args);
    try {
      console.error('[Fluxor][FATAL]', ...args);
    } catch { /* console may already be gone — the file sink below is the point */ }
    this.writeToFile(line);
  }

  /** Absolute path of the persistent sink, so startup can point a human at it. */
  get filePath(): string | null {
    return this.ensureFileSink();
  }

  // ── Internals ───────────────────────────────────────────────────

  private format(level: LogLevel | 'fatal', args: unknown[]): string {
    const message = args.map(a =>
      typeof a === 'string' ? a : (a instanceof Error ? a.stack ?? a.message : JSON.stringify(a)),
    ).join(' ');
    return `${new Date().toISOString()} [Fluxor][${level.toUpperCase()}] ${message}`;
  }

  private write(level: LogLevel, args: unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const prefix = `[Fluxor][${level.toUpperCase()}]`;
    const line = this.format(level, args);

    // Attempt console write first (fast path)
    if (!this.consoleFailed) {
      try {
        const fn = level === 'error' ? console.error
          : level === 'warn' ? console.warn
          : level === 'debug' ? console.debug
          : console.info;
        fn(prefix, ...args);
        return; // success — no need for file fallback
      } catch (err: unknown) {
        if (isStreamError(err)) {
          this.consoleFailed = true;
          // Fall through to file sink
        } else {
          // Re-throw unexpected errors, but guard against recursion
          return;
        }
      }
    }

    // File sink fallback
    this.writeToFile(line);
  }

  private writeToFile(line: string): void {
    const sinkPath = this.ensureFileSink();
    if (!sinkPath) return;

    try {
      // Rotate if the log file exceeds the cap
      this.rotateIfNeeded(sinkPath);
      fs.appendFileSync(sinkPath, line + '\n', 'utf-8');
    } catch {
      // Last resort: silently drop. Never crash.
    }
  }

  private ensureFileSink(): string | null {
    if (this.fileSinkPath) return this.fileSinkPath;

    try {
      // Try Electron's userData first (works after app.ready, or even before on some platforms)
      let dir: string | null = null;
      try {
        dir = _electron?.app?.getPath('userData') ?? null;
      } catch {
        // getPath can throw before app.ready — fall back to cwd
      }

      if (!dir) {
        // Pre-ready fallback: use the process cwd
        dir = process.cwd();
      }

      fs.mkdirSync(dir, { recursive: true });
      this.fileSinkPath = path.join(dir, 'fluxor.log');
      return this.fileSinkPath;
    } catch {
      return null;
    }
  }

  private rotateIfNeeded(filePath: string): void {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size >= MAX_LOG_FILE_BYTES) {
        const rotatedPath = filePath + '.1';
        // Keep only one rotated file to stay simple
        try { fs.unlinkSync(rotatedPath); } catch { /* may not exist */ }
        fs.renameSync(filePath, rotatedPath);
      }
    } catch {
      // File may not exist yet — that's fine
    }
  }
}

function isStreamError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'EIO' || code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED';
}

/** Singleton safe logger for the main process */
export const log = new SafeLogger();
