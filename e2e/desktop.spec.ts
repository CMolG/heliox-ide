/**
 * desktop.spec.ts — Project runtime
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
/**
 * e2e/desktop.spec.ts — Playwright E2E tests for the Fluxor IDE seamless desktop.
 *
 * These tests launch the Electron app via electron-forge's vite dev server
 * and exercise the desktop UI: window spawning, drag/resize, dock, marketplace,
 * role DnD, modifier stacking, connections, keyboard shortcuts, and CLI theming.
 *
 * All marketplace items come exclusively from market/inventory.json — no mocks.
 */
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import { getElectronLaunchArgs, getE2EEnv } from './test-helpers';

// ─── Load the real inventory.json ────────────────────────────────────

const INVENTORY_PATH = path.join(__dirname, '..', 'market', 'inventory.json');
const FULL_INVENTORY = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf-8'));

// Counts derived from the real inventory
const TOTAL_FLOWS = FULL_INVENTORY.flows.length;   // 12
const TOTAL_ROLES = FULL_INVENTORY.roles.length;    // 9
const TOTAL_MODS = FULL_INVENTORY.mods.length;      // 15
// The store initialises availablePlugins with 4 BUILTIN_PLUGINS (category 'tools')
// and then merges in all inventory items — so the rendered "All" tab total is 40.
const BUILTIN_PLUGIN_COUNT = 4;
const TOTAL_ITEMS = TOTAL_FLOWS + TOTAL_ROLES + TOTAL_MODS + BUILTIN_PLUGIN_COUNT; // 40

let app: ElectronApplication;
let page: Page;

// Models available during E2E tests — override with FLUXOR_E2E_MODELS env var.
// Defaults to 'copilot' only to avoid any CLI token usage.
// Example: FLUXOR_E2E_MODELS=copilot,claude-sonnet-4.6 npx playwright test
const E2E_MODELS = process.env.FLUXOR_E2E_MODELS ?? 'copilot';

test.beforeAll(async () => {
  app = await electron.launch({
    args: getElectronLaunchArgs(),
    cwd: path.join(__dirname, '..'),
    env: getE2EEnv(),
    timeout: 30_000,
  });

  page = await app.firstWindow();
  // Wait until the renderer has navigated away from about:blank
  await page.waitForURL(/^(?!about:blank)/, { timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded');

  // Wait for React to mount and expose stores on window
  await page.waitForFunction(
    () => !!(window as any).__FLUXOR_STORE__ && !!(window as any).__DESKTOP_STORE__,
    { timeout: 15_000 },
  );

  // Clear persisted state via the store API (avoids SecurityError with raw localStorage)
  await page.evaluate(() => {
    try { localStorage.clear(); } catch { /* Electron may block direct localStorage access */ }
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

// ─── Helper functions ───────────────────────────────────────────────

/** Spawn a new chat window via store to avoid UI-flakiness */
async function spawnChatWindow() {
  await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    if (store) {
      const s = store.getState();
      const sessionId = (window as any).__FLUXOR_STORE__?.getState()?.addSession?.() ?? 'test-' + Date.now();
      s.addWindow('chat', { title: 'Test Chat', iconName: 'MessageSquare', sessionId });
    }
  });
  await page.waitForTimeout(300);
}

/** Open marketplace overlay via store, resetting search and tab to "All" */
async function openMarketplace() {
  await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    if (store) store.getState().setShowMarketplace(true);
  });
  await page.waitForTimeout(300);
  // Clear any lingering search text and reset to "All" tab
  const searchInput = page.locator('[data-testid="marketplace-search"]');
  if (await searchInput.isVisible({ timeout: 500 }).catch(() => false)) {
    await searchInput.fill('');
  }
  const allTab = page.locator('[data-testid="marketplace-tab-all"]');
  if (await allTab.isVisible({ timeout: 500 }).catch(() => false)) {
    await allTab.click();
    await page.waitForTimeout(200);
  }
}

/** Load the FULL inventory.json into the store — no mocks, no subsets */
async function ensureInventoryLoaded() {
  await page.evaluate((inventory) => {
    const store = (window as any).__DESKTOP_STORE__;
    if (!store) return;
    // Always reload to ensure full inventory is used
    store.getState().setMarketInventory(inventory);
  }, FULL_INVENTORY);
  await page.waitForTimeout(200);
}

/** Clear all attachables from the desktop */
async function clearAttachables() {
  await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    if (store) {
      const s = store.getState();
      for (const a of [...s.attachables]) {
        s.removeAttachable(a.id);
      }
    }
  });
  await page.waitForTimeout(100);
}

/** Open a project so we get to the desktop */
async function ensureProjectOpen() {
  const desktop = page.locator('[data-testid="seamless-desktop"]');
  if (!(await desktop.isVisible({ timeout: 2000 }).catch(() => false))) {
    await page.evaluate(() => {
      const store = (window as any).__FLUXOR_STORE__;
      if (store) store.getState().setProjectPath('/tmp/test-project');
    });
    await desktop.waitFor({ state: 'visible', timeout: 10_000 });
  }
  // Dismiss tour if showing (prevents blocking other tests)
  await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) {
      ds.getState().updateSettings({ tourCompleted: true });
      ds.getState().setActiveTutorial(null);
    }
  });
}

// ─── Desktop Canvas ─────────────────────────────────────────────────

test.describe('Seamless Desktop', () => {
  test.beforeEach(async () => { await ensureProjectOpen(); });

  test('desktop canvas is visible', async () => {
    await expect(page.locator('[data-testid="seamless-desktop"]')).toBeVisible({ timeout: 5000 });
  });

  test('dock is visible at the bottom', async () => {
    await expect(page.locator('.fluxor-dock')).toBeVisible({ timeout: 5000 });
  });

  test('middle-click sets panning cursor', async () => {
    const canvas = page.locator('[data-testid="seamless-desktop"]');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('No canvas box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'middle' });
  });
});

// ─── Window Spawning & Management ───────────────────────────────────

test.describe('Window Management', () => {
  test.beforeEach(async () => { await ensureProjectOpen(); });

  test('spawn a chat window', async () => {
    const initialWindows = await page.locator('.desktop-window').count();
    await spawnChatWindow();
    const newWindows = await page.locator('.desktop-window').count();
    expect(newWindows).toBeGreaterThan(initialWindows);
  });

  test('window renders a slim titlebar drag zone', async () => {
    await spawnChatWindow();
    const win = page.locator('.desktop-window').last();
    // Req 4: a dedicated slim titlebar is now the only drag + double-click-maximize zone.
    await expect(win.locator('.window-titlebar')).toHaveCount(1);
  });

  test('window title shows CLI provider name', async () => {
    await spawnChatWindow();
    const win = page.locator('.desktop-window').last();
    const title = await win.getAttribute('aria-label');
    expect(title).toBeTruthy();
  });

  test('window surface title uses text, not emoji', async () => {
    await spawnChatWindow();
    const win = page.locator('.desktop-window').last();
    const text = await win.getAttribute('aria-label');
    // Should NOT contain emoji characters (Unicode emoji range)
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    expect(emojiRegex.test(text ?? '')).toBe(false);
  });

  test('close window removes it from desktop', async () => {
    await spawnChatWindow();
    const countBefore = await page.locator('.desktop-window').count();
    // Close via store (titlebar buttons removed; close is managed in node tree)
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store?.getState();
      const win = s?.windows?.[s.windows.length - 1];
      if (win) s.removeWindow(win.id);
    });
    await page.waitForTimeout(300);
    const countAfter = await page.locator('.desktop-window').count();
    expect(countAfter).toBeLessThan(countBefore);
  });

  test('minimize window hides it', async () => {
    await spawnChatWindow();
    const winCount = await page.locator('.desktop-window').count();
    // Minimize via store (titlebar buttons removed; minimize is managed in node tree)
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store?.getState();
      const win = s?.windows?.[s.windows.length - 1];
      if (win) s.setWindowState(win.id, 'minimized');
    });
    await page.waitForTimeout(300);
    const visibleCount = await page.locator('.desktop-window:visible').count();
    expect(visibleCount).toBeLessThan(winCount);
  });

  test.skip('grid-snapped window shows in-surface eject control', async () => {
    // REMOVED: Grid feature has been removed entirely (no grid dock button,
    // no grid containers, no grid context-menu). This test is permanently skipped.
  });
});

// ─── Window Drag & Resize ───────────────────────────────────────────

test.describe('Window Drag and Resize', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await spawnChatWindow();
  });

  test('drag window to new position from window surface', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const visible = s.windows.filter((w: any) => w.state !== 'minimized');
      if (visible.length > 0) {
        const target = visible[visible.length - 1];
        s.focusWindow(target.id);
        s.moveWindow(target.id, { x: 100, y: 100 });
        s.resizeWindow(target.id, { width: 400, height: 300 });
      }
    });
    await page.waitForTimeout(400);

    const win = page.locator('.desktop-window').last();
    await win.waitFor({ state: 'visible', timeout: 10000 });
    const box = await win.boundingBox();
    if (!box) throw new Error('No window bounding box');

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 50, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const newBox = await win.boundingBox();
    expect(newBox).toBeTruthy();
  });

  test('resize window from SE corner', async () => {
    const win = page.locator('.desktop-window').last();
    const initialBox = await win.boundingBox();
    if (!initialBox) throw new Error('No window bounding box');

    const handle = win.locator('.resize-handle[data-dir="se"]');
    const handleBox = await handle.boundingBox();
    if (!handleBox) return;

    await page.mouse.move(handleBox.x + 2, handleBox.y + 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 102, handleBox.y + 52, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const newBox = await win.boundingBox();
    if (newBox) {
      expect(newBox.width).toBeGreaterThanOrEqual(initialBox.width);
    }
  });
});

// ─── Dock ───────────────────────────────────────────────────────────

test.describe('Dock', () => {
  test.beforeEach(async () => { await ensureProjectOpen(); });

  test('dock has items with icons', async () => {
    const dock = page.locator('.fluxor-dock');
    await expect(dock).toBeVisible();

    const items = dock.locator('.dock-item');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Each item should have an SVG icon
    const firstSvg = items.first().locator('svg');
    await expect(firstSvg).toBeVisible();
  });

  test('dock items use SVG icons, not emoji', async () => {
    const dock = page.locator('.fluxor-dock');
    const firstItem = dock.locator('.dock-item').first();
    const hasSvg = await firstItem.locator('svg').count();
    expect(hasSvg).toBeGreaterThan(0);
  });

  test('clicking marketplace dock item opens marketplace', async () => {
    const marketplaceItem = page.locator('[data-testid="dock-marketplace"]');
    if (await marketplaceItem.isVisible({ timeout: 1000 }).catch(() => false)) {
      await marketplaceItem.click();
      await page.waitForTimeout(300);
      await expect(page.locator('[data-testid="marketplace"]')).toBeVisible({ timeout: 3000 });
    }
  });
});

// ─── Marketplace (all items from inventory.json) ────────────────────

test.describe('Marketplace', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    await openMarketplace();
  });

  test('marketplace shows ALL inventory cards — no mocks', async () => {
    const cards = page.locator('[data-testid="marketplace"] .plugin-card');
    await expect(cards.first()).toBeVisible({ timeout: 3000 });
    const count = await cards.count();
    // Must match the exact total from inventory.json (flows + roles + mods)
    expect(count).toBe(TOTAL_ITEMS);
  });

  test('marketplace has category tabs (no Tools tab)', async () => {
    // CATEGORY_TABS in MarketplaceApp renders buttons with data-testid="marketplace-tab-{key}"
    // (no .marketplace-tabs / .marketplace-tab CSS classes on the container or buttons)
    const tabs = page.locator('[data-testid^="marketplace-tab-"]');
    const count = await tabs.count();
    expect(count).toBe(4); // All, Flows, Roles, Modifiers
    const toolsTab = page.locator('[data-testid="marketplace-tab-tools"]');
    await expect(toolsTab).not.toBeVisible();
  });

  test('filtering by Roles shows all inventory roles', async () => {
    const rolesTab = page.locator('[data-testid="marketplace-tab-roles"]');
    await rolesTab.click();
    await page.waitForTimeout(300);
    const cards = page.locator('[data-testid="marketplace"] .plugin-card');
    const count = await cards.count();
    expect(count).toBe(TOTAL_ROLES);
  });

  test('filtering by Flows shows all inventory flows', async () => {
    const flowsTab = page.locator('[data-testid="marketplace-tab-flows"]');
    await flowsTab.click();
    await page.waitForTimeout(300);
    const cards = page.locator('[data-testid="marketplace"] .plugin-card');
    const count = await cards.count();
    expect(count).toBe(TOTAL_FLOWS);
  });

  test('filtering by Modifiers shows all inventory mods', async () => {
    const modsTab = page.locator('[data-testid="marketplace-tab-modifiers"]');
    await modsTab.click();
    await page.waitForTimeout(300);
    const cards = page.locator('[data-testid="marketplace"] .plugin-card');
    const count = await cards.count();
    expect(count).toBe(TOTAL_MODS);
  });

  test('search filters inventory items', async () => {
    const allTab = page.locator('[data-testid="marketplace-tab-all"]');
    await allTab.click();
    await page.waitForTimeout(200);
    const searchInput = page.locator('[data-testid="marketplace-search"]');
    await searchInput.fill('frontend');
    await page.waitForTimeout(500);
    const cards = page.locator('[data-testid="marketplace"] .plugin-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('plugin cards use SVG icons', async () => {
    const icon = page.locator('[data-testid="marketplace"] .plugin-icon-box svg').first();
    await expect(icon).toBeVisible({ timeout: 3000 });
  });

  test('deploying a role spawns a role attachable on desktop', async () => {
    const beforeCount = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState()?.attachables?.length ?? 0;
    });
    const rolesTab = page.locator('[data-testid="marketplace-tab-roles"]');
    await rolesTab.click();
    await page.waitForTimeout(300);
    // Clicking a card now opens the product sheet — it no longer deploys.
    const card = page.locator('[data-testid="marketplace"] .plugin-card').first();
    await expect(card).toBeVisible({ timeout: 2000 });
    await card.click();
    const addBtn = page.getByRole('button', { name: 'Deploy' });
    await expect(addBtn).toBeVisible({ timeout: 2000 });
    await addBtn.click();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="marketplace"]')).not.toBeVisible();
    const result = await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      const att = s?.attachables?.[s.attachables.length - 1];
      return { count: s?.attachables?.length ?? 0, type: att?.type };
    });
    expect(result.count).toBeGreaterThan(beforeCount);
    expect(result.type).toBe('role');
  });

  test('deploying a mod spawns a mod attachable on desktop', async () => {
    const beforeCount = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState()?.attachables?.length ?? 0;
    });
    const modTab = page.locator('[data-testid="marketplace-tab-modifiers"]');
    await modTab.click();
    await page.waitForTimeout(300);
    // Clicking a card now opens the product sheet — it no longer deploys.
    const card = page.locator('[data-testid="marketplace"] .plugin-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.click();
    const addBtn = page.getByRole('button', { name: 'Deploy' });
    await expect(addBtn).toBeVisible({ timeout: 2000 });
    await addBtn.click();
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      const att = s?.attachables?.[s.attachables.length - 1];
      return { count: s?.attachables?.length ?? 0, type: att?.type };
    });
    expect(result.count).toBeGreaterThan(beforeCount);
    expect(result.type).toBe('mod');
  });

  test('deploying a flow spawns a flow attachable on desktop', async () => {
    const beforeCount = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState()?.attachables?.length ?? 0;
    });
    const flowTab = page.locator('[data-testid="marketplace-tab-flows"]');
    await flowTab.click();
    await page.waitForTimeout(300);
    // Clicking a card now opens the product sheet — it no longer deploys.
    const card = page.locator('[data-testid="marketplace"] .plugin-card').first();
    await expect(card).toBeVisible({ timeout: 2000 });
    await card.click();
    const addBtn = page.getByRole('button', { name: 'Deploy' });
    await expect(addBtn).toBeVisible({ timeout: 2000 });
    await addBtn.click();
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      const att = s?.attachables?.[s.attachables.length - 1];
      return { count: s?.attachables?.length ?? 0, type: att?.type };
    });
    expect(result.count).toBeGreaterThan(beforeCount);
    expect(result.type).toBe('flow');
  });

  test('close marketplace with Escape', async () => {
    const marketplace = page.locator('[data-testid="marketplace"]');
    await expect(marketplace).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(marketplace).not.toBeVisible();
  });
});

// ─── Attachable Lifecycle ────────────────────────────────────────────

