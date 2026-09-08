/**
 * AgentSessionApp.test.tsx — Terminal-window behaviour under mocked xterm
 *
 * What is pinned here:
 *   1. ONE spawn under React StrictMode's double mount — two `claude`
 *      processes on one window is the expensive bug this component guards.
 *   2. A PTY exit puts the window in the ended state, exit code and all, and
 *      the badge says so in WORDS ("ended · exit 0"), not in colour.
 *   3. `vendor_not_found` renders an actionable error naming the binary and
 *      the env override — no stack trace, no silence.
 *   4. Output is filtered by sessionId, so two open sessions never cross.
 *   5. Keystrokes reach the PTY.
 *   6. F2: the worktree comes BEFORE the PTY — preparing, then bootstrapping,
 *      then the agent — and each step says so in words.
 *   7. F2: a failed bootstrap and a taken main tree are both dead ends WITH a
 *      way out, and the removal offer states why it is not available.
 *
 * Mocking strategy:
 * - `@xterm/xterm` and `@xterm/addon-fit` are replaced with recorders. jsdom
 *   has no canvas and no real layout, so the real terminal cannot render, and
 *   nothing this test asserts is about xterm's own behaviour.
 * - `window.fluxorAPI` is a hand-rolled double whose push channels can be
 *   fired on demand.
 * - The desktop store is a mutable fixture with a working `updateAgentSession`
 *   so the component's own re-renders are exercised.
 * - ResizeObserver is not polyfilled in src/test-setup.ts — same local stub
 *   the repo already uses in StepThinkingPopover.test.tsx.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── xterm doubles ────────────────────────────────────────────────────────────

const xterm = vi.hoisted(() => {
  const instances: Array<{ written: string[]; dataHandlers: Array<(d: string) => void> }> = [];
  return { instances };
});

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    written: string[] = [];
    dataHandlers: Array<(d: string) => void> = [];
    constructor() { xterm.instances.push(this); }
    loadAddon() { /* the fit addon is a double too */ }
    open() { /* jsdom has no canvas */ }
    write(data: string) { this.written.push(data); }
    writeln(data: string) { this.written.push(`${data}\n`); }
    clear() { this.written.length = 0; }
    dispose() { /* nothing to release */ }
    onData(cb: (d: string) => void) {
      this.dataHandlers.push(cb);
      return { dispose: () => { /* noop */ } };
    }
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { fit() { /* no layout in jsdom */ } },
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// ── Desktop store double ─────────────────────────────────────────────────────

interface Meta {
  sessionId: string;
  vendor: string;
  cwd: string;
  projectRoot: string;
  mode: string;
  launchedAt: number;
  ptyStarted: boolean;
  attention: string;
  prompt?: string;
  exitCode?: number | null;
  logPath?: string;
  worktreePath?: string;
  worktreeName?: string;
  branch?: string;
  baseRef?: string;
  worktreeReady?: boolean;
  bootstrapExitCode?: number | null;
}

const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    windows: [] as Array<{ id: string; type: string; title?: string; agentSession?: Meta }>,
    updateAgentSession: (windowId: string, patch: Partial<Meta>) => {
      state.windows = state.windows.map((w) =>
        w.id === windowId && w.agentSession
          ? { ...w, agentSession: { ...w.agentSession, ...patch } }
          : w,
      );
      listeners.forEach((l) => l());
    },
  };
  return { state, listeners };
});

vi.mock('../../../store/desktop-store', () => {
  const useDesktopStore = (selector: (s: typeof store.state) => unknown) => {
    // React's own re-render is driven by the component's state; the fixture
    // notifies through a forced update below, so a plain read is enough.
    const [, force] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
      const l = () => force();
      store.listeners.add(l);
      return () => { store.listeners.delete(l); };
    }, []);
    return selector(store.state);
  };
  useDesktopStore.getState = () => store.state;
  return { useDesktopStore };
});

// ── fluxorAPI double ─────────────────────────────────────────────────────────

type DataCb = (p: { sessionId: string; data: string }) => void;
type ExitCb = (p: { sessionId: string; exitCode: number; signal?: number }) => void;

type ProgressCb = (p: { worktreePath: string; line: string }) => void;

