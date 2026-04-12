/**
 * types.ts — AI Adapter
 *
 * Responsibility:
 * - Defines the universal contract for all AI provider adapters
 * - Shared option types, output event shape, and adapter identifier union
 *
 * Boundaries:
 * - Owns: interface definitions only — no implementation logic
 * - Consumed by: every adapter, adapter-registry, agent-manager
 */
import { EventEmitter } from 'events';

// ─── Adapter Identifier ──────────────────────────────────────────

/** Supported AI provider names used across IPC, settings, and adapter registry */
export type AiAdapterName = 'copilot' | 'claude' | 'openai' | 'openrouter' | 'opencode';

// ─── Run Options ─────────────────────────────────────────────────

/** Options passed to any adapter's runPrompt() method */
export interface AdapterRunOptions {
  prompt: string;
  cwd: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh';
  resumeSessionId?: string;
  timeoutMs?: number;
  /** OpenRouter API key — only used by OpenRouterAdapter */
  apiKey?: string;
}

// ─── Output Event ────────────────────────────────────────────────

/**
 * Normalized output event emitted by all adapters.
 * Every provider's raw format is normalized into this shape
 * so agent-manager can consume events uniformly.
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
 * Universal AI adapter contract.
 *
 * Every adapter (CLI-based or HTTP-based) implements this interface.
 * The agent-manager works exclusively through this contract,
 * remaining agnostic to whether the backend is a spawned process
 * or an HTTP stream.
 *
 * Emitted events (same across all adapters):
 *   'event'          — every parsed AiOutputEvent
 *   'thinking_delta' — streaming reasoning chunk
 *   'message_delta'  — streaming text chunk
 *   'message'        — complete assistant message
 *   'tool_request'   — tool invocation
 *   'tool_result'    — tool execution result
 *   'file_changed'   — file modification metadata
 *   'turn_start'     — assistant turn started
 *   'turn_end'       — assistant turn ended
 *   'result'         — final summary with usage stats
 *   'raw_line'       — unparsed output for debugging
 *   'stderr'         — error/warning output
 *   'done'           — adapter finished (exit code)
 *   'close'          — underlying resource closed
 *   'error'          — fatal error
 */
export interface AiAdapter extends EventEmitter {
  /** Human-readable adapter name (e.g. 'GitHub Copilot') */
  readonly displayName: string;

  /** Machine identifier matching AiAdapterName */
  readonly name: AiAdapterName;

  /** Start processing a prompt — resolves when the adapter finishes */
  runPrompt(options: AdapterRunOptions): Promise<void>;

  /** Abort the current run (kill process or cancel HTTP request) */
  abort(): void;

  /** Whether the adapter is currently processing a prompt */
  readonly isRunning: boolean;
}
