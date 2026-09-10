/**
 * attention-machine.test.ts — The transition table, as a table
 *
 * The whole point of pulling this out of the component is that "what does the
 * badge say after a Stop, then some output, then Enter" is a question about
 * arithmetic, not about React — so it is answered here rather than by watching
 * a terminal and hoping the moment reproduces.
 *
 * The case that justifies the module on its own is `output after a Stop does
 * not flip back to running when hooks are trusted`: it is what separates a
 * "waiting for you" badge you can rely on from one that clears itself the
 * instant the CLI repaints its own footer.
 *
 * The second one is its mirror, and it is a DEVIATION from the spec worth
 * reading before changing it: while hooks are armed but nothing has arrived
 * (`hookSeen: false`), the heuristics stay in charge. A silently broken
 * endpoint must degrade to F1's behaviour, not freeze the badge.
 */
import { describe, expect, it } from 'vitest';
import { IDLE_MS, attentionNotice, describeAttentionReason, nextAttention, type AttentionInput, type AttentionState } from './attention-machine';
import type { AgentHookEvent } from '@/main/cockpit/hook-endpoint';

// ─── Builders ───────────────────────────────────────────────────────────────

function state(patch: Partial<AttentionState> = {}): AttentionState {
  return { attention: 'running', hooksArmed: false, hookSeen: false, ...patch };
}

function hook(patch: Partial<AgentHookEvent>): AttentionInput {
  return {
    kind: 'hook',
    event: { sessionId: 's', kind: 'other', hookEventName: '', at: 0, ...patch },
  };
}

const stop = hook({ kind: 'stop', hookEventName: 'Stop' });
const prompt = hook({ kind: 'user_prompt', hookEventName: 'UserPromptSubmit' });
const notify = (notificationType: string) =>
  hook({ kind: 'notification', hookEventName: 'Notification', notificationType });

/** Hooks that have proven themselves: armed AND at least one event received. */
const trusted = (patch: Partial<AttentionState> = {}) =>
  state({ hooksArmed: true, hookSeen: true, ...patch });

// ─── The table ──────────────────────────────────────────────────────────────

interface Row {
  name: string;
  from: AttentionState;
  input: AttentionInput;
  attention: AttentionState['attention'];
  reason?: AttentionState['attentionReason'];
}

