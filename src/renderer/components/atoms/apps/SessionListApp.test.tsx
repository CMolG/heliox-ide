/**
 * SessionListApp.test.tsx — The session list, row by row
 *
 * What is pinned here:
 *   1. One row per session, with the card id, the vendor, where it runs, the
 *      attention IN WORDS (reason included), and the elapsed time.
 *   2. The empty state says what to do next instead of showing a blank panel.
 *   3. Focus navigates to that window — the control does something.
 *   4. End is two-step, and is disabled WITH A REASON once the session ended.
 *   5. Wrapper Principle: at a narrow width the row keeps the id and the
 *      attention and drops everything else.
 *
 * Mocking strategy mirrors AgentSessionApp.test.tsx: the desktop store is a
 * mutable fixture, `window.fluxorAPI` is a hand-rolled double, and
 * ResizeObserver is stubbed locally (it is not in src/test-setup.ts).
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionMeta } from '@/types/desktop';

// ── Desktop store double ─────────────────────────────────────────────────────

const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    windows: [] as Array<{ id: string; type: string; title?: string; agentSession?: AgentSessionMeta }>,
    navigateToWindow: vi.fn(),
  };
  return { state, listeners };
});

vi.mock('../../../store/desktop-store', () => {
  const useDesktopStore = (selector: (s: typeof store.state) => unknown) => {
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

// ── ResizeObserver stub, with a hook to drive the narrow branch ──────────────

let resizeCallbacks: Array<() => void> = [];
let observedNodes: Element[] = [];

class StubResizeObserver {
  constructor(private readonly cb: () => void) { resizeCallbacks.push(cb); }
  observe(node: Element) { observedNodes.push(node); }
  disconnect() { /* nothing to release */ }
  unobserve() { /* nothing to release */ }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function meta(patch: Partial<AgentSessionMeta> = {}): AgentSessionMeta {
  return {
    sessionId: 'sess-1',
    vendor: 'claude',
    cwd: '/repo/javadaba-web',
    projectRoot: '/repo/javadaba-web',
    mode: 'attached',
    launchedAt: NOW - 64_000,
    ptyStarted: true,
    attention: 'running',
    ...patch,
  };
}

function seed(...metas: AgentSessionMeta[]): void {
  store.state.windows = metas.map((m, i) => ({
    id: `win-${i + 1}`, type: 'agent-session', title: `session ${i + 1}`, agentSession: m,
  }));
}

const ptyKill = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resizeCallbacks = [];
  observedNodes = [];
  store.state.windows = [];
  store.state.navigateToWindow.mockClear();
  ptyKill.mockClear();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
  (window as unknown as { fluxorAPI: unknown }).fluxorAPI = { ptyKill };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Reports a width to the component's ResizeObserver and fires it. */
function reportWidth(px: number): void {
  for (const node of observedNodes) {
    Object.defineProperty(node, 'clientWidth', { value: px, configurable: true });
  }
  act(() => { resizeCallbacks.forEach((cb) => cb()); });
}

