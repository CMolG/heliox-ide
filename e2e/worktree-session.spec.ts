/**
 * worktree-session.spec.ts — End-to-end proof of the F2 chain, on real git
 *
 * F1's spec proved a PTY runs in a window. This one proves the three steps in
 * FRONT of it, against a repository this test creates: renderer →
 * `fluxor:worktree-create` → a real `git worktree add` on disk → the bootstrap
 * step (a no-op here: no lockfile, so the effective command is `null`) → the
 * PTY spawning INSIDE that worktree → the spent verdict when it ends → and
 * `git worktree remove` taking the directory away while the branch survives.
 *
 * The repository is temporary and has no remote: `defaultBaseRef` falls back to
 * the local `main`, and `gh` cannot answer, which is exactly the "unknown, not
 * no" case the verdict has to survive.
 *
 * How the worktree is made SPENT before the session ends: an empty commit on
 * its branch. That is the squash-merge shape in miniature — the content is
 * already in the base (`git diff --quiet main HEAD` passes) while the commit
 * is not one of the base's ancestors — and it is the only state in which the
 * removal is offered at all.
 *
 * The agent is `e2e/fixtures/fake-agent.sh`, pointed at through
 * `FLUXOR_AGENT_BIN_CLAUDE` — no LLM, no network, no login.
 *
 * NOTE (from F1, still true): after touching `src/main` or `src/preload`, the
 * e2e main/preload bundles must be rebuilt or this suite tests an old one.
 */
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getElectronLaunchArgs, getE2EEnv } from './test-helpers';

const REPO_ROOT = path.join(__dirname, '..');
const FAKE_AGENT = path.join(__dirname, 'fixtures', 'fake-agent.sh');

const WORKTREE_NAME = 'e2e-session';
const BRANCH = 'cockpit/e2e-session';

let app: ElectronApplication;
let page: Page;
/** The project the session runs against — created here, deleted in afterAll. */
let project: string;
let worktreePath: string;

/** Hermetic: the machine's own git config cannot change what this repo does. */
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd, env: GIT_ENV, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

test.beforeAll(async () => {
  // `realpathSync` because git reports resolved paths and macOS's tmpdir is a
  // symlink — without it every path comparison below would be off by /private.
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fluxor-e2e-project-')));
  worktreePath = path.join(project, '.claude', 'worktrees', WORKTREE_NAME);

  execFileSync('git', ['init', '-b', 'main', project], { env: GIT_ENV, stdio: 'ignore' });
  git(project, 'config', 'user.email', 'cockpit@example.test');
  git(project, 'config', 'user.name', 'Cockpit E2E');
  git(project, 'config', 'commit.gpgsign', 'false');
  // No lockfile on purpose: `detectBootstrapCommand` answers null, so the
  // bootstrap step is a real no-op rather than an install this test waits for.
  fs.writeFileSync(path.join(project, 'README.md'), '# e2e fixture\n');
  git(project, 'add', '-A');
  git(project, 'commit', '-m', 'first');

  app = await electron.launch({
    args: getElectronLaunchArgs(),
    cwd: REPO_ROOT,
    env: {
      ...getE2EEnv(),
      FLUXOR_AGENT_BIN_CLAUDE: FAKE_AGENT,
    },
    timeout: 30_000,
  });

  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await page.waitForFunction(
    () => !!(window as any).__FLUXOR_STORE__ && !!(window as any).__DESKTOP_STORE__,
    { timeout: 15_000 },
  );

  // App.tsx renders a project picker instead of the desktop while no project is
  // open, so there would be no canvas to mount a window into. The session's own
  // projectRoot is the temporary repository, independently of this.
  await page.evaluate((root) => {
    (window as any).__FLUXOR_STORE__?.getState().setProjectPath(root);
  }, REPO_ROOT);
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    (window as any).__DESKTOP_STORE__?.getState().updateSettings({ tourCompleted: true });
  });
});

test.afterAll(async () => {
  if (app) await app.close();
  // Nothing this test made outlives it — not in the tree, not in tmp.
  if (project) fs.rmSync(project, { recursive: true, force: true });
});

test('creates a worktree, runs the agent inside it, and removes it when it is spent', async () => {
  // The window id comes back so every locator below can be SCOPED to it. The
  // e2e userData directory is shared by the whole run and the desktop store
  // persists its windows there, so a session window opened by an earlier spec
  // is still on the canvas when this one starts — an unscoped
  // `getByTestId('agent-session-terminal')` matches both and fails on strict
  // mode, which is a test-isolation bug rather than a product one.
  const windowId = await page.evaluate(({ projectRoot, name, branch }) => {
    const ds = (window as any).__DESKTOP_STORE__;
    return ds.getState().addWindow('agent-session', {
      title: 'E2E worktree session',
      iconName: 'Terminal',
      size: { width: 760, height: 520 },
      agentSession: {
        sessionId: 'e2e-wt-1',
        vendor: 'claude',
        cwd: projectRoot,
        projectRoot,
        mode: 'worktree',
        worktreeName: name,
        branch,
        launchedAt: Date.now(),
        ptyStarted: false,
        attention: 'preparing',
      },
    });
  }, { projectRoot: project, name: WORKTREE_NAME, branch: BRANCH });

  const win = page.getByTestId(`desktop-window-${windowId}`);
  const terminal = win.getByTestId('agent-session-terminal');
  await expect(terminal).toBeVisible({ timeout: 10_000 });

  // 1. The worktree step announces itself in the session's own terminal — the
  //    terminal is the log surface, from `git worktree add` to the last line.
  await expect(terminal).toContainText('preparing worktree', { timeout: 20_000 });

  // 2. The agent only starts once the worktree is ready, and it starts in it.
  await expect(terminal).toContainText('FAKE AGENT READY', { timeout: 20_000 });
  await expect(win.getByTestId('agent-session-status')).toHaveText('running', { timeout: 10_000 });

  // 3. On disk, this is a real git worktree on a real branch.
  expect(fs.existsSync(worktreePath)).toBe(true);
  expect(git(project, 'worktree', 'list')).toContain(BRANCH);
  expect(git(worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH);
  // And the checkout does not show up as a change in the project.
  expect(git(project, 'status', '--porcelain')).toBe('');

  // 4. Make it spent: a commit whose content is already in the base. This is
  //    what a squash-merged branch looks like from the worktree's side.
  git(worktreePath, 'commit', '--allow-empty', '-m', 'shipped elsewhere');

  // 5. End the session through the terminal, the way a person would.
  await terminal.click();
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');

  await expect(win.getByTestId('agent-session-status')).toHaveText('ended · exit 0', { timeout: 15_000 });

  // 6. The window states the worktree's verdict in words, not in colour.
  const worktreeLine = win.getByTestId('agent-session-worktree');
  await expect(worktreeLine).toContainText(`worktree ${BRANCH} · spent · clean`, { timeout: 15_000 });

  // 7. Removing it takes two clicks, like ending a session does.
  const remove = win.getByTestId('agent-session-remove-worktree');
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(remove).toContainText('Confirm remove?');
  await remove.click();

  await expect(worktreeLine).toContainText('worktree removed', { timeout: 15_000 });
  await expect.poll(() => fs.existsSync(worktreePath), { timeout: 10_000 }).toBe(false);

  // 8. The directory is gone; the branch — the only remaining copy of anything
  //    unpushed — is not.
  expect(git(project, 'worktree', 'list')).not.toContain(worktreePath);
  expect(git(project, 'branch', '--list', BRANCH)).toContain(BRANCH);
});
