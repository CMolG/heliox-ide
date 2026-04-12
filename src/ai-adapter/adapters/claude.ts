/**
 * claude.ts — AI Adapter / Adapters
 *
 * Responsibility:
 * - Anthropic Claude CLI adapter (spawns `claude` binary)
 * - Normalizes Claude's stream-json events into canonical AiOutputEvent format
 *
 * Boundaries:
 * - Owns: CLI command construction, Claude-specific event normalization
 * - Does NOT own: JSONL parsing, event routing (inherited from CliAdapter)
 */
import { CliAdapter } from '../cli-adapter';
import type { AiAdapterName, AdapterRunOptions, AiOutputEvent } from '../types';

export class ClaudeAdapter extends CliAdapter {
  readonly displayName = 'Anthropic Claude';
  readonly name: AiAdapterName = 'claude';

  protected buildCommand(options: AdapterRunOptions): { cmd: string; args: string[] } {
    const args = [
      '-p', options.prompt,
      '--output-format', 'stream-json',
    ];

    if (options.model) args.push('--model', options.model);

    return { cmd: 'claude', args };
  }

  /**
   * Normalizes Claude CLI stream-json events to AiOutputEvent format.
   *
   * Claude emits: content_block_delta, assistant, result,
   * content_block_start, message_start, message_stop
   */
  protected normalizeEvent(raw: Record<string, unknown>): AiOutputEvent | null {
    const type = raw.type as string;

    switch (type) {
      case 'assistant': {
        const message = raw.message as Record<string, unknown> | undefined;
        const contentBlocks = (message?.content as Array<{ type: string; text?: string }>) ?? [];
        const text = contentBlocks
          .filter(c => c.type === 'text')
          .map(c => c.text ?? '')
          .join('');
        const msgId = (message?.id as string) ?? `claude-msg-${Date.now()}`;
        return {
          type: 'assistant.message',
          data: { content: text, messageId: msgId, outputTokens: 0, toolRequests: [] },
        };
      }

      case 'content_block_delta': {
        const delta = raw.delta as Record<string, unknown> | undefined;
        if (delta?.type === 'text_delta') {
          return {
            type: 'assistant.message_delta',
            data: { deltaContent: delta.text as string, messageId: 'claude-stream' },
          };
        }
        if (delta?.type === 'thinking_delta') {
          return {
            type: 'assistant.thinking_delta',
            data: { deltaContent: delta.thinking as string, messageId: 'claude-thinking' },
          };
        }
        return null;
      }

      case 'content_block_start': {
        const block = raw.content_block as Record<string, unknown> | undefined;
        if (block?.type === 'tool_use') {
          return {
            type: 'assistant.message',
            data: {
              content: '',
              messageId: (block.id as string) ?? `claude-tool-${Date.now()}`,
              outputTokens: 0,
              toolRequests: [{ tool: block.name as string, input: block.input ?? {} }],
            },
          };
        }
        return null;
      }

      case 'result': {
        const subtype = raw.subtype as string;
        return {
          type: 'result',
          exitCode: subtype === 'success' ? 0 : 1,
          sessionId: raw.session_id as string,
          usage: {
            totalApiDurationMs: raw.duration_api_ms,
            cost_usd: raw.cost_usd,
            num_turns: raw.num_turns,
          },
        };
      }

      case 'message_start':
        return { type: 'assistant.turn_start', data: {} };

      case 'message_stop':
        return { type: 'assistant.turn_end', data: {} };

      default:
        return null;
    }
  }
}
