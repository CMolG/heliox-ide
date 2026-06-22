/**
 * types.ts — AI Adapter
 *
 * Responsibility:
 * - Defines the contract for the OpenCode adapter and shared event shape.
 * - OpenCode is the single execution surface: it handles every provider
 *   (Anthropic, OpenAI, OpenRouter, Xiaomi MiMo, OpenCode Zen, etc.) via
 *   its own credential store.
 *
 * Boundaries:
 * - Owns: adapter interface, run options, normalized output event shape.
 * - Does NOT own: provider catalog (lives in main/opencode-providers).
 */
import { EventEmitter } from 'events';

// ─── Adapter Identifier ──────────────────────────────────────────

/** The only supported adapter — OpenCode multiplexes every provider. */
export type AiAdapterName = 'opencode';

// ─── Run Options ─────────────────────────────────────────────────

/** Options passed to the adapter's runPrompt() method. */
export interface AdapterRunOptions {
  prompt: string;
  cwd: string;
  /** Full `provider/model` string (e.g. `opencode/claude-sonnet-4-6`, `xiaomi-token-plan-ams/mimo-v2-pro`). */
  model?: string;
  /** Provider-specific reasoning effort — maps to opencode's `--variant`. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh';
  /** Resume a previous opencode session by id. */
  resumeSessionId?: string;
  timeoutMs?: number;
  /** Optional agent name to run with (opencode --agent). */
  agent?: string;
}

// ─── Output Event ────────────────────────────────────────────────

/**
 * Normalized output event emitted by the adapter.
 *
 * Provider-specific event shapes are mapped into this canonical form so the
 * renderer chat surface stays decoupled from CLI internals.
 */
export interface AiOutputEvent {
  type: string;
  data?: Record<string, unknown>;
  id?: string;
  timestamp?: string;
  parentId?: string;
  ephemeral?: boolean;
  sessionId?: string;
  exitCode?: number;
  usage?: Record<string, unknown>;
}

// ─── Adapter Interface ───────────────────────────────────────────

/**
 * The adapter contract. Agent-manager consumes this exclusively, remaining
 * agnostic to the underlying CLI invocation details.
 *
 * Emitted events:
 *   'event'          — every parsed AiOutputEvent
 *   'thinking_delta' — streaming reasoning chunk
 *   'message_delta'  — streaming text chunk
 *   'message'        — complete assistant message
 *   'tool_request'   — tool invocation
 *   'tool_result'    — tool execution result
 *   'file_changed'   — file modification metadata
 *   'turn_start' / 'turn_end' — assistant turn boundaries
 *   'result'         — final summary with usage + sessionId
 *   'raw_line'       — unparsed output for debugging
 *   'stderr'         — error/warning output
 *   'done' / 'close' — adapter finished (exit code)
 *   'error'          — fatal error
 */
export interface AiAdapter extends EventEmitter {
  readonly displayName: string;
  readonly name: AiAdapterName;
  runPrompt(options: AdapterRunOptions): Promise<void>;
  abort(): void;
  readonly isRunning: boolean;
}