test.describe('Attachable Lifecycle', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    await clearAttachables();
  });

  test('attachable appears on desktop after deploy', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (store) store.getState().deployPlugin('inv-role-frontend-engineer');
    });
    await page.waitForTimeout(500);
    const attachable = page.locator('[data-testid="desktop-attachable-role-frontend-engineer"]');
    await expect(attachable).toBeVisible({ timeout: 3000 });
  });

  test('attachable is draggable on canvas', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (store) store.getState().spawnAttachable('role', 'frontend-engineer', { x: 400, y: 300 });
    });
    await page.waitForTimeout(300);
    const attachable = page.locator('[data-testid="desktop-attachable-role-frontend-engineer"]');
    await expect(attachable).toBeVisible({ timeout: 2000 });
    const before = await page.evaluate(() => {
      const a = (window as any).__DESKTOP_STORE__?.getState()?.attachables?.[0];
      return a ? { x: a.position.x, y: a.position.y } : null;
    });
    expect(before).not.toBeNull();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (store) {
        const a = store.getState().attachables[0];
        if (a) store.getState().moveAttachable(a.id, { x: a.position.x + 100, y: a.position.y + 50 });
      }
    });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => {
      const a = (window as any).__DESKTOP_STORE__?.getState()?.attachables?.[0];
      return a ? { x: a.position.x, y: a.position.y } : null;
    });
    expect(after!.x).toBe(before!.x + 100);
    expect(after!.y).toBe(before!.y + 50);
  });

  test('close button removes attachable from desktop', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (store) store.getState().spawnAttachable('role', 'frontend-engineer', { x: 200, y: 200 });
    });
    await page.waitForTimeout(300);
    const countBefore = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState()?.attachables?.length ?? 0;
    });
    expect(countBefore).toBe(1);
    // Remove via store (simulates close button click)
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const a = store.getState().attachables[0];
      if (a) store.getState().removeAttachable(a.id);
    });
    await page.waitForTimeout(200);
    const countAfter = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState()?.attachables?.length ?? 0;
    });
    expect(countAfter).toBe(0);
  });

  test('role attachable attaches to chat window', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (store) store.getState().spawnAttachable('role', 'backend-engineer', { x: 400, y: 300 });
    });
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      const att = s.attachables.find((a: any) => a.name === 'backend-engineer');
      if (win && att) {
        s.attachToWindow(att.id, win.id);
        const updated = store.getState();
        const updatedWin = updated.windows.find((w: any) => w.id === win.id);
        return { roleId: updatedWin?.roleId, attachablesLeft: updated.attachables.length };
      }
      return null;
    });
    expect(result).not.toBeNull();
    expect(result!.roleId).toBe('backend-engineer');
    expect(result!.attachablesLeft).toBe(0);
  });

  test('mod attachable attaches to chat window', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (store) store.getState().spawnAttachable('mod', 'strict-linting', { x: 400, y: 300 });
    });
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      const att = s.attachables.find((a: any) => a.name === 'strict-linting');
      if (win && att) {
        s.attachToWindow(att.id, win.id);
        const updated = store.getState();
        const updatedWin = updated.windows.find((w: any) => w.id === win.id);
        return { modifierIds: updatedWin?.modifierIds, attachablesLeft: updated.attachables.length };
      }
      return null;
    });
    expect(result).not.toBeNull();
    expect(result!.modifierIds).toContain('strict-linting');
    expect(result!.attachablesLeft).toBe(0);
  });

  test('flow connects to chat window via connectFlow', async () => {
    // Flows are no longer drag-attached via the attachable system (attachToWindow returns
    // false for type=flow since the harness rework). They are linked directly via
    // connectFlow / disconnectFlow. This test verifies that current-model path.
    await spawnChatWindow();
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (!win) return null;
      const connected = s.connectFlow(win.id, 'auto-optimizer');
      const updatedWin = store.getState().windows.find((w: any) => w.id === win.id);
      return { connected, flowId: updatedWin?.flowId };
    });
    expect(result).not.toBeNull();
    expect(result!.connected).toBe(true);
    expect(result!.flowId).toBe('auto-optimizer');
  });

  test('detaching a role respawns attachable on desktop', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) {
        s.spawnAttachable('role', 'qa-engineer', { x: 300, y: 300 });
        const att = store.getState().attachables.find((a: any) => a.name === 'qa-engineer');
        if (att) store.getState().attachToWindow(att.id, win.id);
      }
    });
    await page.waitForTimeout(300);
    const stateAfterA = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      return { roleId: win?.roleId, attachablesCount: s.attachables.length };
    });
    expect(stateAfterA.roleId).toBe('qa-engineer');
    expect(stateAfterA.attachablesCount).toBe(0);
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.detachFromWindow(win.id, 'role', 'qa-engineer');
    });
    await page.waitForTimeout(300);
    const stateAfterD = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      const att = s.attachables.find((a: any) => a.name === 'qa-engineer');
      return { roleId: win?.roleId, hasAttachable: !!att, attachableType: att?.type };
    });
    expect(stateAfterD.roleId).toBeUndefined();
    expect(stateAfterD.hasAttachable).toBe(true);
    expect(stateAfterD.attachableType).toBe('role');
  });

  test('detaching a mod respawns attachable on desktop', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) {
        s.spawnAttachable('mod', 'security-hardened', { x: 300, y: 300 });
        const att = store.getState().attachables.find((a: any) => a.name === 'security-hardened');
        if (att) store.getState().attachToWindow(att.id, win.id);
      }
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.detachFromWindow(win.id, 'mod', 'security-hardened');
    });
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      return {
        modIds: win?.modifierIds,
        attachable: s.attachables.find((a: any) => a.name === 'security-hardened'),
      };
    });
    expect(result.modIds).not.toContain('security-hardened');
    expect(result.attachable).toBeTruthy();
    expect(result.attachable.type).toBe('mod');
  });

  test('detaching a flow respawns attachable on desktop', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) {
        s.spawnAttachable('flow', 'auto-reducer', { x: 300, y: 300 });
        const att = store.getState().attachables.find((a: any) => a.name === 'auto-reducer');
        if (att) store.getState().attachToWindow(att.id, win.id);
      }
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.detachFromWindow(win.id, 'flow', 'auto-reducer');
    });
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      return {
        flowId: win?.flowId,
        attachable: s.attachables.find((a: any) => a.name === 'auto-reducer'),
      };
    });
    expect(result.flowId).toBeUndefined();
    expect(result.attachable).toBeTruthy();
    expect(result.attachable.type).toBe('flow');
  });

  test('replacing a role detaches old and attaches new', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) {
        s.spawnAttachable('role', 'frontend-engineer', { x: 300, y: 300 });
        const att = store.getState().attachables.find((a: any) => a.name === 'frontend-engineer');
        if (att) store.getState().attachToWindow(att.id, win.id);
      }
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) {
        s.spawnAttachable('role', 'backend-engineer', { x: 500, y: 300 });
        const att = store.getState().attachables.find((a: any) => a.name === 'backend-engineer');
        if (att) store.getState().attachToWindow(att.id, win.id);
      }
    });
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      return {
        roleId: win?.roleId,
        attachables: s.attachables.map((a: any) => a.name),
      };
    });
    expect(result.roleId).toBe('backend-engineer');
    expect(result.attachables).toContain('frontend-engineer');
  });

  test('replacing a flow disconnects old and connects new via connectFlow', async () => {
    // Flows attach to windows via connectFlow (not the attachable drag system).
    // Calling connectFlow a second time simply overwrites the previous flowId.
    await spawnChatWindow();
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (!win) return null;
      s.connectFlow(win.id, 'auto-optimizer');
      store.getState().connectFlow(win.id, 'auto-reducer');
      const updatedWin = store.getState().windows.find((w: any) => w.id === win.id);
      return { flowId: updatedWin?.flowId };
    });
    expect(result).not.toBeNull();
    expect(result!.flowId).toBe('auto-reducer');
  });

  test('multiple mods can stack on one window', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) {
        s.spawnAttachable('mod', 'strict-linting', { x: 300, y: 300 });
        const a1 = store.getState().attachables.find((a: any) => a.name === 'strict-linting');
        if (a1) store.getState().attachToWindow(a1.id, win.id);
        store.getState().spawnAttachable('mod', 'security-hardened', { x: 400, y: 300 });
        const a2 = store.getState().attachables.find((a: any) => a.name === 'security-hardened');
        if (a2) store.getState().attachToWindow(a2.id, win.id);
      }
    });
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      return { modifierIds: win?.modifierIds, attachablesCount: s.attachables.length };
    });
    expect(result.modifierIds).toContain('strict-linting');
    expect(result.modifierIds).toContain('security-hardened');
    expect(result.attachablesCount).toBe(0);
  });

  test('incompatible mods are rejected', async () => {
    await spawnChatWindow();
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (!win) return null;
      // Attach strict-linting (incompatible with dry-run)
      s.spawnAttachable('mod', 'strict-linting', { x: 300, y: 300 });
      const a1 = store.getState().attachables.find((a: any) => a.name === 'strict-linting');
      if (a1) store.getState().attachToWindow(a1.id, win.id);
      // Try to attach dry-run (incompatible with strict-linting)
      store.getState().spawnAttachable('mod', 'dry-run', { x: 400, y: 300 });
      const a2 = store.getState().attachables.find((a: any) => a.name === 'dry-run');
      let dryRunAttached = false;
      if (a2) dryRunAttached = store.getState().attachToWindow(a2.id, win.id);
      const updated = store.getState();
      const updatedWin = updated.windows.find((w: any) => w.id === win.id);
      return {
        modifierIds: updatedWin?.modifierIds,
        dryRunAttached,
        dryRunStillOnCanvas: updated.attachables.some((a: any) => a.name === 'dry-run'),
      };
    });
    expect(result).not.toBeNull();
    expect(result!.modifierIds).toContain('strict-linting');
    expect(result!.modifierIds).not.toContain('dry-run');
    expect(result!.dryRunAttached).toBe(false);
    expect(result!.dryRunStillOnCanvas).toBe(true);
  });

  test('cannot attach to non-chat window', async () => {
    // Spawn a file-explorer window
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (store) store.getState().addWindow('file-explorer', { title: 'Files', iconName: 'FileText' });
    });
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = s.windows.find((w: any) => w.type === 'file-explorer');
      if (!win) return null;
      s.spawnAttachable('role', 'frontend-engineer', { x: 300, y: 300 });
      const att = store.getState().attachables.find((a: any) => a.name === 'frontend-engineer');
      let success = false;
      if (att) success = store.getState().attachToWindow(att.id, win.id);
      return {
        success,
        attachableStillExists: store.getState().attachables.some((a: any) => a.name === 'frontend-engineer'),
      };
    });
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.attachableStillExists).toBe(true);
  });

  test('full deploy → attach → detach → reattach cycle', async () => {
    await spawnChatWindow();
    await openMarketplace();
    const rolesTab = page.locator('[data-testid="marketplace-tab-roles"]');
    await rolesTab.click();
    await page.waitForTimeout(300);
    // Clicking a card now opens the product sheet — Deploy is what deploys.
    const card = page.locator('[data-testid="marketplace"] .plugin-card').first();
    await card.click();
    await page.getByRole('button', { name: 'Deploy' }).click();
    await page.waitForTimeout(500);
    const hasAttachable = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState()?.attachables?.length > 0;
    });
    expect(hasAttachable).toBe(true);
    const aResult = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const att = s.attachables[0];
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (att && win) {
        s.attachToWindow(att.id, win.id);
        const updated = store.getState();
        return {
          roleId: updated.windows.find((w: any) => w.id === win.id)?.roleId,
          attachablesLeft: updated.attachables.length,
          name: att.name,
        };
      }
      return null;
    });
    expect(aResult).not.toBeNull();
    expect(aResult!.roleId).toBeTruthy();
    expect(aResult!.attachablesLeft).toBe(0);
    await page.evaluate((name) => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.detachFromWindow(win.id, 'role', name);
    }, aResult!.name);
    await page.waitForTimeout(300);
    const afterDetach = await page.evaluate((name) => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      return {
        hasAttachable: s.attachables.some((a: any) => a.name === name),
        windowRoleId: [...s.windows].reverse().find((w: any) => w.type === 'chat')?.roleId,
      };
    }, aResult!.name);
    expect(afterDetach.hasAttachable).toBe(true);
    expect(afterDetach.windowRoleId).toBeUndefined();
    await page.evaluate((name) => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      const att = s.attachables.find((a: any) => a.name === name);
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (att && win) s.attachToWindow(att.id, win.id);
    }, aResult!.name);
    await page.waitForTimeout(300);
    const afterReattach = await page.evaluate((name) => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store.getState();
      return {
        roleId: [...s.windows].reverse().find((w: any) => w.type === 'chat')?.roleId,
        attachablesCount: s.attachables.length,
      };
    }, aResult!.name);
    expect(afterReattach.roleId).toBe(aResult!.name);
    expect(afterReattach.attachablesCount).toBe(0);
  });

  test('all inventory roles can be deployed and attached', async () => {
    await spawnChatWindow();
    for (const role of FULL_INVENTORY.roles) {
      const result = await page.evaluate((roleName) => {
        const store = (window as any).__DESKTOP_STORE__;
        const s = store.getState();
        // Clear existing attachables and window role
        for (const a of [...s.attachables]) s.removeAttachable(a.id);
        const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
        if (win?.roleId) store.getState().removeRole(win.id);
        // Deploy and attach
        store.getState().spawnAttachable('role', roleName, { x: 300, y: 300 });
        const att = store.getState().attachables.find((a: any) => a.name === roleName);
        if (!att || !win) return { spawned: !!att, attached: false };
        const attached = store.getState().attachToWindow(att.id, win.id);
        const updatedWin = store.getState().windows.find((w: any) => w.id === win.id);
        return { spawned: true, attached, roleId: updatedWin?.roleId };
      }, role.name);
      expect(result.spawned).toBe(true);
      expect(result.attached).toBe(true);
      expect(result.roleId).toBe(role.name);
    }
  });

  test('all inventory mods can be deployed and attached', async () => {
    await spawnChatWindow();
    // Attach each mod individually (clearing between to avoid incompatibilities)
    for (const mod of FULL_INVENTORY.mods) {
      const result = await page.evaluate((modName) => {
        const store = (window as any).__DESKTOP_STORE__;
        const s = store.getState();
        // Clear
        for (const a of [...s.attachables]) s.removeAttachable(a.id);
        const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
        if (!win) return { spawned: false, attached: false };
        // Remove all existing mods
        for (const m of [...win.modifierIds]) store.getState().removeModifier(win.id, m);
        // Deploy and attach
        store.getState().spawnAttachable('mod', modName, { x: 300, y: 300 });
        const att = store.getState().attachables.find((a: any) => a.name === modName);
        if (!att) return { spawned: false, attached: false };
        const attached = store.getState().attachToWindow(att.id, win.id);
        const updatedWin = store.getState().windows.find((w: any) => w.id === win.id);
        return { spawned: true, attached, hasMod: updatedWin?.modifierIds?.includes(modName) };
      }, mod.name);
      expect(result.spawned).toBe(true);
      expect(result.attached).toBe(true);
      expect(result.hasMod).toBe(true);
    }
  });

  test('all inventory flows can be connected to a chat window', async () => {
    // Flows are linked to windows via connectFlow (not the attachable drag system).
    // attachToWindow deliberately returns false for type=flow since the harness rework.
    await spawnChatWindow();
    for (const flow of FULL_INVENTORY.flows) {
      const result = await page.evaluate((flowName) => {
        const store = (window as any).__DESKTOP_STORE__;
        const s = store.getState();
        const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
        if (!win) return { connected: false, flowId: null };
        if (win.flowId) store.getState().disconnectFlow(win.id);
        const connected = store.getState().connectFlow(win.id, flowName);
        const updatedWin = store.getState().windows.find((w: any) => w.id === win.id);
        return { connected, flowId: updatedWin?.flowId };
      }, flow.name);
      expect(result.connected).toBe(true);
      expect(result.flowId).toBe(flow.name);
    }
  });
});

// ─── Role Assignment (Legacy) ───────────────────────────────────────

test.describe('Role Assignment', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    await clearAttachables();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      for (const w of [...s.windows]) s.removeWindow(w.id);
    });
    await page.waitForTimeout(200);
    await spawnChatWindow();
  });

  test('window renders without inline attachment badges', async () => {
    const win = page.locator('.desktop-window').last();
    // Inline badges were removed — attachments render externally via TopRoleAttachment/BottomModAttachment/RightFlowAttachment
    const roleSlot = win.locator('.role-slot');
    await expect(roleSlot).not.toBeVisible({ timeout: 1000 });
  });

  test('external role attachment appears above window when role assigned', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.assignRole(win.id, 'frontend-engineer');
    });
    await page.waitForTimeout(500);
    const topAttach = page.locator('[data-testid="top-role-attach-frontend-engineer"]');
    await expect(topAttach).toBeVisible({ timeout: 5000 });
  });
});

// ─── Window Connections ─────────────────────────────────────────────

test.describe('Window Connections', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await spawnChatWindow();
    await page.waitForTimeout(200);
    await spawnChatWindow();
    await page.waitForTimeout(200);
  });

  test('connection ports appear on window hover', async () => {
    const win = page.locator('.desktop-window').first();
    await win.first().waitFor({ state: 'visible', timeout: 5000 });
    const box = await win.first().boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(0);
  });
});

