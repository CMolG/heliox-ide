/**
 * cockpit-field-test.spec.ts — The Cockpit against the REAL `claude` (F5)
 *
 * SKIPPED unless `FLUXOR_FIELD_TEST=1`. This is not a unit of the suite: it
 * COSTS REAL CLAUDE TOKENS, needs `claude` on PATH and a logged-in account,
 * and it runs against a REAL repository (`FLUXOR_FIELD_PROJECT`, default
 * `/Users/carlos/IdeaProjects/javadaba-web`) whose working tree it must never
 * disturb. Every other spec in `e2e/` uses `fixtures/fake-agent.sh`; this one
 * exists because a fake agent can prove the plumbing and cannot prove a single
 * thing about timing, hook payloads, or what an LLM does with the prompt.
 *
 *   FLUXOR_FIELD_TEST=1 npx playwright test e2e/field/cockpit-field-test.spec.ts --timeout 900000
 *
 * What it touches in that repository, and nothing else: three throwaway
 * `PROBE-nnn` cards it creates through the project's OWN backlog CLI (so the
 * format is the project's, not this file's opinion of it), three git worktrees
 * under `.claude/worktrees/` and their three branches. All four are removed in
 * a `finally`, and the last assertions are that they are gone.
 *
 * Two deviations from the plan's F5, both deliberate and both in the report:
 * worktree-only (the plan said 1 attached + 2 worktrees — the real tree here
 * carries the user's uncommitted work, and no autonomous agent runs in it),
 * and `--permission-mode bypassPermissions --model haiku` (isolated worktrees,
 * a probe that touches one file, and a cost that has to stay small).
 *
 * Measurements go to a JSON under `FLUXOR_FIELD_OUT` — outside both trees,
 * because a measurement of a moment is not a source file (invariant 12 of the
 * javadaba harness).
 */
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getElectronLaunchArgs, getE2EEnv } from '../test-helpers';

const FIELD_TEST_ENABLED = process.env.FLUXOR_FIELD_TEST === '1';
test.skip(!FIELD_TEST_ENABLED, 'Field test: set FLUXOR_FIELD_TEST=1 (it spends real Claude tokens)');
// Never retried: a retry here is a second bill, and a flake in a field test is
// itself the finding.
test.describe.configure({ retries: 0, mode: 'serial' });

const REPO_ROOT = path.join(__dirname, '..', '..');
const PROJECT = process.env.FLUXOR_FIELD_PROJECT ?? '/Users/carlos/IdeaProjects/javadaba-web';
/** The widget scans the SUBDIRECTORIES of the opened folder for `.backlog`. */
const PROJECTS_ROOT = path.dirname(PROJECT);
const PROJECT_NAME = path.basename(PROJECT);
const BACKLOG_CLI = path.join(PROJECT, '.harness', 'skills', 'backlog', 'backlog.py');
const OUT_DIR = process.env.FLUXOR_FIELD_OUT ?? path.join(os.tmpdir(), 'fluxor-cockpit-field-test');

const PROBE_TITLE_PREFIX = 'Cockpit field test probe';
const PROBE_BODY = 'This is a probe card for the Fluxor Cockpit field test. '
  + 'Do exactly this and nothing else: (1) show this card with the backlog CLI; '
  + '(2) move it to doing with runState running; (3) add the comment "F5 probe OK"; '
  + '(4) move it to review with runState completed; (5) stop. '
  + 'Do not read, edit or create any other file. Do not run tests or builds.';
/** The line the project's own `UserPromptSubmit` prehook injects, verbatim. */
const PREHOOK_MARKER = 'What is not up for discussion';

interface Probe {
  taskId: string;
  filename: string;
  /** `slugify(taskId)` — what `launchActions.ts` names the worktree and prefixes the branch with. */
  slug: string;
  mainCardPath: string;
  worktreePath: string;
}

// ─── The project's own CLI, and plain git on a real repository ───

/**
 * No `GIT_CONFIG_GLOBAL=/dev/null` here, unlike the hermetic specs: this is
 * the user's own repository and its configuration is part of the field.
 */