const CREATED = {
  path: '/repo/javadaba-web/.claude/worktrees/jdb-205',
  branch: 'cockpit/jdb-205',
  head: 'abc1234',
  isMain: false,
  baseRef: 'origin/main',
  reused: false,
};

function installApi(spawnResult: unknown) {
  const dataCbs: DataCb[] = [];
  const exitCbs: ExitCb[] = [];
  const progressCbs: ProgressCb[] = [];
  const api = {
    // The payload parameter is declared so `mock.calls` types as a tuple.
    ptySpawn: vi.fn(async (_payload: { sessionId: string; prompt?: string; cwd?: string; mode?: string; projectRoot?: string }) => spawnResult),
    ptyWrite: vi.fn(async () => ({ success: true })),
    ptyResize: vi.fn(async () => ({ success: true })),
    ptyKill: vi.fn(async () => ({ success: true })),
    ptyList: vi.fn(async () => [] as Array<{ sessionId: string }>),
    revealPath: vi.fn(async () => true),
    worktreeCreate: vi.fn(async (_req: { projectRoot: string; name: string; branch: string }): Promise<unknown> => CREATED),
    worktreeSpent: vi.fn(async (_p: string): Promise<unknown> => null),
    worktreeRemove: vi.fn(async (_p: string, _force?: boolean): Promise<unknown> => ({ success: true })),
    bootstrapRun: vi.fn(async (_w: string, _r: string): Promise<unknown> => ({ exitCode: 0, durationMs: 0 })),
    onPtyData: (cb: DataCb) => { dataCbs.push(cb); return () => { dataCbs.splice(dataCbs.indexOf(cb), 1); }; },
    onPtyExit: (cb: ExitCb) => { exitCbs.push(cb); return () => { exitCbs.splice(exitCbs.indexOf(cb), 1); }; },
    onWorktreeProgress: (cb: ProgressCb) => {
      progressCbs.push(cb);
      return () => { progressCbs.splice(progressCbs.indexOf(cb), 1); };
    },
  };
  (window as unknown as { fluxorAPI: unknown }).fluxorAPI = api;
  return {
    api,
    emitData: (p: { sessionId: string; data: string }) => act(() => { dataCbs.forEach((cb) => cb(p)); }),
    emitExit: (p: { sessionId: string; exitCode: number }) => act(() => { exitCbs.forEach((cb) => cb(p)); }),
    emitProgress: (p: { worktreePath: string; line: string }) =>
      act(() => { progressCbs.forEach((cb) => cb(p)); }),
  };
}

/** Lets the component's own promise chain settle between assertions. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const OK_SPAWN = {
  sessionId: 'unread-by-the-component', pid: 4242, command: '/usr/local/bin/claude', cwd: '/repo',
  logPath: '/userData/sessions/s1.log', startedAt: 1, exitCode: null,
  promptDelivery: 'arg' as const,
};

/**
 * A fresh sessionId per test. The component's spawn guard is module-level and
 * only forgets an id once its PTY exits, so a shared id would make every test
 * after the first silently skip its own spawn.
 */
let sid = 0;
function seedWindow(overrides: Partial<Meta> = {}): string {
  const sessionId = overrides.sessionId ?? `s-${++sid}`;
  store.state.windows = [{
    id: 'win-1',
    type: 'agent-session',
    agentSession: {
      vendor: 'claude', cwd: '/repo/javadaba-web', projectRoot: '/repo/javadaba-web',
      mode: 'attached', launchedAt: 1, ptyStarted: false, attention: 'starting',
      ...overrides, sessionId,
    },
  }];
  return sessionId;
}

/** The sessionId of the window seeded for the current test. */
function currentSid(): string {
  return store.state.windows[0].agentSession!.sessionId;
}

// ── Import after mocks ───────────────────────────────────────────────────────

import { AgentSessionApp } from './AgentSessionApp';

// ── ResizeObserver stub (not polyfilled in src/test-setup.ts) ───────────────

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_cb: ResizeObserverCallback) { /* never fires: jsdom has no layout */ }
}

const realResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  xterm.instances.length = 0;
  store.listeners.clear();
  seedWindow();
});

