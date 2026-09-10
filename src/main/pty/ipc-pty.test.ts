/**
 * ipc-pty.test.ts — The one-attached-session-per-project rule
 *
 * `canOpenAttached` is the whole of decision 3's "attached" half, and it is
 * pure precisely so it can be pinned here rather than by opening two terminals
 * and watching which one corrupts the other's git index.
 *
 * What is pinned:
 *   1. The rule is per PROJECT, not per directory and not global.
 *   2. Worktree sessions never count — that is the point of them.
 *   3. The refusal carries the id of the session in the way, because the window
 *      has to be able to name it instead of printing "already exists".
 *
 * `electron` is stubbed: this file imports the IPC module for one pure
 * function, and `app`/`ipcMain` must not be touched to get at it. `node-pty`
 * is never reached — the manager behind it is a lazy singleton for exactly
 * this reason (see the module's own header).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/fluxor-test' },
  ipcMain: { handle: vi.fn() },
}));

import { canOpenAttached, type LiveSessionEntry } from './ipc-pty';

const attached = (sessionId: string, projectRoot: string): LiveSessionEntry =>
  ({ sessionId, projectRoot, mode: 'attached' });
const worktree = (sessionId: string, projectRoot: string): LiveSessionEntry =>
  ({ sessionId, projectRoot, mode: 'worktree' });

describe('canOpenAttached', () => {
  it('allows the first attached session on a project', () => {
    expect(canOpenAttached([], '/repo/javadaba-web')).toEqual({ ok: true });
  });

  it('refuses the second one, and names the session already in the way', () => {
    expect(canOpenAttached([attached('s1', '/repo/javadaba-web')], '/repo/javadaba-web'))
      .toEqual({ ok: false, sessionId: 's1' });
  });

  it('is per project — another repository is not the same working tree', () => {
    expect(canOpenAttached([attached('s1', '/repo/javadaba-web')], '/repo/heliox-ide'))
      .toEqual({ ok: true });
  });

  it('does not count worktree sessions, however many there are', () => {
    const live = [
      worktree('w1', '/repo/javadaba-web'),
      worktree('w2', '/repo/javadaba-web'),
      worktree('w3', '/repo/javadaba-web'),
    ];
    expect(canOpenAttached(live, '/repo/javadaba-web')).toEqual({ ok: true });
  });

  it('finds the attached one among a crowd of worktrees', () => {
    const live = [
      worktree('w1', '/repo/javadaba-web'),
      attached('a1', '/repo/javadaba-web'),
      worktree('w2', '/repo/javadaba-web'),
    ];
    expect(canOpenAttached(live, '/repo/javadaba-web')).toEqual({ ok: false, sessionId: 'a1' });
  });

  it('reads the values of a live Map, which is the shape the handler passes it', () => {
    const map = new Map<string, LiveSessionEntry>([['s1', attached('s1', '/repo/x')]]);
    expect(canOpenAttached(map.values(), '/repo/x')).toEqual({ ok: false, sessionId: 's1' });
    map.delete('s1');
    expect(canOpenAttached(map.values(), '/repo/x')).toEqual({ ok: true });
  });
});

// ─── F4: the launch arguments that arm the attention hooks ──────────────────

/**
 * `hookArgsFor` is the seam between the endpoint and the spawn, and the two
 * things it can get wrong are invisible from outside: a `--session-id` the CLI
 * refuses (it demands a UUID), and hooks silently armed for a vendor that runs
 * none.
 *
 * The endpoint module is mocked rather than started: what is under test here
 * is the DECISION, not the server, which has its own suite next door.
 */
vi.mock('../cockpit/hook-endpoint', () => ({
  hookEndpointPort: vi.fn(() => 45001),
  issueHookToken: vi.fn(() => 'a'.repeat(32)),
  revokeHookToken: vi.fn(),
  hookSettingsFor: (sessionId: string, token: string, port: number) =>
    JSON.stringify({ sessionId, token, port }),
}));

import { hookArgsFor } from './ipc-pty';
import { hookEndpointPort, issueHookToken } from '../cockpit/hook-endpoint';

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('hookArgsFor', () => {
  it('arms claude with its session id and an inline --settings', () => {
    const { extraArgs, hooksArmed } = hookArgsFor('claude', UUID);
    expect(hooksArmed).toBe(true);
    expect(extraArgs).toEqual(['--session-id', UUID, '--settings', JSON.stringify({
      sessionId: UUID, token: 'a'.repeat(32), port: 45001,
    })]);
  });

  it('skips --session-id when the id is not a UUID, and still arms the hooks', () => {
    // The CLI refuses a non-UUID outright, and it costs nothing to omit: every
    // event is attributed by the URL path the token is bound to.
    const { extraArgs, hooksArmed } = hookArgsFor('claude', 'e2e-1');
    expect(hooksArmed).toBe(true);
    expect(extraArgs[0]).toBe('--settings');
    expect(extraArgs).not.toContain('--session-id');
  });

  it('arms nothing for the vendors that run no hooks — and mints no secret', () => {
    vi.mocked(issueHookToken).mockClear();
    for (const vendor of ['codex', 'opencode', 'gemini'] as const) {
      expect(hookArgsFor(vendor, UUID)).toEqual({ extraArgs: [], hooksArmed: false });
    }
    // A token for a session that will never present one is a live secret with
    // no owner: nothing revokes it, because nothing knows it exists.
    expect(issueHookToken).not.toHaveBeenCalled();
  });

  it('arms nothing when the endpoint never bound a port', () => {
    vi.mocked(hookEndpointPort).mockReturnValueOnce(null);
    expect(hookArgsFor('claude', UUID)).toEqual({ extraArgs: [], hooksArmed: false });
  });
});