function git(...args: string[]): string {
  return execFileSync('git', ['-C', PROJECT, ...args], {
    encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function backlogCli(...args: string[]): string {
  return execFileSync('python3', [BACKLOG_CLI, ...args], {
    cwd: PROJECT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** `created /abs/path/PROBE-001-….md` — the CLI's own answer is the filename. */
function createProbeCard(n: number): Probe {
  const out = backlogCli(
    'new', '--prefix', 'PROBE',
    '--title', `${PROBE_TITLE_PREFIX} ${n}`,
    '--priority', 'low',
    '--tags', 'cockpit,probe',
    '--body', PROBE_BODY,
  );
  const created = out.split('\n').map((l) => l.trim()).find((l) => l.startsWith('created '));
  if (!created) throw new Error(`backlog.py new said something unexpected: ${out}`);
  const mainCardPath = created.slice('created '.length).trim();
  const filename = path.basename(mainCardPath);
  const taskId = filename.split('-').slice(0, 2).join('-');
  const slug = taskId.toLowerCase();
  return {
    taskId,
    filename,
    slug,
    mainCardPath,
    worktreePath: path.join(PROJECT, '.claude', 'worktrees', slug),
  };
}

// ─── Launching the IDE with a CLEAN environment for the nested CLI ───

/**
 * Strips this process's own Claude Code identity before handing the
 * environment to Electron.
 *
 * Found while writing this: the field test is itself usually launched FROM a
 * Claude Code session, which exports `CLAUDECODE=1`,
 * `CLAUDE_CODE_SESSION_ID`, a messaging socket and a token. Those are
 * inherited by Electron, by the PTY, and finally by the `claude` the Cockpit
 * spawns — which then starts believing it is a nested invocation of its own
 * parent. Nothing about the Cockpit causes this and nothing in the product
 * should paper over it; the test that creates the situation is the thing that
 * has to clean it up.
 */
function cleanAgentEnv(extra: Record<string, string>): Record<string, string> {
  const base = getE2EEnv();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (/^CLAUDE(CODE)?(_|$)/.test(k) || k === 'AI_AGENT') continue;
    out[k] = v;
  }
  return { ...out, ...extra };
}

async function launchIde(extraArgs: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: getElectronLaunchArgs(),
    cwd: REPO_ROOT,
    env: cleanAgentEnv({ FLUXOR_AGENT_EXTRA_ARGS_CLAUDE: extraArgs }),
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => !!(window as any).__FLUXOR_STORE__ && !!(window as any).__DESKTOP_STORE__,
    { timeout: 30_000 },
  );
  await page.evaluate((root) => {
    (window as any).__FLUXOR_STORE__?.getState().setProjectPath(root);
  }, PROJECTS_ROOT);
  await page.evaluate(() => {
    (window as any).__DESKTOP_STORE__?.getState().updateSettings({ tourCompleted: true });
  });
  await installRecorder(page);
  return { app, page };
}

/**
 * The instrumentation, installed in the PAGE before anything is launched.
 *
 * Three sources, three different truths: the desktop store says what the
 * WINDOW believed and when (its attention word sequence); `onPtyData` says
 * when the process first spoke; `onAgentHookEvent` says what the CLI itself
 * reported. Polling the store from Node instead would put a 250 ms floor under
 * every number here, which is most of what is being measured.
 */
async function installRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    if (w.__F5__) return;
    w.__F5__ = { transitions: {}, hooks: [], firstOutput: {}, tail: {} };
    const api = w.fluxorAPI;
    api.onAgentHookEvent((e: any) => w.__F5__.hooks.push({ ...e, receivedAt: Date.now() }));
    api.onPtyData(({ sessionId, data }: { sessionId: string; data: string }) => {
      const f = w.__F5__;
      if (!f.firstOutput[sessionId]) f.firstOutput[sessionId] = Date.now();
      // A tail, not a transcript: enough to quote a failure, bounded so a
      // chatty session cannot grow the renderer's heap for fifteen minutes.
      f.tail[sessionId] = ((f.tail[sessionId] ?? '') + data).slice(-8000);
    });
    const ds = w.__DESKTOP_STORE__;
    const record = (s: any) => {
      for (const win of s.windows) {
        if (win.type !== 'agent-session' || !win.agentSession) continue;
        const m = win.agentSession;
        const list = (w.__F5__.transitions[m.sessionId] ||= []);
        const state = m.attention + (m.attentionReason ? ` · ${m.attentionReason}` : '');
        if (!list.length || list[list.length - 1].state !== state) list.push({ state, at: Date.now() });
      }
    };
    ds.subscribe(record);
    record(ds.getState());
  });
}

// ─── Driving the real board ───

interface Board {
  windowId: string;
  locator: ReturnType<Page['getByTestId']>;
}

/** Every desktop window spawns viewport-centred, so they stack. Raise one. */
async function focus(page: Page, windowId: string): Promise<void> {
  await page.evaluate((id) => (window as any).__DESKTOP_STORE__.getState().focusWindow(id), windowId);
}

async function openBoard(page: Page): Promise<Board> {
  const windowId = await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    return ds.getState().addWindow('backlog', {
      title: 'Cockpit field board',
      iconName: 'KanbanSquare',
      size: { width: 1100, height: 800 },
    });
  });
  const board = page.getByTestId(`desktop-window-${windowId}`);
  // Several projects under the root have a backlog, so the picker is shown and
  // the right one is chosen by its EXACT name — `javadaba-web.old` is a sibling
  // and a substring match would reach it. Which of the two views appears is
  // decided by that scan, so wait for either.
  const picker = board.getByTestId('backlog-picker');
  const pile = board.getByTestId('backlog-pile');
  await expect(picker.or(pile).first()).toBeVisible({ timeout: 120_000 });
  if (await picker.isVisible()) {
    await picker.locator('button')
      .filter({ has: page.locator(`div:text-is("${PROJECT_NAME}")`) })
      .first()
      .click();
  }
  await expect(pile).toBeVisible({ timeout: 60_000 });
  // 200+ cards: the search box is how a person reaches three of them, and it is
  // also what keeps this test off a scroll position.
  await board.getByLabel('Search backlog').fill(PROBE_TITLE_PREFIX);
  return { windowId, locator: board };
}