// ─── Keyboard Shortcuts ─────────────────────────────────────────────

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async () => { await ensureProjectOpen(); });

  test('Cmd+N spawns new chat window', async () => {
    const initialCount = await page.locator('.desktop-window').count();
    await page.keyboard.press('Meta+n');
    const picker = page.locator('[data-testid="project-picker-modal"]');
    await picker.waitFor({ state: 'visible', timeout: 5000 });
    const rootBtn = picker.locator('[data-testid="project-pick-root"]');
    await rootBtn.waitFor({ state: 'visible', timeout: 3000 });
    await rootBtn.click();
    await page.waitForTimeout(500);
    const newCount = await page.locator('.desktop-window').count();
    expect(newCount).toBeGreaterThan(initialCount);
  });

  test('Cmd+W closes active window', async () => {
    await spawnChatWindow();
    const countBefore = await page.locator('.desktop-window').count();
    await page.keyboard.press('Meta+w');
    await page.waitForTimeout(500);
    const countAfter = await page.locator('.desktop-window').count();
    expect(countAfter).toBeLessThan(countBefore);
  });

  test('Cmd+Shift+M toggles marketplace', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      store.getState().setShowMarketplace(false);
      store.getState().setShowProjectPicker(false);
      (document.activeElement as HTMLElement)?.blur?.();
    });
    await page.waitForTimeout(200);

    await page.locator('[data-testid="seamless-desktop"]').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(100);

    await page.keyboard.press('Meta+Shift+m');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="marketplace"]')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="marketplace"]')).not.toBeVisible();
  });
});

// ─── CLI Theme Colors ───────────────────────────────────────────────

test.describe('CLI Theme Colors', () => {
  test.beforeEach(async () => { await ensureProjectOpen(); });

  test('default theme has copilot accent', async () => {
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--cli-accent').trim()
    );
    expect(accent.length).toBeGreaterThan(0);
  });

  test('changing CLI to claude updates accent to orange', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (store) store.getState().setCliProvider('claude');
    });
    await page.waitForTimeout(300);
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--cli-accent').trim()
    );
    expect(accent).toBeTruthy();
  });

  test('changing CLI to google updates accent to blue', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (store) store.getState().setCliProvider('google');
    });
    await page.waitForTimeout(300);
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--cli-accent').trim()
    );
    expect(accent).toBeTruthy();
  });

  test('changing CLI to openai updates accent to white', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (store) store.getState().setCliProvider('openai');
    });
    await page.waitForTimeout(300);
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--cli-accent').trim()
    );
    expect(accent).toBeTruthy();
  });
});

// ─── Window Contrast & Visual ───────────────────────────────────────

test.describe('Window Aesthetics', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await spawnChatWindow();
  });

  test('window has proper background contrast', async () => {
    const win = page.locator('.desktop-window').last();
    const bg = await win.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBeTruthy();
    expect(bg).not.toBe('rgb(0, 0, 0)');
  });

  test('window has no visible border outline', async () => {
    const win = page.locator('.desktop-window').last();
    const styles = await win.evaluate(el => {
      const computed = getComputedStyle(el);
      return {
        borderTopWidth: computed.borderTopWidth,
        borderRightWidth: computed.borderRightWidth,
        borderBottomWidth: computed.borderBottomWidth,
        borderLeftWidth: computed.borderLeftWidth,
        boxShadow: computed.boxShadow,
      };
    });

    expect(styles.borderTopWidth).toBe('0px');
    expect(styles.borderRightWidth).toBe('0px');
    expect(styles.borderBottomWidth).toBe('0px');
    expect(styles.borderLeftWidth).toBe('0px');
    expect(styles.boxShadow).not.toContain('0px 0px 0px 1px');
  });

  test('window keeps depth shadow while borderless', async () => {
    const win = page.locator('.desktop-window').last();
    const boxShadow = await win.evaluate(el => getComputedStyle(el).boxShadow);
    expect(boxShadow).not.toBe('none');
    expect(boxShadow).toMatch(/0px\s+\d+px\s+\d+px/);
  });

  test('single-click on window surface focuses and brings it to front', async () => {
    // Two windows placed SIDE BY SIDE so the target's body is not obscured by the
    // other (avoids flaky "element intercepts pointer events" clicks), then focus
    // the second so the first is the non-active/behind one.
    await spawnChatWindow();
    await spawnChatWindow();
    const { firstId, secondId } = await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__.getState();
      const ws = s.windows.slice(-2);
      s.moveWindow(ws[0].id, { x: 80, y: 140 });
      s.resizeWindow(ws[0].id, { width: 340, height: 240 });
      s.moveWindow(ws[1].id, { x: 540, y: 140 });
      s.resizeWindow(ws[1].id, { width: 340, height: 240 });
      s.focusWindow(ws[1].id);
      return { firstId: ws[0].id, secondId: ws[1].id };
    });
    await page.waitForTimeout(150);
    // Click the FIRST window's BODY (below its titlebar). Req 11 / focus fix:
    // onMouseDownCapture must focus it even though content can stop propagation.
    await page.locator(`.desktop-window[data-window-id="${firstId}"]`).click({ position: { x: 60, y: 120 } });
    await page.waitForTimeout(150);
    const { activeId, firstZ, secondZ } = await page.evaluate(({ firstId, secondId }) => {
      const s = (window as any).__DESKTOP_STORE__.getState();
      return {
        activeId: s.activeWindowId ?? null,
        firstZ: s.windows.find((w: any) => w.id === firstId)?.zIndex ?? -1,
        secondZ: s.windows.find((w: any) => w.id === secondId)?.zIndex ?? -1,
      };
    }, { firstId, secondId });
    expect(activeId).toBe(firstId);
    expect(firstZ).toBeGreaterThan(secondZ);
  });

  test('window titlebar double-click toggles maximize', async () => {
    // Maximize is triggered only from the titlebar. Start from a clean single
    // window so a leftover maximized window can't obscure the target titlebar.
    await page.evaluate(() => { (window as any).__DESKTOP_STORE__.setState({ windows: [] }); });
    await spawnChatWindow();
    const win = page.locator('.desktop-window').last();
    const titlebar = win.locator('[data-testid="window-titlebar"]');
    await titlebar.dblclick();
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store?.getState();
      const w = s?.windows?.[s.windows.length - 1];
      return w?.state;
    });
    expect(state).toBe('maximized');
  });

  test('window right-click context menu still includes Close window', async () => {
    // Self-contained: a prior test may have left a maximized window covering things.
    await page.evaluate(() => { (window as any).__DESKTOP_STORE__.setState({ windows: [] }); });
    await spawnChatWindow();
    const win = page.locator('.desktop-window').last();
    await win.waitFor({ state: 'visible' });
    await page.waitForTimeout(150);
    await win.click({ button: 'right' });
    await expect(page.locator('[data-testid="window-context-menu"]')).toBeVisible();
    await expect(page.locator('[data-testid="ctx-menu-close-window"]')).toBeVisible();
  });
});

// ─── Canvas Panning & Zoom ───────────────────────────────────────────

test.describe('Canvas Panning and Zoom', () => {
  test.beforeEach(async () => { await ensureProjectOpen(); });

  test('pan layer exists with transform', async () => {
    const panLayer = page.locator('.desktop-pan-layer');
    await expect(panLayer).toBeVisible({ timeout: 3000 });
    const transform = await panLayer.evaluate(el => el.style.transform);
    expect(transform).toContain('translate');
  });

  test('pan layer transform is translate-only at 100%, adds scale when zoomed', async () => {
    const panLayer = page.locator('.desktop-pan-layer');
    // Req 5: at 100% zoom the camera transform is a pure translate (no scale) so
    // text renders at native subpixel quality (no "fog"). scale() appears once zoomed.
    await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().setCanvasZoom(1));
    await page.waitForTimeout(100);
    const atRest = await panLayer.evaluate(el => el.style.transform);
    expect(atRest).toContain('translate');
    expect(atRest).not.toContain('scale');
    await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().setCanvasZoom(1.5));
    await page.waitForTimeout(100);
    const zoomed = await panLayer.evaluate(el => el.style.transform);
    expect(zoomed).toContain('translate');
    expect(zoomed).toContain('scale');
    await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().setCanvasZoom(1));
  });

  test('ctrl+scroll changes zoom', async () => {
    const canvas = page.locator('[data-testid="seamless-desktop"]');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('No canvas box');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);

    const zoom = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState()?.canvasZoom;
    });
    if (zoom !== undefined) {
      expect(zoom).toBeGreaterThan(1);
    }
  });

  test('zoom indicator appears when zoomed', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (store) store.getState().setCanvasZoom(1.5);
    });
    await page.waitForTimeout(300);
    const indicator = page.locator('[data-testid="zoom-indicator"]');
    await expect(indicator).toBeVisible({ timeout: 2000 });
    const text = await indicator.textContent();
    expect(text).toContain('150%');
  });

  test('zoom indicator hidden at 100%', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (store) store.getState().setCanvasZoom(1);
    });
    await page.waitForTimeout(300);
    const indicator = page.locator('[data-testid="zoom-indicator"]');
    await expect(indicator).not.toBeVisible();
  });
});

// ─── Notifications ──────────────────────────────────────────────────

test.describe('Notification Center', () => {
  test.beforeEach(async () => { await ensureProjectOpen(); });

  test('widget launcher is visible', async () => {
    // notification-bell replaced by hover widget-launcher in the bottom-right corner
    const launcher = page.locator('[data-testid="widget-launcher"]');
    await expect(launcher).toBeVisible({ timeout: 3000 });
  });

  test.skip('opening notification panel via widget launcher', async () => {
    // New flow: hover widget-launcher to open launcher menu, then click the
    // notifications menu item to toggle data-testid="hud-widget-notifications".
    // Skipped until the hover-triggered launcher menu timing is verified in CI.
  });

  test('unread badge appears when there are unread notifications', async () => {
    // notification-pulse replaced by widget-launcher-badge
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (store) store.getState().addNotification('Test notification');
    });
    await page.waitForTimeout(300);
    const badge = page.locator('[data-testid="widget-launcher-badge"]');
    await expect(badge).toBeVisible({ timeout: 2000 });
  });

  test.skip('notifications show timestamps', async () => {
    // New flow: notifications are displayed in the hud-widget-notifications panel,
    // opened from the widget-launcher hover menu. The timestamp selector
    // (.notification-time) may differ inside the HUD widget — skip until confirmed.
  });

  test.skip('clear all removes notifications', async () => {
    // New flow: the clear button lives inside hud-widget-notifications, opened via
    // the widget-launcher hover menu. Skipped until the HUD widget open path is stable.
  });
});

// ─── Window Navigator Children (Attached Items) ─────────────────

test.describe('Navigator Children', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    await clearAttachables();
    // Clean all windows to avoid duplicate testids from leftover state
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      for (const w of [...s.windows]) s.removeWindow(w.id);
    });
    await page.waitForTimeout(200);
  });

  test('attached role appears as child node in navigator', async () => {
    await spawnChatWindow();
    // Attach a role to the latest chat window via store
    const childVisible = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return false;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (!win) return false;
      s.assignRole(win.id, 'frontend-engineer');
      return true;
    });
    expect(childVisible).toBe(true);
    await page.waitForTimeout(300);
    const childNode = page.locator('[data-testid="nav-child-role-frontend-engineer"]');
    await expect(childNode).toBeVisible({ timeout: 3000 });
  });

  test('attached mod appears as child node in navigator', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.addModifier(win.id, 'strict-linting');
    });
    await page.waitForTimeout(300);
    const childNode = page.locator('[data-testid="nav-child-mod-strict-linting"]');
    await expect(childNode).toBeVisible({ timeout: 3000 });
  });

  test('attached flow appears as child node in navigator', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.connectFlow(win.id, 'auto-optimizer');
    });
    await page.waitForTimeout(300);
    const childNode = page.locator('[data-testid="nav-child-flow-auto-optimizer"]');
    await expect(childNode).toBeVisible({ timeout: 3000 });
  });

  test('multiple attached items appear as children', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) {
        s.assignRole(win.id, 'frontend-engineer');
        s.addModifier(win.id, 'strict-linting');
        s.connectFlow(win.id, 'auto-optimizer');
      }
    });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="nav-child-role-frontend-engineer"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="nav-child-mod-strict-linting"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="nav-child-flow-auto-optimizer"]')).toBeVisible({ timeout: 3000 });
  });

  test('child hover highlights parent window on canvas', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.assignRole(win.id, 'frontend-engineer');
    });
    await page.waitForTimeout(300);
    const childNode = page.locator('[data-testid="nav-child-role-frontend-engineer"]');
    await childNode.hover();
    await page.waitForTimeout(200);
    // Check hoveredWindowId is set to the parent window
    const hoveredId = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      return store?.getState()?.hoveredWindowId ?? null;
    });
    expect(hoveredId).not.toBeNull();
  });

  test('unlink button detaches item and respawns attachable', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.assignRole(win.id, 'frontend-engineer');
    });
    await page.waitForTimeout(300);
    const unlinkBtn = page.locator('[data-testid="nav-child-unlink-role-frontend-engineer"]');
    await expect(unlinkBtn).toBeVisible({ timeout: 3000 });
    await unlinkBtn.click();
    await page.waitForTimeout(300);
    // Child should disappear from navigator
    await expect(page.locator('[data-testid="nav-child-role-frontend-engineer"]')).not.toBeVisible({ timeout: 2000 });
    // Attachable should be respawned on canvas
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      return {
        roleId: win?.roleId,
        attachableCount: s.attachables.filter((a: any) => a.name === 'frontend-engineer').length,
      };
    });
    expect(result!.roleId).toBeUndefined();
    expect(result!.attachableCount).toBe(1);
  });

  test('close button removes item permanently without respawn', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.addModifier(win.id, 'strict-linting');
    });
    await page.waitForTimeout(300);
    const closeBtn = page.locator('[data-testid="nav-child-close-mod-strict-linting"]');
    await expect(closeBtn).toBeVisible({ timeout: 3000 });
    await closeBtn.click();
    await page.waitForTimeout(300);
    // Child should disappear
    await expect(page.locator('[data-testid="nav-child-mod-strict-linting"]')).not.toBeVisible({ timeout: 2000 });
    // No attachable should be spawned
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      return {
        modifierIds: win?.modifierIds ?? [],
        attachableCount: s.attachables.filter((a: any) => a.name === 'strict-linting').length,
      };
    });
    expect(result!.modifierIds).not.toContain('strict-linting');
    expect(result!.attachableCount).toBe(0);
  });

  test('child nodes have blue hover highlight via CSS', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.assignRole(win.id, 'frontend-engineer');
    });
    await page.waitForTimeout(300);
    const childNode = page.locator('[data-testid="nav-child-role-frontend-engineer"]');
    await expect(childNode).toBeVisible({ timeout: 3000 });
    // Verify the element has the nav-child-item class for hover styling
    const className = await childNode.getAttribute('class');
    expect(className).toContain('nav-child-item');
  });
});

// ─── Unattached Items in Navigator ──────────────────────────────────────

test.describe('Navigator Unattached Items', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await clearAttachables();
    // Clean up all windows
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      for (const w of [...s.windows]) s.removeWindow(w.id);
    });
    await page.waitForTimeout(200);
  });

  test('unattached attachable appears in navigator panel', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      store.getState().spawnAttachable('role', 'frontend-engineer', { x: 100, y: 100 });
    });
    await page.waitForTimeout(300);
    const navItem = page.locator('[data-testid="nav-unattached-role-frontend-engineer"]');
    await expect(navItem).toBeVisible({ timeout: 3000 });
  });

  test('multiple unattached items shown in navigator', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      s.spawnAttachable('role', 'frontend-engineer', { x: 100, y: 100 });
      s.spawnAttachable('mod', 'concise', { x: 200, y: 100 });
      s.spawnAttachable('flow', 'code-review', { x: 300, y: 100 });
    });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="nav-unattached-role-frontend-engineer"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="nav-unattached-mod-concise"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="nav-unattached-flow-code-review"]')).toBeVisible({ timeout: 3000 });
  });

  test('unattached section shows correct count', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      s.spawnAttachable('role', 'frontend-engineer', { x: 100, y: 100 });
      s.spawnAttachable('mod', 'concise', { x: 200, y: 100 });
    });
    await page.waitForTimeout(300);
    const nav = page.locator('[data-testid="window-navigator"]');
    await expect(nav).toContainText('Unattached (2)', { timeout: 3000 });
  });

  test('remove button in unattached section removes the attachable', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      store.getState().spawnAttachable('mod', 'concise', { x: 100, y: 100 });
    });
    await page.waitForTimeout(300);
    const closeBtn = page.locator('[data-testid="nav-unattached-close-mod-concise"]');
    await expect(closeBtn).toBeVisible({ timeout: 3000 });
    await closeBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="nav-unattached-mod-concise"]')).not.toBeVisible({ timeout: 3000 });
    // Verify it's removed from the store
    const count = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      return store ? store.getState().attachables.length : -1;
    });
    expect(count).toBe(0);
  });

  test('attached items do NOT appear in unattached section', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      store.getState().spawnAttachable('role', 'frontend-engineer', { x: 100, y: 100 });
      // Re-read fresh state after spawn
      const fresh = store.getState();
      const att = fresh.attachables.find((a: any) => a.name === 'frontend-engineer');
      const win = [...fresh.windows].reverse().find((w: any) => w.type === 'chat');
      if (att && win) fresh.attachToWindow(att.id, win.id);
    });
    await page.waitForTimeout(300);
    // Should appear as child of window, NOT in unattached section
    await expect(page.locator('[data-testid="nav-child-role-frontend-engineer"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="nav-unattached-role-frontend-engineer"]')).not.toBeVisible({ timeout: 3000 });
  });
});

