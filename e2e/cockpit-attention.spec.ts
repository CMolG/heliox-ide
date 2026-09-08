/**
 * cockpit-attention.spec.ts — The Cockpit's F4 chain, end to end
 *
 * F1 proved a PTY runs in a window, F2 that a worktree is cut in front of it,
 * F3 that a card drives it. This one proves the three things F4 adds, and all
 * three are about a DESKTOP rather than a terminal:
 *
 *   1. **Attention.** The session is launched with `--session-id` and an inline
 *      `--settings`, a real HTTP POST from the agent reaches the loopback
 *      endpoint, and the badge says `waiting · stopped` in WORDS with a
 *      notification behind it — once per waiting stretch, not once per event.
 *   2. **The preset.** `arrangeCockpit()` puts the board on the left and tiles
 *      the sessions beside it, with nothing overlapping anything.
 *   3. **The list.** One row per session, and its Focus control really brings
 *      that window to the front.
 *
 * The agent is `e2e/fixtures/fake-agent.sh` — no LLM, no network, no login —
 * and since F4 it POSTs the hook payloads itself, using the URL it finds in
 * the `--settings` argument it was given. So the endpoint under test is the
 * real one, on a real port, answering a real `curl`.
 *
 * NOTE (from F1, still true): after touching `src/main` or `src/preload` the
 * e2e main/preload bundles must be rebuilt or this suite tests an old one.
 */
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import { getElectronLaunchArgs, getE2EEnv } from './test-helpers';

const REPO_ROOT = path.join(__dirname, '..');
const FAKE_AGENT = path.join(__dirname, 'fixtures', 'fake-agent.sh');

let app: ElectronApplication;
let page: Page;

interface WindowRect { id: string; type: string; x: number; y: number; width: number; height: number; zIndex: number }