afterEach(() => {
  globalThis.ResizeObserver = realResizeObserver;
  vi.clearAllMocks();
  delete (window as unknown as { fluxorAPI?: unknown }).fluxorAPI;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('spawn discipline', () => {
  it('spawns exactly ONCE under StrictMode double mount', async () => {
    const { api } = installApi(OK_SPAWN);

    await act(async () => {
      render(
        <React.StrictMode>
          <AgentSessionApp windowId="win-1" />
        </React.StrictMode>,
      );
    });

    expect(api.ptySpawn).toHaveBeenCalledTimes(1);
    expect(api.ptySpawn).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: currentSid(), vendor: 'claude', cwd: '/repo/javadaba-web', cols: 80, rows: 24,
    }));
    // And it records what came back, so the Log control has something to open.
    expect(store.state.windows[0].agentSession?.ptyStarted).toBe(true);
    expect(store.state.windows[0].agentSession?.logPath).toBe('/userData/sessions/s1.log');
  });

  it('does not respawn a window that already has a live PTY', async () => {
    const { api } = installApi(OK_SPAWN);
    seedWindow({ sessionId: 'live-1', ptyStarted: true });
    api.ptyList.mockResolvedValue([{ sessionId: 'live-1' }]);

    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });

    expect(api.ptySpawn).not.toHaveBeenCalled();
    expect(store.state.windows[0].agentSession?.attention).toBe('running');
  });

  it('shows the ended state for a rehydrated window whose PTY is gone', async () => {
    const { api } = installApi(OK_SPAWN);
    seedWindow({ sessionId: 'dead-1', ptyStarted: true });
    api.ptyList.mockResolvedValue([]);

    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });

    expect(api.ptySpawn).not.toHaveBeenCalled();
    expect(store.state.windows[0].agentSession?.attention).toBe('ended');
    expect(screen.getByTestId('agent-session-ended')).toBeInTheDocument();
  });
});

describe('states', () => {
  it('starts in "starting" and says so in words', async () => {
    installApi(OK_SPAWN);
    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });
    expect(screen.getByTestId('agent-session-status')).toHaveTextContent('starting');
  });

  it('moves to "running" on the first output chunk', async () => {
    const { emitData } = installApi(OK_SPAWN);
    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });

    await emitData({ sessionId: currentSid(), data: 'FAKE AGENT READY\r\n' });

    expect(screen.getByTestId('agent-session-status')).toHaveTextContent('running');
    expect(xterm.instances[0].written).toContain('FAKE AGENT READY\r\n');
  });

  it('ends with the exit code stated in words, not colour', async () => {
    const { emitExit } = installApi(OK_SPAWN);
    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });

    await emitExit({ sessionId: currentSid(), exitCode: 0 });

    expect(screen.getByTestId('agent-session-status')).toHaveTextContent('ended · exit 0');
    expect(screen.getByTestId('agent-session-ended')).toHaveTextContent('exit 0');
    expect(store.state.windows[0].agentSession?.exitCode).toBe(0);
  });

  it('reports a non-zero exit code just as plainly', async () => {
    const { emitExit } = installApi(OK_SPAWN);
    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });

    await emitExit({ sessionId: currentSid(), exitCode: 3 });

    expect(screen.getByTestId('agent-session-status')).toHaveTextContent('ended · exit 3');
  });

  it('ignores output and exits belonging to a different session', async () => {
    const { emitData, emitExit } = installApi(OK_SPAWN);
    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });

    await emitData({ sessionId: 'someone-else', data: 'not mine' });
    await emitExit({ sessionId: 'someone-else', exitCode: 1 });

    expect(xterm.instances[0].written).not.toContain('not mine');
    expect(screen.getByTestId('agent-session-status')).toHaveTextContent('starting');
  });
});