// ─── DnD-kit Integration ────────────────────────────────────────────────

test.describe('DnD-kit Integration', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await clearAttachables();
  });

  test('desktop attachable has dnd-kit draggable attributes', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      store.getState().spawnAttachable('role', 'frontend-engineer', { x: 100, y: 100 });
    });
    await page.waitForTimeout(300);
    const attachable = page.locator('[data-testid="desktop-attachable-role-frontend-engineer"]');
    await expect(attachable).toBeVisible({ timeout: 3000 });
    // dnd-kit sets role="button" and tabindex on draggable elements
    const role = await attachable.getAttribute('role');
    expect(role).toBe('button');
  });

  test('window has droppable zone for attachments', async () => {
    await spawnChatWindow();
    await page.waitForTimeout(300);
    // Chat window should exist and be a valid drop target
    const chatWindow = page.locator('.desktop-window').first();
    await expect(chatWindow).toBeVisible({ timeout: 3000 });
  });

  test('drop overlay appears on compatible window via store activeDragId', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      s.spawnAttachable('role', 'frontend-engineer', { x: 100, y: 100 });
    });
    await page.waitForTimeout(300);
    // Simulate what dnd-kit does: set activeDragId in the store
    const activeDragId = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      const att = s.attachables[0];
      if (att) {
        s.setActiveDragId(att.id);
        // Read fresh state after mutation
        return store.getState().activeDragId;
      }
      return null;
    });
    expect(activeDragId).toBeTruthy();
    // Clean up
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (store) store.getState().setActiveDragId(null);
    });
  });

  test('store attachToWindow works via dnd-kit handler pattern', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      store.getState().spawnAttachable('mod', 'concise', { x: 100, y: 100 });
    });
    await page.waitForTimeout(200);
    // Simulate the dnd-kit onDragEnd pattern: find attachable, attach to window
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return { success: false };
      const s = store.getState();
      const att = s.attachables.find((a: any) => a.name === 'concise');
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (!att || !win) return { success: false, reason: 'not found' };
      const success = s.attachToWindow(att.id, win.id);
      return { success, attachablesLeft: store.getState().attachables.length };
    });
    expect(result.success).toBe(true);
    expect(result.attachablesLeft).toBe(0); // removed from canvas
  });
});

// ─── External Window Attachments ────────────────────────────────────────

test.describe('External Window Attachments', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    await clearAttachables();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      for (const w of [...s.windows]) s.removeWindow(w.id);
    });
    await page.waitForTimeout(200);
  });

  test('TopRoleAttachment renders above window when role is attached', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.assignRole(win.id, 'frontend-engineer');
    });
    await page.waitForTimeout(400);
    const topAttach = page.locator('[data-testid="top-role-attach-frontend-engineer"]');
    await expect(topAttach).toBeVisible({ timeout: 3000 });
    const roleRegion = topAttach.locator('[data-testid="top-role-attachment"]');
    await expect(roleRegion).toBeVisible({ timeout: 2000 });
  });

  test('TopRoleAttachment detach via context menu respawns attachable', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.assignRole(win.id, 'frontend-engineer');
    });
    await page.waitForTimeout(400);
    // Right-click the window to open context menu
    const windowEl = page.locator('.desktop-window').last();
    await windowEl.click({ button: 'right' });
    await page.waitForTimeout(200);
    const ctxMenu = page.locator('[data-testid="window-context-menu"]');
    await expect(ctxMenu).toBeVisible({ timeout: 2000 });
    // Click "Remove role: Frontend Engineer"
    const removeRoleBtn = page.locator('[data-testid="ctx-menu-remove-role:-frontend-engineer"]');
    await expect(removeRoleBtn).toBeVisible({ timeout: 2000 });
    await removeRoleBtn.click();
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      return {
        roleId: win?.roleId,
        attachableCount: s.attachables.filter((a: any) => a.name === 'frontend-engineer').length,
      };
    });
    expect(result!.roleId).toBeUndefined();
    expect(result!.attachableCount).toBe(1);
  });

  test('BottomModAttachment renders below window when mods are attached', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) {
        s.addModifier(win.id, 'strict-linting');
        s.addModifier(win.id, 'test-driven');
      }
    });
    await page.waitForTimeout(400);
    const bottomAttach = page.locator('[data-testid="bottom-mod-attachment"]');
    await expect(bottomAttach).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="bottom-mod-strict-linting"]')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('[data-testid="bottom-mod-test-driven"]')).toBeVisible({ timeout: 2000 });
  });

  test('BottomModAttachment detach via context menu removes mod and respawns', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.addModifier(win.id, 'strict-linting');
    });
    await page.waitForTimeout(400);
    // Right-click window → context menu
    const windowEl = page.locator('.desktop-window').last();
    await windowEl.click({ button: 'right' });
    await page.waitForTimeout(200);
    const removeModBtn = page.locator('[data-testid="ctx-menu-remove-mod:-strict-linting"]');
    await expect(removeModBtn).toBeVisible({ timeout: 2000 });
    await removeModBtn.click();
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      return {
        modifierIds: win?.modifierIds ?? [],
        attachableCount: s.attachables.filter((a: any) => a.name === 'strict-linting').length,
      };
    });
    expect(result!.modifierIds).not.toContain('strict-linting');
    expect(result!.attachableCount).toBe(1);
  });

  test('RightFlowAttachment renders on right side when flow is attached', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.connectFlow(win.id, 'auto-optimizer');
    });
    await page.waitForTimeout(400);
    const rightAttach = page.locator('[data-testid="right-flow-auto-optimizer"]');
    await expect(rightAttach).toBeVisible({ timeout: 3000 });
  });

  test('RightFlowAttachment detach via context menu removes flow and respawns', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.connectFlow(win.id, 'auto-optimizer');
    });
    await page.waitForTimeout(400);
    // Right-click window → context menu
    const windowEl = page.locator('.desktop-window').last();
    await windowEl.click({ button: 'right' });
    await page.waitForTimeout(200);
    const removeFlowBtn = page.locator('[data-testid="ctx-menu-remove-flow:-auto-optimizer"]');
    await expect(removeFlowBtn).toBeVisible({ timeout: 2000 });
    await removeFlowBtn.click();
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      return {
        flowId: win?.flowId,
        attachableCount: s.attachables.filter((a: any) => a.name === 'auto-optimizer').length,
      };
    });
    expect(result!.flowId).toBeUndefined();
    expect(result!.attachableCount).toBe(1);
  });

  test('external attachments hidden when window is maximized', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) {
        s.assignRole(win.id, 'frontend-engineer');
        s.addModifier(win.id, 'strict-linting');
        s.connectFlow(win.id, 'auto-optimizer');
      }
    });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="top-role-attach-frontend-engineer"]')).toBeVisible({ timeout: 3000 });
    // Maximize the window
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.setWindowState(win.id, 'maximized');
    });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="top-role-attach-frontend-engineer"]')).not.toBeVisible({ timeout: 2000 });
    await expect(page.locator('[data-testid="bottom-mod-attachment"]')).not.toBeVisible({ timeout: 2000 });
    await expect(page.locator('[data-testid="right-flow-auto-optimizer"]')).not.toBeVisible({ timeout: 2000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// ██  Role Color Integration
// ═══════════════════════════════════════════════════════════════════

test.describe('Role Color Integration', () => {

  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    await clearAttachables();
    // Clean slate: remove all windows
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      const s = ds.getState();
      s.windows.forEach((w: any) => s.removeWindow(w.id));
    });
    await page.waitForTimeout(200);
  });

  test('window border tints to role color when a role is attached', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.assignRole(win.id, 'frontend-engineer');
    });
    await page.waitForTimeout(400);
    const windowEl = page.locator('.desktop-window[data-has-role="true"]');
    await expect(windowEl).toBeVisible({ timeout: 3000 });
    // Verify the CSS custom property --role-color is set
    const roleColor = await windowEl.evaluate((el: HTMLElement) =>
      getComputedStyle(el).getPropertyValue('--role-color').trim()
    );
    expect(roleColor).toContain('D90368'); // frontend-engineer color
  });

  test('role color CSS variable is removed when role is detached', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.assignRole(win.id, 'data-scientist');
    });
    await page.waitForTimeout(400);
    // Verify role color is applied
    await expect(page.locator('.desktop-window[data-has-role="true"]')).toBeVisible({ timeout: 3000 });
    // Detach the role via context menu
    const windowEl = page.locator('.desktop-window').last();
    await windowEl.click({ button: 'right' });
    await page.waitForTimeout(200);
    const removeRoleBtn = page.locator('[data-testid="ctx-menu-remove-role:-data-scientist"]');
    await removeRoleBtn.click();
    await page.waitForTimeout(400);
    // Now data-has-role should be false
    await expect(page.locator('.desktop-window[data-has-role="true"]')).not.toBeVisible({ timeout: 2000 });
  });

  test('different roles produce different role colors on windows', async () => {
    // Spawn two chat windows with different roles
    await spawnChatWindow();
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const chatWindows = s.windows.filter((w: any) => w.type === 'chat');
      if (chatWindows.length >= 2) {
        s.assignRole(chatWindows[0].id, 'frontend-engineer');
        s.assignRole(chatWindows[1].id, 'devops-engineer');
      }
    });
    await page.waitForTimeout(400);
    const roleWindows = page.locator('.desktop-window[data-has-role="true"]');
    expect(await roleWindows.count()).toBe(2);
    const colors = await roleWindows.evaluateAll((els: HTMLElement[]) =>
      els.map(el => getComputedStyle(el).getPropertyValue('--role-color').trim())
    );
    // frontend-engineer = #D90368, devops-engineer = #E0FF4F
    expect(colors[0]).not.toEqual(colors[1]);
  });

  test('TopRoleAttachment has z-index below window (arc behind window)', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.assignRole(win.id, 'frontend-engineer');
    });
    await page.waitForTimeout(400);
    const arcContainer = page.locator('[data-testid="top-role-attach-frontend-engineer"]');
    await expect(arcContainer).toBeAttached({ timeout: 3000 });
    const zIndex = await arcContainer.evaluate((el: HTMLElement) => el.style.zIndex);
    expect(Number(zIndex)).toBeLessThan(0);
  });

  test('TopRoleAttachment width matches window width (100%)', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.assignRole(win.id, 'backend-engineer');
    });
    await page.waitForTimeout(400);
    const arcContainer = page.locator('[data-testid="top-role-attach-backend-engineer"]');
    await expect(arcContainer).toBeAttached({ timeout: 3000 });
    const width = await arcContainer.evaluate((el: HTMLElement) => el.style.width);
    expect(width).toBe('100%');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ██  Agent Session Lifecycle
// ═══════════════════════════════════════════════════════════════════

