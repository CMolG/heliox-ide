/**
 * opencode.ts — AI Adapter / Adapters
 *
 * Responsibility:
 * - OpenCode CLI adapter (spawns `opencode` binary from opencode.ai)
 * - Normalizes OpenCode's JSONL output into canonical AiOutputEvent format
 *
 * Boundaries:
 * - Owns: CLI command construction, OpenCode-specific event normalization
 * - Does NOT own: JSONL parsing, event routing (inherited from CliAdapter)
 */
import { CliAdapter } from '../cli-adapter';
import type { AiAdapterName, AdapterRunOptions, AiOutputEvent } from '../types';

export class OpenCodeAdapter extends CliAdapter {
  readonly displayName = 'OpenCode';
  readonly name: AiAdapterName = 'opencode';

  protected buildCommand(options: AdapterRunOptions): { cmd: string; args: string[] } {
    const args = [
      '-p', options.prompt,
      '--output-format', 'json',
    ];

    if (options.model) args.push('--model', options.model);

    return { cmd: 'opencode', args };
  }

  /**
   * Normalizes OpenCode JSONL events to AiOutputEvent format.
   *
   * OpenCode emits events with a `kind` field rather than `type`.
   * Falls through to canonical format if already compatible.
   */
  protected normalizeEvent(raw: Record<string, unknown>): AiOutputEvent | null {
    // OpenCode uses `kind` instead of `type` in some output modes
    if (raw.kind && !raw.type) {
      const kind = raw.kind as string;
      const kindMap: Record<string, string> = {
        'text_delta': 'assistant.message_delta',
        'thinking_delta': 'assistant.thinking_delta',
        'message': 'assistant.message',
        'tool_call': 'assistant.message',
        'tool_result': 'tool.result',
        'turn_start': 'assistant.turn_start',
        'turn_end': 'assistant.turn_end',
        'done': 'result',
      };

      const mappedType = kindMap[kind];
      if (!mappedType) return null;

      // Reshape data fields for delta events
      if (kind === 'text_delta') {
        return {
          type: mappedType,
          data: {
            deltaContent: raw.text as string,
            messageId: (raw.id as string) ?? 'opencode-stream',
          },
        };
      }

      if (kind === 'thinking_delta') {
        return {
          type: mappedType,
          data: {
            deltaContent: raw.text as string,
            messageId: (raw.id as string) ?? 'opencode-thinking',
          },
        };
      }

      if (kind === 'tool_call') {
        return {
          type: mappedType,
          data: {
            content: '',
            messageId: (raw.id as string) ?? `opencode-tool-${Date.now()}`,
            outputTokens: 0,
            toolRequests: [{ tool: raw.name as string, input: raw.input ?? {} }],
          },
        };
      }

      if (kind === 'done') {
        return {
          type: 'result',
          exitCode: raw.success === false ? 1 : 0,
          sessionId: raw.session_id as string,
          usage: raw.usage as Record<string, unknown>,
        };
      }

      return { type: mappedType, data: raw.data as Record<string, unknown> ?? {} };
    }

    // Already canonical format — pass through
    return raw as unknown as AiOutputEvent;
  }
}