describe('vendor_not_found', () => {
  it('names the missing binary and both ways to fix it', async () => {
    installApi({ error: 'vendor_not_found', vendor: 'claude', bin: 'claude' });

    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });

    const panel = screen.getByTestId('agent-session-error');
    expect(panel).toHaveTextContent('claude is not installed');
    expect(panel).toHaveTextContent('not found on your PATH');
    expect(panel).toHaveTextContent('FLUXOR_AGENT_BIN_CLAUDE');
    // It is a dead end, not a running session — and the window says so.
    expect(store.state.windows[0].agentSession?.ptyStarted).toBe(false);
    expect(screen.getByTestId('agent-session-status')).toHaveTextContent('ended');
  });

  it('offers "Start again", which respawns with a fresh id and no prompt', async () => {
    const { api } = installApi({ error: 'vendor_not_found', vendor: 'claude', bin: 'claude' });
    const firstSid = seedWindow({ prompt: 'the original instruction' });

    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });
    api.ptySpawn.mockResolvedValue(OK_SPAWN);

    await act(async () => { fireEvent.click(screen.getByTestId('agent-session-restart')); });

    expect(api.ptySpawn).toHaveBeenCalledTimes(2);
    const second = api.ptySpawn.mock.calls[1][0];
    expect(second.sessionId).not.toBe(firstSid);
    // Replaying the prompt would make the agent redo whatever it already did.
    expect(second.prompt).toBeUndefined();
  });
});

describe('controls', () => {
  it('sends keystrokes straight to the PTY', async () => {
    const { api } = installApi(OK_SPAWN);
    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });

    act(() => { xterm.instances[0].dataHandlers.forEach((h) => h('ls\r')); });

    expect(api.ptyWrite).toHaveBeenCalledWith(currentSid(), 'ls\r');
  });

  it('asks for confirmation before killing — one click does not end a session', async () => {
    const { api } = installApi(OK_SPAWN);
    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });

    const end = screen.getByTestId('agent-session-end');
    expect(end).toHaveTextContent('End session');

    await act(async () => { fireEvent.click(end); });
    expect(api.ptyKill).not.toHaveBeenCalled();
    expect(screen.getByTestId('agent-session-end')).toHaveTextContent('Confirm end?');

    await act(async () => { fireEvent.click(screen.getByTestId('agent-session-end')); });
    expect(api.ptyKill).toHaveBeenCalledWith(currentSid());
  });

  it('reveals the transcript from the Log control', async () => {
    const { api } = installApi(OK_SPAWN);
    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });

    await act(async () => { fireEvent.click(screen.getByTestId('agent-session-log')); });

    expect(api.revealPath).toHaveBeenCalledWith('/userData/sessions/s1.log');
  });
});

