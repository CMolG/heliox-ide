/**
 * snapshot-browser-installer.test.ts — On-demand Chromium download (audit 1.7)
 *
 * `child_process.spawn` is mocked throughout — this suite must never launch a
 * real installer or touch the network. `electron`'s `app` is mocked with a
 * mutable fake so each test controls `isPackaged` and points `getPath` at a
 * real temp directory — isAlreadyInstalled()'s directory-emptiness check runs
 * against real fs calls, which is simpler and more faithful than mocking `fs`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// ─── electron `app` fake ──────────────────────────────────────────────────────

const { fakeApp, setPackaged, setUserDataDir } = vi.hoisted(() => {
  const state = { isPackaged: false, userDataDir: '/nonexistent' };
  const fakeApp = {
    get isPackaged() { return state.isPackaged; },
    getPath: (name: string) => {
      if (name === 'userData') return state.userDataDir;
      throw new Error(`unexpected getPath name in test: ${name}`);
    },
  };
  return {
    fakeApp,
    setPackaged: (value: boolean) => { state.isPackaged = value; },
    setUserDataDir: (dir: string) => { state.userDataDir = dir; },
  };
});

vi.mock('electron', () => ({ app: fakeApp }));

// ─── child_process.spawn fake ────────────────────────────────────────────────

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

const { spawnMock, lastChild } = vi.hoisted(() => {
  let lastChild: FakeChildProcess | null = null;
  const spawnMock = vi.fn((_command: string, _args: string[], _options: unknown) => {
    lastChild = new FakeChildProcess();
    return lastChild;
  });
  return { spawnMock, lastChild: () => lastChild };
});

vi.mock('child_process', () => ({ spawn: spawnMock, default: { spawn: spawnMock } }));

import {
  ensureSnapshotBrowsers,
  isAlreadyInstalled,
  resolvePlaywrightCliEntry,
  snapshotBrowsersDir,
  SnapshotBrowserInstallError,
} from './snapshot-browser-installer';

describe('snapshot-browser-installer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'fluxor-pw-browsers-test-'));
    setPackaged(false);
    setUserDataDir(tempDir);
    spawnMock.mockClear();
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  });

  describe('dev (non-packaged)', () => {
    it('resolves immediately without spawning or touching PLAYWRIGHT_BROWSERS_PATH', async () => {
      setPackaged(false);
      await expect(ensureSnapshotBrowsers()).resolves.toBeUndefined();
      expect(spawnMock).not.toHaveBeenCalled();
      expect(process.env.PLAYWRIGHT_BROWSERS_PATH).toBeUndefined();
    });
  });

  describe('packaged — already installed', () => {
    it('resolves without spawning when the target directory is non-empty', async () => {
      setPackaged(true);
      const browsersDir = snapshotBrowsersDir();
      // Simulate a prior successful install.
      mkdirSync(browsersDir, { recursive: true });
      writeFileSync(path.join(browsersDir, 'chromium-1234'), 'stub');

      await expect(ensureSnapshotBrowsers()).resolves.toBeUndefined();
      expect(spawnMock).not.toHaveBeenCalled();
      expect(process.env.PLAYWRIGHT_BROWSERS_PATH).toBe(browsersDir);
    });
  });

  describe('packaged — missing, spawns the installer', () => {
    it('spawns process.execPath with ELECTRON_RUN_AS_NODE=1 and the resolved playwright-core CLI, install chromium', async () => {
      setPackaged(true);
      const browsersDir = snapshotBrowsersDir();
      const progress: string[] = [];

      const resultPromise = ensureSnapshotBrowsers((msg) => progress.push(msg));

      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [command, args, options] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string> }];
      expect(command).toBe(process.execPath);
      expect(args[0]).toBe(resolvePlaywrightCliEntry());
      expect(args.slice(1)).toEqual(['install', 'chromium']);
      expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1');
      expect(options.env.PLAYWRIGHT_BROWSERS_PATH).toBe(browsersDir);
      expect(progress).toContain('Downloading Chromium for snapshot runs (one-time)…');

      // Simulate the installer's real side effect (it would have downloaded
      // Chromium into this directory) before signalling process exit.
      mkdirSync(browsersDir, { recursive: true });
      writeFileSync(path.join(browsersDir, 'chromium-1234'), 'stub');
      const child = lastChild();
      child?.stdout.emit('data', Buffer.from('Downloading Chromium 120.0...\n'));
      child?.emit('close', 0);

      await expect(resultPromise).resolves.toBeUndefined();
      expect(isAlreadyInstalled(browsersDir)).toBe(true);
      expect(progress).toContain('Snapshot browser ready.');
    });

    it('rejects with a typed, retry-guidance error when the installer exits non-zero (offline)', async () => {
      setPackaged(true);
      const resultPromise = ensureSnapshotBrowsers();
      const child = lastChild();
      child?.stderr.emit('data', Buffer.from('net::ERR_INTERNET_DISCONNECTED\n'));
      child?.emit('close', 1);

      await expect(resultPromise).rejects.toBeInstanceOf(SnapshotBrowserInstallError);
      await expect(resultPromise).rejects.toThrow(/one-time browser download/i);
      await expect(resultPromise).rejects.toThrow(/internet connection/i);
    });

    it('rejects with a typed error when the child process itself fails to launch', async () => {
      setPackaged(true);
      const resultPromise = ensureSnapshotBrowsers();
      const child = lastChild();
      child?.emit('error', new Error('ENOENT'));

      await expect(resultPromise).rejects.toBeInstanceOf(SnapshotBrowserInstallError);
    });

    it('dedupes concurrent calls onto a single in-flight install', async () => {
      setPackaged(true);
      const browsersDir = snapshotBrowsersDir();

      const first = ensureSnapshotBrowsers();
      const second = ensureSnapshotBrowsers();
      expect(spawnMock).toHaveBeenCalledTimes(1);

      mkdirSync(browsersDir, { recursive: true });
      writeFileSync(path.join(browsersDir, 'chromium-1234'), 'stub');
      lastChild()?.emit('close', 0);

      await expect(first).resolves.toBeUndefined();
      await expect(second).resolves.toBeUndefined();
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('allows a fresh install attempt after a prior failure (in-flight guard clears)', async () => {
      setPackaged(true);
      const failed = ensureSnapshotBrowsers();
      lastChild()?.emit('close', 1);
      await expect(failed).rejects.toBeInstanceOf(SnapshotBrowserInstallError);

      const browsersDir = snapshotBrowsersDir();
      const retried = ensureSnapshotBrowsers();
      expect(spawnMock).toHaveBeenCalledTimes(2);
      mkdirSync(browsersDir, { recursive: true });
      writeFileSync(path.join(browsersDir, 'chromium-1234'), 'stub');
      lastChild()?.emit('close', 0);
      await expect(retried).resolves.toBeUndefined();
    });
  });

  describe('isAlreadyInstalled', () => {
    it('is false for a missing directory and true once it has any entry', () => {
      const dir = path.join(tempDir, 'pw-browsers');
      expect(isAlreadyInstalled(dir)).toBe(false);
      mkdirSync(dir, { recursive: true });
      expect(isAlreadyInstalled(dir)).toBe(false);
      writeFileSync(path.join(dir, 'marker'), '');
      expect(isAlreadyInstalled(dir)).toBe(true);
    });
  });

  describe('resolvePlaywrightCliEntry', () => {
    it('resolves to a real, existing file inside the installed playwright-core package', () => {
      const cliEntry = resolvePlaywrightCliEntry();
      expect(cliEntry.endsWith('cli.js')).toBe(true);
      expect(cliEntry).toContain('playwright-core');
      expect(existsSync(cliEntry)).toBe(true);
    });
  });
});