/** Card → menu → agent → worktree → claude, exactly as a person clicks it. */
async function launchProbe(page: Page, board: Board, probe: Probe): Promise<string> {
  // The board is under three session windows by the third launch; raise it
  // first or the click lands on a terminal.
  await focus(page, board.windowId);
  const card = board.locator.locator(`[data-testid="backlog-card"][data-filename="${probe.filename}"]`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByTestId('launch-menu-trigger').click();
  await board.locator.getByTestId('launch-menu-agent').click();
  await expect(board.locator.getByTestId('launch-agent-submenu')).toBeVisible();
  await board.locator.getByTestId('launch-agent-mode-worktree').click();
  await board.locator.getByTestId('launch-agent-vendor-claude').click();

  await page.waitForFunction(
    (id) => (window as any).__DESKTOP_STORE__.getState().windows
      .some((w: any) => w.type === 'agent-session' && w.agentSession?.cardId === id),
    probe.taskId,
    { timeout: 30_000 },
  );
  return page.evaluate((id) => {
    const wins = (window as any).__DESKTOP_STORE__.getState().windows
      .filter((w: any) => w.type === 'agent-session' && w.agentSession?.cardId === id);
    return wins.sort((a: any, b: any) => b.agentSession.launchedAt - a.agentSession.launchedAt)[0].id as string;
  }, probe.taskId);
}

function sessionMeta(page: Page, windowId: string): Promise<any> {
  return page.evaluate(
    (id) => (window as any).__DESKTOP_STORE__.getState().windows.find((w: any) => w.id === id)?.agentSession,
    windowId,
  );
}

/** Every number this test exists to produce, derived from the three recorders. */
async function measure(page: Page, windowId: string): Promise<Record<string, unknown>> {
  const meta = await sessionMeta(page, windowId);
  const rec = await page.evaluate((sid) => {
    const f = (window as any).__F5__;
    return {
      transitions: f.transitions[sid] ?? [],
      firstOutput: f.firstOutput[sid] ?? null,
      hooks: f.hooks.filter((h: any) => h.sessionId === sid),
      tail: (f.tail[sid] ?? '').slice(-1200),
    };
  }, meta.sessionId);

  const at = (state: string) => rec.transitions.find((t: any) => t.state === state)?.at ?? null;
  const hookAt = (name: string) => rec.hooks.find((h: any) => h.hookEventName === name)?.receivedAt ?? null;
  const since = (from: number | null, to: number | null) =>
    from !== null && to !== null ? to - from : null;

  // `starting` is written by the bootstrap step immediately before the spawn
  // effect runs, so it is the closest thing the renderer has to a spawn clock.
  const spawnAt = at('starting');
  const prompt = hookAt('UserPromptSubmit');
  const notification = rec.hooks.find((h: any) => h.hookEventName === 'Notification');

  return {
    cardId: meta.cardId,
    branch: meta.branch,
    worktreePath: meta.worktreePath,
    hooksArmed: meta.hooksArmed === true,
    bootstrapExitCode: meta.bootstrapExitCode ?? null,
    exitCode: meta.exitCode ?? null,
    transcriptPath: meta.transcriptPath ?? null,
    worktreeCreateMs: since(meta.launchedAt, at('bootstrapping')),
    bootstrapMs: since(at('bootstrapping'), spawnAt),
    spawnToFirstOutputMs: since(spawnAt, rec.firstOutput),
    spawnToSessionStartMs: since(spawnAt, hookAt('SessionStart')),
    spawnToUserPromptMs: since(spawnAt, prompt),
    userPromptToFirstStopMs: since(prompt, hookAt('Stop')),
    notificationType: notification?.notificationType ?? null,
    notificationAtMs: since(spawnAt, notification?.receivedAt ?? null),
    hookNames: rec.hooks.map((h: any) => h.hookEventName),
    attentionSequence: rec.transitions.map((t: any) => t.state),
    terminalTail: rec.tail,
  };
}

/**
 * Ends a session through the Cockpit's own two-step End control, falling back
 * to `ptyKill` if the control cannot be reached — and SAYING which it used,
 * because "the End button worked" is one of the things this run is here to
 * find out.
 */
async function endSession(page: Page, windowId: string): Promise<'control' | 'ptyKill'> {
  await focus(page, windowId);
  const win = page.getByTestId(`desktop-window-${windowId}`);
  const end = win.getByTestId('agent-session-end');
  let how: 'control' | 'ptyKill' = 'control';
  try {
    await end.click({ timeout: 15_000 });
    await expect(end).toContainText('Confirm end?', { timeout: 5_000 });
    await end.click({ timeout: 15_000 });
  } catch {
    how = 'ptyKill';
    const meta = await sessionMeta(page, windowId);
    await page.evaluate((sid) => (window as any).fluxorAPI.ptyKill(sid), meta.sessionId);
  }
  await expect(win.getByTestId('agent-session-status')).toContainText('ended', { timeout: 60_000 });
  return how;
}

function writeReport(name: string, payload: unknown): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  // The only place this test prints a path: the numbers are its whole output.
  console.log(`[field] measurements → ${file}`);
}