describe('prompt delivery', () => {
  it('types the prompt into a "type" vendor after its first output', async () => {
    vi.useFakeTimers();
    try {
      const { api, emitData } = installApi({ ...OK_SPAWN, promptDelivery: 'type' as const });
      seedWindow({ vendor: 'opencode', prompt: 'work on JDB-205' });

      await act(async () => { render(<AgentSessionApp windowId="win-1" />); });
      await emitData({ sessionId: currentSid(), data: 'opencode ready' });

      expect(api.ptyWrite).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(api.ptyWrite).toHaveBeenCalledWith(currentSid(), 'work on JDB-205\r');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never types anything for an "arg" vendor — it already has the prompt', async () => {
    vi.useFakeTimers();
    try {
      const { api, emitData } = installApi(OK_SPAWN);
      seedWindow({ prompt: 'work on JDB-205' });

      await act(async () => { render(<AgentSessionApp windowId="win-1" />); });
      await emitData({ sessionId: currentSid(), data: 'claude ready' });
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

      expect(api.ptyWrite).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── F2: the worktree comes before the agent ────────────────────────────────

/** A worktree session as `openAgentSession` would have created it. */
function seedWorktreeWindow(overrides: Partial<Meta> = {}): string {
  return seedWindow({
    mode: 'worktree',
    worktreeName: 'jdb-205',
    branch: 'cockpit/jdb-205',
    attention: 'preparing',
    ...overrides,
  });
}

describe('worktree preparation', () => {
  it('goes preparing → bootstrapping → running, and spawns only at the end', async () => {
    const { api, emitData } = installApi(OK_SPAWN);
    seedWorktreeWindow();

    let releaseCreate: (v: unknown) => void = () => { /* replaced below */ };
    let releaseBootstrap: (v: unknown) => void = () => { /* replaced below */ };
    api.worktreeCreate.mockReturnValue(new Promise((r) => { releaseCreate = r; }));
    api.bootstrapRun.mockReturnValue(new Promise((r) => { releaseBootstrap = r; }));

    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });

    // 1. It says what it is doing, in words, before anything exists.
    expect(screen.getByTestId('agent-session-status')).toHaveTextContent('preparing worktree');
    expect(api.worktreeCreate).toHaveBeenCalledWith({
      projectRoot: '/repo/javadaba-web', name: 'jdb-205', branch: 'cockpit/jdb-205',
    });
    expect(api.ptySpawn).not.toHaveBeenCalled();

    // 2. The worktree lands: the terminal is the log surface, so it is written there.
    await act(async () => { releaseCreate(CREATED); });
    await settle();
    expect(xterm.instances[0].written.join('')).toContain('preparing worktree');
    expect(xterm.instances[0].written.join('')).toContain('origin/main');
    expect(screen.getByTestId('agent-session-status')).toHaveTextContent('bootstrapping');
    expect(api.bootstrapRun).toHaveBeenCalledWith(CREATED.path, '/repo/javadaba-web');
    // Still nothing spawned — a worktree with no dependencies is not ready.
    expect(api.ptySpawn).not.toHaveBeenCalled();

    // 3. Bootstrap done → the agent starts, INSIDE the worktree.
    await act(async () => { releaseBootstrap({ exitCode: 0, durationMs: 1200 }); });
    await settle();
    expect(api.ptySpawn).toHaveBeenCalledTimes(1);
    expect(api.ptySpawn).toHaveBeenCalledWith(expect.objectContaining({
      cwd: CREATED.path, projectRoot: '/repo/javadaba-web', mode: 'worktree',
    }));
    expect(store.state.windows[0].agentSession?.worktreeReady).toBe(true);
    expect(store.state.windows[0].agentSession?.baseRef).toBe('origin/main');

    await emitData({ sessionId: currentSid(), data: 'FAKE AGENT READY' });
    expect(screen.getByTestId('agent-session-status')).toHaveTextContent('running');
  });

  it('writes the bootstrap\'s own output into the same terminal, and only its own', async () => {
    const { api, emitProgress } = installApi(OK_SPAWN);
    seedWorktreeWindow();
    api.bootstrapRun.mockReturnValue(new Promise(() => { /* still installing */ }));

    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });
    await settle();

    await emitProgress({ worktreePath: CREATED.path, line: 'Progress: resolved 1701' });
    await emitProgress({ worktreePath: '/some/other/worktree', line: 'not mine' });

    const written = xterm.instances[0].written.join('');
    expect(written).toContain('Progress: resolved 1701');
    expect(written).not.toContain('not mine');
  });

  it('creates the worktree exactly once under StrictMode double mount', async () => {
    const { api } = installApi(OK_SPAWN);
    seedWorktreeWindow();

    await act(async () => {
      render(
        <React.StrictMode>
          <AgentSessionApp windowId="win-1" />
        </React.StrictMode>,
      );
    });
    await settle();

    // Two `git worktree add` on one session leaves a checkout nothing cleans up.
    expect(api.worktreeCreate).toHaveBeenCalledTimes(1);
  });

  it('never prepares a worktree for an attached session', async () => {
    const { api } = installApi(OK_SPAWN);
    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });
    expect(api.worktreeCreate).not.toHaveBeenCalled();
    expect(api.ptySpawn).toHaveBeenCalledWith(expect.objectContaining({ mode: 'attached' }));
  });

  it('says the worktree could not be prepared instead of dying silently', async () => {
    const { api } = installApi(OK_SPAWN);
    seedWorktreeWindow();
    api.worktreeCreate.mockResolvedValue({
      error: 'git_failed', message: 'exit 128', stderr: "fatal: 'cockpit/jdb-205' is already checked out",
    });

    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });
    await settle();

    const panel = screen.getByTestId('agent-session-error');
    expect(panel).toHaveTextContent('The worktree could not be prepared');
    expect(panel).toHaveTextContent('already checked out');
    expect(api.ptySpawn).not.toHaveBeenCalled();
  });
});

