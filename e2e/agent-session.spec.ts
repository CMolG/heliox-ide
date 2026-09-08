/**
 * agent-session.spec.ts — End-to-end proof that a real PTY runs in a window
 *
 * This is the one test that exercises the whole Cockpit F1 chain for real:
 * renderer → preload → `fluxor:pty-spawn` → node-pty → a live process → its
 * output pushed back → xterm rendering it → a keystroke travelling the other
 * way → the exit code landing in the window's status badge. Everything below
 * that chain is unit-tested with doubles; nothing but this proves the native
 * module actually loads under Electron and that the two halves agree.
 *
 * The agent is `e2e/fixtures/fake-agent.sh`, pointed at through
 * `FLUXOR_AGENT_BIN_CLAUDE` (see src/main/pty/vendors.ts) — no LLM, no
 * network, no login, and a deterministic exit code.
 *
 * Architecture note: the window is injected through `__DESKTOP_STORE__`, the
 * same convention `backlog-dnd.spec.ts` uses, so the test does not depend on
 * the dock picker's own rendering.
 */
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import { getElectronLaunchArgs, getE2EEnv } from './test-helpers';

const REPO_ROOT = path.join(__dirname, '..');
const FAKE_AGENT = path.join(__dirname, 'fixtures', 'fake-agent.sh');

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
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

  // App.tsx renders a project picker instead of the desktop while no project
  // is open (App.tsx's `if (!projectPath)` branch), so there would be no
  // canvas to mount a window into. Same setup the other desktop specs use.
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

test('runs a real PTY in an agent-session window and reports its exit code', async () => {
  await page.evaluate((cwd) => {
    const ds = (window as any).__DESKTOP_STORE__;
    ds.getState().addWindow('agent-session', {
      title: 'E2E agent session',
      iconName: 'Terminal',
      size: { width: 720, height: 480 },
      agentSession: {
        sessionId: 'e2e-1',
        vendor: 'claude',
        cwd,
        mode: 'attached',
        launchedAt: Date.now(),
        ptyStarted: false,
        attention: 'starting',
      },
    });
  }, REPO_ROOT);

  const terminal = page.getByTestId('agent-session-terminal');
  await expect(terminal).toBeVisible({ timeout: 10_000 });

  // 1. The process really started and its stdout reached xterm.
  await expect(terminal).toContainText('FAKE AGENT READY', { timeout: 20_000 });

  // 2. The badge says the state in WORDS — this is the assertion that would
  //    fail if the status were ever communicated by colour alone.
  await expect(page.getByTestId('agent-session-status')).toHaveText('running', { timeout: 10_000 });

  // 3. Keystrokes travel the other way: type into the terminal, and the
  //    fixture echoes the line back through the PTY.
  await terminal.click();
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await expect(terminal).toContainText('echo:hello', { timeout: 10_000 });

  // 4. `exit` ends the process with code 0, and the window says so.
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('agent-session-status')).toHaveText('ended · exit 0', { timeout: 15_000 });
  await expect(page.getByTestId('agent-session-ended')).toContainText('exit 0');

  // 5. The ended window offers a way forward rather than being a dead end.
  await expect(page.getByTestId('agent-session-restart')).toBeVisible();
});
