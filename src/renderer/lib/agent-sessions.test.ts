/**
 * agent-sessions.test.ts — Unit tests for the session-opening rules
 *
 * What is pinned here:
 *   1. `openAgentSession` creates an 'agent-session' window whose metadata is
 *      complete and in the pre-spawn state (`ptyStarted:false`, 'starting').
 *   2. The prompt-typing decision: only `'type'` vendors, only a real prompt,
 *      and the payload ends in `\r`.
 *   3. `describeAttention` says the state in WORDS, exit code included.
 *
 * Mocking strategy: the desktop store is stubbed down to `addWindow`, which is
 * the only thing this module touches — no zustand, no persistence, no React.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The parameters are declared so `mock.calls` types as a real tuple —
// a bare `vi.fn(() => ...)` types its calls as `[]` and every read of
// `calls[0][1]` becomes a tsc error.
const mockStore = vi.hoisted(() => ({
  addWindow: vi.fn((_type: string, _opts?: Record<string, unknown>) => 'win-1'),
}));

vi.mock('../store/desktop-store', () => ({
  useDesktopStore: { getState: () => mockStore },
}));

import {
  PROMPT_TYPE_DELAY_MS,
  basenameOf,
  describeAttention,
  openAgentSession,
  planPromptTyping,
} from './agent-sessions';

beforeEach(() => {
  mockStore.addWindow.mockClear();
});

describe('openAgentSession', () => {
  it('creates an agent-session window with complete, pre-spawn metadata', () => {
    const before = Date.now();
    const id = openAgentSession({ vendor: 'claude', cwd: '/repo/javadaba-web', prompt: 'JDB-205' });

    expect(id).toBe('win-1');
    const [type, opts] = mockStore.addWindow.mock.calls[0];
    expect(type).toBe('agent-session');

    const meta = opts?.agentSession as Record<string, unknown>;
    expect(meta.vendor).toBe('claude');
    expect(meta.cwd).toBe('/repo/javadaba-web');
    expect(meta.prompt).toBe('JDB-205');
    // Attached is the default — a worktree is F2's job, never an implicit one.
    expect(meta.mode).toBe('attached');
    // The PTY is spawned by the component once it knows its geometry.
    expect(meta.ptyStarted).toBe(false);
    expect(meta.attention).toBe('starting');
    expect(typeof meta.sessionId).toBe('string');
    expect((meta.sessionId as string).length).toBeGreaterThan(10);
    expect(meta.launchedAt as number).toBeGreaterThanOrEqual(before);
  });

  it('gives every session its own id', () => {
    openAgentSession({ vendor: 'codex', cwd: '/a' });
    openAgentSession({ vendor: 'codex', cwd: '/a' });
    const [first, second] = mockStore.addWindow.mock.calls.map(
      (c) => (c[1]?.agentSession as { sessionId: string }).sessionId,
    );
    expect(first).not.toBe(second);
  });

  it('titles the window by directory so two sessions are tellable apart', () => {
    openAgentSession({ vendor: 'claude', cwd: '/repo/heliox-ide' });
    expect(mockStore.addWindow.mock.calls[0][1]?.title)
      .toBe('claude · heliox-ide');
  });

  it('honours an explicit title and mode', () => {
    openAgentSession({ vendor: 'opencode', cwd: '/a/b', mode: 'worktree', title: 'JDB-205' });
    const opts = mockStore.addWindow.mock.calls[0][1] as { title: string; agentSession: { mode: string } };
    expect(opts.title).toBe('JDB-205');
    expect(opts.agentSession.mode).toBe('worktree');
  });
});

describe('planPromptTyping', () => {
  it('plans a typed prompt for a "type" vendor, submitted with a carriage return', () => {
    expect(planPromptTyping('type', 'do the thing')).toEqual({
      payload: 'do the thing\r',
      delayMs: PROMPT_TYPE_DELAY_MS,
    });
  });

  it('plans nothing for an "arg" vendor — it already got the prompt in argv', () => {
    expect(planPromptTyping('arg', 'do the thing')).toBeNull();
  });

  it('plans nothing without a prompt, and nothing for a blank one', () => {
    expect(planPromptTyping('type', undefined)).toBeNull();
    expect(planPromptTyping('type', '')).toBeNull();
    expect(planPromptTyping('type', '   \n ')).toBeNull();
  });

  it('waits long enough for a TUI to finish laying itself out', () => {
    expect(PROMPT_TYPE_DELAY_MS).toBeGreaterThanOrEqual(1000);
  });
});

describe('describeAttention', () => {
  it('says the state in words', () => {
    expect(describeAttention('starting')).toBe('starting');
    expect(describeAttention('running')).toBe('running');
    expect(describeAttention('waiting')).toBe('waiting');
  });

  it('carries the exit code when the session ended', () => {
    expect(describeAttention('ended', 0)).toBe('ended · exit 0');
    expect(describeAttention('ended', 3)).toBe('ended · exit 3');
  });

  it('still reads as ended when the code is unknown (a kill, or a failed spawn)', () => {
    expect(describeAttention('ended', null)).toBe('ended');
    expect(describeAttention('ended')).toBe('ended');
  });
});

describe('basenameOf', () => {
  it('returns the last segment, ignoring a trailing separator', () => {
    expect(basenameOf('/repo/javadaba-web')).toBe('javadaba-web');
    expect(basenameOf('/repo/javadaba-web/')).toBe('javadaba-web');
    expect(basenameOf('javadaba-web')).toBe('javadaba-web');
  });

  it('is empty for an empty path rather than throwing', () => {
    expect(basenameOf('')).toBe('');
  });
});
