/**
 * agent-sessions.ts — Opening and driving agent-session windows (Cockpit F1)
 *
 * Responsibility:
 * - `openAgentSession` — the one way a session window comes into existence.
 * - The pure rules the session component needs but should not decide inline:
 *   how a `'type'` vendor's prompt gets delivered, and how a status reads.
 *
 * Boundaries:
 * - Owns: window creation for `'agent-session'`, prompt-delivery policy.
 * - Does NOT own: the terminal itself (AgentSessionApp.tsx), the PTY
 *   (src/main/pty/*), or anything about backlog cards (that is F3).
 *
 * Architectural role:
 * - Renderer-side module with no React and no DOM, so its decisions are unit
 *   testable without mounting a terminal.
 */
import { useDesktopStore } from '../store/desktop-store';
import type { AgentSessionAttention, AgentSessionMeta, AgentVendorId } from '@/types/desktop';

/**
 * How long to wait AFTER the first output chunk before typing the prompt into
 * a `promptDelivery: 'type'` vendor.
 *
 * `opencode` in TUI mode has no initial-prompt flag (`opencode [project]` takes
 * a DIRECTORY), so the only way to hand it a first instruction is to type it
 * the way a person would. First output means "something rendered"; it does not
 * mean the input box is focused and accepting keys, and typing into a TUI that
 * is still laying itself out drops characters. This delay is empirical, not
 * derived — if a vendor grows a real flag, delete the whole path rather than
 * tuning the number.
 */
export const PROMPT_TYPE_DELAY_MS = 1500;

export type PromptDelivery = 'arg' | 'type';

export interface PromptTypingPlan {
  /** Exactly what to write into the PTY — the prompt plus the Enter that submits it. */
  payload: string;
  /** Milliseconds to wait after the first output chunk. */
  delayMs: number;
}

/**
 * Decides whether the session has to TYPE its prompt, and what to type.
 *
 * Returns `null` in the three cases where it must not: there is no prompt, the
 * prompt is blank, or the vendor already received it through argv. Pure, so
 * the "did we send it twice / did we send an empty line" question is answered
 * by a unit test rather than by watching a terminal.
 */
export function planPromptTyping(
  promptDelivery: PromptDelivery,
  prompt: string | undefined,
): PromptTypingPlan | null {
  if (promptDelivery !== 'type') return null;
  if (!prompt || !prompt.trim()) return null;
  // `\r`, not `\n`: a PTY in canonical mode reads Enter as carriage return, and
  // a TUI that reads raw keys expects the same byte the keyboard would send.
  return { payload: `${prompt}\r`, delayMs: PROMPT_TYPE_DELAY_MS };
}

/**
 * The status line the header badge shows. Words, never colour alone — a badge
 * that only changes hue says nothing in greyscale, in a screenshot, or to a
 * colour blind reader (and it is what the e2e suite asserts on).
 */
export function describeAttention(attention: AgentSessionAttention, exitCode?: number | null): string {
  if (attention === 'ended') {
    return typeof exitCode === 'number' ? `ended · exit ${exitCode}` : 'ended';
  }
  return attention;
}

/** Last path segment, trailing separators ignored. `''` for an empty path. */
export function basenameOf(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts[parts.length - 1] ?? '';
}

export interface OpenAgentSessionOptions {
  vendor: AgentVendorId;
  cwd: string;
  prompt?: string;
  mode?: AgentSessionMeta['mode'];
  title?: string;
}

/**
 * Creates an 'agent-session' window. The PTY is NOT spawned here: the terminal
 * has to be mounted and measured first, because a PTY spawned at the wrong
 * geometry renders a TUI it can never re-lay-out correctly. AgentSessionApp
 * spawns once it knows its own cols/rows, guarded by `ptyStarted`.
 */
export function openAgentSession(opts: OpenAgentSessionOptions): string {
  const agentSession: AgentSessionMeta = {
    sessionId: crypto.randomUUID(),
    vendor: opts.vendor,
    cwd: opts.cwd,
    mode: opts.mode ?? 'attached',
    prompt: opts.prompt,
    launchedAt: Date.now(),
    ptyStarted: false,
    attention: 'starting',
  };

  return useDesktopStore.getState().addWindow('agent-session', {
    // A desktop of windows all called "Agent session" is a desktop you cannot
    // navigate; the directory is the thing that tells two sessions apart.
    title: opts.title ?? `${opts.vendor} · ${basenameOf(opts.cwd) || opts.cwd}`,
    iconName: 'Terminal',
    agentSession,
  });
}