const TABLE: Row[] = [
  // ── hooks that mean a person is needed ──
  { name: 'Stop → waiting · stopped', from: trusted(), input: stop, attention: 'waiting', reason: 'stopped' },
  { name: 'permission_prompt → waiting · permission', from: trusted(), input: notify('permission_prompt'), attention: 'waiting', reason: 'permission' },
  { name: 'idle_prompt → waiting · idle', from: trusted(), input: notify('idle_prompt'), attention: 'waiting', reason: 'idle' },
  { name: 'agent_needs_input → waiting · input', from: trusted(), input: notify('agent_needs_input'), attention: 'waiting', reason: 'input' },
  { name: 'elicitation_dialog → waiting · input', from: trusted(), input: notify('elicitation_dialog'), attention: 'waiting', reason: 'input' },
  { name: 'elicitation_url_dialog → waiting · input', from: trusted(), input: notify('elicitation_url_dialog'), attention: 'waiting', reason: 'input' },
  { name: 'agent_completed → waiting · stopped', from: trusted(), input: notify('agent_completed'), attention: 'waiting', reason: 'stopped' },

  // ── hooks that mean nothing to the badge ──
  { name: 'auth_success leaves running alone', from: trusted(), input: notify('auth_success'), attention: 'running' },
  { name: 'elicitation_complete does not re-raise a waiting', from: trusted({ attention: 'waiting', attentionReason: 'input' }), input: notify('elicitation_complete'), attention: 'waiting', reason: 'input' },
  { name: 'quota_auto_resume_fired leaves running alone', from: trusted(), input: notify('quota_auto_resume_fired'), attention: 'running' },
  { name: 'a Notification with no type at all is inert', from: trusted(), input: hook({ kind: 'notification', hookEventName: 'Notification' }), attention: 'running' },
  { name: 'SessionStart is inert — starting is already the right word', from: state({ attention: 'starting', hooksArmed: true }), input: hook({ kind: 'session_start', hookEventName: 'SessionStart' }), attention: 'starting' },
  { name: 'SessionEnd is inert — the PTY exit knows the exit code', from: trusted({ attention: 'waiting', attentionReason: 'stopped' }), input: hook({ kind: 'session_end', hookEventName: 'SessionEnd' }), attention: 'waiting', reason: 'stopped' },
  { name: 'an unknown hook event is inert', from: trusted(), input: hook({ kind: 'other', hookEventName: 'PreCompact' }), attention: 'running' },

  // ── back to work ──
  { name: 'UserPromptSubmit clears the reason and runs', from: trusted({ attention: 'waiting', attentionReason: 'permission' }), input: prompt, attention: 'running' },
  { name: 'UserPromptSubmit lifts starting', from: state({ attention: 'starting', hooksArmed: true }), input: prompt, attention: 'running' },
  { name: 'Enter is the person answering', from: trusted({ attention: 'waiting', attentionReason: 'permission' }), input: { kind: 'user_enter' }, attention: 'running' },

  // ── output ──
  { name: 'first output lifts starting', from: state({ attention: 'starting' }), input: { kind: 'output' }, attention: 'running' },
  { name: 'OUTPUT AFTER A STOP DOES NOT RUN when hooks are trusted', from: trusted({ attention: 'waiting', attentionReason: 'stopped' }), input: { kind: 'output' }, attention: 'waiting', reason: 'stopped' },
  { name: 'output DOES lift a waiting when there are no hooks', from: state({ attention: 'waiting', attentionReason: 'silent' }), input: { kind: 'output' }, attention: 'running' },
  { name: 'output lifts a waiting while hooks are armed but silent', from: state({ attention: 'waiting', attentionReason: 'silent', hooksArmed: true }), input: { kind: 'output' }, attention: 'running' },
  { name: 'output cannot touch preparing', from: state({ attention: 'preparing' }), input: { kind: 'output' }, attention: 'preparing' },
  { name: 'output cannot touch bootstrapping', from: state({ attention: 'bootstrapping' }), input: { kind: 'output' }, attention: 'bootstrapping' },

  // ── silence ──
  { name: 'silence past the threshold is waiting · silent', from: state(), input: { kind: 'idle_tick', silentMs: IDLE_MS }, attention: 'waiting', reason: 'silent' },
  { name: 'silence below the threshold is nothing', from: state(), input: { kind: 'idle_tick', silentMs: IDLE_MS - 1 }, attention: 'running' },
  { name: 'silence is ignored entirely once hooks are trusted', from: trusted(), input: { kind: 'idle_tick', silentMs: IDLE_MS * 10 }, attention: 'running' },
  { name: 'silence never touches starting', from: state({ attention: 'starting' }), input: { kind: 'idle_tick', silentMs: IDLE_MS * 10 }, attention: 'starting' },
  { name: 'silence never touches bootstrapping', from: state({ attention: 'bootstrapping' }), input: { kind: 'idle_tick', silentMs: IDLE_MS * 10 }, attention: 'bootstrapping' },

  // ── the end ──
  { name: 'exit ends it from running', from: state(), input: { kind: 'exit' }, attention: 'ended' },
  { name: 'exit ends it from waiting, and clears the reason', from: trusted({ attention: 'waiting', attentionReason: 'permission' }), input: { kind: 'exit' }, attention: 'ended' },
  { name: 'exit ends it from preparing (a worktree that never got a PTY)', from: state({ attention: 'preparing' }), input: { kind: 'exit' }, attention: 'ended' },
  { name: 'a late Stop cannot resurrect an ended session', from: trusted({ attention: 'ended' }), input: stop, attention: 'ended' },
  { name: 'output cannot resurrect an ended session', from: state({ attention: 'ended' }), input: { kind: 'output' }, attention: 'ended' },
];