test.beforeAll(async () => {
  app = await electron.launch({
    args: getElectronLaunchArgs(),
    cwd: REPO_ROOT,
    env: { ...getE2EEnv(), FLUXOR_AGENT_BIN_CLAUDE: FAKE_AGENT },
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

  // App.tsx renders the project picker instead of the desktop while no project
  // is open, so there would be no canvas to mount a window into.
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
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Opens one session window and returns its window id AND its session id.
 *
 * The session id is a real `crypto.randomUUID()` because `claude --session-id`
 * refuses anything else — `hookArgsFor` therefore omits the flag for a
 * hand-written id, and this test asserts the flag is there.
 */
async function openSession(
  title: string,
  launchedAt: number,
  projectDir: string = REPO_ROOT,
): Promise<{ windowId: string; sessionId: string }> {
  return page.evaluate(({ cwd, windowTitle, at }) => {
    const ds = (window as any).__DESKTOP_STORE__;
    const sessionId = crypto.randomUUID();
    const windowId = ds.getState().addWindow('agent-session', {
      title: windowTitle,
      iconName: 'Terminal',
      size: { width: 720, height: 480 },
      agentSession: {
        sessionId, vendor: 'claude', cwd, projectRoot: cwd, mode: 'attached',
        launchedAt: at, ptyStarted: false, attention: 'starting',
      },
    });
    return { windowId, sessionId };
  }, { cwd: projectDir, windowTitle: title, at: launchedAt });
}

/**
 * Clears the canvas before a test that COUNTS windows.
 *
 * The e2e run shares one userData directory, and the desktop store persists
 * its windows into it — a `localStorage.clear()` in `beforeAll` does not
 * survive, because the store flushes its in-memory state back out on unload.
 * So a session window opened by an earlier spec is still here (F2's lesson 7).
 * Scoping locators handles that for a test that looks at ONE window; a test
 * about the desktop as a whole has to own the desktop.
 */
async function resetDesktop(): Promise<void> {
  await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__.getState();
    for (const w of [...ds.windows]) ds.removeWindow(w.id);
  });
}

/** Every notification currently in the desktop's notification centre. */
function notices(): Promise<string[]> {
  return page.evaluate(() =>
    (window as any).__DESKTOP_STORE__.getState().notifications.map((n: { message: string }) => n.message));
}

function windowRects(): Promise<WindowRect[]> {
  return page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().windows.map((w: any) => ({
    id: w.id, type: w.type, zIndex: w.zIndex,
    x: w.position.x, y: w.position.y, width: w.size.width, height: w.size.height,
  })));
}

function overlaps(a: WindowRect, b: WindowRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}

// ─── 1. Attention ───────────────────────────────────────────────────────────

test('a hook event moves the badge, and notifies once per waiting stretch', async () => {
  await resetDesktop();
  const { windowId, sessionId } = await openSession('E2E attention session', Date.now());
  const win = page.getByTestId(`desktop-window-${windowId}`);
  const terminal = win.getByTestId('agent-session-terminal');
  const status = win.getByTestId('agent-session-status');

  await expect(terminal).toBeVisible({ timeout: 10_000 });
  await expect(terminal).toContainText('FAKE AGENT READY', { timeout: 20_000 });

  // 1. The hooks were armed AS ARGUMENTS. Nothing was written to disk — no
  //    settings.local.json, no temp file — so argv is the only place this can
  //    be proved. (The fixture prints the flag names but never the settings
  //    VALUE: it carries the session's token.)
  await expect(terminal).toContainText('ARGS:', { timeout: 10_000 });
  await expect(terminal).toContainText('--session-id', { timeout: 10_000 });
  await expect(terminal).toContainText('--settings', { timeout: 10_000 });
  await expect(status).toHaveText('running', { timeout: 10_000 });

  // 2. A real POST from the agent to the real loopback endpoint. The badge
  //    says the state AND the reason, in words.
  await terminal.click();
  await page.keyboard.type('stop');
  await page.keyboard.press('Enter');

  await expect(status).toHaveText('waiting · stopped', { timeout: 15_000 });
  await expect.poll(async () => (await notices()).filter((m) => m.includes('needs you')).length,
    { timeout: 10_000 }).toBe(1);

  // 3. A SECOND waiting event inside the same stretch moves the badge and
  //    raises nothing.
  //
  //    It is written into the PTY directly rather than typed, and that is the
  //    point rather than a shortcut: pressing Enter is the person ANSWERING,
  //    which ends the stretch by design (`user_enter` → running). What has to
  //    be tested here is the agent asking for a second thing without anyone
  //    having intervened — and that is a write nobody typed.
  await page.evaluate((sid) => (window as any).fluxorAPI.ptyWrite(sid, 'perm\r'), sessionId);

  await expect(status).toHaveText('waiting · permission', { timeout: 15_000 });
  // Still one. Three notifications for one interruption is how a channel gets
  // muted inside a week.
  expect((await notices()).filter((m) => m.includes('needs you'))).toHaveLength(1);

  // 4. A prompt puts it back to work…
  await page.keyboard.type('prompt');
  await page.keyboard.press('Enter');
  await expect(status).toHaveText('running', { timeout: 15_000 });

  // 5. …and the exit code still lands where F1 put it.
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await expect(status).toHaveText('ended · exit 0', { timeout: 15_000 });

  // 6. The state reached the window TITLE too, so a canvas of terminals can be
  //    read without opening one.
  await expect.poll(async () => page.evaluate((id) =>
    (window as any).__DESKTOP_STORE__.getState().windows.find((w: any) => w.id === id)?.title,
  windowId), { timeout: 10_000 }).toBe('ended · E2E attention session');

});

// ─── 2. The preset ──────────────────────────────────────────────────────────

test('arrangeCockpit lays out the board and the sessions without overlapping', async () => {
  await resetDesktop();
  await page.evaluate(() => {
    (window as any).__DESKTOP_STORE__.getState().addWindow('backlog', { title: 'Backlog' });
  });
  // Three DIFFERENT project directories, because one attached session per
  // project is the F2 rule: three attached sessions on the same tree is the
  // exact thing the Cockpit refuses, and two of these would come up as a
  // refusal panel rather than as a running agent.
  const base = Date.now();
  const opened = [
    await openSession('E2E cockpit 1', base, REPO_ROOT),
    await openSession('E2E cockpit 2', base + 1, path.join(REPO_ROOT, 'e2e')),
    await openSession('E2E cockpit 3', base + 2, path.join(REPO_ROOT, 'src')),
  ];
  for (const { windowId } of opened) {
    const sessionWindow = page.getByTestId(`desktop-window-${windowId}`);
    await expect(sessionWindow.getByTestId('agent-session-terminal')).toBeVisible({ timeout: 10_000 });
    // Really running, not a refusal panel — otherwise this would be a layout
    // test over three dead windows.
    await expect(sessionWindow.getByTestId('agent-session-status'))
      .toHaveText('running', { timeout: 20_000 });
  }

  await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().arrangeCockpit());

  const placed = (await windowRects()).filter((w) =>
    w.type === 'backlog' || w.type === 'agent-session' || w.type === 'session-list');
  expect(placed.length).toBeGreaterThanOrEqual(4);

  // 1. Nothing sits on top of anything else. This is the whole promise of a
  //    preset: arrange once and every session is readable without dragging.
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      expect({ a: placed[i].id, b: placed[j].id, overlap: overlaps(placed[i], placed[j]) })
        .toEqual({ a: placed[i].id, b: placed[j].id, overlap: false });
    }
  }

  // 2. The board is the leftmost thing on the desktop — the pile is what you
  //    read, the sessions are what you watch.
  const backlog = placed.find((w) => w.type === 'backlog')!;
  expect(Math.min(...placed.map((w) => w.x))).toBe(backlog.x);

  // 3. And the camera was moved so the arrangement is actually on screen.
  const zoom = await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().canvasZoom);
  expect(zoom).toBeGreaterThan(0);
  expect(zoom).toBeLessThanOrEqual(1);
});

// ─── 3. The list ────────────────────────────────────────────────────────────

test('the session list has a row per session, and Focus brings that one forward', async () => {
  const listWindowId = await page.evaluate(() => (window as any).__DESKTOP_STORE__
    .getState().addWindow('session-list', { title: 'Sessions', size: { width: 560, height: 240 } }));

  const list = page.getByTestId(`desktop-window-${listWindowId}`);
  await expect(list.getByTestId('session-list')).toBeVisible({ timeout: 10_000 });

  // The three sessions the previous test opened, and only those.
  const rows = list.getByTestId('session-list-row');
  await expect(rows).toHaveCount(3, { timeout: 10_000 });

  // Every row says its state in WORDS. `no card` too: a session launched from
  // the dock has no card, and a blank there would read as missing data.
  const attentions = list.getByTestId('session-list-attention');
  for (let i = 0; i < 3; i += 1) {
    await expect(attentions.nth(i)).toHaveText(/^(running|waiting|starting)/);
  }
  await expect(rows.first()).toContainText('no card');

  // Focus is not decoration: it brings that window to the top of the stack.
  await list.getByTestId('session-list-focus').first().click();

  const oldest = await page.evaluate(() => {
    const wins = (window as any).__DESKTOP_STORE__.getState().windows
      .filter((w: any) => w.type === 'agent-session')
      .sort((a: any, b: any) => a.agentSession.launchedAt - b.agentSession.launchedAt);
    return wins[0].id as string;
  });

  const after = await windowRects();
  const top = after.reduce((best, w) => (w.zIndex > best.zIndex ? w : best), after[0]);
  expect(top.id).toBe(oldest);
});