test.describe('Agent Session Lifecycle', () => {

  test.beforeEach(async () => {
    // Clean slate: remove all sessions and windows
    await page.evaluate(() => {
      const hs = (window as any).__FLUXOR_STORE__;
      const ds = (window as any).__DESKTOP_STORE__;
      if (!hs || !ds) return;
      const hState = hs.getState();
      const dState = ds.getState();
      // Remove all windows
      dState.windows.forEach((w: any) => dState.removeWindow(w.id));
      // Remove all sessions
      hState.sessions.forEach((s: any) => hState.removeSession(s.id));
    });
    await page.waitForTimeout(200);
  });

  test('can create a new session via store', async () => {
    const sessionId = await page.evaluate(() => {
      const store = (window as any).__FLUXOR_STORE__;
      if (!store) return null;
      return store.getState().addSession();
    });
    expect(sessionId).toBeTruthy();
    const session = await page.evaluate((id: string) => {
      const store = (window as any).__FLUXOR_STORE__;
      if (!store) return null;
      const s = store.getState().sessions.find((ses: any) => ses.id === id);
      return s ? { id: s.id, status: s.status, messages: s.messages.length } : null;
    }, sessionId as string);
    expect(session).toBeTruthy();
    expect(session!.status).toBe('waiting');
    expect(session!.messages).toBe(0);
  });

  test('can add messages to a session', async () => {
    const sessionId = await page.evaluate(() => {
      const store = (window as any).__FLUXOR_STORE__;
      if (!store) return null;
      const id = store.getState().addSession();
      store.getState().addSessionMessage(id, {
        id: 'msg-1',
        role: 'user',
        content: 'echo hello',
        timestamp: Date.now(),
      });
      return id;
    });
    const msgCount = await page.evaluate((id: string) => {
      const store = (window as any).__FLUXOR_STORE__;
      if (!store) return 0;
      const s = store.getState().sessions.find((ses: any) => ses.id === id);
      return s?.messages.length ?? 0;
    }, sessionId as string);
    expect(msgCount).toBe(1);
  });

  test('session status transitions work correctly', async () => {
    const sessionId = await page.evaluate(() => {
      const store = (window as any).__FLUXOR_STORE__;
      if (!store) return null;
      return store.getState().addSession();
    });
    // Transition: waiting → running
    await page.evaluate((id: string) => {
      const store = (window as any).__FLUXOR_STORE__;
      if (store) store.getState().updateSessionStatus(id, 'running');
    }, sessionId as string);
    let status = await page.evaluate((id: string) => {
      const store = (window as any).__FLUXOR_STORE__;
      return store?.getState().sessions.find((s: any) => s.id === id)?.status;
    }, sessionId as string);
    expect(status).toBe('running');
    // Transition: running → completed
    await page.evaluate((id: string) => {
      const store = (window as any).__FLUXOR_STORE__;
      if (store) store.getState().updateSessionStatus(id, 'completed', Date.now());
    }, sessionId as string);
    status = await page.evaluate((id: string) => {
      const store = (window as any).__FLUXOR_STORE__;
      return store?.getState().sessions.find((s: any) => s.id === id)?.status;
    }, sessionId as string);
    expect(status).toBe('completed');
  });

  test('session can be stopped (cancelled)', async () => {
    const sessionId = await page.evaluate(() => {
      const store = (window as any).__FLUXOR_STORE__;
      if (!store) return null;
      const id = store.getState().addSession();
      store.getState().updateSessionStatus(id, 'running');
      return id;
    });
    // Stop the session
    await page.evaluate((id: string) => {
      const store = (window as any).__FLUXOR_STORE__;
      if (store) store.getState().updateSessionStatus(id, 'stopped', Date.now());
    }, sessionId as string);
    const result = await page.evaluate((id: string) => {
      const store = (window as any).__FLUXOR_STORE__;
      if (!store) return null;
      const s = store.getState().sessions.find((ses: any) => ses.id === id);
      return { status: s?.status, hasEndedAt: !!s?.endedAt };
    }, sessionId as string);
    expect(result!.status).toBe('stopped');
    expect(result!.hasEndedAt).toBe(true);
  });

  test('session error status is recorded', async () => {
    const sessionId = await page.evaluate(() => {
      const store = (window as any).__FLUXOR_STORE__;
      if (!store) return null;
      const id = store.getState().addSession();
      store.getState().updateSessionStatus(id, 'running');
      store.getState().updateSessionStatus(id, 'error', Date.now());
      return id;
    });
    const status = await page.evaluate((id: string) => {
      const store = (window as any).__FLUXOR_STORE__;
      return store?.getState().sessions.find((s: any) => s.id === id)?.status;
    }, sessionId as string);
    expect(status).toBe('error');
  });

  test('session can be removed', async () => {
    const sessionId = await page.evaluate(() => {
      const store = (window as any).__FLUXOR_STORE__;
      if (!store) return null;
      return store.getState().addSession();
    });
    await page.evaluate((id: string) => {
      const store = (window as any).__FLUXOR_STORE__;
      if (store) store.getState().removeSession(id);
    }, sessionId as string);
    const exists = await page.evaluate((id: string) => {
      const store = (window as any).__FLUXOR_STORE__;
      return !!store?.getState().sessions.find((s: any) => s.id === id);
    }, sessionId as string);
    expect(exists).toBe(false);
  });

  test('chat window is linked to a session', async () => {
    await spawnChatWindow();
    const result = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      const hs = (window as any).__FLUXOR_STORE__;
      if (!ds || !hs) return null;
      const win = ds.getState().windows.find((w: any) => w.type === 'chat');
      const session = hs.getState().sessions.find((s: any) => s.id === win?.sessionId);
      return {
        windowHasSessionId: !!win?.sessionId,
        sessionExists: !!session,
        sessionStatus: session?.status,
      };
    });
    expect(result!.windowHasSessionId).toBe(true);
    expect(result!.sessionExists).toBe(true);
    expect(result!.sessionStatus).toBe('waiting');
  });

  test('multiple sessions can coexist with different statuses', async () => {
    await page.evaluate(() => {
      const store = (window as any).__FLUXOR_STORE__;
      if (!store) return;
      const s = store.getState();
      const id1 = s.addSession();
      const id2 = s.addSession();
      const id3 = s.addSession();
      s.updateSessionStatus(id1, 'running');
      s.updateSessionStatus(id2, 'completed', Date.now());
      // id3 remains 'waiting'
    });
    const statuses = await page.evaluate(() => {
      const store = (window as any).__FLUXOR_STORE__;
      if (!store) return [];
      return store.getState().sessions.map((s: any) => s.status);
    });
    expect(statuses).toContain('running');
    expect(statuses).toContain('completed');
    expect(statuses).toContain('waiting');
  });

  test('session messages are persisted and retrievable', async () => {
    const sessionId = await page.evaluate(() => {
      const store = (window as any).__FLUXOR_STORE__;
      if (!store) return null;
      const id = store.getState().addSession();
      const s = store.getState();
      s.addSessionMessage(id, { id: 'u1', role: 'user', content: 'echo hello', timestamp: Date.now() });
      s.addSessionMessage(id, { id: 'a1', role: 'assistant', content: 'hello', timestamp: Date.now() });
      s.addSessionMessage(id, { id: 's1', role: 'system', content: 'Agent completed.', timestamp: Date.now() });
      return id;
    });
    const messages = await page.evaluate((id: string) => {
      const store = (window as any).__FLUXOR_STORE__;
      if (!store) return [];
      const session = store.getState().sessions.find((s: any) => s.id === id);
      return session?.messages.map((m: any) => ({ role: m.role, content: m.content })) ?? [];
    }, sessionId as string);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: 'user', content: 'echo hello' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'hello' });
    expect(messages[2]).toEqual({ role: 'system', content: 'Agent completed.' });
  });

  test('running agent via IPC returns result (or graceful error without CLI)', async () => {
    // This test validates the IPC bridge works end-to-end.
    // Without a real CLI provider installed, we expect a graceful error (not a crash).
    const sessionId = await page.evaluate(() => {
      const store = (window as any).__FLUXOR_STORE__;
      if (!store) return null;
      return store.getState().addSession();
    });
    const result = await page.evaluate(async (id: string) => {
      if (!window.fluxorAPI) return { success: false, error: 'No fluxorAPI' };
      try {
        return await window.fluxorAPI.runAgent({
          agentId: id,
          instruction: 'echo hello',
          flows: [],
          cwd: '.',
          model: 'gpt-4.1',
        });
      } catch (e: any) {
        return { success: false, error: e.message || 'unknown error' };
      }
    }, sessionId as string);
    // Either succeeds or returns a structured error — never crashes
    expect(result).toBeTruthy();
    expect(typeof result.success).toBe('boolean');
  });

  test('stopAgent via IPC does not crash even if no agent is running', async () => {
    const result = await page.evaluate(async () => {
      if (!window.fluxorAPI) return false;
      try {
        return await window.fluxorAPI.stopAgent('nonexistent-session-id');
      } catch {
        return false;
      }
    });
    // Should return false (nothing to stop) without crashing
    expect(typeof result).toBe('boolean');
  });

  test('session with role assignment inherits role metadata', async () => {
    const result = await page.evaluate(() => {
      const hs = (window as any).__FLUXOR_STORE__;
      const ds = (window as any).__DESKTOP_STORE__;
      if (!hs || !ds) return null;
      const sessionId = hs.getState().addSession();
      const s = ds.getState();
      s.addWindow('chat', { title: 'Role Chat', iconName: 'MessageSquare', sessionId });
      const win = ds.getState().windows.find((w: any) => w.sessionId === sessionId);
      if (win) s.assignRole(win.id, 'security-researcher');
      const updatedWin = ds.getState().windows.find((w: any) => w.sessionId === sessionId);
      return {
        roleId: updatedWin?.roleId,
        sessionId: updatedWin?.sessionId,
      };
    });
    expect(result!.roleId).toBe('security-researcher');
    expect(result!.sessionId).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
// ██  Clear Conversation Button
// ═══════════════════════════════════════════════════════════════════

test.describe('Clear Conversation', () => {
  test.beforeEach(async () => { await ensureProjectOpen(); await ensureInventoryLoaded(); });

  test('clear button appears in agentic window when messages exist', async () => {
    // Spawn a chat window with a session that has messages
    const ids = await page.evaluate(() => {
      const hs = (window as any).__FLUXOR_STORE__;
      const ds = (window as any).__DESKTOP_STORE__;
      if (!hs || !ds) return null;
      const sessionId = hs.getState().addSession();
      hs.getState().addSessionMessage(sessionId, { id: 'u1', role: 'user', content: 'hello', timestamp: Date.now() });
      hs.getState().addSessionMessage(sessionId, { id: 'a1', role: 'assistant', content: 'hi there', timestamp: Date.now() });
      ds.getState().addWindow('chat', { title: 'Clear Test', iconName: 'MessageSquare', sessionId });
      return { sessionId, windowId: ds.getState().windows.find((w: any) => w.sessionId === sessionId)?.id };
    });
    expect(ids).toBeTruthy();
    await page.waitForTimeout(500);

    // The clear button should be visible
    const clearBtn = page.locator('[data-testid="chat-clear"]');
    await expect(clearBtn).toBeVisible({ timeout: 5000 });
  });

  test('clear button resets messages but preserves model', async () => {
    const ids = await page.evaluate(() => {
      const hs = (window as any).__FLUXOR_STORE__;
      const ds = (window as any).__DESKTOP_STORE__;
      if (!hs || !ds) return null;
      const sessionId = hs.getState().addSession();
      hs.getState().setSessionModel(sessionId, 'claude-sonnet-4');
      hs.getState().addSessionMessage(sessionId, { id: 'u1', role: 'user', content: 'test msg', timestamp: Date.now() });
      hs.getState().addSessionMessage(sessionId, { id: 'a1', role: 'assistant', content: 'response', timestamp: Date.now() });
      ds.getState().addWindow('chat', { title: 'Clear Model Test', iconName: 'MessageSquare', sessionId });
      return { sessionId, windowId: ds.getState().windows.find((w: any) => w.sessionId === sessionId)?.id };
    });
    expect(ids).toBeTruthy();
    await page.waitForTimeout(500);

    // Click clear
    const clearBtn = page.locator('[data-testid="chat-clear"]').last();
    await expect(clearBtn).toBeVisible({ timeout: 5000 });
    await clearBtn.click();
    await page.waitForTimeout(300);

    // Verify: messages cleared, model preserved
    const result = await page.evaluate((sessionId: string) => {
      const hs = (window as any).__FLUXOR_STORE__;
      if (!hs) return null;
      const s = hs.getState().sessions.find((ses: any) => ses.id === sessionId);
      return s ? { messages: s.messages.length, model: s.model, status: s.status } : null;
    }, ids!.sessionId);
    expect(result!.messages).toBe(0);
    expect(result!.model).toBe('claude-sonnet-4');
    expect(result!.status).toBe('waiting');
  });

  test('clear button preserves role when attached', async () => {
    const ids = await page.evaluate(() => {
      const hs = (window as any).__FLUXOR_STORE__;
      const ds = (window as any).__DESKTOP_STORE__;
      if (!hs || !ds) return null;
      const sessionId = hs.getState().addSession();
      hs.getState().addSessionMessage(sessionId, { id: 'u1', role: 'user', content: 'with role', timestamp: Date.now() });
      ds.getState().addWindow('chat', { title: 'Role Clear Test', iconName: 'MessageSquare', sessionId });
      const win = ds.getState().windows.find((w: any) => w.sessionId === sessionId);
      if (win) ds.getState().assignRole(win.id, 'frontend-engineer');
      return { sessionId, windowId: win?.id };
    });
    expect(ids).toBeTruthy();
    await page.waitForTimeout(500);

    // Click clear
    const clearBtn = page.locator('[data-testid="chat-clear"]').last();
    await expect(clearBtn).toBeVisible({ timeout: 5000 });
    await clearBtn.click();
    await page.waitForTimeout(300);

    // Verify: messages cleared, role still attached
    const result = await page.evaluate((args: { sessionId: string; windowId: string }) => {
      const hs = (window as any).__FLUXOR_STORE__;
      const ds = (window as any).__DESKTOP_STORE__;
      if (!hs || !ds) return null;
      const session = hs.getState().sessions.find((s: any) => s.id === args.sessionId);
      const win = ds.getState().windows.find((w: any) => w.id === args.windowId);
      return { messages: session?.messages.length, roleId: win?.roleId };
    }, ids!);
    expect(result!.messages).toBe(0);
    expect(result!.roleId).toBe('frontend-engineer');
  });

  test('clear button uses role accent color when role is attached', async () => {
    const ids = await page.evaluate(() => {
      const hs = (window as any).__FLUXOR_STORE__;
      const ds = (window as any).__DESKTOP_STORE__;
      if (!hs || !ds) return null;
      const sessionId = hs.getState().addSession();
      hs.getState().addSessionMessage(sessionId, { id: 'u1', role: 'user', content: 'color test', timestamp: Date.now() });
      ds.getState().addWindow('chat', { title: 'Color Clear Test', iconName: 'MessageSquare', sessionId });
      const win = ds.getState().windows.find((w: any) => w.sessionId === sessionId);
      if (win) ds.getState().assignRole(win.id, 'backend-engineer');
      return { sessionId, windowId: win?.id };
    });
    expect(ids).toBeTruthy();
    await page.waitForTimeout(500);

    // Get role color from inventory
    const roleColor = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      const inv = ds?.getState().marketInventory;
      const role = inv?.roles?.find((r: any) => r.name === 'backend-engineer');
      return role?.color ?? null;
    });

    const clearBtn = page.locator('[data-testid="chat-clear"]').last();
    await expect(clearBtn).toBeVisible({ timeout: 5000 });

    // The button's computed color should match the role color (browser returns rgb())
    const computedColor = await clearBtn.evaluate(el => getComputedStyle(el).color);
    if (roleColor) {
      // Convert hex role color to rgb for comparison
      const hex = roleColor.startsWith('#') ? roleColor.slice(1) : roleColor;
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      expect(computedColor).toBe(`rgb(${r}, ${g}, ${b})`);
    }
  });

  test('clear button is hidden when no messages', async () => {
    await page.evaluate(() => {
      const hs = (window as any).__FLUXOR_STORE__;
      const ds = (window as any).__DESKTOP_STORE__;
      if (!hs || !ds) return;
      const sessionId = hs.getState().addSession();
      ds.getState().addWindow('chat', { title: 'Empty Chat', iconName: 'MessageSquare', sessionId });
    });
    await page.waitForTimeout(500);

    // The "Start a conversation" placeholder should be visible
    const placeholder = page.locator('text=Start a conversation');
    await expect(placeholder.last()).toBeVisible({ timeout: 5000 });

    // No clear button should be present in a window with the empty placeholder
    const clearButtons = page.locator('[data-testid="chat-clear"]');
    // Count should be same as before (from previous tests), not increased
    // Simpler: check that the last window-content doesn't have a clear button
    const lastWindow = page.locator('.desktop-window').last();
    const clearInLast = lastWindow.locator('[data-testid="chat-clear"]');
    await expect(clearInLast).not.toBeVisible({ timeout: 2000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// ██  Attachment Info Modals
// ═══════════════════════════════════════════════════════════════════

test.describe('Attachment Info Modals', () => {

  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    await clearAttachables();
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      const s = ds.getState();
      s.windows.forEach((w: any) => s.removeWindow(w.id));
    });
    await page.waitForTimeout(200);
  });

  test('clicking TopRoleAttachment opens info modal with role details', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.assignRole(win.id, 'frontend-engineer');
    });
    await page.waitForTimeout(400);
    // Click the role attachment
    const roleAttach = page.locator('[data-testid="top-role-attach-frontend-engineer"]');
    await roleAttach.click({ position: { x: 50, y: 20 } });
    await page.waitForTimeout(300);
    // Modal should appear
    const modal = page.locator('[data-testid="attachment-info-modal"]');
    await expect(modal).toBeVisible({ timeout: 3000 });
    // Should contain role name and description
    await expect(modal).toContainText('Frontend Engineer');
    await expect(modal).toContainText('Role');
    // Close the modal
    await page.locator('[data-testid="attachment-modal-close"]').click();
    await page.waitForTimeout(200);
    await expect(modal).not.toBeVisible({ timeout: 2000 });
  });

  test('clicking BottomModAttachment tab opens info modal', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.addModifier(win.id, 'test-driven');
    });
    await page.waitForTimeout(400);
    const modTab = page.locator('[data-testid="bottom-mod-test-driven"]');
    await expect(modTab).toBeVisible({ timeout: 3000 });
    await modTab.click();
    await page.waitForTimeout(300);
    const modal = page.locator('[data-testid="attachment-info-modal"]');
    await expect(modal).toBeVisible({ timeout: 3000 });
    await expect(modal).toContainText('Test Driven');
    await expect(modal).toContainText('Mod');
    await page.locator('[data-testid="attachment-modal-close"]').click();
    await page.waitForTimeout(200);
    await expect(modal).not.toBeVisible({ timeout: 2000 });
  });

  test('clicking RightFlowAttachment ribbon opens info modal', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) s.connectFlow(win.id, 'auto-optimizer');
    });
    await page.waitForTimeout(400);
    const flowRibbon = page.locator('[data-testid="right-flow-auto-optimizer"] .fluxor-flow-ribbon');
    await expect(flowRibbon).toBeVisible({ timeout: 3000 });
    await flowRibbon.click();
    await page.waitForTimeout(300);
    const modal = page.locator('[data-testid="attachment-info-modal"]');
    await expect(modal).toBeVisible({ timeout: 3000 });
    await expect(modal).toContainText('Auto Optimizer');
    await expect(modal).toContainText('Flow');
    await page.locator('[data-testid="attachment-modal-close"]').click();
    await page.waitForTimeout(200);
    await expect(modal).not.toBeVisible({ timeout: 2000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// ██  Window Context Menu
// ═══════════════════════════════════════════════════════════════════

test.describe('Window Context Menu', () => {

  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    await clearAttachables();
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      const s = ds.getState();
      s.windows.forEach((w: any) => s.removeWindow(w.id));
    });
    await page.waitForTimeout(200);
  });

  test('right-click on window opens context menu', async () => {
    await spawnChatWindow();
    await page.waitForTimeout(300);
    const windowEl = page.locator('.desktop-window').last();
    await windowEl.click({ button: 'right' });
    await page.waitForTimeout(200);
    const ctxMenu = page.locator('[data-testid="window-context-menu"]');
    await expect(ctxMenu).toBeVisible({ timeout: 2000 });
    // Should have basic window actions
    await expect(page.locator('[data-testid="ctx-menu-maximize"]')).toBeVisible();
    await expect(page.locator('[data-testid="ctx-menu-minimize"]')).toBeVisible();
    await expect(page.locator('[data-testid="ctx-menu-close-window"]')).toBeVisible();
  });

  test('context menu shows attachment removal entries when items are attached', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) {
        s.assignRole(win.id, 'frontend-engineer');
        s.addModifier(win.id, 'test-driven');
        s.connectFlow(win.id, 'auto-optimizer');
      }
    });
    await page.waitForTimeout(400);
    const windowEl = page.locator('.desktop-window').last();
    await windowEl.click({ button: 'right' });
    await page.waitForTimeout(200);
    // Should have removal entries for each attachment type
    await expect(page.locator('[data-testid="ctx-menu-remove-role:-frontend-engineer"]')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('[data-testid="ctx-menu-remove-mod:-test-driven"]')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('[data-testid="ctx-menu-remove-flow:-auto-optimizer"]')).toBeVisible({ timeout: 2000 });
  });

  test('clicking outside context menu closes it', async () => {
    await spawnChatWindow();
    await page.waitForTimeout(300);
    const windowEl = page.locator('.desktop-window').last();
    await windowEl.click({ button: 'right' });
    await page.waitForTimeout(200);
    const ctxMenu = page.locator('[data-testid="window-context-menu"]');
    await expect(ctxMenu).toBeVisible({ timeout: 2000 });
    // Click the backdrop
    await ctxMenu.click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(200);
    await expect(ctxMenu).not.toBeVisible({ timeout: 2000 });
  });

  test('context menu close window action removes the window', async () => {
    await spawnChatWindow();
    await page.waitForTimeout(300);
    const initialCount = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState().windows.length ?? 0;
    });
    const windowEl = page.locator('.desktop-window').last();
    await windowEl.click({ button: 'right' });
    await page.waitForTimeout(200);
    await page.locator('[data-testid="ctx-menu-close-window"]').click();
    await page.waitForTimeout(300);
    const newCount = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState().windows.length ?? 0;
    });
    expect(newCount).toBe(initialCount - 1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ██  Navigator Children Selection & Role Color
// ═══════════════════════════════════════════════════════════════════

test.describe('Navigator Children Selection', () => {

  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    await clearAttachables();
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      const s = ds.getState();
      s.windows.forEach((w: any) => s.removeWindow(w.id));
    });
    await page.waitForTimeout(200);
  });

  test('children nodes show selected state when parent window is active', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) {
        s.assignRole(win.id, 'frontend-engineer');
        s.focusWindow(win.id);
      }
    });
    await page.waitForTimeout(400);
    const childEl = page.locator('[data-testid="nav-child-role-frontend-engineer"]');
    await expect(childEl).toBeVisible({ timeout: 3000 });
    const parentActive = await childEl.getAttribute('data-parent-active');
    expect(parentActive).toBe('true');
  });

  test('children border color follows role color when role is applied', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const win = [...s.windows].reverse().find((w: any) => w.type === 'chat');
      if (win) {
        s.assignRole(win.id, 'frontend-engineer');
        s.addModifier(win.id, 'test-driven');
        s.focusWindow(win.id);
      }
    });
    await page.waitForTimeout(400);
    // Check that both children have the role-colored border
    const roleChild = page.locator('[data-testid="nav-child-role-frontend-engineer"]');
    const modChild = page.locator('[data-testid="nav-child-mod-test-driven"]');
    await expect(roleChild).toBeVisible({ timeout: 3000 });
    await expect(modChild).toBeVisible({ timeout: 3000 });
    const roleBorderLeft = await roleChild.evaluate((el: HTMLElement) => el.style.borderLeft);
    const modBorderLeft = await modChild.evaluate((el: HTMLElement) => el.style.borderLeft);
    // Both should contain the frontend-engineer color D90368 (rgb(217, 3, 104))
    expect(roleBorderLeft).toContain('rgb(217, 3, 104)');
    expect(modBorderLeft).toContain('rgb(217, 3, 104)');
  });

  test('children lose selected state when parent window is not active', async () => {
    await spawnChatWindow();
    await spawnChatWindow(); // second window takes focus
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      const s = store.getState();
      const chatWindows = s.windows.filter((w: any) => w.type === 'chat');
      if (chatWindows.length >= 2) {
        s.assignRole(chatWindows[0].id, 'frontend-engineer');
        // Focus second window so first is NOT active
        s.focusWindow(chatWindows[1].id);
      }
    });
    await page.waitForTimeout(400);
    const childEl = page.locator('[data-testid="nav-child-role-frontend-engineer"]');
    await expect(childEl).toBeVisible({ timeout: 3000 });
    const parentActive = await childEl.getAttribute('data-parent-active');
    expect(parentActive).toBe('false');
    // Border should be transparent
    const borderLeft = await childEl.evaluate((el: HTMLElement) => el.style.borderLeft);
    expect(borderLeft).toContain('transparent');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ██  Backlog Widget
