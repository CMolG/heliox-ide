/**
 * dev-server-watcher.test.ts — Unit tests for the M1 dev-server watcher
 *
 * Tests the core liveness semantics:
 *   1. Emits once per detected port (not on every poll tick).
 *   2. Does not re-emit while a port stays up.
 *   3. Re-emits after a port goes down and comes back up.
 *   4. Handles multiple ports independently in the same poll cycle.
 *   5. stopDevServerWatch prevents further emissions.
 *
 * Mocking strategy:
 *   - `fetch` is replaced with a vi.fn() per test.
 *   - BrowserWindow is faked with a lightweight stub.
 *   - vi.useFakeTimers() controls time; we use vi.advanceTimersByTimeAsync() to
 *     advance fake time AND flush the microtask queue atomically (vitest 1.3+).
 *   - The module is freshly imported per test via vi.resetModules() so the
 *     module-level Maps (activeIntervals, livePortSets) start clean each time.
 *
 * Fake-timer note:
 *   The AbortController timeout in probePort() uses setTimeout(abort, 800).
 *   Our mock fetch resolves/rejects synchronously (same microtask tick), so the
 *   finally block always calls clearTimeout(timer) before it fires — no hang.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── ipcMain stub ─────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

// ─── Minimal BrowserWindow stub ───────────────────────────────────────────────

interface SendCall { channel: string; payload: unknown }

function makeFakeWindow() {
  const sent: SendCall[] = [];
  return {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: unknown) => { sent.push({ channel, payload }); },
    },
    on: () => {},
    sent,
  };
}

// ─── Fetch mock factory ───────────────────────────────────────────────────────

function makeFetchMock(initialUpPorts: number[]) {
  const upPorts = new Set(initialUpPorts);

  // The mock fetch is async but resolves in the same microtask frame, so no
  // real timers are needed — clearTimeout(timer) fires before abort can.
  const mockFetch = vi.fn(async (url: RequestInfo | URL) => {
    const urlStr =
      url instanceof URL ? url.href :
      typeof url === 'string' ? url :
      (url as Request).url;
    const match = urlStr.match(/:(\d+)/);
    const port = match ? parseInt(match[1], 10) : -1;
    if (upPorts.has(port)) {
      return { body: { cancel: async () => {} } } as unknown as Response;
    }
    const err = Object.assign(new Error('ECONNREFUSED'), { name: 'AbortError' });
    throw err;
  }) as unknown as typeof globalThis.fetch;

  return {
    mockFetch,
    bringDown: (port: number) => upPorts.delete(port),
    bringUp:   (port: number) => upPorts.add(port),
  };
}

// ─── Module loader ────────────────────────────────────────────────────────────

type WatcherModule = typeof import('./dev-server-watcher');

async function loadFresh(): Promise<WatcherModule> {
  vi.resetModules();
  return import('./dev-server-watcher');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('dev-server-watcher', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(async () => {
    try {
      // Best-effort cleanup — module may not be loaded if test errored early
      const mod: WatcherModule = await import('./dev-server-watcher');
      mod.stopDevServerWatch();
    } catch { /* ok */ }
    vi.clearAllTimers();
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── Test 1 ────────────────────────────────────────────────────────────────

  it('emits once when a port first becomes reachable', async () => {
    const { mockFetch } = makeFetchMock([5173]);
    globalThis.fetch = mockFetch;

    const { startDevServerWatch } = await loadFresh();
    const win = makeFakeWindow();

    // startDevServerWatch fires the initial tick immediately (void tick())
    // and then sets up a setInterval. We await it so the tick() call is queued.
    await startDevServerWatch(win as any, '/proj/a');

    // Advance by 0 ms — this flushes all pending microtasks (Promise resolutions)
    // from the initial tick() without triggering the interval again.
    await vi.advanceTimersByTimeAsync(0);

    const detected = win.sent.filter(s => s.channel === 'heliox:dev-server-detected');
    expect(detected).toHaveLength(1);
    expect(detected[0].payload).toMatchObject({ url: 'http://localhost:5173', port: 5173 });
  });

  // ── Test 2 ────────────────────────────────────────────────────────────────

  it('does NOT re-emit on subsequent ticks while the port stays up', async () => {
    const { mockFetch } = makeFetchMock([5173]);
    globalThis.fetch = mockFetch;

    const { startDevServerWatch } = await loadFresh();
    const win = makeFakeWindow();

    await startDevServerWatch(win as any, '/proj/b');
    // Flush initial tick
    await vi.advanceTimersByTimeAsync(0);

    // Run 3 poll intervals
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(2500);
    }

    const detected = win.sent.filter(s => s.channel === 'heliox:dev-server-detected');
    // Must still be 1 — never re-emits for the same up port
    expect(detected).toHaveLength(1);
  });

  // ── Test 3 ────────────────────────────────────────────────────────────────

  it('re-emits after a port goes down and comes back up', async () => {
    const { mockFetch, bringDown, bringUp } = makeFetchMock([3000]);
    globalThis.fetch = mockFetch;

    const { startDevServerWatch } = await loadFresh();
    const win = makeFakeWindow();

    await startDevServerWatch(win as any, '/proj/c');
    await vi.advanceTimersByTimeAsync(0);

    // First detection
    expect(win.sent.filter(s => s.channel === 'heliox:dev-server-detected')).toHaveLength(1);

    // Bring port down; tick fires — liveness removed, no emit
    bringDown(3000);
    await vi.advanceTimersByTimeAsync(2500);
    expect(win.sent.filter(s => s.channel === 'heliox:dev-server-detected')).toHaveLength(1);

    // Bring port back up; tick fires — re-detected → second emit
    bringUp(3000);
    await vi.advanceTimersByTimeAsync(2500);

    const detected = win.sent.filter(s => s.channel === 'heliox:dev-server-detected');
    expect(detected).toHaveLength(2);
    expect(detected[1].payload).toMatchObject({ port: 3000 });
  });

  // ── Test 4 ────────────────────────────────────────────────────────────────

  it('handles multiple independent ports in the same poll cycle', async () => {
    const { mockFetch } = makeFetchMock([5173, 3000]);
    globalThis.fetch = mockFetch;

    const { startDevServerWatch } = await loadFresh();
    const win = makeFakeWindow();

    await startDevServerWatch(win as any, '/proj/d');
    await vi.advanceTimersByTimeAsync(0);

    const detected = win.sent.filter(s => s.channel === 'heliox:dev-server-detected');
    expect(detected).toHaveLength(2);
    const ports = detected.map(d => (d.payload as { port: number }).port).sort((a, b) => a - b);
    expect(ports).toEqual([3000, 5173]);
  });

  // ── Test 5 ────────────────────────────────────────────────────────────────

  it('stopDevServerWatch prevents further emissions', async () => {
    const { mockFetch, bringUp } = makeFetchMock([]);
    globalThis.fetch = mockFetch;

    const { startDevServerWatch, stopDevServerWatch } = await loadFresh();
    const win = makeFakeWindow();

    await startDevServerWatch(win as any, '/proj/e');
    await vi.advanceTimersByTimeAsync(0);

    // No ports up
    expect(win.sent.filter(s => s.channel === 'heliox:dev-server-detected')).toHaveLength(0);

    stopDevServerWatch('/proj/e');

    // Bring port up after stop — should never emit
    bringUp(5173);
    await vi.advanceTimersByTimeAsync(2500 * 2);

    expect(win.sent.filter(s => s.channel === 'heliox:dev-server-detected')).toHaveLength(0);
  });
});
