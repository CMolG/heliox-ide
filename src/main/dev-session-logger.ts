/**
 * dev-session-logger.ts — Main process
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
/**
 * dev-session-logger.ts — Writes structured log files for every agent session in dev mode.
 *
 * Output: <projectCwd>/.dev-logs/<session-id>-<timestamp>.log
 *
 * Each log contains:
 *   - Session metadata (model, effort, aiAdapter, timestamp)
 *   - The full enriched prompt sent to the CLI
 *   - Every streaming event with timestamps (thinking-delta, message-delta, tool events)
 *   - The final assistant response
 *   - A diff summary of files changed (if any)
 */
import * as fs from 'fs';
import * as path from 'path';
import { log } from './logger';

let _electron: typeof import('electron') | null = null;
try { _electron = require('electron'); } catch { /* not in Electron context */ }

// Multi-signal dev detection: app.isPackaged can fail in certain Forge configs,
// so we also check __dirname (.vite/ = dev) and ELECTRON_IS_DEV env var.
function checkIsDev(): boolean {
  try {
    if (_electron?.app && typeof _electron.app.isPackaged === 'boolean') {
      return !_electron.app.isPackaged;
    }
  } catch { /* app not ready */ }
  // Forge dev builds always output to .vite/
  if (typeof __dirname === 'string' && __dirname.includes('.vite')) return true;
  if (process.env.ELECTRON_IS_DEV === '1') return true;
  return false;
}

// Log detection result at startup so dev console confirms it
log.info(`[DevSessionLogger] dev=${checkIsDev()} (packaged=${_electron?.app?.isPackaged}, dir=${typeof __dirname === 'string' ? __dirname.slice(-30) : '?'})`);

export class DevSessionLogger {
  private lines: string[] = [];
  private logDir: string;
  private logPath: string;
  private startTime: number;
  private filesChanged: { path: string; linesAdded: number; linesRemoved: number }[] = [];
  private active = false;
  private writing = false;
  private pendingFlush = false;

  constructor(private agentId: string, private cwd: string) {
    this.startTime = Date.now();
    this.logDir = path.join(cwd, '.dev-logs');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const shortId = agentId.replace(/[^a-zA-Z0-9-]/g, '').slice(-12);
    this.logPath = path.join(this.logDir, `${ts}_${shortId}.log`);
  }

  /** Returns true if logging is enabled (dev mode) */
  static get enabled(): boolean {
    return checkIsDev();
  }

  /** Start session — write header */
  async start(params: {
    model?: string;
    effort?: string;
    aiAdapter?: string;
    resumeSessionId?: string;
    prompt: string;
  }): Promise<void> {
    if (!checkIsDev()) return;
    this.active = true;

    try {
      await fs.promises.mkdir(this.logDir, { recursive: true });
    } catch (e) {
      log.error('[DevSessionLogger] Failed to create log dir:', this.logDir, e);
      this.active = false;
      return;
    }

    log.info(`[DevSessionLogger] Logging session to ${this.logPath}`);

    this.line('═'.repeat(80));
    this.line(`FLUXOR DEV SESSION LOG`);
    this.line('═'.repeat(80));
    this.line(`Session ID  : ${this.agentId}`);
    this.line(`Started     : ${new Date(this.startTime).toISOString()}`);
    this.line(`CWD         : ${this.cwd}`);
    this.line(`Model       : ${params.model ?? 'opencode/claude-sonnet-4-6'}`);
    this.line(`Effort      : ${params.effort ?? 'default'}`);
    this.line(`AI Adapter  : ${params.aiAdapter ?? 'opencode'}`);
    if (params.resumeSessionId) {
      this.line(`Resume From : ${params.resumeSessionId}`);
    }
    this.line('');
    this.line('─── PROMPT SENT TO CLI ─────────────────────────────────────────────');
    this.line(params.prompt);
    this.line('─── END PROMPT ─────────────────────────────────────────────────────');
    this.line('');
    this.line('─── STREAMING EVENTS ──────────────────────────────────────────────');
    await this.flush();
  }

  /** Log a streaming event */
  event(type: string, data: Record<string, unknown>): void {
    if (!this.active) return;
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2);
    const ts = `[+${elapsed.padStart(8)}s]`;

