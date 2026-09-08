/**
 * attention-machine.ts — What a session's state IS, given what just happened (F4)
 *
 * Responsibility:
 * - One pure transition function over the five things that can happen to a
 *   live session: a hook event, output, the person pressing Enter, an idle
 *   tick, and the process exiting.
 * - Deciding not just the state but the REASON for it, because "waiting" on
 *   its own tells nobody whether to go and click something or go and read.
 *
 * Boundaries:
 * - Owns: the transition table and the idle threshold.
 * - Does NOT own: where events come from (AgentSessionApp.tsx), what a hook
 *   payload looks like (src/main/cockpit/hook-endpoint.ts), or how any of it
 *   is drawn.
 *
 * Architectural role:
 * - Pure renderer module, no React and no DOM, so "does output after a Stop
 *   flip the badge back to running" is answered by a table test rather than by
 *   sitting in front of a terminal waiting for it to happen.
 *
 * Why a machine rather than four `if`s in the component: the same state is
 * reachable from a hook, from a heuristic, and from a keystroke, and the three
 * disagree. Written inline, the last writer wins — which is how a session that
 * is blocked on a permission prompt goes back to reading "running" the instant
 * the CLI repaints its footer.
 */
import type { AgentHookEvent } from '@/main/cockpit/hook-endpoint';
import type { AgentSessionAttention, AgentSessionAttentionReason } from '@/types/desktop';

/**
 * How long a session may produce nothing before the heuristic calls it waiting.
 *
 * Only ever consulted when hooks are not answering — see `hooksTrusted` below.
 * 20 s is long enough that a slow tool call is not mistaken for a stall and
 * short enough that a person is not left staring at "running" while the CLI
 * sits on a prompt it never told anyone about.
 */
export const IDLE_MS = 20_000;

/**
 * Why the session is waiting, in the word the badge prints.
 *
 *  - 'permission' — it is asking to run something and cannot proceed
 *  - 'input'      — it is asking a question (a dialog, an elicitation)
 *  - 'idle'       — the CLI itself said it is idle
 *  - 'stopped'    — the turn ended; it is done until someone says more
 *  - 'silent'     — nobody said anything: this is the heuristic's guess, and
 *                   it is named differently from the other four precisely so a
 *                   guess never reads like a fact
 */
export type AttentionReason = AgentSessionAttentionReason;

export interface AttentionState {
  attention: AgentSessionAttention;
  attentionReason?: AttentionReason;
  /** Was this session launched with its hooks armed? (main answers at spawn.) */
  hooksArmed: boolean;
  /** Has any hook event actually arrived? Armed is a claim; this is evidence. */
  hookSeen: boolean;
}

export type AttentionInput =
  | { kind: 'hook'; event: AgentHookEvent }
  | { kind: 'output' }
  | { kind: 'user_enter' }
  | { kind: 'idle_tick'; silentMs: number }
  | { kind: 'exit' };

/**
 * The notification types that mean a PERSON is required, and which one.
 *
 * Everything not in this table leaves the state alone: `auth_success`,
 * `elicitation_complete`, `elicitation_response` and the `quota_auto_resume_*`
 * family are all reports of something that already resolved itself, and
 * flipping a badge to "waiting" for them would train people to ignore it.
 */
const WAITING_NOTIFICATIONS: Record<string, AttentionReason> = {
  permission_prompt: 'permission',
  idle_prompt: 'idle',
  agent_needs_input: 'input',
  elicitation_dialog: 'input',
  elicitation_url_dialog: 'input',
  // "The agent finished" is the same thing as a Stop from where a person
  // stands: nothing more will happen until they look.
  agent_completed: 'stopped',
};

/** The states the session is still setting itself up in — before any agent. */
const PRE_RUN: ReadonlySet<AgentSessionAttention> = new Set(['preparing', 'bootstrapping']);

function withState(
  state: AttentionState,
  attention: AgentSessionAttention,
  attentionReason?: AttentionReason,
): AttentionState {
  if (state.attention === attention && state.attentionReason === attentionReason) return state;
  return { ...state, attention, attentionReason };
}

