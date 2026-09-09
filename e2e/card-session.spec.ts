/**
 * card-session.spec.ts — End-to-end proof that a CARD runs an agent (Cockpit F3)
 *
 * F1 proved a PTY runs in a window; F2 proved a worktree is cut in front of it.
 * This one proves the chain that makes the Cockpit a harness rather than a
 * terminal: a card on the board opens a session, the session's prompt actually
 * reaches the agent's argv, and what the agent leaves behind on the card comes
 * back to the file on disk.
 *
 * What is asserted against REALITY rather than against a mock:
 *  - the launch prompt arrives in argv (the fixture prints `ARGS:`, which is
 *    the only way to tell "the prompt was built" from "the prompt was passed");
 *  - `runState: running` lands in the .md file once the process is really up;
 *  - on exit, the card's own `status` — not the exit code — decides `completed`
 *    against `failed`, and a `failed` one carries a Cockpit comment naming the
 *    transcript;
 *  - a HUMAN card is pinned in its lane, says what it unblocks, and has no
 *    launcher at all;
 *  - a HUMAN card written WHILE a session runs becomes a notification;
 *  - (F5) a card that has NOT reached `origin/main` is seeded into the worktree
 *    that was cut without it, so the prompt's first instruction is true.
 *
 * The repository is temporary and the agent is `e2e/fixtures/fake-agent.sh`,
 * pointed at through `FLUXOR_AGENT_BIN_CLAUDE` — no LLM, no network, no login.
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

const CARD_FILE = 'JDB-001-probe.md';
const HUMAN_FILE = 'HUMAN-001-needs-you.md';
/**
 * F5's card, and the one property that makes the test mean anything: it is
 * written AFTER the initial commit, so it is untracked and therefore absent
 * from any worktree cut from `main`. That is the exact shape of a card written
 * during a session, which is most of them.
 */
const UNCOMMITTED_CARD_FILE = 'JDB-002-not-on-main.md';
const SEED_WORKTREE_NAME = 'JDB-002';

let app: ElectronApplication;
let page: Page;
/** The directory the widget scans — the project lives one level inside it. */
let projectsRoot: string;
let project: string;
let backlogDir: string;

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

const NOW = '2026-09-08T00:00:00.000Z';

/**
 * A card in the EXACT v2 frontmatter order the javadaba backlog writes
 * (`.backlog/HUMAN-002-*.md`, `JDB-205-*.md`) and that
 * `src/main/backlog/frontmatter.ts` serializes back — task_id, priority,
 * status, runState, order, estimate, epic, tags, assignees, related,
 * createdAt, updatedAt. Written by hand rather than through the serializer on
 * purpose: this test's job includes proving the parser reads what the real
 * backlog contains, not what this repository happens to emit.
 */
function cardFile(fm: {
  taskId: string; priority: string; status: string; runState: string; order: number;
  estimate: number; epic?: string; tags?: string[]; assignees?: string[]; related?: string[];
}, title: string, description: string): string {
  const lines = [
    '---',
    `task_id: ${fm.taskId}`,
    `priority: ${fm.priority}`,
    `status: ${fm.status}`,
    `runState: ${fm.runState}`,
    `order: ${fm.order}`,
    `estimate: ${fm.estimate}`,
    ...(fm.epic ? [`epic: ${fm.epic}`] : []),
    ...(fm.tags?.length ? ['tags:', ...fm.tags.map((t) => `  - ${t}`)] : []),
    ...(fm.assignees?.length ? ['assignees:', ...fm.assignees.map((a) => `  - ${a}`)] : []),
    ...(fm.related?.length ? ['related:', ...fm.related.map((r) => `  - ${r}`)] : []),
    `createdAt: ${NOW}`,
    `updatedAt: ${NOW}`,
    '---',
    `# ${title}`,
    '',
    description,
    '',
  ];
  return lines.join('\n');
}

/** The probe card, fresh — each test rewrites it so it starts from a known state. */
function writeProbeCard(status = 'todo', runState = 'idle'): void {
  fs.writeFileSync(
    path.join(backlogDir, CARD_FILE),
    cardFile(
      {
        taskId: 'JDB-001', priority: 'high', status, runState, order: 0, estimate: 2,
        epic: 'cockpit', tags: ['cockpit'], related: ['HUMAN-001'],
      },
      'Probe the launcher',
      'A card the e2e suite launches an agent session on.',
    ),
    'utf-8',
  );
}