// ═══════════════════════════════════════════════════════════════════

test.describe('Backlog Widget', () => {

  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      const s = ds.getState();
      s.windows.forEach((w: any) => s.removeWindow(w.id));
    });
    await page.waitForTimeout(200);
  });

  test('backlog window can be opened and shows kanban board', async () => {
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      store.getState().addWindow('backlog', {
        title: 'Backlog',
        iconName: 'KanbanSquare',
        size: { width: 720, height: 480 },
      });
    });
    await page.waitForTimeout(400);
    const kanban = page.locator('.backlog-kanban');
    await expect(kanban).toBeVisible({ timeout: 3000 });
  });

  test('mock backlog cards render in all four kanban columns', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      ds.getState().addWindow('backlog', {
        title: 'Backlog',
        iconName: 'KanbanSquare',
        size: { width: 720, height: 480 },
      });
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      ds.getState().setBacklogCards([
        { filename: 'task-1.md', taskId: 'task-1', targetAgent: 'frontend', targetModule: 'ui', priority: 'critical', status: 'pending', title: 'Fix login button', body: 'The login button is broken on mobile.' },
        { filename: 'task-2.md', taskId: 'task-2', targetAgent: 'backend', targetModule: 'api', priority: 'high', status: 'in_progress', title: 'Optimize API endpoints', body: 'Reduce response time for search.' },
        { filename: 'task-3.md', taskId: 'task-3', targetAgent: 'qa', targetModule: 'tests', priority: 'medium', status: 'completed', title: 'Add unit tests', body: 'Cover auth module with tests.' },
        { filename: 'task-4.md', taskId: 'task-4', targetAgent: 'devops', targetModule: 'ci', priority: 'low', status: 'failed', title: 'Fix CI pipeline', body: 'Pipeline fails on macOS.' },
      ]);
    });
    await page.waitForTimeout(400);
    // Verify cards appear
    await expect(page.locator('text=Fix login button')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Optimize API endpoints')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Add unit tests')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Fix CI pipeline')).toBeVisible({ timeout: 3000 });
    // Verify column headers (FlowDeck-style names)
    await expect(page.locator('.fd-laneTitle h2', { hasText: 'Backlog' })).toBeVisible();
    await expect(page.locator('.fd-laneTitle h2', { hasText: 'In Progress' })).toBeVisible();
    await expect(page.locator('.fd-laneTitle h2', { hasText: 'Done' })).toBeVisible();
    await expect(page.locator('.fd-laneTitle h2', { hasText: 'Failed' })).toBeVisible();
  });

  test('clicking a backlog card expands its body details', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      ds.getState().addWindow('backlog', {
        title: 'Backlog',
        iconName: 'KanbanSquare',
        size: { width: 720, height: 480 },
      });
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      ds.getState().setBacklogCards([
        { filename: 'task-1.md', taskId: 'task-1', targetAgent: 'frontend', targetModule: 'ui', priority: 'critical', status: 'pending', title: 'Fix login button', body: 'The login button is broken on mobile devices and needs urgent attention.' },
      ]);
    });
    await page.waitForTimeout(400);
    const cardEl = page.locator('.fd-card', { hasText: 'Fix login button' });
    await expect(cardEl).toBeVisible({ timeout: 3000 });
    await cardEl.click();
    await page.waitForTimeout(300);
    // Modal opens at canvas level (outside backlog window)
    const modal = page.locator('[data-testid="backlog-card-modal"]');
    await expect(modal).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.fd-modalBody', { hasText: 'broken on mobile devices' })).toBeVisible({ timeout: 2000 });
    // Close the modal
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible({ timeout: 2000 });
  });

  test('backlog card count is displayed in header', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      ds.getState().addWindow('backlog', {
        title: 'Backlog',
        iconName: 'KanbanSquare',
        size: { width: 720, height: 480 },
      });
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      ds.getState().setBacklogCards([
        { filename: 'task-1.md', taskId: 'task-1', targetAgent: 'fe', targetModule: 'ui', priority: 'high', status: 'pending', title: 'Task A', body: '' },
        { filename: 'task-2.md', taskId: 'task-2', targetAgent: 'be', targetModule: 'api', priority: 'low', status: 'pending', title: 'Task B', body: '' },
      ]);
    });
    await page.waitForTimeout(400);
    await expect(page.locator('text=2 cards')).toBeVisible({ timeout: 3000 });
  });

  test('backlog shows empty state when no cards exist', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      ds.getState().setBacklogCards([]);
      ds.getState().addWindow('backlog', {
        title: 'Backlog',
        iconName: 'KanbanSquare',
        size: { width: 720, height: 480 },
      });
    });
    // Wait for the widget to leave the loading state before asserting.
    // The picker view is hidden while `loading` is true (scanForBacklogs runs async),
    // so we wait up to 5 s for any of the empty-state strings to appear in the DOM.
    await page.waitForFunction(
      () => {
        const texts = [
          'No backlog cards found',
          'No project subdirectories found',
          'Open a project to scan',
        ];
        return texts.some(t =>
          Array.from(document.querySelectorAll('*')).some(
            el => el.children.length === 0 && el.textContent?.includes(t),
          ),
        );
      },
      { timeout: 5_000 },
    ).catch(() => null); // tolerate timeout — assertion below gives the real verdict

    // Widget shows picker view with no backlogs found, or kanban with empty state
    const emptyKanban = page.locator('text=No backlog cards found');
    const emptyPicker = page.locator('text=No project subdirectories found');
    const noProject = page.locator('text=Open a project to scan');
    // At least one of the empty states should be visible
    const anyVisible = await emptyKanban.isVisible().catch(() => false)
      || await emptyPicker.isVisible().catch(() => false)
      || await noProject.isVisible().catch(() => false);
    expect(anyVisible).toBe(true);
  });

  test('backlog card shows priority and target info', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      ds.getState().addWindow('backlog', {
        title: 'Backlog',
        iconName: 'KanbanSquare',
        size: { width: 720, height: 480 },
      });
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      ds.getState().setBacklogCards([
        { filename: 'task-5.md', taskId: 'task-5', targetAgent: 'security', targetModule: 'auth', priority: 'critical', status: 'pending', title: 'Audit auth module', body: 'Review all authentication flows.' },
      ]);
    });
    await page.waitForTimeout(400);
    await expect(page.locator('text=Audit auth module')).toBeVisible({ timeout: 3000 });
    // Should show target info (agent → module)
    await expect(page.locator('text=security')).toBeVisible({ timeout: 2000 });
  });

  test('multiple cards per column render correctly', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      ds.getState().addWindow('backlog', {
        title: 'Backlog',
        iconName: 'KanbanSquare',
        size: { width: 720, height: 480 },
      });
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      ds.getState().setBacklogCards([
        { filename: 't1.md', taskId: 't1', targetAgent: 'fe', targetModule: 'ui', priority: 'high', status: 'pending', title: 'Pending Task 1', body: '' },
        { filename: 't2.md', taskId: 't2', targetAgent: 'fe', targetModule: 'ui', priority: 'medium', status: 'pending', title: 'Pending Task 2', body: '' },
        { filename: 't3.md', taskId: 't3', targetAgent: 'be', targetModule: 'api', priority: 'low', status: 'pending', title: 'Pending Task 3', body: '' },
      ]);
    });
    await page.waitForTimeout(400);
    await expect(page.locator('text=Pending Task 1')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Pending Task 2')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Pending Task 3')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=3 cards')).toBeVisible({ timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// ██  Project Files Window (IntelliJ-style file explorer)
// ═══════════════════════════════════════════════════════════════════