/**
 * The next state, or the SAME OBJECT when nothing changed.
 *
 * Reference stability is not an optimisation here, it is what stops the 5 s
 * idle tick from writing to the store forever: the caller compares by identity
 * and only persists a real transition.
 */
export function nextAttention(state: AttentionState, input: AttentionInput): AttentionState {
  // The process is gone. Nothing that arrives afterwards is about a live
  // session, and a late `Stop` must not resurrect an ended window.
  if (input.kind === 'exit') {
    return state.attention === 'ended' && state.attentionReason === undefined
      ? state
      : { ...state, attention: 'ended', attentionReason: undefined };
  }
  if (state.attention === 'ended') {
    // One exception: a hook still counts as EVIDENCE the wiring works, which
    // is what the "no event yet" hint reads.
    return input.kind === 'hook' && !state.hookSeen ? { ...state, hookSeen: true } : state;
  }

  if (input.kind === 'hook') {
    const seen: AttentionState = state.hookSeen ? state : { ...state, hookSeen: true };
    const { event } = input;
    switch (event.kind) {
      case 'stop':
        return withState(seen, 'waiting', 'stopped');
      case 'notification': {
        const reason = event.notificationType
          ? WAITING_NOTIFICATIONS[event.notificationType]
          : undefined;
        return reason ? withState(seen, 'waiting', reason) : seen;
      }
      case 'user_prompt':
        // Someone submitted a prompt: the agent has work, whatever it was
        // doing a moment ago. This is also how a session launched with a
        // prompt in argv leaves 'starting'.
        return withState(seen, 'running', undefined);
      case 'session_start':
      case 'session_end':
      case 'other':
      default:
        // `session_end` is deliberately inert: the PTY exit is a beat behind
        // it and is the event that actually knows the exit code.
        return seen;
    }
  }

  // The worktree and its install own these two states end to end; nothing the
  // terminal shows during them is the agent, so neither heuristic applies.
  if (PRE_RUN.has(state.attention)) return state;

  if (input.kind === 'user_enter') {
    // The person answered the thing that was blocking. Whatever the reason
    // was, it is not blocking any more.
    return withState(state, 'running', undefined);
  }

  // Armed is a claim the main process makes at spawn; `hookSeen` is the
  // evidence. Until one event has actually arrived, the heuristics stay in
  // charge — otherwise a broken endpoint would freeze the badge silently,
  // which is the exact failure this phase exists to make visible.
  const hooksTrusted = state.hooksArmed && state.hookSeen;

  if (input.kind === 'output') {
    // First output out of 'starting' is the one thing output always proves:
    // the process came up. After that it proves nothing while hooks answer —
    // output arriving on a stopped session is the CLI redrawing its own
    // footer, not the agent working.
    if (state.attention === 'starting') return withState(state, 'running', undefined);
    if (state.attention === 'waiting' && !hooksTrusted) return withState(state, 'running', undefined);
    return state;
  }

  // input.kind === 'idle_tick'
  if (hooksTrusted) return state;
  if (state.attention !== 'running') return state;
  return input.silentMs >= IDLE_MS ? withState(state, 'waiting', 'silent') : state;
}

/**
 * `waiting · permission` — the badge text, and the words the e2e asserts on.
 *
 * Kept beside the machine rather than in `agent-sessions.ts` so the vocabulary
 * and the transitions cannot drift into two lists.
 */
export function describeAttentionReason(
  attention: AgentSessionAttention,
  reason: AttentionReason | undefined,
): string | null {
  if (attention !== 'waiting' || !reason) return null;
  return `waiting · ${reason}`;
}

/**
 * The sentence a notification carries: who needs you, and for what.
 *
 * `who` is the card id when there is one and the vendor otherwise, because
 * "claude needs you" is useless on a desktop with four claude sessions on it.
 */
export function attentionNotice(who: string, reason: AttentionReason | undefined): string {
  return `${who} needs you: ${reason ?? 'waiting'}`;
}
