/**
 * pty-manager.test.ts — Unit tests for the live-session manager
 *
 * What is pinned here:
 *   1. `data` and `exit` are re-emitted with their sessionId attached.
 *   2. Every byte of output reaches `<sessionsDir>/<sessionId>.log`.
 *   3. Spawning an already-live sessionId throws (two CLIs on one window is
 *      the failure this class exists to prevent).
 *   4. An exited session leaves the live table, so its id is reusable.
 *   5. `disposeAll` kills everything — the app's `will-quit` contract.
 *   6. `resize` clamps a 0x0 geometry instead of handing it to node-pty.
 *
 * Mocking strategy: the spawn function is INJECTED, so this file never loads
 * the native module. The fake PTY records what it was given and lets a test
 * push data/exit at will.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PtyManager, type PtySpawnFn } from './pty-manager';

// ─── Fake PTY ────────────────────────────────────────────────────────────────

interface FakePty {
  pid: number;
  written: string[];
  resized: Array<[number, number]>;
  killed: Array<string | undefined>;
  emitData(data: string): void;
  emitExit(exitCode: number, signal?: number): void;
}

interface SpawnCall {
  file: string;
  args: string[];
  options: { cwd: string; cols: number; rows: number; env: Record<string, string> };
  pty: FakePty;
}

function makeFakeSpawn() {
  const calls: SpawnCall[] = [];
  let nextPid = 1000;

  const spawn = ((file: string, args: string[], options: SpawnCall['options']) => {
    let onData: (d: string) => void = () => { /* not wired yet */ };
    let onExit: (e: { exitCode: number; signal?: number }) => void = () => { /* not wired yet */ };

    const pty: FakePty = {
      pid: nextPid++,
      written: [],
      resized: [],
      killed: [],
      emitData: (d) => onData(d),
      emitExit: (exitCode, signal) => onExit({ exitCode, signal }),
    };

    calls.push({ file, args, options, pty });

    return {
      pid: pty.pid,
      onData: (cb: (d: string) => void) => { onData = cb; return { dispose() { /* noop */ } }; },
      onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => { onExit = cb; return { dispose() { /* noop */ } }; },
      write: (d: string) => { pty.written.push(d); },
      resize: (c: number, r: number) => { pty.resized.push([c, r]); },
      kill: (s?: string) => { pty.killed.push(s); },
    };
  }) as unknown as PtySpawnFn;

  return { spawn, calls };
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

let sessionsDir: string;

beforeEach(() => {
  sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pty-manager-test-'));
});

afterEach(() => {
  fs.rmSync(sessionsDir, { recursive: true, force: true });
});

function baseRequest(sessionId = 's1') {
  return { sessionId, command: '/bin/echo', args: ['hi'], cwd: '/tmp', cols: 80, rows: 24 };
}