function readProbeCard(): string {
  return fs.readFileSync(path.join(backlogDir, CARD_FILE), 'utf-8');
}

test.beforeAll(async () => {
  // `realpathSync` because macOS's tmpdir is a symlink and git reports the
  // resolved path — without it every path comparison here is off by /private.
  projectsRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fluxor-e2e-cockpit-')));
  project = path.join(projectsRoot, 'probe-project');
  backlogDir = path.join(project, '.backlog');
  fs.mkdirSync(backlogDir, { recursive: true });

  writeProbeCard();
  fs.writeFileSync(
    path.join(backlogDir, HUMAN_FILE),
    cardFile(
      {
        taskId: 'HUMAN-001', priority: 'high', status: 'todo', runState: 'idle', order: 1,
        estimate: 0, epic: 'HUMAN', tags: ['human'], assignees: ['carlos'], related: ['JDB-001'],
      },
      'Put the deploy key on the server',
      '**Why this needs you.** Secrets are written by a person, never by an agent.',
    ),
    'utf-8',
  );

  execFileSync('git', ['init', '-b', 'main', project], { env: GIT_ENV, stdio: 'ignore' });
  git(project, 'config', 'user.email', 'cockpit@example.test');
  git(project, 'config', 'user.name', 'Cockpit E2E');
  git(project, 'config', 'commit.gpgsign', 'false');
  git(project, 'add', '-A');
  git(project, 'commit', '-m', 'first');

  app = await electron.launch({
    args: getElectronLaunchArgs(),
    cwd: REPO_ROOT,
    env: {
      ...getE2EEnv(),
      // The e2e seam: 'claude' resolves to the fixture for this launch only.
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

  // The widget scans the SUBDIRECTORIES of the open folder for `.backlog`, so
  // the projects root is what the IDE opens and `probe-project` is what it finds.
  await page.evaluate((root) => {
    (window as any).__FLUXOR_STORE__?.getState().setProjectPath(root);
  }, projectsRoot);
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    (window as any).__DESKTOP_STORE__?.getState().updateSettings({ tourCompleted: true });
  });
});

test.afterAll(async () => {
  if (app) await app.close();
  if (projectsRoot) fs.rmSync(projectsRoot, { recursive: true, force: true });
});

/** Opens the backlog window and waits for the real directory to be read. */
async function openBoard(): Promise<ReturnType<Page['getByTestId']>> {
  const windowId = await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    return ds.getState().addWindow('backlog', {
      title: 'Cockpit board',
      iconName: 'KanbanSquare',
      size: { width: 980, height: 720 },
    });
  });
  const board = page.getByTestId(`desktop-window-${windowId}`);
  await expect(board.getByTestId('backlog-pile')).toBeVisible({ timeout: 15_000 });
  return board;
}

/**
 * Drives the fourth launcher the way a person does — card → menu → agent
 * submenu → mode → vendor — and returns the id of the window that opened.
 */