    switch (type) {
      case 'thinking-delta':
        // Compact: append thinking content inline
        this.line(`${ts}  THINK   ${(data.content as string ?? '').slice(0, 200)}`);
        break;
      case 'message-delta':
        this.line(`${ts}  DELTA   ${(data.content as string ?? '').slice(0, 200)}`);
        break;
      case 'message':
        this.line('');
        this.line(`${ts}  ── COMPLETE MESSAGE ──`);
        this.line((data.content as string) ?? '');
        this.line(`${ts}  ── END MESSAGE (tokens: ${data.outputTokens ?? '?'}) ──`);
        this.line('');
        break;
      case 'tool-use':
        this.line(`${ts}  TOOL    → ${data.tool}(${JSON.stringify(data.args ?? {}).slice(0, 150)})`);
        break;
      case 'tool-result': {
        const result = (data.result as string ?? '').slice(0, 300);
        this.line(`${ts}  RESULT  ← ${data.tool}: ${result}`);
        break;
      }
      case 'file-changed': {
        const fc = { path: data.path as string, linesAdded: data.linesAdded as number ?? 0, linesRemoved: data.linesRemoved as number ?? 0 };
        this.filesChanged.push(fc);
        this.line(`${ts}  FILE    Δ ${fc.path} (+${fc.linesAdded} -${fc.linesRemoved})`);
        break;
      }
      case 'result': {
        this.line('');
        this.line(`${ts}  ── RESULT ──`);
        this.line(`  Exit code       : ${data.exitCode ?? 0}`);
        this.line(`  Premium requests: ${data.premiumRequests ?? '?'}`);
        this.line(`  API duration    : ${data.totalApiDurationMs ?? '?'}ms`);
        if (data.sessionId) this.line(`  OpenCode session : ${data.sessionId}`);
        break;
      }
      case 'error':
        this.line(`${ts}  ERROR   ${data.content ?? 'Unknown error'}`);
        break;
      case 'started':
        this.line(`${ts}  START   attempt=${data.attempt ?? 1}`);
        break;
      case 'autocorrecting':
        this.line(`${ts}  RETRY   Auto-correcting (attempt ${data.attemptNumber})`);
        break;
      default:
        this.line(`${ts}  ${type.toUpperCase().padEnd(7)} ${JSON.stringify(data).slice(0, 200)}`);
    }

    // Periodically flush to disk (every 20 lines)
    if (this.lines.length >= 20) void this.flush();
  }

  /** Finalize — write summary and diff */
  async finish(diffs?: { path: string; linesAdded: number; linesRemoved: number }[]): Promise<void> {
    if (!this.active) return;
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2);

    this.line('');
    this.line('─── END STREAMING EVENTS ──────────────────────────────────────────');
    this.line('');
    this.line('═'.repeat(80));
    this.line('SUMMARY');
    this.line('═'.repeat(80));
    this.line(`Duration   : ${elapsed}s`);
    this.line(`Finished   : ${new Date().toISOString()}`);

    const allFiles = [...this.filesChanged, ...(diffs ?? [])];
    // Deduplicate by path
    const seen = new Set<string>();
    const unique = allFiles.filter(f => {
      if (seen.has(f.path)) return false;
      seen.add(f.path);
      return true;
    });

    if (unique.length > 0) {
      this.line('');
      this.line('─── DIFF SUMMARY ──────────────────────────────────────────────────');
      this.line(`Files changed: ${unique.length}`);
      for (const f of unique) {
        this.line(`  ${f.path}  (+${f.linesAdded} -${f.linesRemoved})`);
      }
    } else {
      this.line('Files changed: 0');
    }

    this.line('');
    this.line(`Log file: ${this.logPath}`);
    await this.flush();
    this.active = false;
  }

  /** Write error and finish */
  async error(message: string): Promise<void> {
    if (!this.active) return;
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2);
    this.line('');
    this.line(`[+${elapsed.padStart(8)}s]  FATAL   ${message}`);
    await this.finish();
  }

  // ── Internal ──────────────────────────────────────────────────

  private line(text: string): void {
    this.lines.push(text);
  }

  private async flush(): Promise<void> {
    if (this.lines.length === 0) return;

    // Write-queue guard: if a write is in progress, mark pending and return.
    // The in-flight write will re-flush when it completes.
    if (this.writing) {
      this.pendingFlush = true;
      return;
    }

    this.writing = true;
    const content = this.lines.join('\n') + '\n';
    this.lines = [];

    try {
      await fs.promises.appendFile(this.logPath, content, 'utf-8');
    } catch (e) {
      log.error('[DevSessionLogger] Failed to write log:', this.logPath, e);
      this.active = false;
    } finally {
      this.writing = false;
    }

    // Drain any lines that accumulated while we were writing
    if (this.pendingFlush) {
      this.pendingFlush = false;
      await this.flush();
    }
  }
}