describe('bootstrap failure', () => {
  async function renderFailedBootstrap() {
    const installed = installApi(OK_SPAWN);
    seedWorktreeWindow();
    installed.api.bootstrapRun.mockResolvedValue({ exitCode: 3, durationMs: 900 });
    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });
    await settle();
    return installed;
  }

  it('states the exit code and offers two real ways forward', async () => {
    const { api } = await renderFailedBootstrap();

    expect(screen.getByTestId('agent-session-status')).toHaveTextContent('bootstrap failed · exit 3');
    const panel = screen.getByTestId('agent-session-bootstrap-error');
    expect(panel).toHaveTextContent('Bootstrap failed · exit 3');
    expect(screen.getByTestId('agent-session-bootstrap-retry')).toBeInTheDocument();
    expect(screen.getByTestId('agent-session-bootstrap-open-anyway')).toBeInTheDocument();
    // The agent does not start on top of a half-installed worktree by itself.
    expect(api.ptySpawn).not.toHaveBeenCalled();
  });

  it('Retry runs the same bootstrap again, in the same worktree', async () => {
    const { api } = await renderFailedBootstrap();
    api.bootstrapRun.mockResolvedValue({ exitCode: 0, durationMs: 10 });

    await act(async () => { fireEvent.click(screen.getByTestId('agent-session-bootstrap-retry')); });
    await settle();

    expect(api.bootstrapRun).toHaveBeenCalledTimes(2);
    expect(api.bootstrapRun.mock.calls[1][0]).toBe(CREATED.path);
    expect(api.ptySpawn).toHaveBeenCalledTimes(1);
  });

  it('Open anyway starts the agent in the worktree without its dependencies', async () => {
    const { api } = await renderFailedBootstrap();

    await act(async () => { fireEvent.click(screen.getByTestId('agent-session-bootstrap-open-anyway')); });
    await settle();

    expect(api.bootstrapRun).toHaveBeenCalledTimes(1);
    expect(api.ptySpawn).toHaveBeenCalledWith(expect.objectContaining({ cwd: CREATED.path }));
    expect(screen.queryByTestId('agent-session-bootstrap-error')).not.toBeInTheDocument();
  });
});

describe('attached_session_exists', () => {
  function seedTheOtherSession() {
    store.state.windows.push({
      id: 'win-other',
      type: 'agent-session',
      title: 'claude · javadaba-web',
      agentSession: {
        sessionId: 'other-1', vendor: 'claude', cwd: '/repo/javadaba-web',
        projectRoot: '/repo/javadaba-web', mode: 'attached',
        launchedAt: 1, ptyStarted: true, attention: 'running',
      },
    });
  }

  it('names the window in the way, rather than printing an id', async () => {
    installApi({ error: 'attached_session_exists', projectRoot: '/repo/javadaba-web', sessionId: 'other-1' });
    seedTheOtherSession();

    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });
    await settle();

    const panel = screen.getByTestId('agent-session-error');
    expect(panel).toHaveTextContent('Another session already holds this project');
    expect(panel).toHaveTextContent('claude · javadaba-web');
    expect(screen.getByTestId('agent-session-open-in-worktree')).toBeInTheDocument();
  });

  it('converts THIS window to a worktree session, keeping its prompt', async () => {
    const { api } = installApi({
      error: 'attached_session_exists', projectRoot: '/repo/javadaba-web', sessionId: 'other-1',
    });
    const firstSid = seedWindow({ prompt: 'work on JDB-205' });
    seedTheOtherSession();

    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });
    await settle();
    api.ptySpawn.mockResolvedValue(OK_SPAWN);

    await act(async () => { fireEvent.click(screen.getByTestId('agent-session-open-in-worktree')); });
    await settle();

    const meta = store.state.windows[0].agentSession!;
    expect(meta.mode).toBe('worktree');
    expect(meta.sessionId).not.toBe(firstSid);
    // Nothing ran, so the instruction is still owed to the agent.
    expect(meta.prompt).toBe('work on JDB-205');

    // The defaults are what it ASKED for; what it stores afterwards is what
    // git reported back, which is the answer that has to win.
    expect(api.worktreeCreate).toHaveBeenCalledTimes(1);
    const asked = api.worktreeCreate.mock.calls[0][0];
    expect(asked.name).toMatch(/^session-[0-9a-f]{8}$/);
    expect(asked.branch).toMatch(/^cockpit\/session-[0-9a-f]{8}$/);
    expect(meta.branch).toBe(CREATED.branch);
  });
});