/**
 * Removes everything this test made, and is safe to call twice.
 *
 * Scoped by construction: only the three `PROBE-nnn` worktrees, only the three
 * `probe-nnn/*` branches, only the three probe cards. Nothing here takes a
 * pattern that could widen.
 */
function cleanup(probes: Probe[]): void {
  for (const p of probes) {
    try {
      execFileSync('git', ['-C', PROJECT, 'worktree', 'remove', '--force', p.worktreePath], { stdio: 'ignore' });
    } catch { /* never created, or already gone */ }
    try {
      fs.rmSync(p.worktreePath, { recursive: true, force: true });
    } catch { /* ignore */ }
    try {
      const branches = execFileSync('git', ['-C', PROJECT, 'branch', '--list', `${p.slug}/*`], { encoding: 'utf-8' })
        .split('\n').map((b) => b.replace(/^[*+]?\s*/, '').trim()).filter(Boolean);
      for (const b of branches) {
        execFileSync('git', ['-C', PROJECT, 'branch', '-D', b], { stdio: 'ignore' });
      }
    } catch { /* ignore */ }
    try { fs.rmSync(p.mainCardPath, { force: true }); } catch { /* ignore */ }
  }
  try { execFileSync('git', ['-C', PROJECT, 'worktree', 'prune'], { stdio: 'ignore' }); } catch { /* ignore */ }
}

// ─── The run ───