describe('nextAttention', () => {
  it.each(TABLE)('$name', ({ from, input, attention, reason }) => {
    const after = nextAttention(from, input);
    expect(after.attention).toBe(attention);
    expect(after.attentionReason).toBe(reason);
  });

  it('returns the SAME OBJECT when nothing changed, so the store is not written', () => {
    const quiet = trusted();
    expect(nextAttention(quiet, { kind: 'idle_tick', silentMs: IDLE_MS * 10 })).toBe(quiet);
    expect(nextAttention(quiet, { kind: 'output' })).toBe(quiet);
    expect(nextAttention(quiet, notify('auth_success'))).toBe(quiet);
  });

  it('sets hookSeen on ANY hook event, including the ones it ignores', () => {
    expect(nextAttention(state({ hooksArmed: true }), notify('auth_success')).hookSeen).toBe(true);
    expect(nextAttention(state({ hooksArmed: true }), hook({ kind: 'other' })).hookSeen).toBe(true);
    // Even after the process died: the hint is about the WIRING, not the state.
    expect(nextAttention(state({ attention: 'ended', hooksArmed: true }), stop).hookSeen).toBe(true);
  });

  it('never invents hookSeen without a hook', () => {
    expect(nextAttention(state({ hooksArmed: true }), { kind: 'output' }).hookSeen).toBe(false);
    expect(nextAttention(state({ hooksArmed: true }), { kind: 'exit' }).hookSeen).toBe(false);
  });

  it('flips to trusting hooks only from the FIRST event onward', () => {
    // Armed and silent: the heuristic is still in charge, so output runs.
    const armed = state({ attention: 'waiting', attentionReason: 'silent', hooksArmed: true });
    expect(nextAttention(armed, { kind: 'output' }).attention).toBe('running');
    // One event later, the same output is just a redraw.
    const seen = nextAttention(nextAttention(armed, stop), { kind: 'output' });
    expect(seen.attention).toBe('waiting');
    expect(seen.attentionReason).toBe('stopped');
  });

  it('walks a whole session the way it actually happens', () => {
    let s = state({ attention: 'starting', hooksArmed: true });
    s = nextAttention(s, { kind: 'output' });          // banner
    expect(s.attention).toBe('running');
    s = nextAttention(s, prompt);                       // the launch prompt
    expect(s.attention).toBe('running');
    s = nextAttention(s, notify('permission_prompt'));  // asks to run something
    expect([s.attention, s.attentionReason]).toEqual(['waiting', 'permission']);
    s = nextAttention(s, { kind: 'output' });           // the CLI redraws
    expect(s.attentionReason).toBe('permission');       // …and is ignored
    s = nextAttention(s, { kind: 'user_enter' });       // the person approves
    expect(s.attention).toBe('running');
    s = nextAttention(s, stop);                         // the turn ends
    expect([s.attention, s.attentionReason]).toEqual(['waiting', 'stopped']);
    s = nextAttention(s, { kind: 'exit' });
    expect([s.attention, s.attentionReason]).toEqual(['ended', undefined]);
  });
});

describe('wording', () => {
  it('says the reason next to the state, never the state alone', () => {
    expect(describeAttentionReason('waiting', 'permission')).toBe('waiting · permission');
    expect(describeAttentionReason('waiting', 'silent')).toBe('waiting · silent');
  });

  it('has nothing to add when the session is not waiting', () => {
    expect(describeAttentionReason('running', 'permission')).toBeNull();
    expect(describeAttentionReason('waiting', undefined)).toBeNull();
  });

  it('names WHO needs you, because a desktop has more than one session', () => {
    expect(attentionNotice('JDB-205', 'permission')).toBe('JDB-205 needs you: permission');
    expect(attentionNotice('claude', undefined)).toBe('claude needs you: waiting');
  });
});
