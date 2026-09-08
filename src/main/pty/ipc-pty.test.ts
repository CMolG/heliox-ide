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
