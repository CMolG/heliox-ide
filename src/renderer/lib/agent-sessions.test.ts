/**
 * agent-sessions.test.ts — Unit tests for the session-opening rules
 *
 * What is pinned here:
 *   1. `openAgentSession` creates an 'agent-session' window whose metadata is
 *      complete and in the pre-spawn state (`ptyStarted:false`, 'starting'),
 *      and a worktree session comes out with its name and branch already
 *      decided — nothing downstream may invent them a second time.
 *   2. The prompt-typing decision: only `'type'` vendors, only a real prompt,
 *      and the payload ends in `\r`.
 *   3. `describeAttention` says the state in WORDS, exit code included.
 *   4. Why a spent worktree may not be removed, in the words the disabled
 *      control shows.
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
  defaultWorktreeBranch,
  defaultWorktreeName,
  describeAttention,
  describeWorktreeVerdict,
  isGitFailed,
  openAgentSession,
  describeCardSession,
  findCardSessionWindow,
  planPromptTyping,
  removalReason,
} from './agent-sessions';
import type { AgentSessionMeta } from '@/types/desktop';
import type { SpentVerdict } from '@/main/worktrees/worktree-manager';

beforeEach(() => {
  mockStore.addWindow.mockClear();
});

describe('openAgentSession', () => {
  it('creates an agent-session window with complete, pre-spawn metadata', () => {
    const before = Date.now();
    const id = openAgentSession({ vendor: 'claude', cwd: '/repo/javadaba-web', projectRoot: '/repo/javadaba-web', prompt: 'JDB-205' });

    expect(id).toBe('win-1');
    const [type, opts] = mockStore.addWindow.mock.calls[0];
    expect(type).toBe('agent-session');

    const meta = opts?.agentSession as Record<string, unknown>;
    expect(meta.vendor).toBe('claude');
    expect(meta.cwd).toBe('/repo/javadaba-web');
    expect(meta.projectRoot).toBe('/repo/javadaba-web');
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
    openAgentSession({ vendor: 'codex', cwd: '/a', projectRoot: '/a' });
    openAgentSession({ vendor: 'codex', cwd: '/a', projectRoot: '/a' });
    const [first, second] = mockStore.addWindow.mock.calls.map(
      (c) => (c[1]?.agentSession as { sessionId: string }).sessionId,
    );
    expect(first).not.toBe(second);
  });

  it('titles the window by directory so two sessions are tellable apart', () => {
    openAgentSession({ vendor: 'claude', cwd: '/repo/heliox-ide', projectRoot: '/repo/heliox-ide' });
    expect(mockStore.addWindow.mock.calls[0][1]?.title)
      .toBe('claude · heliox-ide');
  });

  it('honours an explicit title and mode', () => {
    openAgentSession({ vendor: 'opencode', cwd: '/a/b', projectRoot: '/a/b', mode: 'worktree', title: 'JDB-205' });
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

describe('worktree defaults', () => {
  it('names the worktree and the branch from the session id, once, at open time', () => {
    openAgentSession({ vendor: 'claude', cwd: '/repo/x', projectRoot: '/repo/x', mode: 'worktree' });
    const meta = mockStore.addWindow.mock.calls[0][1]?.agentSession as Record<string, unknown>;

    const sessionId = meta.sessionId as string;
    expect(meta.worktreeName).toBe(defaultWorktreeName(sessionId));
    expect(meta.branch).toBe(defaultWorktreeBranch(sessionId));
    expect(meta.worktreeName).toMatch(/^session-[0-9a-f]{8}$/);
    expect(meta.branch).toMatch(/^cockpit\/session-[0-9a-f]{8}$/);
  });

  it('opens a worktree session in "preparing", never in "starting"', () => {
    openAgentSession({ vendor: 'claude', cwd: '/repo/x', projectRoot: '/repo/x', mode: 'worktree' });
    const meta = mockStore.addWindow.mock.calls[0][1]?.agentSession as Record<string, unknown>;
    // 'starting' would claim the agent is up while a fetch is still running.
    expect(meta.attention).toBe('preparing');
    expect(meta.worktreeReady).toBeUndefined();
  });

  it('lets a caller name the worktree and branch — F3 hands it the card id', () => {
    openAgentSession({
      vendor: 'claude', cwd: '/repo/x', projectRoot: '/repo/x', mode: 'worktree',
      worktreeName: 'jdb-205', branch: 'JDB-205/cockpit',
    });
    const meta = mockStore.addWindow.mock.calls[0][1]?.agentSession as Record<string, unknown>;
    expect(meta.worktreeName).toBe('jdb-205');
    expect(meta.branch).toBe('JDB-205/cockpit');
  });

  it('titles a worktree window by its worktree — they all share one directory', () => {
    openAgentSession({
      vendor: 'claude', cwd: '/repo/x', projectRoot: '/repo/x', mode: 'worktree', worktreeName: 'jdb-205',
    });
    expect(mockStore.addWindow.mock.calls[0][1]?.title).toBe('claude · jdb-205');
  });

  it('gives an attached session no worktree at all', () => {
    openAgentSession({ vendor: 'claude', cwd: '/repo/x', projectRoot: '/repo/x' });
    const meta = mockStore.addWindow.mock.calls[0][1]?.agentSession as Record<string, unknown>;
    expect(meta.worktreeName).toBeUndefined();
    expect(meta.branch).toBeUndefined();
    expect(meta.attention).toBe('starting');
  });
});

describe('describeAttention — the F2 states', () => {
  it('spells out the worktree steps rather than showing a bare verb', () => {
    expect(describeAttention('preparing')).toBe('preparing worktree');
    expect(describeAttention('bootstrapping')).toBe('bootstrapping');
  });

  it('separates a failed INSTALL from a failed agent', () => {
    expect(describeAttention('bootstrapping', null, 1)).toBe('bootstrap failed · exit 1');
    expect(describeAttention('bootstrapping', null, 0)).toBe('bootstrapping');
    expect(describeAttention('ended', 1, 0)).toBe('ended · exit 1');
  });
});

// ─── The removal offer ───────────────────────────────────────────

function verdict(over: Partial<SpentVerdict> = {}): SpentVerdict {
  return {
    same: true, ahead: 2, clean: true, changes: 0, prMerged: null,
    spent: true, removable: true, baseRef: 'origin/main', branch: 'cockpit/x',
    ...over,
  };
}

describe('removalReason', () => {
  it('says nothing when the worktree may go', () => {
    expect(removalReason(verdict())).toBeNull();
  });

  it('puts uncommitted work first — it is the only unrecoverable one', () => {
    expect(removalReason(verdict({ clean: false, changes: 3, removable: false })))
      .toBe('has uncommitted changes');
  });

  it('distinguishes work no PR carried from a worktree nothing happened in', () => {
    expect(removalReason(verdict({ same: false, ahead: 4, spent: false, removable: false })))
      .toBe('has commits no PR carried');
    expect(removalReason(verdict({ ahead: 0, spent: false, removable: false })))
      .toBe('not spent yet');
  });
});

describe('describeWorktreeVerdict', () => {
  it('reads as three plain facts, none of them a colour', () => {
    expect(describeWorktreeVerdict(verdict())).toBe('worktree cockpit/x · spent · clean');
    expect(describeWorktreeVerdict(verdict({ spent: false, clean: false, changes: 1 })))
      .toBe('worktree cockpit/x · not spent · 1 change');
    expect(describeWorktreeVerdict(verdict({ clean: false, changes: 7 })))
      .toBe('worktree cockpit/x · spent · 7 changes');
  });

  it('names a detached HEAD rather than printing nothing', () => {
    expect(describeWorktreeVerdict(verdict({ branch: null }))).toContain('detached HEAD');
  });
});

describe('isGitFailed', () => {
  it('recognises the failure value the main process sends back', () => {
    expect(isGitFailed({ error: 'git_failed', message: 'boom', stderr: '' })).toBe(true);
  });

  it('does not mistake a successful result — or nothing at all — for one', () => {
    expect(isGitFailed({ path: '/w', branch: 'x' })).toBe(false);
    expect(isGitFailed(null)).toBe(false);
    expect(isGitFailed(undefined)).toBe(false);
  });
});

// ─── Cards ↔ sessions (F3) ───────────────────────────────────────

function sessionMeta(overrides: Partial<AgentSessionMeta> = {}): AgentSessionMeta {
  return {
    sessionId: 's1', vendor: 'claude', cwd: '/proj', projectRoot: '/proj',
    mode: 'attached', launchedAt: 1000, ptyStarted: true, attention: 'running',
    ...overrides,
  };
}

describe('findCardSessionWindow', () => {
  it('finds the window through the correlation the launcher registered', () => {
    const windows = [{ id: 'w1', agentSession: sessionMeta() }];
    const found = findCardSessionWindow(windows, { s1: { backlogDir: '/b', filename: 'a.md', cardId: 'JDB-1' } }, 'a.md');
    expect(found?.windowId).toBe('w1');
  });

  it('finds it through the window\'s own metadata after a restart minted a new sessionId', () => {
    // "Start again" replaces sessionId, so the correlation map no longer keys
    // this session — the card is still written on the window itself.
    const windows = [{ id: 'w1', agentSession: sessionMeta({ sessionId: 's2', cardFilename: 'a.md' }) }];
    expect(findCardSessionWindow(windows, {}, 'a.md')?.windowId).toBe('w1');
  });

  it('is null for a card with no session, and for windows with no session at all', () => {
    const windows = [{ id: 'w0' }, { id: 'w1', agentSession: sessionMeta({ cardFilename: 'other.md' }) }];
    expect(findCardSessionWindow(windows, {}, 'a.md')).toBeNull();
  });

  it('prefers the most recently launched when a card was relaunched', () => {
    const windows = [
      { id: 'old', agentSession: sessionMeta({ sessionId: 's1', cardFilename: 'a.md', launchedAt: 1000 }) },
      { id: 'new', agentSession: sessionMeta({ sessionId: 's2', cardFilename: 'a.md', launchedAt: 2000 }) },
    ];
    expect(findCardSessionWindow(windows, {}, 'a.md')?.windowId).toBe('new');
  });
});

describe('describeCardSession', () => {
  it('reuses F1\'s attention vocabulary, so the card and the window never disagree', () => {
    expect(describeCardSession(sessionMeta({ attention: 'preparing' }), 'todo').label).toBe('preparing worktree');
    expect(describeCardSession(sessionMeta({ attention: 'bootstrapping' }), 'todo').label).toBe('bootstrapping');
    expect(describeCardSession(sessionMeta({ attention: 'ended', exitCode: 3 }), 'todo').label).toBe('ended · exit 3');
  });

  it('names the vendor and the branch in the tooltip, or "attached" when there is none', () => {
    expect(describeCardSession(sessionMeta({ mode: 'worktree', branch: 'jdb-1/probe' }), 'todo').tooltip)
      .toBe('session claude · jdb-1/probe');
    expect(describeCardSession(sessionMeta(), 'todo').tooltip).toBe('session claude · attached');
  });

  it('shows the worktree\'s own status when it has moved ahead of the main tree\'s', () => {
    const meta = sessionMeta({ mode: 'worktree', branch: 'b', mirroredStatus: 'review' });
    expect(describeCardSession(meta, 'doing').label).toBe('running · in worktree: review');
  });

  it('says nothing extra when the two agree, or when the session is attached', () => {
    expect(describeCardSession(sessionMeta({ mode: 'worktree', mirroredStatus: 'doing' }), 'doing').label).toBe('running');
    expect(describeCardSession(sessionMeta({ mirroredStatus: 'review' }), 'doing').label).toBe('running');
  });
});
