/**
 * ipc-worktrees.ts — IPC surface for session worktrees (Cockpit F2)
 *
 * Responsibility:
 * - Exposes the worktree manager and the bootstrap step to the renderer:
 *   list / create / spent / remove, plus detect / set / run for bootstrap.
 * - Pushes `fluxor:worktree-progress` while a bootstrap runs, so the session's
 *   terminal shows the install as it happens instead of after it.
 *
 * Boundaries:
 * - Owns: channel names, payload validation, turning a git failure into a
 *   VALUE the window can render.
 * - Does NOT own: git argv (worktree-manager.ts), the bootstrap command table
 *   (bootstrap.ts), or where a project's config directory is (ipc-handlers.ts).
 *
 * Architectural role:
 * - Registered from `src/main/index.ts` next to `registerPtyIpcHandlers`.
 *
 * Why failures come back as values: every one of these operations fails for
 * ORDINARY reasons — a branch that already exists somewhere else, a detached
 * HEAD, no network for the fetch, a worktree someone deleted by hand. A
 * rejected `invoke` reaches the renderer as an opaque `Error: Error invoking
 * remote method`, which is the one shape a session window cannot explain to
 * anyone. Same reasoning as `vendor_not_found` in ipc-pty.ts.
 */
import { ipcMain, type BrowserWindow } from 'electron';
import { getProjectConfigDir } from '../ipc-handlers';
import {
  WorktreeManager,
  type CreatedWorktree,
  type SpentVerdict,
  type WorktreeInfo,
} from './worktree-manager';
import {
  resolveBootstrap,
  runBootstrap,
  writeBootstrapOverride,
  type BootstrapResolution,
  type BootstrapRunResult,
} from './bootstrap';
import { seedCardIntoWorktree, type SeedCardResult } from './seed-card';

export interface GitFailed {
  error: 'git_failed';
  message: string;
  stderr: string;
}

export type WorktreeListResult = WorktreeInfo[] | GitFailed;
export type WorktreeCreateResult = CreatedWorktree | GitFailed;
export type WorktreeSpentResult = SpentVerdict | GitFailed;
export type WorktreeRemoveResult = { success: true } | GitFailed;
export type BootstrapRunIpcResult = BootstrapRunResult | GitFailed;
export type WorktreeSeedCardResult = SeedCardResult | GitFailed;

export interface WorktreeProgressEvent {
  worktreePath: string;
  line: string;
}

/** The one place an exception becomes a renderable answer. */
function asGitFailed(err: unknown): GitFailed {
  const e = err as { message?: string; stderr?: string };
  return {
    error: 'git_failed',
    message: e?.message ?? String(err),
    stderr: (e?.stderr ?? '').trim(),
  };
}

async function attempt<T>(fn: () => Promise<T>): Promise<T | GitFailed> {
  try {
    return await fn();
  } catch (err) {
    return asGitFailed(err);
  }
}

let manager: WorktreeManager | null = null;

function getManager(): WorktreeManager {
  manager ??= new WorktreeManager({});
  return manager;
}

/**
 * Registration is idempotent, and the window it pushes to is a variable rather
 * than a closed-over constant: on macOS `app.on('activate')` calls
 * `createWindow()` again after every window has been closed, which runs every
 * registrar a second time. `ipcMain.handle` throws on a duplicate channel, so
 * without this the second call would take the app down — and a second
 * registration that quietly kept pushing at the DESTROYED window would be
 * worse, because nothing would say why the terminal had gone silent.
 */
let registered = false;
let targetWindow: BrowserWindow | null = null;

export function registerWorktreeIpcHandlers(mainWindow: BrowserWindow): void {
  const mgr = getManager();
  targetWindow = mainWindow;
  if (registered) return;
  registered = true;

  const push = (channel: string, payload: unknown) => {
    if (!targetWindow || targetWindow.isDestroyed()) return;
    targetWindow.webContents.send(channel, payload);
  };

  ipcMain.handle('fluxor:worktree-list', async (_e, projectRoot: string): Promise<WorktreeListResult> =>
    attempt(() => mgr.list(projectRoot)));

  ipcMain.handle(
    'fluxor:worktree-create',
    async (_e, req: { projectRoot: string; name: string; branch: string }): Promise<WorktreeCreateResult> =>
      attempt(() => mgr.create(req)),
  );

  ipcMain.handle('fluxor:worktree-spent', async (_e, worktreePath: string): Promise<WorktreeSpentResult> =>
    attempt(() => mgr.detectSpent(worktreePath)));

  ipcMain.handle(
    'fluxor:worktree-remove',
    async (_e, worktreePath: string, force?: boolean): Promise<WorktreeRemoveResult> => {
      const out = await attempt(async () => {
        await mgr.remove(worktreePath, { force: !!force });
        return { success: true } as const;
      });
      return out;
    },
  );

  /**
   * F5 — the card the worktree was cut without.
   *
   * Between `worktree-create` and the bootstrap, because the launch prompt's
   * very first instruction is to read that file: a session that starts without
   * it starts by improvising. Sits here rather than inside `worktree-create`
   * because a worktree opened from the dock carries no card at all, and
   * `create` must not learn what a card is to serve it.
   */
  ipcMain.handle(
    'fluxor:worktree-seed-card',
    async (_e, worktreePath: string, backlogDir: string, filename: string): Promise<WorktreeSeedCardResult> =>
      attempt(() => seedCardIntoWorktree(worktreePath, backlogDir, filename)),
  );

  ipcMain.handle('fluxor:bootstrap-detect', async (_e, projectRoot: string): Promise<BootstrapResolution> =>
    resolveBootstrap(projectRoot, getProjectConfigDir(projectRoot)));

  ipcMain.handle(
    'fluxor:bootstrap-set',
    async (_e, projectRoot: string, command: string | null): Promise<{ success: boolean }> => {
      await writeBootstrapOverride(getProjectConfigDir(projectRoot), command);
      return { success: true };
    },
  );

  /**
   * Runs the EFFECTIVE command, and a project with none is a success in zero
   * milliseconds — not an error, and not a reason to block the session. That
   * is the whole answer for a repository with no lockfile.
   */
  ipcMain.handle(
    'fluxor:bootstrap-run',
    async (_e, worktreePath: string, projectRoot: string): Promise<BootstrapRunIpcResult> => {
      const { effective } = await resolveBootstrap(projectRoot, getProjectConfigDir(projectRoot));
      if (!effective) return { exitCode: 0, durationMs: 0 };
      return runBootstrap(worktreePath, effective, (line) => {
        push('fluxor:worktree-progress', { worktreePath, line } satisfies WorktreeProgressEvent);
      });
    },
  );
}
