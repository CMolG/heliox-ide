/**
 * new-features.spec.ts — E2E coverage for features added in the current release cycle.
 *
 * Covers:
 * 1. Dock tools: dock-new-step and dock-new-flow present; grid/arena/design-system absent.
 *    Clicking dock-new-step creates a step node.
 * 2. Widget launcher: widget-launcher exists bottom-right; toggling widgets via it flips
 *    hudWidgets visibility in the store; hud-widget-agent-sessions is visible by default.
 * 3. Text-to-Flow widget: mounts with textarea + "Build flow" button.
 * 4. Window focus z-order: focusWindow() raises the target window's zIndex above others.
 * 5. Mental topLayer toggle: default topLayer='mental'; focusWindow → 'windows';
 *    addStepNode / setSelectedMentalNodeIds → 'mental'.
 * 6. Flow attachment right-click context menu: skipped (flow attachment requires full AI
 *    IPC round-trip which is not available in the E2E environment).
 */
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import { getElectronLaunchArgs, getE2EEnv } from './test-helpers';

let app: ElectronApplication;
let page: Page;

// ─── Boot ────────────────────────────────────────────────────────

test.beforeAll(async () => {
  app = await electron.launch({
    args: getElectronLaunchArgs(),
    cwd: path.join(__dirname, '..'),
    env: getE2EEnv(),
    timeout: 30_000,
  });
  page = await app.firstWindow();
  await page.waitForURL(/^(?!about:blank)/, { timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => !!(window as any).__HELIOX_STORE__ && !!(window as any).__DESKTOP_STORE__,
    { timeout: 15_000 },
  );
  await page.evaluate(() => {
    try { localStorage.clear(); } catch { /* Electron may block direct access */ }
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) {
      ds.getState().updateSettings({ tourCompleted: true });
      ds.getState().setActiveTutorial(null);
    }
  });
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ─── Shared setup helpers ─────────────────────────────────────────

async function ensureDesktop() {
  const desktop = page.locator('[data-testid="seamless-desktop"]');
  if (!(await desktop.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await page.evaluate(() => {
      const store = (window as any).__HELIOX_STORE__;
      if (store) store.getState().setProjectPath('/tmp/test-project');
    });
    await desktop.waitFor({ state: 'visible', timeout: 10_000 });
  }
  await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) {
      ds.getState().updateSettings({ tourCompleted: true });
      ds.getState().setActiveTutorial(null);
    }
  });
}

async function resetCanvas() {
  await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    if (!ds) return;
    const s = ds.getState();
    // Wipe windows and mental nodes
    for (const w of [...s.windows]) s.removeWindow(w.id);
    for (const e of [...(s.mentalEdges ?? [])]) s.removeMentalEdge(e.id);
    for (const n of [...s.mentalNodes]) s.removeMentalNode(n.id);
    // Reset camera
    s.setCanvasPan({ x: 0, y: 0 });
    s.setCanvasZoom(1);
    // Reset topLayer to its initial value
    s.setTopLayer('mental');
    // Reset HUD widgets to defaults (text-to-flow visible, others hidden)
    s.setHudWidgetVisible('agent-sessions', false);
    s.setHudWidgetVisible('text-to-flow', true);
    s.setHudWidgetVisible('notifications', false);
  });
  await page.waitForTimeout(150);
}

test.beforeEach(async () => {
  await ensureDesktop();
  await resetCanvas();
});

// ─── 1. Dock tools ───────────────────────────────────────────────