describe('cwd_not_found', () => {
  it('names the directory that is not there', async () => {
    installApi({ error: 'cwd_not_found', cwd: '/repo/javadaba-web/.claude/worktrees/gone' });

    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });
    await settle();

    const panel = screen.getByTestId('agent-session-error');
    expect(panel).toHaveTextContent('That directory is not there');
    expect(panel).toHaveTextContent('/repo/javadaba-web/.claude/worktrees/gone');
  });
});

describe('the worktree a finished session leaves behind', () => {
  const SPENT = {
    same: true, ahead: 2, clean: true, changes: 0, prMerged: null,
    spent: true, removable: true, baseRef: 'origin/main', branch: 'cockpit/jdb-205',
  };

  async function renderEnded(verdict: Record<string, unknown>) {
    const installed = installApi(OK_SPAWN);
    seedWindow({
      mode: 'worktree', worktreePath: CREATED.path, branch: 'cockpit/jdb-205',
      worktreeReady: true, ptyStarted: true, attention: 'ended', exitCode: 0,
    });
    installed.api.worktreeSpent.mockResolvedValue(verdict);
    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });
    await settle();
    return installed;
  }

  it('states the verdict in words and offers the removal', async () => {
    const { api } = await renderEnded(SPENT);

    expect(api.worktreeSpent).toHaveBeenCalledWith(CREATED.path);
    expect(screen.getByTestId('agent-session-worktree'))
      .toHaveTextContent('worktree cockpit/jdb-205 · spent · clean');
    expect(screen.getByTestId('agent-session-remove-worktree')).toBeEnabled();
  });

  it('disables the removal WITH the reason when there is uncommitted work', async () => {
    await renderEnded({ ...SPENT, clean: false, changes: 2, removable: false });

    const button = screen.getByTestId('agent-session-remove-worktree');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('has uncommitted changes');
    expect(screen.getByTestId('agent-session-worktree')).toHaveTextContent('2 changes');
  });

  it('disables it with the OTHER reason when no PR carried the commits', async () => {
    await renderEnded({ ...SPENT, same: false, ahead: 4, spent: false, removable: false });
    expect(screen.getByTestId('agent-session-remove-worktree'))
      .toHaveTextContent('has commits no PR carried');
  });

  it('disables it while nothing has happened in the worktree yet', async () => {
    await renderEnded({ ...SPENT, ahead: 0, spent: false, removable: false });
    expect(screen.getByTestId('agent-session-remove-worktree')).toHaveTextContent('not spent yet');
  });

  it('removes in two steps, and says the branch survived', async () => {
    const { api } = await renderEnded(SPENT);

    await act(async () => { fireEvent.click(screen.getByTestId('agent-session-remove-worktree')); });
    expect(api.worktreeRemove).not.toHaveBeenCalled();
    expect(screen.getByTestId('agent-session-remove-worktree')).toHaveTextContent('Confirm remove?');

    await act(async () => { fireEvent.click(screen.getByTestId('agent-session-remove-worktree')); });
    await settle();

    expect(api.worktreeRemove).toHaveBeenCalledWith(CREATED.path);
    expect(screen.getByTestId('agent-session-worktree'))
      .toHaveTextContent('worktree removed · branch cockpit/jdb-205 kept');
  });

  it('shows git\'s own refusal rather than silently doing nothing', async () => {
    const { api } = await renderEnded(SPENT);
    api.worktreeRemove.mockResolvedValue({
      error: 'git_failed', message: 'exit 128', stderr: 'fatal: validation failed',
    });

    await act(async () => { fireEvent.click(screen.getByTestId('agent-session-remove-worktree')); });
    await act(async () => { fireEvent.click(screen.getByTestId('agent-session-remove-worktree')); });
    await settle();

    expect(screen.getByTestId('agent-session-worktree')).toHaveTextContent('fatal: validation failed');
  });

  it('offers nothing of the sort for an attached session', async () => {
    installApi(OK_SPAWN);
    seedWindow({ ptyStarted: true, attention: 'ended', exitCode: 0 });
    await act(async () => { render(<AgentSessionApp windowId="win-1" />); });
    await settle();

    expect(screen.queryByTestId('agent-session-worktree')).not.toBeInTheDocument();
  });
});