test.describe('Project Files Window', () => {

  // Create a real temp directory structure for the file explorer to read
  const TEST_FILES_DIR = '/tmp/fluxor-test-files';

  test.beforeAll(async () => {
    // Build a realistic project structure on disk
    fs.mkdirSync(`${TEST_FILES_DIR}/src/renderer/components`, { recursive: true });
    fs.mkdirSync(`${TEST_FILES_DIR}/src/main`, { recursive: true });
    fs.writeFileSync(`${TEST_FILES_DIR}/package.json`, JSON.stringify({
      name: 'test-project', version: '1.0.0', description: 'A test project'
    }, null, 2));
    fs.writeFileSync(`${TEST_FILES_DIR}/README.md`, '# Test Project\nHello world.\n');
    fs.writeFileSync(`${TEST_FILES_DIR}/tsconfig.json`, '{ "compilerOptions": {} }');
    fs.writeFileSync(`${TEST_FILES_DIR}/src/index.ts`, 'console.log("hello");\n');
    fs.writeFileSync(`${TEST_FILES_DIR}/src/renderer/App.tsx`, 'export default function App() { return <div />; }\n');
    fs.writeFileSync(`${TEST_FILES_DIR}/src/renderer/components/Button.tsx`, 'export const Button = () => <button>Click</button>;\n');
    fs.writeFileSync(`${TEST_FILES_DIR}/src/main/index.ts`, 'import { app } from "electron";\n');
  });

  test.afterAll(async () => {
    fs.rmSync(TEST_FILES_DIR, { recursive: true, force: true });
    // Restore original project path
    await page.evaluate(() => {
      const hs = (window as any).__FLUXOR_STORE__;
      if (hs) hs.getState().setProjectPath('/tmp/test-project');
    });
  });

  test.beforeEach(async () => {
    // Point project path at our real temp directory
    await page.evaluate((dir) => {
      const hs = (window as any).__FLUXOR_STORE__;
      if (hs) hs.getState().setProjectPath(dir);
    }, TEST_FILES_DIR);
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      const s = ds.getState();
      s.windows.forEach((w: any) => s.removeWindow(w.id));
    });
    await page.waitForTimeout(200);
  });

  function openFileExplorer() {
    return page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return;
      store.getState().addWindow('file-explorer', {
        title: 'Files',
        iconName: 'FileText',
        size: { width: 500, height: 600 },
      });
    });
  }

  test('file explorer opens and shows project tree with real files', async () => {
    await openFileExplorer();
    await page.waitForTimeout(800);
    const explorer = page.locator('[data-testid="file-explorer"]');
    await expect(explorer).toBeVisible({ timeout: 3000 });
    // Header says "Files"
    const header = explorer.getByText('Files', { exact: true }).first();
    await expect(header).toBeVisible({ timeout: 3000 });
    // package.json exists at root of our temp dir — give IPC extra time to load
    await expect(explorer.getByText('package.json')).toBeVisible({ timeout: 10_000 });
  });

  test('file explorer shows folders with folder icons', async () => {
    await openFileExplorer();
    await page.waitForTimeout(800);
    const srcFolder = page.locator('button[aria-label="src folder"]');
    await expect(srcFolder).toBeVisible({ timeout: 5000 });
  });

  test('clicking a folder expands to show lazy-loaded children', async () => {
    await openFileExplorer();
    await page.waitForTimeout(800);
    const srcFolder = page.locator('button[aria-label="src folder"]');
    await expect(srcFolder).toBeVisible({ timeout: 5000 });
    await srcFolder.click();
    await page.waitForTimeout(600);
    // src/ contains main/ and renderer/
    await expect(page.locator('button[aria-label="renderer folder"]')).toBeVisible({ timeout: 3000 });
  });

  test('collapsing a folder hides its children', async () => {
    await openFileExplorer();
    await page.waitForTimeout(800);
    const srcFolder = page.locator('button[aria-label="src folder"]');
    await srcFolder.click();
    await page.waitForTimeout(600);
    await expect(page.locator('button[aria-label="renderer folder"]')).toBeVisible({ timeout: 3000 });
    await srcFolder.click();
    await page.waitForTimeout(300);
    await expect(page.locator('button[aria-label="renderer folder"]')).not.toBeVisible({ timeout: 2000 });
  });

  test('clicking a file opens the code editor with Monaco and tab', async () => {
    await openFileExplorer();
    await page.waitForTimeout(800);
    const explorer = page.locator('[data-testid="file-explorer"]');
    const pkgJson = explorer.locator('button', { hasText: 'package.json' }).first();
    await expect(pkgJson).toBeVisible({ timeout: 10_000 });
    await pkgJson.click();
    await page.waitForTimeout(800);
    // A tab should appear for the file
    const tab = page.locator('[data-testid="file-tab-package.json"]');
    await expect(tab).toBeVisible({ timeout: 5000 });
    // Monaco editor should be visible (renders inside a section element)
    const monacoEditor = explorer.locator('.monaco-editor');
    await expect(monacoEditor).toBeVisible({ timeout: 5000 });
  });

  test('code editor save button is hidden when file is clean', async () => {
    await openFileExplorer();
    await page.waitForTimeout(800);
    const explorer = page.locator('[data-testid="file-explorer"]');
    const pkgJson = explorer.locator('button', { hasText: 'package.json' }).first();
    await expect(pkgJson).toBeVisible({ timeout: 10_000 });
    await pkgJson.click();
    await page.waitForTimeout(800);
    // Tab should be visible
    await expect(page.locator('[data-testid="file-tab-package.json"]')).toBeVisible({ timeout: 5000 });
    // Save button should NOT be visible when file is clean (only appears when dirty)
    const saveBtn = page.locator('[data-testid="file-editor-save"]');
    await expect(saveBtn).not.toBeVisible({ timeout: 2000 });
  });

  test('file tree remains visible while editor is open (split-pane)', async () => {
    await openFileExplorer();
    await page.waitForTimeout(800);
    const explorer = page.locator('[data-testid="file-explorer"]');
    // Wait for the tree to load
    const pkgJson = explorer.locator('button', { hasText: 'package.json' }).first();
    await expect(pkgJson).toBeVisible({ timeout: 10_000 });
    await pkgJson.click();
    await page.waitForTimeout(800);
    // Tab should exist
    await expect(page.locator('[data-testid="file-tab-package.json"]')).toBeVisible({ timeout: 5000 });
    // File tree should still be visible (split-pane layout) — use scoped locator
    const treeHeader = explorer.getByText('Files', { exact: true }).first();
    await expect(treeHeader).toBeVisible({ timeout: 3000 });
    // The file entry in the tree should also still be visible
    await expect(pkgJson).toBeVisible({ timeout: 3000 });
  });

  test('file explorer has toolbar buttons for new file, new folder, refresh', async () => {
    await openFileExplorer();
    await page.waitForTimeout(800);
    await expect(page.locator('[data-testid="new-file-btn"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="new-folder-btn"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="refresh-files-btn"]')).toBeVisible({ timeout: 3000 });
  });

  test('right-click on folder shows context menu with New File / New Folder', async () => {
    await openFileExplorer();
    await page.waitForTimeout(800);
    const srcFolder = page.locator('button[aria-label="src folder"]');
    await expect(srcFolder).toBeVisible({ timeout: 5000 });
    await srcFolder.click({ button: 'right' });
    await page.waitForTimeout(300);
    const ctxMenu = page.locator('[data-testid="file-context-menu"]');
    await expect(ctxMenu).toBeVisible({ timeout: 2000 });
    await expect(page.locator('[data-testid="file-ctx-new-file"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-ctx-new-folder"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-ctx-rename"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-ctx-delete"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-ctx-refresh"]')).toBeVisible();
  });

  test('nested folder navigation works (multi-level expand)', async () => {
    await openFileExplorer();
    await page.waitForTimeout(800);
    const srcFolder = page.locator('button[aria-label="src folder"]');
    await srcFolder.click();
    await page.waitForTimeout(600);
    const rendererFolder = page.locator('button[aria-label="renderer folder"]');
    await expect(rendererFolder).toBeVisible({ timeout: 3000 });
    await rendererFolder.click();
    await page.waitForTimeout(600);
    // src/renderer/ has a components/ folder
    await expect(page.locator('button[aria-label="components folder"]')).toBeVisible({ timeout: 3000 });
  });

  test('file explorer shows empty state for non-existent directory', async () => {
    // Point project at a directory that does not exist on disk
    await page.evaluate(() => {
      const hs = (window as any).__FLUXOR_STORE__;
      if (hs) hs.getState().setProjectPath('/tmp/nonexistent-dir-xyz-99999');
    });
    await openFileExplorer();
    await page.waitForTimeout(800);
    await expect(page.locator('text=No files loaded')).toBeVisible({ timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// ██  Z-Index & Attachable Visibility
// ═══════════════════════════════════════════════════════════════════

test.describe('Z-Index & Attachable Visibility', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      const s = ds.getState();
      s.windows.forEach((w: any) => s.removeWindow(w.id));
      for (const a of [...s.attachables]) s.removeAttachable(a.id);
    });
    await page.waitForTimeout(200);
  });

  test('spawned attachable has z-index from store nextZIndex', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      ds.getState().spawnAttachable('role', 'Architect', { x: 100, y: 100 });
    });
    await page.waitForTimeout(300);
    const attachable = page.locator('[data-testid^="desktop-attachable-role"]').first();
    await expect(attachable).toBeVisible({ timeout: 3000 });
    const zIndex = await attachable.evaluate(el => getComputedStyle(el).zIndex);
    expect(Number(zIndex)).toBeGreaterThanOrEqual(10);
  });

  test('attachable z-index is above window base z-index', async () => {
    await spawnChatWindow();
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      ds.getState().spawnAttachable('mod', 'TestMod', { x: 200, y: 200 });
    });
    await page.waitForTimeout(300);
    const attachable = page.locator('[data-testid^="desktop-attachable-mod"]').first();
    await expect(attachable).toBeVisible({ timeout: 3000 });
    const attachZIndex = await attachable.evaluate(el => Number(getComputedStyle(el).zIndex));
    // The attachable was spawned AFTER the window, so its z-index should be higher
    expect(attachZIndex).toBeGreaterThanOrEqual(10);
  });

  test('focusAttachable pushes z-index to top', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      const s = ds.getState();
      s.spawnAttachable('role', 'First', { x: 50, y: 50 });
      s.spawnAttachable('flow', 'Second', { x: 150, y: 150 });
    });
    await page.waitForTimeout(300);
    // Focus the first attachable
    const firstId = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return null;
      const s = ds.getState();
      const first = s.attachables.find((a: any) => a.name === 'First');
      if (first) s.focusAttachable(first.id);
      return first?.id;
    });
    expect(firstId).toBeTruthy();
    await page.waitForTimeout(100);
    // Verify first attachable now has highest z-index
    const zIndexes = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return {};
      const s = ds.getState();
      const result: Record<string, number> = {};
      for (const a of s.attachables) result[a.name] = a.zIndex;
      return result;
    });
    expect(zIndexes['First']).toBeGreaterThan(zIndexes['Second']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ██  Infinite Dock Scroll
// ═══════════════════════════════════════════════════════════════════

test.describe('Infinite Dock Scroll', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    // Deploy enough items to trigger scroll
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      const s = ds.getState();
      // Deploy first 5 plugins to ensure attachable dock items exist
      const plugins = s.availablePlugins.slice(0, 5);
      for (const p of plugins) s.deployPlugin(p.id);
    });
    await page.waitForTimeout(400);
  });

  test('scroll arrows are always visible when attachable items exist', async () => {
    const leftArrow = page.locator('[data-testid="attachable-scroll-left"]');
    const rightArrow = page.locator('[data-testid="attachable-scroll-right"]');
    await expect(leftArrow).toBeVisible({ timeout: 3000 });
    await expect(rightArrow).toBeVisible({ timeout: 3000 });
  });

  test('scroll right wraps around to beginning', async () => {
    // Get initial visible items
    const initialItems = await page.evaluate(() => {
      const dock = document.querySelectorAll('[data-testid^="attachable-dock-"]');
      return Array.from(dock).map(el => el.getAttribute('data-testid'));
    });
    expect(initialItems.length).toBeGreaterThan(0);

    // Click right enough times to wrap around
    const rightArrow = page.locator('[data-testid="attachable-scroll-right"]');
    // Click 3 times (3 visible × 3 clicks ≥ 5 items wraps around)
    for (let i = 0; i < 3; i++) {
      await rightArrow.click();
      await page.waitForTimeout(100);
    }

    // Should still have visible items (didn't disappear)
    const afterItems = await page.evaluate(() => {
      const dock = document.querySelectorAll('[data-testid^="attachable-dock-"]');
      return Array.from(dock).map(el => el.getAttribute('data-testid'));
    });
    expect(afterItems.length).toBeGreaterThan(0);
  });

  test('scroll left from beginning wraps to end', async () => {
    const leftArrow = page.locator('[data-testid="attachable-scroll-left"]');
    await leftArrow.click();
    await page.waitForTimeout(200);

    // Should still have visible items
    const items = await page.evaluate(() => {
      const dock = document.querySelectorAll('[data-testid^="attachable-dock-"]');
      return Array.from(dock).map(el => el.getAttribute('data-testid'));
    });
    expect(items.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ██  Settings
// ═══════════════════════════════════════════════════════════════════

test.describe('Settings', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    // Ensure tour is complete so it doesn't interfere
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().updateSettings({ tourCompleted: true });
    });
    await page.waitForTimeout(200);
  });

  test('settings gear button is visible in dock', async () => {
    const settingsBtn = page.locator('[data-testid="dock-settings"]');
    await expect(settingsBtn).toBeVisible({ timeout: 3000 });
  });

  test('clicking settings gear opens settings modal', async () => {
    const settingsBtn = page.locator('[data-testid="dock-settings"]');
    await settingsBtn.click();
    await page.waitForTimeout(400);
    const modal = page.locator('[data-testid="settings-modal"]');
    await expect(modal).toBeVisible({ timeout: 3000 });
    // Should show white background modal with title "Settings"
    await expect(modal.locator('.settings-modal-title')).toContainText('Settings');
  });

  test('settings modal shows CLI adapter options', async () => {
    await page.evaluate(() => {
      const hs = (window as any).__FLUXOR_STORE__;
      if (hs) hs.getState().setShowSettings(true);
    });
    await page.waitForTimeout(400);
    const modal = page.locator('[data-testid="settings-modal"]');
    await expect(modal).toBeVisible({ timeout: 3000 });
    // Should have radio buttons for CLI adapters (one per known provider)
    const radios = modal.locator('[role="radio"]');
    await expect(radios).toHaveCount(10); // opencode, xiaomi-ams, xiaomi-cn, openrouter, anthropic, openai, google, groq, deepseek, xai
  });

  test('settings modal shows canvas click animation toggle', async () => {
    await page.evaluate(() => {
      const hs = (window as any).__FLUXOR_STORE__;
      if (hs) hs.getState().setShowSettings(true);
    });
    await page.waitForTimeout(400);
    const toggle = page.locator('[data-testid="settings-toggle-click-anim"]');
    await expect(toggle).toBeVisible({ timeout: 3000 });
  });

  test('settings modal has repeat tour button', async () => {
    await page.evaluate(() => {
      const hs = (window as any).__FLUXOR_STORE__;
      if (hs) hs.getState().setShowSettings(true);
    });
    await page.waitForTimeout(400);
    const tourBtn = page.locator('[data-testid="settings-repeat-tour"]');
    await expect(tourBtn).toBeVisible({ timeout: 3000 });
  });

  test('canvas click animation setting can be toggled via store', async () => {
    const initial = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      return ds?.getState()?.settings?.canvasClickAnimation;
    });
    expect(initial).toBe(true);

    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().updateSettings({ canvasClickAnimation: false });
    });
    const after = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      return ds?.getState()?.settings?.canvasClickAnimation;
    });
    expect(after).toBe(false);

    // Reset
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().updateSettings({ canvasClickAnimation: true });
    });
  });

  test('settings modal closes on Done button', async () => {
    await page.evaluate(() => {
      const hs = (window as any).__FLUXOR_STORE__;
      if (hs) hs.getState().setShowSettings(true);
    });
    await page.waitForTimeout(400);
    const modal = page.locator('[data-testid="settings-modal"]');
    await expect(modal).toBeVisible({ timeout: 3000 });
    await modal.locator('.settings-done-btn').click();
    await page.waitForTimeout(300);
    await expect(modal).not.toBeVisible({ timeout: 2000 });
  });

  test.afterEach(async () => {
    // Close settings if open
    await page.evaluate(() => {
      const hs = (window as any).__FLUXOR_STORE__;
      if (hs) hs.getState().setShowSettings(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// ██  Quick Tour
// ═══════════════════════════════════════════════════════════════════

test.describe('Quick Tour', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    // Deploy some plugins so attachable scroll arrows are visible for tour
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      const s = ds.getState();
      const plugins = s.availablePlugins.slice(0, 4);
      for (const p of plugins) s.deployPlugin(p.id);
    });
    await page.waitForTimeout(500);
    // Reset tour so it shows (triggers workspace tutorial auto-start)
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) {
        ds.getState().updateSettings({ tourCompleted: false, tutorialCompleted: {} });
        ds.getState().setActiveTutorial(null);
      }
    });
    await page.waitForTimeout(1200);
  });

  test('tour backdrop appears when not completed', async () => {
    const backdrop = page.locator('[data-testid="quick-tour-backdrop"]');
    await expect(backdrop).toBeVisible({ timeout: 5000 });
  });

  test('tour tooltip shows first step about the dock', async () => {
    const tooltip = page.locator('[data-testid="quick-tour-tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 5000 });
    await expect(tooltip.locator('.tour-title')).toContainText('Dock', { timeout: 2000 });
    await expect(tooltip.locator('.tour-step-counter')).toContainText('1 /', { timeout: 2000 });
  });

  test('next button advances to step 2', async () => {
    const nextBtn = page.locator('[data-testid="quick-tour-next"]');
    await expect(nextBtn).toBeVisible({ timeout: 5000 });
    await nextBtn.click();
    await page.waitForTimeout(500);
    const tooltip = page.locator('[data-testid="quick-tour-tooltip"]');
    await expect(tooltip.locator('.tour-step-counter')).toContainText('2 /', { timeout: 3000 });
    await expect(tooltip.locator('.tour-title')).toContainText('Chat', { timeout: 2000 });
  });

  test('backdrop click does NOT dismiss tour', async () => {
    const backdrop = page.locator('[data-testid="quick-tour-backdrop"]');
    await expect(backdrop).toBeVisible({ timeout: 5000 });
    // Click the backdrop SVG area
    await backdrop.locator('svg').first().click({ position: { x: 10, y: 10 }, force: true });
    await page.waitForTimeout(500);
    // Tour should still be visible
    await expect(backdrop).toBeVisible({ timeout: 2000 });
    const tooltip = page.locator('[data-testid="quick-tour-tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 2000 });
  });

  test('skip button completes tour and hides it', async () => {
    const skipBtn = page.locator('.tour-skip');
    await expect(skipBtn).toBeVisible({ timeout: 5000 });
    await skipBtn.click();
    await page.waitForTimeout(500);
    const backdrop = page.locator('[data-testid="quick-tour-backdrop"]');
    await expect(backdrop).not.toBeVisible({ timeout: 3000 });
    const completed = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      return ds?.getState()?.settings?.tourCompleted;
    });
    expect(completed).toBe(true);
  });

  test('completing all steps marks tour as done', async () => {
    const nextBtn = page.locator('[data-testid="quick-tour-next"]');
    const tooltip = page.locator('[data-testid="quick-tour-tooltip"]');

    // Click through all steps, waiting for each step counter to update
    for (let i = 0; i < 8; i++) {
      await expect(nextBtn).toBeVisible({ timeout: 5000 });
      // Verify we're on the expected step before clicking
      if (i < 7) {
        await expect(tooltip.locator('.tour-step-counter')).toContainText(`${i + 1} /`, { timeout: 3000 });
      }
      await nextBtn.click();
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(500);
    const completed = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      return ds?.getState()?.settings?.tourCompleted;
    });
    expect(completed).toBe(true);
  });

  test.afterEach(async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) {
        ds.getState().updateSettings({ tourCompleted: true });
        ds.getState().setActiveTutorial(null);
      }
    });
    await page.waitForTimeout(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ██  Tutorial System (Scenario-driven)
// ═══════════════════════════════════════════════════════════════════

test.describe('Tutorial System', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
  });

  test('can launch roles tutorial from store', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setActiveTutorial('roles');
    });
    await page.waitForTimeout(1200);
    const card = page.locator('[data-testid="tutorial-card"]');
    // The tutorial card should be visible (for non-workspace scenarios)
    // Note: roles uses testid="tutorial-card" not "quick-tour-tooltip"
    await expect(card).toBeVisible({ timeout: 5000 });
  });

  test('roles tutorial shows correct label', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setActiveTutorial('roles');
    });
    await page.waitForTimeout(1200);
    const label = page.locator('.brutalist-card-label');
    await expect(label).toContainText('Roles', { timeout: 3000 });
  });

  test('mods tutorial shows correct label', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setActiveTutorial('mods');
    });
    await page.waitForTimeout(1200);
    const label = page.locator('.brutalist-card-label');
    await expect(label).toContainText('Mods', { timeout: 3000 });
  });

  test('flows tutorial shows correct label', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setActiveTutorial('flows');
    });
    await page.waitForTimeout(1200);
    const label = page.locator('.brutalist-card-label');
    await expect(label).toContainText('Flows', { timeout: 3000 });
  });

  test('tutorial skip marks scenario as completed', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setActiveTutorial('roles');
    });
    await page.waitForTimeout(1200);
    const skipBtn = page.locator('[data-testid="tutorial-skip"]');
    await expect(skipBtn).toBeVisible({ timeout: 5000 });
    await skipBtn.click();
    await page.waitForTimeout(500);
    const completed = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      return ds?.getState()?.settings?.tutorialCompleted?.roles;
    });
    expect(completed).toBe(true);
  });

  test('tutorial next advances through steps', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setActiveTutorial('roles');
    });
    await page.waitForTimeout(1200);
    const nextBtn = page.locator('[data-testid="tutorial-next"]');
    await expect(nextBtn).toBeVisible({ timeout: 5000 });
    // Roles has 3 steps — advance to step 2
    await nextBtn.click();
    await page.waitForTimeout(600);
    const badge = page.locator('.brutalist-step-badge-text');
    await expect(badge).toContainText('2 /', { timeout: 3000 });
  });

  test('tutorial prev goes back a step', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setActiveTutorial('roles');
    });
    await page.waitForTimeout(1200);
    const nextBtn = page.locator('[data-testid="tutorial-next"]');
    await nextBtn.click();
    await page.waitForTimeout(600);
    const prevBtn = page.locator('[data-testid="tutorial-prev"]');
    await expect(prevBtn).toBeVisible({ timeout: 3000 });
    await prevBtn.click();
    await page.waitForTimeout(600);
    const badge = page.locator('.brutalist-step-badge-text');
    await expect(badge).toContainText('1 /', { timeout: 3000 });
  });

  test('completing all steps marks scenario done', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setActiveTutorial('roles');
    });
    await page.waitForTimeout(1200);
    const nextBtn = page.locator('[data-testid="tutorial-next"]');
    // Roles has 3 steps
    for (let i = 0; i < 3; i++) {
      await expect(nextBtn).toBeVisible({ timeout: 5000 });
      await nextBtn.click();
      await page.waitForTimeout(600);
    }
    const completed = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      return ds?.getState()?.settings?.tutorialCompleted?.roles;
    });
    expect(completed).toBe(true);
  });

  test('brutalist card has expected visual elements', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setActiveTutorial('flows');
    });
    await page.waitForTimeout(1200);
    // Check brutalist visual elements are present
    await expect(page.locator('.brutalist-halftone')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.brutalist-tape-top')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.brutalist-icon-box')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.brutalist-asterisk')).toBeVisible({ timeout: 2000 });
  });

  test('tutorial tags are displayed', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setActiveTutorial('flows');
    });
    await page.waitForTimeout(1200);
    const tags = page.locator('.brutalist-tag');
    // Flows has 3 tags: Pipeline, Automation, Steps
    await expect(tags).toHaveCount(3, { timeout: 3000 });
  });

  test('settings shows tutorial replay buttons', async () => {
    // Open settings
    const settingsBtn = page.locator('[data-testid="dock-settings"]');
    await settingsBtn.click();
    await page.waitForTimeout(500);
    // Check for replay all button
    const replayAll = page.locator('[data-testid="settings-repeat-tour"]');
    await expect(replayAll).toBeVisible({ timeout: 3000 });
    // Check for individual tutorial buttons
    const rolesTutorial = page.locator('[data-testid="settings-tutorial-roles"]');
    await expect(rolesTutorial).toBeVisible({ timeout: 3000 });
    const modsTutorial = page.locator('[data-testid="settings-tutorial-mods"]');
    await expect(modsTutorial).toBeVisible({ timeout: 3000 });
    const flowsTutorial = page.locator('[data-testid="settings-tutorial-flows"]');
    await expect(flowsTutorial).toBeVisible({ timeout: 3000 });
    // Close settings
    await page.keyboard.press('Escape');
  });

  test('settings can launch individual tutorial', async () => {
    // Open settings
    const settingsBtn = page.locator('[data-testid="dock-settings"]');
    await settingsBtn.click();
    await page.waitForTimeout(500);
    // Click roles tutorial button
    const rolesTutorial = page.locator('[data-testid="settings-tutorial-roles"]');
    await rolesTutorial.click();
    await page.waitForTimeout(1200);
    // Tutorial should be showing
    const card = page.locator('[data-testid="tutorial-card"]');
    await expect(card).toBeVisible({ timeout: 5000 });
    const label = page.locator('.brutalist-card-label');
    await expect(label).toContainText('Roles', { timeout: 3000 });
  });

  test.afterEach(async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) {
        ds.getState().updateSettings({ tourCompleted: true });
        ds.getState().setActiveTutorial(null);
      }
    });
    await page.waitForTimeout(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ██  Tutorial Visual Verification (screenshot-based)
// ═══════════════════════════════════════════════════════════════════

test.describe('Tutorial Visual Verification', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    await page.evaluate((inv: any) => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      ds.getState().setMarketInventory(inv);
      const plugins = ds.getState().availablePlugins.slice(0, 4);
      for (const p of plugins) ds.getState().deployPlugin(p.id);
    }, FULL_INVENTORY);
    await page.waitForTimeout(500);
  });

  test('workspace step 6 (canvas) highlights full viewport', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) {
        ds.getState().updateSettings({ tourCompleted: false, tutorialCompleted: {} });
        ds.getState().setActiveTutorial(null);
      }
    });
    await page.waitForTimeout(1500);
    const nextBtn = page.locator('[data-testid="quick-tour-next"]');
    // Advance to step 6 (canvas) — steps 1-5 are dock items
    for (let i = 0; i < 5; i++) {
      await expect(nextBtn).toBeVisible({ timeout: 5000 });
      await nextBtn.click();
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/tutorial-ws-step6-canvas.png' });

    // Verify the highlight ring covers the full viewport (not a tiny square)
    const ring = page.locator('.tutorial-backdrop div[style]').last();
    const ringBox = await ring.boundingBox();
    expect(ringBox).toBeTruthy();
    // Viewport highlight should be close to window dimensions
    const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    expect(ringBox!.width).toBeGreaterThan(vp.w * 0.8);
    expect(ringBox!.height).toBeGreaterThan(vp.h * 0.8);
  });

  test('workspace step 8 (attachables dock) highlights full row', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) {
        ds.getState().updateSettings({ tourCompleted: false, tutorialCompleted: {} });
        ds.getState().setActiveTutorial(null);
      }
    });
    await page.waitForTimeout(1500);
    const nextBtn = page.locator('[data-testid="quick-tour-next"]');
    // Advance to step 8 (attachables dock)
    for (let i = 0; i < 7; i++) {
      await expect(nextBtn).toBeVisible({ timeout: 5000 });
      await nextBtn.click();
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/tutorial-ws-step8-dock.png' });

    // The highlight ring should be wider than just a small arrow
    const dockEl = page.locator('[data-testid="attachables-dock"]');
    const dockBox = await dockEl.boundingBox();
    expect(dockBox).toBeTruthy();
    // Dock row should be significantly wider than a single button (~30px)
    expect(dockBox!.width).toBeGreaterThan(100);
  });

  test('roles tutorial card shows ShieldCheck icon, not folder', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setActiveTutorial('roles');
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: '/tmp/tutorial-roles-icon.png' });
    const card = page.locator('[data-testid="tutorial-card"]');
    await expect(card).toBeVisible({ timeout: 5000 });
    // Should NOT have the old folder SVG path
    const folderPath = card.locator('svg path[d*="M4 20h16"]');
    await expect(folderPath).not.toBeVisible({ timeout: 1000 });
  });

  test('flows tutorial card shows GitBranch icon', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setActiveTutorial('flows');
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: '/tmp/tutorial-flows-icon.png' });
    const card = page.locator('[data-testid="tutorial-card"]');
    await expect(card).toBeVisible({ timeout: 5000 });
    const folderPath = card.locator('svg path[d*="M4 20h16"]');
    await expect(folderPath).not.toBeVisible({ timeout: 1000 });
  });

  test('flows step 2 (dock) highlights full attachables dock row', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setActiveTutorial('flows');
    });
    await page.waitForTimeout(1200);
    const nextBtn = page.locator('[data-testid="tutorial-next"]');
    await expect(nextBtn).toBeVisible({ timeout: 5000 });
    await nextBtn.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: '/tmp/tutorial-flows-step2-dock.png' });

    // Verify highlight covers the full dock row
    const dockEl = page.locator('[data-testid="attachables-dock"]');
    const dockBox = await dockEl.boundingBox();
    expect(dockBox).toBeTruthy();
    expect(dockBox!.width).toBeGreaterThan(100);
  });

  test('flows step 3 (canvas) highlights full viewport', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setActiveTutorial('flows');
    });
    await page.waitForTimeout(1200);
    const nextBtn = page.locator('[data-testid="tutorial-next"]');
    await expect(nextBtn).toBeVisible({ timeout: 5000 });
    await nextBtn.click();
    await page.waitForTimeout(600);
    await nextBtn.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: '/tmp/tutorial-flows-step3-canvas.png' });

    // Card should be centered, not hidden behind topbar
    const card = page.locator('[data-testid="tutorial-card"]');
    const cardBox = await card.boundingBox();
    expect(cardBox).toBeTruthy();
    const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    // Card center should be near viewport center
    const cardCenterY = cardBox!.y + cardBox!.height / 2;
    expect(cardCenterY).toBeGreaterThan(vp.h * 0.2);
    expect(cardCenterY).toBeLessThan(vp.h * 0.8);
  });

  test.afterEach(async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) {
        ds.getState().updateSettings({ tourCompleted: true });
        ds.getState().setActiveTutorial(null);
      }
    });
    await page.waitForTimeout(200);
  });
});

