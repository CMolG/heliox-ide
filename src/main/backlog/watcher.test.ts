// src/main/backlog/watcher.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

interface SendCall { channel: string; payload: unknown }
function makeFakeWindow() {
  const sent: SendCall[] = [];
  return { isDestroyed: () => false, webContents: { send: (c: string, p: unknown) => { sent.push({ channel: c, payload: p }); } }, on: () => {}, sent };
}

describe('backlog watcher', () => {
  let fakeWatch: ReturnType<typeof vi.fn>;
  let watchCallback: ((eventType: string, filename: string | null) => void) | null;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    watchCallback = null;
    fakeWatch = vi.fn((_dir: string, cb: typeof watchCallback) => {
      watchCallback = cb;
      return { close: vi.fn() };
    });
    // NOTE (deviation from plan text, flagged in the F1 implementation report):
    // Vitest v4's module mocker wraps each `vi.doMock` factory's return value
    // in a strict Proxy that throws on ANY accessed property absent from the
    // object (only `__esModule` + well-known symbols are exempt — see
    // node_modules/vitest/dist/chunks/startVitestModuleRunner.*.js
    // `callFunctionMock`). Vite's SSR loader probes `.default` for CJS
    // interop when resolving Node built-ins ('fs', 'fs/promises'), so a mock
    // shaped as just `{ watch: fakeWatch }` throws "No \"default\" export is
    // defined on the \"fs\" mock" the instant watcher.ts's top-level import
    // runs — before any test body executes. Mirroring `default` onto the same
    // object (matching real Node builtin ESM interop shape) is the minimal
    // fix; it changes no assertion and no behavior under test.
    const fsImpl = { watch: fakeWatch };
    vi.doMock('fs', () => ({ ...fsImpl, default: fsImpl }));
    vi.doMock('./frontmatter', () => ({
      parseBacklogCard: vi.fn(async (filePath: string) => ({ filename: filePath.split('/').pop(), title: 'x' })),
    }));
    // `readdir` alone matches the plan's given mock; `readFile` is added
    // because `readAllCards`'s per-entry `await import('fs/promises')` also
    // resolves against this SAME mock and calls `readFile(filePath, 'utf-8')`
    // before handing content to the (separately mocked, content-agnostic)
    // `parseBacklogCard` — without it, `readFile` is `undefined`, the call
    // throws inside the per-entry try/catch, and the card is silently
    // dropped (deviation flagged above applies here too).
    const fsPromisesImpl = { readdir: vi.fn(async () => ['a.md']), readFile: vi.fn(async () => 'mock content') };
    vi.doMock('fs/promises', () => ({ ...fsPromisesImpl, default: fsPromisesImpl }));
  });

  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('debounces multiple fs events into a single push', async () => {
    const { startBacklogWatch } = await import('./watcher');
    const win = makeFakeWindow();
    await startBacklogWatch(win as any, '/proj/.backlog', '/proj');

    watchCallback?.('change', 'a.md');
    watchCallback?.('change', 'a.md');
    watchCallback?.('rename', 'a.md');
    await vi.advanceTimersByTimeAsync(400);

    const pushes = win.sent.filter(s => s.channel === 'fluxor:backlog-changed');
    expect(pushes.length).toBe(1);
    expect((pushes[0].payload as any).backlogDir).toBe('/proj/.backlog');
    expect((pushes[0].payload as any).cards).toHaveLength(1);
  });

  it('stopBacklogWatch prevents further pushes', async () => {
    const { startBacklogWatch, stopBacklogWatch } = await import('./watcher');
    const win = makeFakeWindow();
    await startBacklogWatch(win as any, '/proj/.backlog', '/proj');
    stopBacklogWatch('/proj/.backlog');

    watchCallback?.('change', 'a.md');
    await vi.advanceTimersByTimeAsync(400);

    expect(win.sent.filter(s => s.channel === 'fluxor:backlog-changed')).toHaveLength(0);
  });
});