async function launchFromCard(
  board: ReturnType<Page['getByTestId']>,
  mode: 'attached' | 'worktree',
  file: string = CARD_FILE,
  cardId: string = 'JDB-001',
): Promise<string> {
  const card = board.locator(`[data-testid="backlog-card"][data-filename="${file}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByTestId('launch-menu-trigger').click();
  await board.getByTestId('launch-menu-agent').click();
  await expect(board.getByTestId('launch-agent-submenu')).toBeVisible();
  await board.getByTestId(`launch-agent-mode-${mode}`).click();
  await board.getByTestId('launch-agent-vendor-claude').click();

  await page.waitForFunction(
    (id) => (window as any).__DESKTOP_STORE__.getState().windows
      .some((w: any) => w.type === 'agent-session' && w.agentSession?.cardId === id && !w.agentSession?.exitCode),
    cardId,
    { timeout: 15_000 },
  );
  return page.evaluate((id) => {
    const wins = (window as any).__DESKTOP_STORE__.getState().windows
      .filter((w: any) => w.type === 'agent-session' && w.agentSession?.cardId === id);
    return wins.sort((a: any, b: any) => b.agentSession.launchedAt - a.agentSession.launchedAt)[0].id as string;
  }, cardId);
}

test('a card opens a session, its prompt reaches argv, and an unfinished card settles as failed', async () => {
  writeProbeCard();
  const board = await openBoard();

  // 1. The HUMAN card is pinned in its own lane, says what it unblocks, and is
  //    not launchable — an agent cannot start a card that needs a person.
  const lane = board.getByTestId('needs-you-lane');
  await expect(lane).toContainText('Needs you · 1', { timeout: 15_000 });
  await expect(lane).toContainText('Put the deploy key on the server');
  await expect(lane.getByTestId('needs-you-unblocks')).toHaveText('unblocks: JDB-001');
  expect(await lane.getByTestId('launch-menu-trigger').count()).toBe(0);

  // 2. The launcher opens a session ON THIS CARD, in the project's own tree.
  const sessionWindowId = await launchFromCard(board, 'attached');
  const win = page.getByTestId(`desktop-window-${sessionWindowId}`);
  const terminal = win.getByTestId('agent-session-terminal');
  await expect(terminal).toBeVisible({ timeout: 10_000 });

  // 3. The prompt really travelled through argv — the fixture prints what it
  //    was given, so this cannot pass on a prompt that was merely built.
  await expect(terminal).toContainText('ARGS:', { timeout: 20_000 });
  await expect(terminal).toContainText('JDB-001', { timeout: 10_000 });
  await expect(terminal).toContainText('FAKE AGENT READY', { timeout: 20_000 });
  await expect(win.getByTestId('agent-session-status')).toHaveText('running', { timeout: 10_000 });

  // 4. `runState: running` is on DISK, written once the process was really up.
  await expect.poll(readProbeCard, { timeout: 15_000 }).toContain('runState: running');
  // And `status` was NOT touched: moving the card is the agent's own first
  // instruction, and doing it for it would forge the one signal that says it read.
  expect(readProbeCard()).toContain('status: todo');

  // 5. The session ends without the agent having closed the card out.
  await terminal.click();
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await expect(win.getByTestId('agent-session-status')).toHaveText('ended · exit 0', { timeout: 15_000 });

  // 6. Exit 0 is not a verdict about the work: the card is still `todo`, so the
  //    run failed, and the comment says where to look.
  await expect.poll(readProbeCard, { timeout: 15_000 }).toContain('runState: failed');
  const settled = readProbeCard();
  expect(settled).toContain('## Comments');
  expect(settled).toContain('**Cockpit**');
  expect(settled).toContain('Session claude ended (exit 0) without closing the card.');
  expect(settled).toMatch(/Transcript: .*\.log/);
});

test('a card the agent moved to review settles as completed, with nothing to explain', async () => {
  writeProbeCard();
  const board = await openBoard();
  const sessionWindowId = await launchFromCard(board, 'attached');
  const win = page.getByTestId(`desktop-window-${sessionWindowId}`);
  const terminal = win.getByTestId('agent-session-terminal');
  await expect(terminal).toContainText('FAKE AGENT READY', { timeout: 20_000 });
  await expect.poll(readProbeCard, { timeout: 15_000 }).toContain('runState: running');

  // The agent's half of the contract, performed by the spec: it moves its own
  // card while the session is still running.
  writeProbeCard('review', 'running');

  await terminal.click();
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await expect(win.getByTestId('agent-session-status')).toHaveText('ended · exit 0', { timeout: 15_000 });

  await expect.poll(readProbeCard, { timeout: 15_000 }).toContain('runState: completed');
  const settled = readProbeCard();
  expect(settled).toContain('status: review');
  // Nothing went wrong, so there is nothing to say. A comment per session would
  // bury the ones that matter.
  expect(settled).not.toContain('**Cockpit**');
});

test('a HUMAN card written while a session runs becomes a notification', async () => {
  writeProbeCard();
  const board = await openBoard();
  const sessionWindowId = await launchFromCard(board, 'attached');
  const win = page.getByTestId(`desktop-window-${sessionWindowId}`);
  const terminal = win.getByTestId('agent-session-terminal');
  await expect(terminal).toContainText('FAKE AGENT READY', { timeout: 20_000 });

  // This is what an agent hitting a wall does: it writes the card that makes
  // the block survive the session, and stops.
  const newHuman = path.join(backlogDir, 'HUMAN-002-set-the-admin-token.md');
  fs.writeFileSync(
    newHuman,
    cardFile(
      {
        taskId: 'HUMAN-002', priority: 'high', status: 'todo', runState: 'idle', order: 2,
        estimate: 0, epic: 'HUMAN', tags: ['human'], assignees: ['carlos'], related: ['JDB-001'],
      },
      'Set the admin token on the server',
      '**Why this needs you.** A secret is typed by a person.',
    ),
    'utf-8',
  );

  // The notification centre keeps it; the toast says it now.
  await expect.poll(
    () => page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().notifications.map((n: any) => n.message)),
    { timeout: 20_000 },
  ).toEqual(expect.arrayContaining([expect.stringContaining('HUMAN-002')]));
  await expect(page.locator('[aria-label="Notifications"]')).toContainText('HUMAN-002');

  // And it lands in the lane, next to the one that was already there.
  await expect(board.getByTestId('needs-you-lane')).toContainText('Needs you · 2', { timeout: 15_000 });

  await terminal.click();
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await expect(win.getByTestId('agent-session-status')).toHaveText('ended · exit 0', { timeout: 15_000 });
  fs.rmSync(newHuman, { force: true });
});

/**
 * F5 — the gap the field test found, and the fix for it.
 *
 * A session worktree is cut from `origin/main` (decision 3), so a card that
 * has not reached it — written this session, uncommitted, or on an unpushed
 * branch — is NOT in the checkout, while the launch prompt's first line tells
 * the agent to read exactly that path. This card is written after the initial
 * commit and never staged, which is precisely that shape.
 */
test('a card that is not on origin/main yet is seeded into the worktree cut for it', async () => {
  const mainCardPath = path.join(backlogDir, UNCOMMITTED_CARD_FILE);
  fs.writeFileSync(
    mainCardPath,
    cardFile(
      {
        taskId: 'JDB-002', priority: 'medium', status: 'todo', runState: 'idle', order: 3,
        estimate: 1, epic: 'cockpit', tags: ['cockpit'],
      },
      'Seed me',
      'A card written this session, so it exists nowhere but the working tree.',
    ),
    'utf-8',
  );
  // The premise, asserted rather than assumed: git does not know this file.
  expect(git(project, 'status', '--porcelain')).toContain(UNCOMMITTED_CARD_FILE);

  const board = await openBoard();
  const sessionWindowId = await launchFromCard(board, 'worktree', UNCOMMITTED_CARD_FILE, 'JDB-002');
  const win = page.getByTestId(`desktop-window-${sessionWindowId}`);
  const terminal = win.getByTestId('agent-session-terminal');
  await expect(terminal).toBeVisible({ timeout: 10_000 });

  // 1. The Cockpit says what it did, in the session's own log surface.
  await expect(terminal).toContainText('preparing worktree', { timeout: 25_000 });
  await expect(terminal).toContainText(
    `seeded ${UNCOMMITTED_CARD_FILE} into the worktree (not on origin/main yet)`,
    { timeout: 25_000 },
  );

  // 2. And the file is really there — which is what makes the prompt's first
  //    instruction ("read the card file in full first") true.
  const worktreeCard = path.join(
    project, '.claude', 'worktrees', SEED_WORKTREE_NAME, '.backlog', UNCOMMITTED_CARD_FILE,
  );
  await expect.poll(() => fs.existsSync(worktreeCard), { timeout: 20_000 }).toBe(true);
  expect(fs.readFileSync(worktreeCard, 'utf-8')).toContain('task_id: JDB-002');

  // 3. The agent starts after it, inside that worktree.
  await expect(terminal).toContainText('FAKE AGENT READY', { timeout: 25_000 });
  await expect(win.getByTestId('agent-session-status')).toHaveText('running', { timeout: 15_000 });

  // 4. The write-back went to the copy the agent can see, and the main tree's
  //    card was left exactly as it was (card-writeback.ts's file rule).
  await expect.poll(() => fs.readFileSync(worktreeCard, 'utf-8'), { timeout: 20_000 })
    .toContain('runState: running');
  expect(fs.readFileSync(mainCardPath, 'utf-8')).toContain('runState: idle');

  await terminal.click();
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await expect(win.getByTestId('agent-session-status')).toHaveText('ended · exit 0', { timeout: 20_000 });

  // Nothing this test made is left registered in the project's git.
  execFileSync('git', ['worktree', 'remove', '--force', path.dirname(path.dirname(worktreeCard))], {
    cwd: project, env: GIT_ENV, stdio: 'ignore',
  });
  fs.rmSync(mainCardPath, { force: true });
});