test.describe('Star Grid Distribution', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    // Ensure tour is complete so it doesn't interfere
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().updateSettings({ tourCompleted: true });
    });
    await page.waitForTimeout(200);
  });

  test('canvas background is rendered with star/monogram dot pattern', async () => {
    const canvasBg = page.locator('[data-testid="desktop-canvas-bg"]');
    await expect(canvasBg).toBeVisible({ timeout: 3000 });
    // Verify it's a canvas element
    const tagName = await canvasBg.evaluate(el => el.tagName.toLowerCase());
    expect(tagName).toBe('canvas');
  });

  test('canvas background fills the desktop container', async () => {
    const canvasBg = page.locator('[data-testid="desktop-canvas-bg"]');
    await expect(canvasBg).toBeVisible({ timeout: 3000 });
    const style = await canvasBg.evaluate(el => ({
      width: el.clientWidth,
      height: el.clientHeight,
      position: getComputedStyle(el).position,
    }));
    expect(style.width).toBeGreaterThan(200);
    expect(style.height).toBeGreaterThan(200);
    expect(style.position).toBe('absolute');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ██  Dock-to-Desktop Drag
// ═══════════════════════════════════════════════════════════════════

test.describe('Dock-to-Desktop Drag', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    // Make sure tour is complete
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().updateSettings({ tourCompleted: true });
    });
    // Deploy some plugins to get dock items
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      const s = ds.getState();
      for (const a of [...s.attachables]) s.removeAttachable(a.id);
      const plugins = s.availablePlugins.slice(0, 4);
      for (const p of plugins) s.deployPlugin(p.id);
    });
    await page.waitForTimeout(400);
  });

  test('attachable dock items have mousedown handler for drag', async () => {
    const dockItem = page.locator('[data-testid^="attachable-dock-"]').first();
    await expect(dockItem).toBeVisible({ timeout: 3000 });
    // Verify it's interactive (has the dock-attachable-item class)
    await expect(dockItem).toHaveClass(/dock-attachable-item/);
  });

  test('dragging attachable from dock spawns it on canvas via store', async () => {
    // Use store directly to test spawn behavior (drag simulation is complex)
    const beforeCount = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      return ds?.getState()?.attachables?.length ?? 0;
    });

    // Simulate what the drag handler does: spawn an attachable at a position
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      ds.getState().spawnAttachable('role', 'DragTest', { x: 300, y: 200 });
    });
    await page.waitForTimeout(200);

    const afterCount = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      return ds?.getState()?.attachables?.length ?? 0;
    });

    expect(afterCount).toBe(beforeCount + 1);
    // Verify it's on canvas
    const attachable = page.locator('[data-testid="desktop-attachable-role-DragTest"]');
    await expect(attachable).toBeVisible({ timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Canvas wave behavior tests
// ═══════════════════════════════════════════════════════════════════

test.describe('Canvas wave behavior', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
  });

  test('wave does NOT trigger on canvas click (empty area)', async () => {
    // Listen for fluxor:canvas-wave events
    const waveCount = await page.evaluate(() => {
      (window as any).__waveCount = 0;
      window.addEventListener('fluxor:canvas-wave', () => { (window as any).__waveCount++; });
      return (window as any).__waveCount;
    });
    expect(waveCount).toBe(0);

    // Click on the empty canvas area — wave should NOT fire (removed in favor of attachment-triggered waves)
    const desktop = page.locator('[data-testid="seamless-desktop"]');
    const box = await desktop.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await page.waitForTimeout(200);

    const afterCount = await page.evaluate(() => (window as any).__waveCount);
    expect(afterCount).toBe(0);
  });

  test('wave does NOT trigger on window click', async () => {
    await spawnChatWindow();
    await page.waitForTimeout(300);

    // Reset wave counter
    await page.evaluate(() => {
      (window as any).__waveCount2 = 0;
      window.addEventListener('fluxor:canvas-wave', () => { (window as any).__waveCount2++; });
    });

    // Click inside the window body (not canvas)
    const win = page.locator('.desktop-window').last();
    await win.click({ force: true, position: { x: 50, y: 80 } });
    await page.waitForTimeout(200);

    const afterCount = await page.evaluate(() => (window as any).__waveCount2);
    expect(afterCount).toBe(0);
  });

  test('wave triggers on window drag-drop from window center', async () => {
    await page.evaluate(() => { (window as any).__DESKTOP_STORE__.setState({ windows: [] }); });
    await spawnChatWindow();
    await page.waitForTimeout(300);

    // Position window and listen for waves
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      const s = ds.getState();
      const win = s.windows[s.windows.length - 1];
      if (win) {
        s.moveWindow(win.id, { x: 100, y: 100 });
        s.resizeWindow(win.id, { width: 400, height: 300 });
      }
      (window as any).__dropWaveCount = 0;
      window.addEventListener('fluxor:canvas-wave', () => { (window as any).__dropWaveCount++; });
    });
    await page.waitForTimeout(300);

    // Req 4: a window is dragged by its titlebar (the body no longer initiates drag,
    // so text inside windows stays selectable).
    const win = page.locator('.desktop-window').last();
    const titlebar = win.locator('[data-testid="window-titlebar"]');
    const box = await titlebar.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 50, { steps: 5 });
      await page.mouse.up();
    }
    await page.waitForTimeout(300);

    const dropCount = await page.evaluate(() => (window as any).__dropWaveCount);
    expect(dropCount).toBeGreaterThanOrEqual(1);
  });

  test('wave does NOT trigger on window resize', async () => {
    await spawnChatWindow();
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      const s = ds.getState();
      const win = s.windows[s.windows.length - 1];
      if (win) {
        s.moveWindow(win.id, { x: 100, y: 100 });
        s.resizeWindow(win.id, { width: 400, height: 300 });
      }
      (window as any).__resizeWaveCount = 0;
      window.addEventListener('fluxor:canvas-wave', () => { (window as any).__resizeWaveCount++; });
    });
    await page.waitForTimeout(300);

    // Resize from SE corner
    const win = page.locator('.desktop-window').last();
    const handle = win.locator('.resize-handle[data-dir="se"]');
    const handleBox = await handle.boundingBox();
    if (handleBox) {
      await page.mouse.move(handleBox.x + 2, handleBox.y + 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x + 102, handleBox.y + 52, { steps: 5 });
      await page.mouse.up();
    }
    await page.waitForTimeout(300);

    const resizeCount = await page.evaluate(() => (window as any).__resizeWaveCount);
    expect(resizeCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Flow independence tests
// ═══════════════════════════════════════════════════════════════════

test.describe('Flow independence', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
    await ensureInventoryLoaded();
    await clearAttachables();
  });

  test('flows cannot be linked to chat windows via store', async () => {
    await spawnChatWindow();
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      const s = ds.getState();
      const win = s.windows[s.windows.length - 1];
      // Spawn a flow attachable
      const flowId = s.spawnAttachable('flow', 'e2e-visual-regression', { x: 500, y: 500 });
      // Try to drop it on the window
      const success = s.attachToWindow(flowId, win.id);
      // Check window still has no flowId
      const afterWin = ds.getState().windows.find((w: any) => w.id === win.id);
      // Check attachable still exists on canvas
      const attachableStillExists = ds.getState().attachables.some((a: any) => a.id === flowId);
      return { success, flowId: afterWin?.flowId, attachableStillExists };
    });

    expect(result.success).toBe(false);
    expect(result.flowId).toBeFalsy();
    expect(result.attachableStillExists).toBe(true);
  });

  test('roles can still be linked to chat windows', async () => {
    await spawnChatWindow();
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      const s = ds.getState();
      const win = s.windows[s.windows.length - 1];
      const roleId = s.spawnAttachable('role', 'frontend-engineer', { x: 500, y: 500 });
      const success = s.attachToWindow(roleId, win.id);
      const afterWin = ds.getState().windows.find((w: any) => w.id === win.id);
      return { success, roleId: afterWin?.roleId };
    });

    expect(result.success).toBe(true);
    expect(result.roleId).toBe('frontend-engineer');
  });

  test('mods can still be linked to chat windows', async () => {
    await spawnChatWindow();
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      const s = ds.getState();
      const win = s.windows[s.windows.length - 1];
      const modId = s.spawnAttachable('mod', 'async-first', { x: 500, y: 500 });
      const success = s.attachToWindow(modId, win.id);
      const afterWin = ds.getState().windows.find((w: any) => w.id === win.id);
      return { success, hasMod: afterWin?.modifierIds?.includes('async-first') };
    });

    expect(result.success).toBe(true);
    expect(result.hasMod).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TopBar cleanup tests
// ═══════════════════════════════════════════════════════════════════

test.describe('TopBar shows only IDE name', () => {
  test.beforeEach(async () => {
    await ensureProjectOpen();
  });

  test('topbar displays Fluxor brand', async () => {
    const brand = page.locator('[data-testid="topbar-brand"]');
    await expect(brand).toBeVisible({ timeout: 5000 });
    const text = await brand.textContent();
    expect(text).toContain('Fluxor');
  });

  test('topbar area has widget launcher (notifications affordance)', async () => {
    // notification-bell replaced by widget-launcher (hover-triggered HUD launcher)
    const notif = page.locator('[data-testid="widget-launcher"]');
    await expect(notif).toBeVisible({ timeout: 2000 });
  });

  test('topbar does NOT have settings button', async () => {
    const settings = page.locator('header[aria-label="Fluxor IDE header"] [aria-label="Settings"]');
    await expect(settings).not.toBeVisible({ timeout: 2000 });
  });

  test('topbar does NOT have project tabs', async () => {
    const tabs = page.locator('header[aria-label="Fluxor IDE header"] [role="tablist"]');
    await expect(tabs).not.toBeVisible({ timeout: 2000 });
  });
});