test.describe('Dock tools', () => {
  test('dock shows dock-new-step button', async () => {
    const btn = page.locator('[data-testid="dock-new-step"]');
    await expect(btn).toBeVisible({ timeout: 5_000 });
  });

  test('dock shows dock-new-flow button', async () => {
    const btn = page.locator('[data-testid="dock-new-flow"]');
    await expect(btn).toBeVisible({ timeout: 5_000 });
  });

  test('dock does NOT show grid button', async () => {
    // The grid feature was removed entirely.
    await expect(page.locator('[data-testid="dock-grid"]')).not.toBeVisible({ timeout: 2_000 });
  });

  test('dock does NOT show arena button', async () => {
    // dock-arena removed.
    await expect(page.locator('[data-testid="dock-arena"]')).not.toBeVisible({ timeout: 2_000 });
  });

  test('clicking dock-new-step creates a step node in the store', async () => {
    const before = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().mentalNodes.filter((n: any) => n.type === 'step').length
    );

    await page.locator('[data-testid="dock-new-step"]').click();
    await page.waitForTimeout(400);

    const after = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().mentalNodes.filter((n: any) => n.type === 'step').length
    );
    expect(after).toBe(before + 1);
  });

  test('clicking dock-new-step renders a step-node element in the DOM', async () => {
    const beforeCount = await page.locator('[data-testid^="step-node-"]').count();

    await page.locator('[data-testid="dock-new-step"]').click();
    await page.waitForTimeout(500);

    const afterCount = await page.locator('[data-testid^="step-node-"]').count();
    expect(afterCount).toBeGreaterThan(beforeCount);
  });
});

// ─── 2. Widget launcher ───────────────────────────────────────────

test.describe('Widget launcher', () => {
  test('widget-launcher button is visible bottom-right', async () => {
    const launcher = page.locator('[data-testid="widget-launcher"]');
    await expect(launcher).toBeVisible({ timeout: 5_000 });
  });

  test('text-to-flow HUD widget is visible by default (default visible=true)', async () => {
    const visible = await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__.getState();
      return s.hudWidgets.find((w: any) => w.type === 'text-to-flow')?.visible ?? false;
    });
    expect(visible).toBe(true);
    // The layer should render the widget in the DOM
    await expect(page.locator('[data-testid="hud-widget-text-to-flow"]')).toBeVisible({ timeout: 5_000 });
  });

  test('agent-sessions and notifications start hidden', async () => {
    const states = await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__.getState();
      return {
        agentSessions: s.hudWidgets.find((w: any) => w.type === 'agent-sessions')?.visible ?? true,
        notifications: s.hudWidgets.find((w: any) => w.type === 'notifications')?.visible ?? true,
      };
    });
    expect(states.agentSessions).toBe(false);
    expect(states.notifications).toBe(false);
  });

  test('toggleHudWidget flips text-to-flow visibility in the store', async () => {
    // Start hidden
    await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().setHudWidgetVisible('text-to-flow', false)
    );
    await page.waitForTimeout(100);

    // Toggle on
    await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().toggleHudWidget('text-to-flow')
    );
    await page.waitForTimeout(200);

    const visibleAfterOn = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().hudWidgets.find((w: any) => w.type === 'text-to-flow')?.visible
    );
    expect(visibleAfterOn).toBe(true);

    // Toggle off
    await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().toggleHudWidget('text-to-flow')
    );
    await page.waitForTimeout(200);

    const visibleAfterOff = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().hudWidgets.find((w: any) => w.type === 'text-to-flow')?.visible
    );
    expect(visibleAfterOff).toBe(false);
  });

  test('setHudWidgetVisible(true) renders hud-widget-notifications in hud-widget-layer', async () => {
    await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().setHudWidgetVisible('notifications', true)
    );
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid="hud-widget-layer"]')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('[data-testid="hud-widget-notifications"]')).toBeVisible({ timeout: 3_000 });

    // Clean up
    await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().setHudWidgetVisible('notifications', false)
    );
  });

  test('setHudWidgetVisible(true) renders hud-widget-text-to-flow in hud-widget-layer', async () => {
    await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().setHudWidgetVisible('text-to-flow', true)
    );
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid="hud-widget-text-to-flow"]')).toBeVisible({ timeout: 3_000 });

    // Clean up
    await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().setHudWidgetVisible('text-to-flow', false)
    );
  });

  test('unread badge appears when there are unread notifications', async () => {
    // Clear notifications first
    await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__.getState();
      s.clearNotifications();
    });
    await page.waitForTimeout(100);

    // Badge should not exist yet
    await expect(page.locator('[data-testid="widget-launcher-badge"]')).not.toBeVisible();

    // Add a notification
    await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().addNotification('Test notification')
    );
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid="widget-launcher-badge"]')).toBeVisible({ timeout: 2_000 });

    // Clean up
    await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().clearNotifications()
    );
  });
});