/** The log stream is async; give the event loop a turn before reading it. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PtyManager.spawn', () => {
  it('returns the session info and registers it as live', () => {
    const { spawn, calls } = makeFakeSpawn();
    const mgr = new PtyManager({ spawn, sessionsDir });

    const info = mgr.spawn(baseRequest());

    expect(info.sessionId).toBe('s1');
    expect(info.pid).toBe(calls[0].pty.pid);
    expect(info.exitCode).toBeNull();
    expect(info.logPath).toBe(path.join(sessionsDir, 's1.log'));
    expect(mgr.get('s1')?.pid).toBe(info.pid);
    expect(mgr.list().map((s) => s.sessionId)).toEqual(['s1']);
  });

  it('forces a real terminal type regardless of the parent process env', () => {
    const { spawn, calls } = makeFakeSpawn();
    new PtyManager({ spawn, sessionsDir }).spawn(baseRequest());
    expect(calls[0].options.env.TERM).toBe('xterm-256color');
    expect(calls[0].options.env.COLORTERM).toBe('truecolor');
  });

  it("lets an explicit request env override the defaults", () => {
    const { spawn, calls } = makeFakeSpawn();
    new PtyManager({ spawn, sessionsDir }).spawn({ ...baseRequest(), env: { TERM: 'vt100' } });
    expect(calls[0].options.env.TERM).toBe('vt100');
  });

  it('throws rather than starting a second CLI on a live sessionId', () => {
    const { spawn } = makeFakeSpawn();
    const mgr = new PtyManager({ spawn, sessionsDir });
    mgr.spawn(baseRequest());
    expect(() => mgr.spawn(baseRequest())).toThrow(/already running/i);
  });

  it('creates the sessions directory on demand', () => {
    const nested = path.join(sessionsDir, 'does', 'not', 'exist');
    const { spawn } = makeFakeSpawn();
    new PtyManager({ spawn, sessionsDir: nested }).spawn(baseRequest());
    expect(fs.existsSync(nested)).toBe(true);
  });
});

describe('PtyManager events', () => {
  it('re-emits data with its sessionId and appends it to the log', async () => {
    const { spawn, calls } = makeFakeSpawn();
    const mgr = new PtyManager({ spawn, sessionsDir });
    const seen: unknown[] = [];
    mgr.on('data', (e) => seen.push(e));

    mgr.spawn(baseRequest());
    calls[0].pty.emitData('hello ');
    calls[0].pty.emitData('world');
    await flush();

    expect(seen).toEqual([
      { sessionId: 's1', data: 'hello ' },
      { sessionId: 's1', data: 'world' },
    ]);
    expect(fs.readFileSync(path.join(sessionsDir, 's1.log'), 'utf-8')).toBe('hello world');
  });

  it('emits exit, records the code, and frees the id for reuse', async () => {
    const { spawn, calls } = makeFakeSpawn();
    const mgr = new PtyManager({ spawn, sessionsDir });
    const exits: unknown[] = [];
    mgr.on('exit', (e) => exits.push(e));

    mgr.spawn(baseRequest());
    calls[0].pty.emitExit(3, 0);
    await flush();

    expect(exits).toEqual([{ sessionId: 's1', exitCode: 3, signal: 0 }]);
    // Gone from the live table — which is exactly how a rehydrated window
    // learns that its persisted session is dead.
    expect(mgr.get('s1')).toBeUndefined();
    expect(mgr.list()).toEqual([]);
    expect(() => mgr.spawn(baseRequest())).not.toThrow();
  });

  it('keeps two sessions independent', async () => {
    const { spawn, calls } = makeFakeSpawn();
    const mgr = new PtyManager({ spawn, sessionsDir });
    const seen: Array<{ sessionId: string }> = [];
    mgr.on('data', (e) => seen.push(e));

    mgr.spawn(baseRequest('a'));
    mgr.spawn(baseRequest('b'));
    calls[1].pty.emitData('from-b');
    await flush();

    expect(seen).toEqual([{ sessionId: 'b', data: 'from-b' }]);
    expect(fs.readFileSync(path.join(sessionsDir, 'b.log'), 'utf-8')).toBe('from-b');
    expect(fs.readFileSync(path.join(sessionsDir, 'a.log'), 'utf-8')).toBe('');
  });
});

describe('PtyManager write / resize / kill', () => {
  it('writes to the addressed session and ignores an unknown one', () => {
    const { spawn, calls } = makeFakeSpawn();
    const mgr = new PtyManager({ spawn, sessionsDir });
    mgr.spawn(baseRequest());

    mgr.write('s1', 'ls\r');
    expect(() => mgr.write('nope', 'x')).not.toThrow();
    expect(calls[0].pty.written).toEqual(['ls\r']);
  });

  it('clamps a zero geometry — a hidden window measures 0x0 and node-pty throws on it', () => {
    const { spawn, calls } = makeFakeSpawn();
    const mgr = new PtyManager({ spawn, sessionsDir });
    mgr.spawn(baseRequest());

    mgr.resize('s1', 0, 0);
    mgr.resize('s1', 120.7, 40.2);
    expect(calls[0].pty.resized).toEqual([[1, 1], [120, 40]]);
  });

  it('kills the addressed session, passing the signal through', () => {
    const { spawn, calls } = makeFakeSpawn();
    const mgr = new PtyManager({ spawn, sessionsDir });
    mgr.spawn(baseRequest());

    mgr.kill('s1', 'SIGKILL');
    expect(calls[0].pty.killed).toEqual(['SIGKILL']);
  });
});

describe('PtyManager.disposeAll', () => {
  it('kills every live session', () => {
    const { spawn, calls } = makeFakeSpawn();
    const mgr = new PtyManager({ spawn, sessionsDir });
    mgr.spawn(baseRequest('a'));
    mgr.spawn(baseRequest('b'));

    mgr.disposeAll();

    expect(calls[0].pty.killed).toHaveLength(1);
    expect(calls[1].pty.killed).toHaveLength(1);
  });

  it('does not abort halfway when one kill throws', () => {
    const { spawn, calls } = makeFakeSpawn();
    const mgr = new PtyManager({ spawn, sessionsDir });
    mgr.spawn(baseRequest('a'));
    mgr.spawn(baseRequest('b'));
    const first = calls[0].pty;
    vi.spyOn(mgr, 'kill').mockImplementationOnce(() => { throw new Error('already dead'); });

    expect(() => mgr.disposeAll()).not.toThrow();
    // The second session was still reached.
    expect(calls[1].pty.killed).toHaveLength(1);
    expect(first.killed).toHaveLength(0);
  });
});