// Imported after the mocks are registered.
const { SessionListApp } = await import('./SessionListApp');

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SessionListApp', () => {
  it('says what to do next when there is nothing to list', () => {
    render(<SessionListApp windowId="win-list" />);
    expect(screen.getByTestId('session-list-empty'))
      .toHaveTextContent('No sessions · open one from a card or the dock');
    expect(screen.queryAllByTestId('session-list-row')).toHaveLength(0);
  });

  it('renders one row per session, oldest first', () => {
    seed(
      meta({ sessionId: 'a', cardId: 'JDB-205', launchedAt: NOW - 10_000 }),
      meta({ sessionId: 'b', cardId: 'JDB-206', launchedAt: NOW - 90_000 }),
    );
    render(<SessionListApp windowId="win-list" />);
    const rows = screen.getAllByTestId('session-list-row');
    expect(rows).toHaveLength(2);
    // Sorted by launch time, so the grid and this list agree on the order.
    expect(rows[0]).toHaveTextContent('JDB-206');
    expect(rows[1]).toHaveTextContent('JDB-205');
  });

  it('shows the card, the vendor, where it runs, and the elapsed time', () => {
    seed(meta({ cardId: 'JDB-205', mode: 'worktree', branch: 'cockpit/jdb-205' }));
    render(<SessionListApp windowId="win-list" />);
    const row = screen.getByTestId('session-list-row');
    expect(row).toHaveTextContent('JDB-205');
    expect(row).toHaveTextContent('claude');
    expect(row).toHaveTextContent('cockpit/jdb-205');
    // 64 s since launch.
    expect(row).toHaveTextContent('1:04');
  });

  it('says `no card` rather than showing a blank where an id would be', () => {
    seed(meta({ cardId: undefined }));
    render(<SessionListApp windowId="win-list" />);
    expect(screen.getByTestId('session-list-row')).toHaveTextContent('no card');
  });

  it('says `attached` for a session in the main tree', () => {
    seed(meta({ mode: 'attached' }));
    render(<SessionListApp windowId="win-list" />);
    expect(screen.getByTestId('session-list-row')).toHaveTextContent('attached');
  });

  it('prints the attention IN WORDS, reason included', () => {
    seed(
      meta({ sessionId: 'a', attention: 'waiting', attentionReason: 'permission', launchedAt: NOW - 1 }),
      meta({ sessionId: 'b', attention: 'ended', exitCode: 3, launchedAt: NOW }),
    );
    render(<SessionListApp windowId="win-list" />);
    const badges = screen.getAllByTestId('session-list-attention');
    expect(badges[0]).toHaveTextContent('waiting · permission');
    expect(badges[1]).toHaveTextContent('ended · exit 3');
  });

  it('refreshes the clock on its own 30 s tick, not per second', () => {
    seed(meta({ launchedAt: NOW }));
    render(<SessionListApp windowId="win-list" />);
    expect(screen.getByTestId('session-list-row')).toHaveTextContent('0:00');
    // 29 s in, nothing has re-rendered: the row is a glance, not a stopwatch.
    act(() => { vi.advanceTimersByTime(29_000); });
    expect(screen.getByTestId('session-list-row')).toHaveTextContent('0:00');
    // The tick lands at 30 s and the row catches up to it.
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(screen.getByTestId('session-list-row')).toHaveTextContent('0:30');
  });

  it('Focus navigates to that session\'s window', () => {
    seed(meta({ sessionId: 'a', launchedAt: NOW - 1 }), meta({ sessionId: 'b', launchedAt: NOW }));
    render(<SessionListApp windowId="win-list" />);
    fireEvent.click(screen.getAllByTestId('session-list-focus')[1]);
    expect(store.state.navigateToWindow).toHaveBeenCalledWith('win-2');
  });

  it('End is two-step — the first click arms, the second kills', () => {
    seed(meta({ sessionId: 'sess-x' }));
    render(<SessionListApp windowId="win-list" />);
    const end = screen.getByTestId('session-list-end');

    fireEvent.click(end);
    expect(ptyKill).not.toHaveBeenCalled();
    expect(end).toHaveTextContent('Confirm?');

    fireEvent.click(screen.getByTestId('session-list-end'));
    expect(ptyKill).toHaveBeenCalledWith('sess-x');
  });

  it('disarms itself rather than staying armed forever', () => {
    seed(meta());
    render(<SessionListApp windowId="win-list" />);
    fireEvent.click(screen.getByTestId('session-list-end'));
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.getByTestId('session-list-end')).toHaveTextContent('End');
  });

  it('disables End on an ended session WITH the reason', () => {
    seed(meta({ attention: 'ended', exitCode: 0 }));
    render(<SessionListApp windowId="win-list" />);
    const end = screen.getByTestId('session-list-end');
    expect(end).toBeDisabled();
    expect(end.getAttribute('title')).toContain('already exited');
  });

  it('collapses to the id and the attention at a narrow width', () => {
    seed(meta({ cardId: 'JDB-205', mode: 'worktree', branch: 'cockpit/jdb-205' }));
    render(<SessionListApp windowId="win-list" />);
    reportWidth(300);

    const row = screen.getByTestId('session-list-row');
    expect(row).toHaveTextContent('JDB-205');
    expect(row).toHaveTextContent('running');
    // The three that go: vendor, branch, elapsed.
    expect(row).not.toHaveTextContent('claude');
    expect(row).not.toHaveTextContent('cockpit/jdb-205');
    expect(row).not.toHaveTextContent('1:04');
    // Both controls survive: a narrow list is still a list you act from.
    expect(screen.getByTestId('session-list-focus')).toBeInTheDocument();
    expect(screen.getByTestId('session-list-end')).toBeInTheDocument();
  });
});