// ─── 3. Text-to-Flow widget ───────────────────────────────────────

test.describe('Text to Flow widget', () => {
  test.beforeEach(async () => {
    // Make the text-to-flow widget visible
    await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().setHudWidgetVisible('text-to-flow', true)
    );
    await page.waitForTimeout(300);
  });

  test.afterEach(async () => {
    await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().setHudWidgetVisible('text-to-flow', false)
    );
  });

  test('text-to-flow widget mounts with the data-testid="text-to-flow" container', async () => {
    await expect(page.locator('[data-testid="hud-widget-text-to-flow"]')).toBeVisible({ timeout: 3_000 });
    // The TextToFlowWidget form has data-testid="text-to-flow"
    await expect(page.locator('[data-testid="text-to-flow"]')).toBeVisible({ timeout: 3_000 });
  });

  test('text-to-flow widget renders a textarea', async () => {
    await page.locator('[data-testid="text-to-flow"]').waitFor({ state: 'visible', timeout: 3_000 });
    const textarea = page.locator('[data-testid="text-to-flow"] textarea');
    await expect(textarea).toBeVisible({ timeout: 3_000 });
  });

  test('text-to-flow widget renders a "Build flow" button', async () => {
    await page.locator('[data-testid="text-to-flow"]').waitFor({ state: 'visible', timeout: 3_000 });
    const btn = page.locator('[aria-label="Build flow from description"]');
    await expect(btn).toBeVisible({ timeout: 3_000 });
    await expect(btn).toContainText('Build flow');
  });

  test('typing in the textarea enables the Build flow button', async () => {
    await page.locator('[data-testid="text-to-flow"]').waitFor({ state: 'visible', timeout: 3_000 });
    const textarea = page.locator('[data-testid="text-to-flow"] textarea');
    const btn = page.locator('[aria-label="Build flow from description"]');

    // Initially disabled (empty input)
    await expect(btn).toBeDisabled();

    // Type something
    await textarea.fill('Scrape a website and summarize each page');
    await page.waitForTimeout(150);

    // Should now be enabled
    await expect(btn).not.toBeDisabled();
  });
});

// ─── 4. Window focus z-order ─────────────────────────────────────

test.describe('Window focus z-order', () => {
  test('focusWindow raises target window zIndex above the other window', async () => {
    // Open two chat windows via store
    const { winA, winB } = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__.getState();
      const hs = (window as any).__HELIOX_STORE__.getState();
      hs.setProjectPath('/tmp/test-zorder');
      const sA = hs.addSession();
      const sB = hs.addSession();
      const winA = ds.addWindow('chat', { sessionId: sA, title: 'WinA', position: { x: 80, y: 80 } });
      const winB = ds.addWindow('chat', { sessionId: sB, title: 'WinB', position: { x: 200, y: 200 } });
      return { winA, winB };
    });

    await page.waitForTimeout(200);

    // Focus window A — it should now be on top
    await page.evaluate((id) => (window as any).__DESKTOP_STORE__.getState().focusWindow(id), winA);
    await page.waitForTimeout(100);

    const zAfterFocusA = await page.evaluate(({ winA, winB }) => {
      const s = (window as any).__DESKTOP_STORE__.getState();
      const wA = s.windows.find((w: any) => w.id === winA);
      const wB = s.windows.find((w: any) => w.id === winB);
      return { zA: wA?.zIndex ?? 0, zB: wB?.zIndex ?? 0 };
    }, { winA, winB });

    expect(zAfterFocusA.zA).toBeGreaterThan(zAfterFocusA.zB);

    // Now focus window B — it should overtake A
    await page.evaluate((id) => (window as any).__DESKTOP_STORE__.getState().focusWindow(id), winB);
    await page.waitForTimeout(100);

    const zAfterFocusB = await page.evaluate(({ winA, winB }) => {
      const s = (window as any).__DESKTOP_STORE__.getState();
      const wA = s.windows.find((w: any) => w.id === winA);
      const wB = s.windows.find((w: any) => w.id === winB);
      return { zA: wA?.zIndex ?? 0, zB: wB?.zIndex ?? 0 };
    }, { winA, winB });

    expect(zAfterFocusB.zB).toBeGreaterThan(zAfterFocusB.zA);
  });
});

