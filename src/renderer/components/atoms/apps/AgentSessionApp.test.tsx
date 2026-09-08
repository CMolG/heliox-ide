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
  mode: string;
  launchedAt: number;
  ptyStarted: boolean;
  attention: string;
  prompt?: string;
  exitCode?: number | null;
  logPath?: string;
}

const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    windows: [] as Array<{ id: string; type: string; agentSession?: Meta }>,
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

function installApi(spawnResult: unknown) {
  const dataCbs: DataCb[] = [];
  const exitCbs: ExitCb[] = [];
  const api = {
    // The payload parameter is declared so `mock.calls` types as a tuple.
    ptySpawn: vi.fn(async (_payload: { sessionId: string; prompt?: string }) => spawnResult),
    ptyWrite: vi.fn(async () => ({ success: true })),
    ptyResize: vi.fn(async () => ({ success: true })),
    ptyKill: vi.fn(async () => ({ success: true })),
    ptyList: vi.fn(async () => [] as Array<{ sessionId: string }>),
    revealPath: vi.fn(async () => true),
    onPtyData: (cb: DataCb) => { dataCbs.push(cb); return () => { dataCbs.splice(dataCbs.indexOf(cb), 1); }; },
    onPtyExit: (cb: ExitCb) => { exitCbs.push(cb); return () => { exitCbs.splice(exitCbs.indexOf(cb), 1); }; },
  };
  (window as unknown as { fluxorAPI: unknown }).fluxorAPI = api;
  return {
    api,
    emitData: (p: { sessionId: string; data: string }) => act(() => { dataCbs.forEach((cb) => cb(p)); }),
    emitExit: (p: { sessionId: string; exitCode: number }) => act(() => { exitCbs.forEach((cb) => cb(p)); }),
  };
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
      vendor: 'claude', cwd: '/repo/javadaba-web', mode: 'attached',
      launchedAt: 1, ptyStarted: false, attention: 'starting', ...overrides, sessionId,
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
