/**
 * openrouter.ts — AI Adapter / Adapters
 *
 * Responsibility:
 * - OpenRouter HTTP API adapter (no CLI binary — uses REST + SSE streaming)
 * - Connects to the OpenRouter API and normalizes SSE events into AiOutputEvent
 *
 * Boundaries:
 * - Owns: HTTP request lifecycle, SSE stream parsing, OpenRouter-specific normalization
 * - Does NOT own: event routing semantics (follows same event contract as CliAdapter)
 *
 * Design note:
 * Unlike the CLI-based adapters, OpenRouter communicates via HTTPS.
 * We use Node.js built-in `https` module to make streaming requests,
 * parsing server-sent events (SSE) from the response body.
 */
import { EventEmitter } from 'events';
import https from 'https';
import type { IncomingMessage } from 'http';
import type { AiAdapter, AiAdapterName, AdapterRunOptions, AiOutputEvent } from '../types';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class OpenRouterAdapter extends EventEmitter implements AiAdapter {
  readonly displayName = 'OpenRouter';
  readonly name: AiAdapterName = 'openrouter';

  private activeRequest: ReturnType<typeof https.request> | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private _isRunning = false;
  private messageBuffer = '';
  private messageId = '';

  async runPrompt(options: AdapterRunOptions): Promise<void> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const apiKey = options.apiKey;

    if (!apiKey) {
      throw new Error('OpenRouter adapter requires an API key (options.apiKey)');
    }

    this._isRunning = true;
    this.messageBuffer = '';
    this.messageId = `or-msg-${Date.now()}`;

    return new Promise((resolve, reject) => {
      const url = new URL(OPENROUTER_API_URL);
      const body = JSON.stringify({
        model: options.model ?? 'anthropic/claude-sonnet-4',
        messages: [{ role: 'user', content: options.prompt }],
        stream: true,
      });

      const reqOptions = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://heliox.dev',
          'X-Title': 'Heliox IDE',
        },
      };

      this.timeoutHandle = setTimeout(() => {
        if (this._isRunning) {
          this.emit('stderr', `Request timed out after ${timeoutMs}ms — aborting`);
          this.abort();
        }
      }, timeoutMs);

      this.emit('turn_start', {});

      const req = https.request(reqOptions, (res: IncomingMessage) => {
        if (res.statusCode !== 200) {
          let errorBody = '';
          res.on('data', (chunk: Buffer) => { errorBody += chunk.toString(); });
          res.on('end', () => {
            this.finish();
            const err = new Error(`OpenRouter API error ${res.statusCode}: ${errorBody.slice(0, 500)}`);
            this.emit('error', err);
            reject(err);
          });
          return;
        }

        let sseBuffer = '';

        res.on('data', (chunk: Buffer) => {
          sseBuffer += chunk.toString();
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() ?? '';

          for (const line of lines) {
            const rawLine = line.trim();
            if (!rawLine || !rawLine.startsWith('data: ')) continue;

            const payload = rawLine.slice(6);
            if (payload === '[DONE]') {
              this.emitFinalMessage();
              this.emit('turn_end', {});
              this.emit('result', { exitCode: 0, usage: {}, sessionId: this.messageId });
              continue;
            }

            this.emit('raw_line', rawLine);

            try {
              const parsed = JSON.parse(payload);
              const event = this.normalizeSseEvent(parsed);
              if (event) {
                this.emit('event', event);
                this.routeSseEvent(event);
              }
            } catch {
              this.emit('stderr', `Non-JSON SSE payload: ${payload.slice(0, 200)}`);
            }
          }
        });

        res.on('end', () => {
          this.finish();
          this.emit('close', 0);
          this.emit('done', 0);
          resolve();
        });

        res.on('error', (err) => {
          this.finish();
          this.emit('error', err);
          reject(err);
        });
      });

      req.on('error', (err) => {
        this.finish();
        this.emit('error', err);
        reject(err);
      });

      req.write(body);
      req.end();
      this.activeRequest = req;
    });
  }

  abort(): void {
    this.activeRequest?.destroy();
    this.activeRequest = null;
    this.finish();
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  // ─── SSE Normalization ─────────────────────────────────────────

  /**
   * Converts an OpenRouter SSE chunk (OpenAI-compatible streaming format)
   * into a canonical AiOutputEvent.
   */
  private normalizeSseEvent(parsed: Record<string, unknown>): AiOutputEvent | null {
    const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
    if (!choices || choices.length === 0) return null;

    const choice = choices[0];
    const delta = choice.delta as Record<string, unknown> | undefined;
    if (!delta) return null;

    const content = delta.content as string | undefined;
    if (content) {
      return {
        type: 'assistant.message_delta',
        data: { deltaContent: content, messageId: this.messageId },
      };
    }

    // Tool call deltas
    const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls && toolCalls.length > 0) {
      const tc = toolCalls[0];
      const fn = tc.function as Record<string, unknown> | undefined;
      if (fn?.name) {
        return {
          type: 'assistant.message',
          data: {
            content: '',
            messageId: (tc.id as string) ?? `or-tool-${Date.now()}`,
            outputTokens: 0,
            toolRequests: [{ tool: fn.name as string, input: fn.arguments ?? {} }],
          },
        };
      }
    }

    return null;
  }

  /**
   * Routes normalized SSE events to semantic event names,
   * mirroring the CliAdapter's routing contract.
   */
  private routeSseEvent(event: AiOutputEvent): void {
    const data = event.data ?? {};

    if (event.type === 'assistant.message_delta') {
      const delta = data.deltaContent as string;
      if (delta) {
        this.messageBuffer += delta;
        this.emit('message_delta', { content: delta, messageId: this.messageId });
      }
    } else if (event.type === 'assistant.message') {
      this.emit('message', {
        content: (data.content as string) ?? '',
        messageId: data.messageId as string,
        outputTokens: (data.outputTokens as number) ?? 0,
      });
      const toolRequests = (data.toolRequests as Array<Record<string, unknown>>) ?? [];
      for (const req of toolRequests) {
        if (req.tool) {
          this.emit('tool_request', { tool: req.tool, args: req.input ?? req.args ?? {} });
        }
      }
    }
  }

  private emitFinalMessage(): void {
    if (this.messageBuffer) {
      this.emit('message', {
        content: this.messageBuffer.trim(),
        messageId: this.messageId,
        outputTokens: 0,
      });
      this.messageBuffer = '';
    }
  }

  private finish(): void {
    this._isRunning = false;
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }
}
