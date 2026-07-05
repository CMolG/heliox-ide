/**
 * opencode.ts — AI Adapter / Adapters
 *
 * Responsibility:
 * - Spawn the `opencode run` CLI with the chosen provider/model.
 * - Translate opencode's JSON event stream (`--format json`) into the
 *   canonical AiOutputEvent shape consumed by agent-manager.
 *
 * Boundaries:
 * - Owns: CLI command shape, opencode-specific event normalization.
 * - Does NOT own: process lifecycle or routing (inherited from CliAdapter).
 */
import { CliAdapter } from '../cli-adapter';
import type { AiAdapterName, AdapterRunOptions, AiOutputEvent } from '../types';

/** Map our four-level effort to opencode's `--variant` reasoning level. */
const EFFORT_TO_VARIANT: Record<NonNullable<AdapterRunOptions['effort']>, string> = {
  low: 'minimal',
  medium: 'medium',
  high: 'high',
  xhigh: 'max',
};

export class OpenCodeAdapter extends CliAdapter {
  readonly displayName = 'OpenCode';
  readonly name: AiAdapterName = 'opencode';

  protected buildCommand(options: AdapterRunOptions): { cmd: string; args: string[] } {
    // opencode run takes the message as positional args. We pipe a single
    // argv string so multiline prompts survive shell quoting.
    const args: string[] = [
      'run',
      options.prompt,
      '--format', 'json',
      '--dangerously-skip-permissions',
    ];

    if (options.model) args.push('--model', options.model);
    if (options.agent) args.push('--agent', options.agent);
    if (options.effort) args.push('--variant', EFFORT_TO_VARIANT[options.effort]);
    if (options.resumeSessionId) args.push('--session', options.resumeSessionId);

    return { cmd: 'opencode', args };
  }

  /**
   * Translate opencode's JSON envelope (`{type, sessionID, part, ...}`) into
   * the canonical AiOutputEvent shape. Returning null skips the event.
   */
  protected normalizeEvent(raw: Record<string, unknown>): AiOutputEvent | null {
    const type = raw.type as string | undefined;
    if (!type) return null;
    const sessionID = raw.sessionID as string | undefined;
    const part = (raw.part ?? {}) as Record<string, unknown>;
    const messageID = (part.messageID as string) ?? (raw.messageID as string) ?? `oc-${sessionID ?? 'session'}`;

    switch (type) {
      case 'step_start':
        return { type: 'assistant.turn_start', sessionId: sessionID, data: { messageId: messageID } };

      case 'step_finish': {
        const tokens = (part.tokens ?? {}) as Record<string, unknown>;
        return {
          type: 'assistant.turn_end',
          sessionId: sessionID,
          data: {
            messageId: messageID,
            outputTokens: tokens.output as number ?? 0,
            reason: part.reason as string,
          },
        };
      }

      case 'text': {
        const text = (part.text as string) ?? '';
        return {
          type: 'assistant.message',
          sessionId: sessionID,
          data: { content: text, messageId: messageID, outputTokens: 0 },
        };
      }

      case 'reasoning': {
        const text = (part.text as string) ?? '';
        return {
          type: 'assistant.thinking_delta',
          sessionId: sessionID,
          data: { deltaContent: text, messageId: messageID },
        };
      }

      case 'tool': {
        const tool = (part.tool as string) ?? (part.name as string) ?? 'tool';
        const state = (part.state ?? {}) as Record<string, unknown>;
        const input = (state.input ?? part.input ?? {}) as Record<string, unknown>;
        const output = state.output as string | undefined;
        if (output !== undefined) {
          return {
            type: 'tool.result',
            sessionId: sessionID,
            data: { tool, result: output, filePath: input.filePath ?? input.path },
          };
        }
        return {
          type: 'assistant.message',
          sessionId: sessionID,
          data: {
            content: '',
            messageId: messageID,
            outputTokens: 0,
            toolRequests: [{ tool, input }],
          },
        };
      }

      case 'finish':
      case 'done': {
        const tokens = (part.tokens ?? raw.tokens ?? {}) as Record<string, unknown>;
        return {
          type: 'result',
          sessionId: sessionID,
          exitCode: 0,
          usage: {
            outputTokens: tokens.output as number ?? 0,
            inputTokens: tokens.input as number ?? 0,
            totalApiDurationMs: raw.durationMs as number,
          },
        };
      }

      case 'error': {
        const error = (raw.error ?? {}) as Record<string, unknown>;
        const data = (error.data ?? {}) as Record<string, unknown>;
        const message = (data.message as string) ?? (error.name as string) ?? 'opencode error';
        this.emit('stderr', message);
        return {
          type: 'result',
          sessionId: sessionID,
          exitCode: 1,
          data: { error: message },
        };
      }

      default:
        // Unknown opencode events are passed through as raw passthrough so the
        // renderer terminal still shows them — agent-manager will ignore them.
        return null;
    }
  }
}