test('three probe cards run to completion in their own worktrees, with the real claude', async () => {
  expect(fs.existsSync(BACKLOG_CLI), `${BACKLOG_CLI} — the project's own backlog CLI`).toBe(true);

  const probes: Probe[] = [];
  let app: ElectronApplication | null = null;
  const summary: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    project: PROJECT,
    extraArgs: '--permission-mode bypassPermissions --model haiku',
    claudeVersion: execFileSync('claude', ['--version'], { encoding: 'utf-8' }).trim(),
    sessions: [] as unknown[],
  };

  try {
    for (let n = 1; n <= 3; n += 1) probes.push(createProbeCard(n));
    summary.probes = probes.map((p) => ({ taskId: p.taskId, filename: p.filename }));

    const ide = await launchIde('--permission-mode bypassPermissions --model haiku');
    app = ide.app;
    const { page } = ide;
    const board = await openBoard(page);

    // Launched one after another, each waiting only for its own `git worktree
    // add` to land before the next one starts. `git worktree add` takes the
    // repository's index lock, and three of them fired at the same instant race
    // for it; everything expensive after that point — the install and the agent
    // — still overlaps, which is the concurrency this run is measuring.
    //
    // The seed line is the F5 fix proving itself against a real repository: the
    // probe cards were created minutes ago and are on no remote at all.
    const windowIds: string[] = [];
    for (const probe of probes) {
      const windowId = await launchProbe(page, board, probe);
      windowIds.push(windowId);
      await expect(page.getByTestId(`desktop-window-${windowId}`).getByTestId('agent-session-terminal'))
        .toContainText(`seeded ${probe.filename} into the worktree`, { timeout: 180_000 });
    }

    // The Cockpit's own layout: board left, sessions tiled right. Not cosmetic
    // here — it is what stops three centred windows from covering each other.
    await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().arrangeCockpit());

    // The bootstrap is a real `pnpm install --prefer-offline --frozen-lockfile`
    // over an 11-project monorepo, three times at once. Ten minutes.
    for (const windowId of windowIds) {
      await expect(page.getByTestId(`desktop-window-${windowId}`).getByTestId('agent-session-status'))
        .not.toHaveText(/preparing|bootstrapping/, { timeout: 600_000 });
    }

    // Then the agent's own turn: it reads the card, moves it twice, comments.
    for (const windowId of windowIds) {
      await expect(page.getByTestId(`desktop-window-${windowId}`).getByTestId('agent-session-status'))
        .toContainText(/waiting|ended/, { timeout: 600_000 });
    }

    for (let i = 0; i < probes.length; i += 1) {
      const probe = probes[i];
      const windowId = windowIds[i];
      const metrics = await measure(page, windowId);

      const endedVia = await endSession(page, windowId);

      // ── What the agent left on the card the Cockpit seeded for it ──
      const worktreeCard = path.join(probe.worktreePath, '.backlog', probe.filename);
      expect(fs.existsSync(worktreeCard), `${worktreeCard} exists`).toBe(true);
      const written = fs.readFileSync(worktreeCard, 'utf-8');
      const settled = await measure(page, windowId);

      // ── The main tree is untouched: worktree mode never writes to it ──
      const mainCard = fs.readFileSync(probe.mainCardPath, 'utf-8');

      // ── The project's own prehook fired INSIDE the worktree ──
      const transcript = (metrics.transcriptPath ?? settled.transcriptPath) as string | null;
      const prehookFired = !!transcript && fs.existsSync(transcript)
        && fs.readFileSync(transcript, 'utf-8').includes(PREHOOK_MARKER);

      const du = execFileSync('/bin/sh', ['-c', `du -sh ${JSON.stringify(probe.worktreePath)} 2>/dev/null || true`], { encoding: 'utf-8' }).trim();
      // Only the `## Comments` section counts. The card's own BODY quotes the
      // string it asks the agent to write — a whole-file `includes` reports
      // success for a card nobody touched, which is exactly what the first run
      // did until this was noticed.
      const comments = written.split(/^## Comments\s*$/m)[1] ?? '';

      (summary.sessions as unknown[]).push({
        ...mergeSnapshots(metrics, settled),
        endedVia,
        worktreeDiskUsage: du.split('\t')[0] ?? null,
        prehookFiredInWorktree: prehookFired,
        cardStatus: /^status:\s*(\w+)/m.exec(written)?.[1] ?? null,
        cardRunState: /^runState:\s*(\w+)/m.exec(written)?.[1] ?? null,
        cardHasProbeComment: comments.includes('F5 probe OK'),
        cardHasCockpitComment: written.includes('**Cockpit**'),
        mainCardStatus: /^status:\s*(\w+)/m.exec(mainCard)?.[1] ?? null,
        mainCardRunState: /^runState:\s*(\w+)/m.exec(mainCard)?.[1] ?? null,
      });

      expect(written, `${probe.taskId} status`).toContain('status: review');
      expect(written, `${probe.taskId} runState`).toContain('runState: completed');
      expect(comments, `${probe.taskId} comment`).toContain('F5 probe OK');
      // The card closed itself out, so `settleCard` had nothing to explain —
      // a comment per session would bury the ones that matter.
      expect(written, `${probe.taskId} carries no Cockpit comment`).not.toContain('**Cockpit**');

      expect(mainCard, `${probe.taskId} main-tree status`).toContain('status: todo');
      expect(mainCard, `${probe.taskId} main-tree runState`).toContain('runState: idle');

      expect(prehookFired, `the project's UserPromptSubmit prehook fired in ${probe.slug}`).toBe(true);
    }
  } finally {
    writeReport('field-run', summary);
    if (app) await app.close().catch(() => { /* already gone */ });
    cleanup(probes);
  }

  // ── The repository is exactly as it was found ──
  //
  // Matched against the three FILENAMES rather than against /probe/i: this
  // backlog already carries two cards whose titles contain the word "probe"
  // and which are modified in the user's working tree. A pattern that widened
  // onto them would report someone else's work as this test's residue.
  const dirty = git('status', '--short', '.backlog').split('\n');
  const leftovers = dirty.filter((line) => probes.some((p) => line.includes(p.filename)));
  expect(leftovers, 'no probe cards left in .backlog').toEqual([]);
  expect(git('worktree', 'list').split('\n').length, 'one worktree — the main one').toBe(1);
});

