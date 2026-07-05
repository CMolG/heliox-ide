/**
 * cli-adapter.ts — AI Adapter
 *
 * Responsibility:
 * - Abstract base class for CLI-based AI adapters
 * - Handles process spawning, JSONL stream parsing, timeout management
 * - Provides shared event routing from normalized AiOutputEvent
 *
 * Boundaries:
 * - Owns: process lifecycle, JSONL parsing, event routing, timeout logic
 * - Does NOT own: CLI command construction (delegated to subclasses via buildCommand)
 * - Does NOT own: provider-specific event normalization (delegated to normalizeEvent)
 */
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { AiAdapter, AiAdapterName, AdapterRunOptions, AiOutputEvent } from './types';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Abstract base for all CLI-based AI adapters.
 *
 * Subclasses implement two hooks:
 *   1. buildCommand(options) — returns { cmd, args } for process spawning
 *   2. normalizeEvent(raw)   — converts provider-specific JSONL into AiOutputEvent
 *
 * The base class handles everything else: spawning, streaming, parsing,
 * timeout, abort, and routing normalized events to semantic emitters.
 */
export abstract class CliAdapter extends EventEmitter implements AiAdapter {
  abstract readonly displayName: string;
  abstract readonly name: AiAdapterName;

  private process: ChildProcess | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private messageBuffer: Map<string, string> = new Map();

  /**
   * Build the CLI command and arguments for this adapter.
   * Each subclass returns its own binary name and flag layout.
   */
  protected abstract buildCommand(options: AdapterRunOptions): { cmd: string; args: string[] };

  /**
   * Normalize a raw JSON object from the CLI's JSONL stream into an AiOutputEvent.
   * Return null to skip the event entirely.
   * Default implementation passes the event through unchanged.
   */
  protected normalizeEvent(raw: Record<string, unknown>): AiOutputEvent | null {
    return raw as unknown as AiOutputEvent;
  }

  async runPrompt(options: AdapterRunOptions): Promise<void> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      this.messageBuffer.clear();

      const { cmd, args } = this.buildCommand(options);

      this.process = spawn(cmd, args, {
        cwd: options.cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.timeoutHandle = setTimeout(() => {
        if (this.isRunning) {
          this.emit('stderr', `Process timed out after ${timeoutMs}ms — killing`);
          this.abort();
        }
      }, timeoutMs);

      let buffer = '';
      let parseErrors = 0;

      this.process.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          this.emit('raw_line', line);
          try {
            const raw = JSON.parse(line);
            const event = this.normalizeEvent(raw);
            if (!event) continue;
            this.emit('event', event);
            this.routeEvent(event);
          } catch {
            parseErrors++;
            if (parseErrors <= 5) {
              this.emit('stderr', `Non-JSON output (line ${parseErrors}): ${line.slice(0, 200)}`);
            }
          }
        }
      });

      this.process.stderr?.on('data', (chunk: Buffer) => {
        this.emit('stderr', chunk.toString());
      });

      this.process.on('close', (code) => {
        this.clearTimeout();
        this.emit('close', code);
        this.emit('done', code ?? 0);
        if (parseErrors > 5) {
          this.emit('stderr', `Total non-JSON lines skipped: ${parseErrors}`);
        }
        resolve();
      });

      this.process.on('error', (err) => {
        this.clearTimeout();
        this.emit('error', err);
        reject(err);
      });
    });
  }

  abort(): void {
    this.clearTimeout();
    this.process?.kill('SIGTERM');
    this.process = null;
  }

  get isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  // ─── Event Routing ───────────────────────────────────────────

  /**
   * Routes a normalized AiOutputEvent to semantic event names.
   * Shared across all CLI adapters — subclasses normalize first,
   * then this method dispatches uniformly.
   */
  private routeEvent(event: AiOutputEvent): void {
    const data = event.data ?? {};

    switch (event.type) {
      case 'assistant.thinking_delta':
      case 'assistant.reasoning_delta': {
        const messageId = (data.messageId ?? data.reasoningId) as string;
        const delta = data.deltaContent as string;
        if (messageId && delta) {
          this.emit('thinking_delta', { content: delta, messageId });
        }
        break;
      }

      case 'assistant.message_delta': {
        const messageId = data.messageId as string;
        const delta = data.deltaContent as string;
        if (messageId && delta) {
          const current = this.messageBuffer.get(messageId) ?? '';
          this.messageBuffer.set(messageId, current + delta);
          this.emit('message_delta', { content: delta, messageId });
        }
        break;
      }

      case 'assistant.message': {
        const messageId = data.messageId as string;
        const content = (data.content as string) ?? this.messageBuffer.get(messageId) ?? '';
        const outputTokens = (data.outputTokens as number) ?? 0;
        const toolRequests = (data.toolRequests as Array<Record<string, unknown>>) ?? [];
        this.messageBuffer.delete(messageId);
        this.emit('message', { content: content.trim(), messageId, outputTokens });

        for (const req of toolRequests) {
          if (req.tool) {
            this.emit('tool_request', { tool: req.tool, args: req.input ?? req.args ?? {} });
          }
        }
        break;
      }

      case 'assistant.turn_start':
        this.emit('turn_start', data);
        break;

      case 'assistant.turn_end':
        this.emit('turn_end', data);
        break;

      case 'tool.result': {
        const tool = data.tool as string;
        const result = data.result as string;
        this.emit('tool_result', { tool, result });

        if (tool === 'edit_file' || tool === 'create_file' || tool === 'write_file') {
          const filePath = (data.filePath as string) ?? (data.path as string);
          if (filePath) {
            this.emit('file_changed', {
              path: filePath,
              linesAdded: (data.linesAdded as number) ?? 0,
              linesRemoved: (data.linesRemoved as number) ?? 0,
            });
          }
        }
        break;
      }

      case 'result': {
        const usage = event.usage ?? data.usage;
        const exitCode = event.exitCode ?? (data.exitCode as number) ?? 0;
        const sessionId = event.sessionId ?? (data.sessionId as string);
        const usageRecord = usage as Record<string, unknown> | undefined;
        const premiumRequests = usageRecord?.premiumRequests as number | undefined;
        const totalApiDurationMs = usageRecord?.totalApiDurationMs as number | undefined;
        const codeChanges = usageRecord?.codeChanges as Record<string, unknown> | undefined;
        if (codeChanges) {
          const files = (codeChanges.filesModified as string[]) ?? [];
          for (const fp of files) {
            this.emit('file_changed', { path: fp, linesAdded: 0, linesRemoved: 0 });
          }
        }
        this.emit('result', { exitCode, usage, sessionId, premiumRequests, totalApiDurationMs });
        break;
      }

      default:
        break;
    }
  }

  private clearTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }
}