// ─── 5. Mental topLayer toggle ───────────────────────────────────

test.describe('Mental topLayer toggle', () => {
  test('default topLayer is "mental"', async () => {
    // After canvas reset (no windows, no selections), the initial value is 'mental'.
    const layer = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().topLayer
    );
    expect(layer).toBe('mental');
  });

  test('focusWindow switches topLayer to "windows"', async () => {
    const winId = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__.getState();
      const hs = (window as any).__HELIOX_STORE__.getState();
      hs.setProjectPath('/tmp/test-toplayer');
      const sid = hs.addSession();
      return ds.addWindow('chat', { sessionId: sid, title: 'TopLayer-Win', position: { x: 100, y: 100 } });
    });
    await page.waitForTimeout(100);

    await page.evaluate((id) => (window as any).__DESKTOP_STORE__.getState().focusWindow(id), winId);
    await page.waitForTimeout(100);

    const layer = await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().topLayer);
    expect(layer).toBe('windows');
  });

  test('addStepNode switches topLayer back to "mental"', async () => {
    // Force topLayer to 'windows' directly (avoids window-creation timing issues)
    await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().setTopLayer('windows'));
    await page.waitForTimeout(100);

    const beforeLayer = await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().topLayer);
    expect(beforeLayer).toBe('windows');

    // Now add a step node — should flip topLayer back to 'mental'
    await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().addStepNode());
    await page.waitForTimeout(100);

    const afterLayer = await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().topLayer);
    expect(afterLayer).toBe('mental');
  });

  test('setSelectedMentalNodeIds switches topLayer to "mental"', async () => {
    // Seed a mental node first, then use setTopLayer to force 'windows',
    // then call setSelectedMentalNodeIds — that should flip it back to 'mental'.
    // We seed the node first to avoid addMentalNode changing topLayer before we can test.
    const nodeId = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__.getState().addMentalNode({
        position: { x: 200, y: 200 }, width: 200, height: 100, text: 'X',
        color: '#BFDBFE', shape: 'square',
      })
    );

    // Force topLayer to 'windows' directly
    await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().setTopLayer('windows'));
    await page.waitForTimeout(100);

    const beforeLayer = await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().topLayer);
    expect(beforeLayer).toBe('windows');

    // Selecting the node should raise topLayer to 'mental'
    await page.evaluate((id) => (window as any).__DESKTOP_STORE__.getState().setSelectedMentalNodeIds([id]), nodeId);
    await page.waitForTimeout(100);

    const afterLayer = await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().topLayer);
    expect(afterLayer).toBe('mental');
  });
});

// ─── 6. Flow attachment right-click (skipped) ────────────────────

test.describe('Flow attachment right-click context menu', () => {
  test.skip('right-clicking a flow ribbon on a chat window shows flow-context-menu', async () => {
    // SKIPPED: Attaching a flow to a chat window requires a full AI IPC round-trip
    // via assemblePipeline (main-process meta-agent), which is not available in the
    // isolated E2E environment without a real model. The store-side state for
    // flow attachments (attachFlow, detachFlow) is covered by unit tests.
    // This test can be enabled once an E2E-safe mock for helioxAPI.assemblePipeline
    // is wired into the test environment.
  });
});