/**
 * The fourth run, best effort: the SAME thing without `bypassPermissions`, to
 * see the one state the fake agent can never produce — a real permission
 * prompt, and the `Notification permission_prompt` the CLI sends with it.
 *
 * It reports what it saw rather than asserting a shape, because what claude
 * asks for and when is the CLI's business and can change between versions.
 * A failure here is a finding, not a broken Cockpit.
 */
test('best effort: a session without bypassPermissions shows what a permission prompt looks like', async () => {
  const probes: Probe[] = [];
  let app: ElectronApplication | null = null;
  const observed: Record<string, unknown> = { startedAt: new Date().toISOString(), extraArgs: '--model haiku' };

  try {
    probes.push(createProbeCard(4));
    const ide = await launchIde('--model haiku');
    app = ide.app;
    const { page } = ide;
    const board = await openBoard(page);
    const windowId = await launchProbe(page, board, probes[0]);
    const win = page.getByTestId(`desktop-window-${windowId}`);

    await expect(win.getByTestId('agent-session-status'))
      .not.toHaveText(/preparing|bootstrapping/, { timeout: 600_000 });

    // Anything but 'running' means it is either asking or done.
    await expect(win.getByTestId('agent-session-status'))
      .toContainText(/waiting|ended/, { timeout: 420_000 });
    observed.beforeAnswer = await measure(page, windowId);

    // The person answering, in the one byte a PTY carries.
    const meta = await sessionMeta(page, windowId);
    await page.evaluate((sid) => (window as any).fluxorAPI.ptyWrite(sid, '\r'), meta.sessionId);
    await page.waitForTimeout(20_000);
    observed.afterAnswer = await measure(page, windowId);

    await endSession(page, windowId);
    observed.outcome = 'observed';
  } catch (err) {
    // Best effort means best effort: the observation is the deliverable.
    observed.outcome = 'failed';
    observed.error = err instanceof Error ? err.message : String(err);
  } finally {
    writeReport('field-run-permission', observed);
    if (app) await app.close().catch(() => { /* already gone */ });
    cleanup(probes);
  }
});

/** Flattens the two snapshots into one row, keeping the later value when it exists. */
function mergeSnapshots(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...before };
  for (const [k, v] of Object.entries(after)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}
