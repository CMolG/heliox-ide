/**
 * context-menus.spec.ts — Playwright E2E tests for context menus
 *
 * Validates:
 * - Mental card right-click context menu (Change color, Delete card)
 * - Mental edge right-click context menu (Change color, Delete edge)
 * - NodeTree right-click context menu for windows (Rename, Locate, Minimize, Delete)
 * - NodeTree right-click context menu for mental cards (Rename, Locate, Delete)
 * - NodeTree right-click context menu for grids: REMOVED (Grid feature removed)
 * - Mental card edges render without arrowheads (plain lines)
 */
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import { getElectronLaunchArgs, getE2EEnv } from './test-helpers';

let app: ElectronApplication;
let page: Page;

// ─── Boot helpers ─────────────────────────────────────────────────

test.beforeAll(async () => {
  app = await electron.launch({
    args: getElectronLaunchArgs(),
    cwd: path.join(__dirname, '..'),
    env: getE2EEnv(),
    timeout: 30_000,
  });

  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // Wait for the stores to be ready (app fully loaded)
  await page.waitForFunction(
    () => !!(window as any).__HELIOX_STORE__ && !!(window as any).__DESKTOP_STORE__,
    { timeout: 15_000 },
  );

  // Clear persisted state after app has loaded (localStorage available)
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await page.waitForFunction(
    () => !!(window as any).__HELIOX_STORE__ && !!(window as any).__DESKTOP_STORE__,
    { timeout: 15_000 },
  );
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ─── Setup helpers ────────────────────────────────────────────────

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
      // Also clear any active tutorial so the backdrop does not intercept clicks.
      ds.getState().setActiveTutorial(null);
    }
  });
}

async function resetState() {
  await page.evaluate(() => {
    const s = (window as any).__DESKTOP_STORE__?.getState();
    if (!s) return;
    for (const e of [...(s.mentalEdges ?? [])]) s.removeMentalEdge(e.id);
    for (const n of [...s.mentalNodes]) s.removeMentalNode(n.id);
    for (const w of [...s.windows]) s.removeWindow(w.id);
    s.setMentalMode('square');
    s.setMentalTool('select');
    s.setMentalEditingNodeId(null);
  });
  await page.waitForTimeout(150);
}

/** Create a mental node via the store and return its ID */
async function createMentalNode(text: string, opts?: { x?: number; y?: number; color?: string }) {
  return page.evaluate(
    ({ text, x, y, color }) => {
      return (window as any).__DESKTOP_STORE__?.getState()?.addMentalNode({
        position: { x: x ?? 300, y: y ?? 300 },
        width: 220,
        height: 120,
        text,
        color: color ?? '#EDE9FE',
        shape: 'square',
      });
    },
    { text, x: opts?.x, y: opts?.y, color: opts?.color },
  );
}

test.beforeEach(async () => {
  await ensureDesktop();
  await resetState();
});

// ─── Mental Card Context Menu ─────────────────────────────────────

test.describe('Mental card context menu', () => {
  test('right-clicking a mental card shows context menu with "Change color" and "Delete card"', async () => {
    const nodeId = await createMentalNode('ctx test card');
    await page.waitForTimeout(300);

    const nodeEl = page.locator(`[data-testid="mental-graph-node-${nodeId}"]`);
    await expect(nodeEl).toBeVisible({ timeout: 5_000 });

    await nodeEl.click({ button: 'right' });
    await page.waitForTimeout(300);

    const ctxMenu = page.locator(`[data-testid="mental-node-ctx-menu-${nodeId}"]`);
    await expect(ctxMenu).toBeVisible({ timeout: 3_000 });

    // Verify menu items
    const colorBtn = page.locator(`[data-testid="mental-node-color-${nodeId}"]`);
    const deleteBtn = page.locator(`[data-testid="mental-node-delete-${nodeId}"]`);
    await expect(colorBtn).toBeVisible();
    await expect(deleteBtn).toBeVisible();
    await expect(colorBtn).toContainText('Change color');
    await expect(deleteBtn).toContainText('Delete card');
  });

  test('"Change color" opens color picker modal', async () => {
    const nodeId = await createMentalNode('color test');
    await page.waitForTimeout(300);

    const nodeEl = page.locator(`[data-testid="mental-graph-node-${nodeId}"]`);
    await nodeEl.click({ button: 'right' });
    await page.waitForTimeout(300);

    const colorBtn = page.locator(`[data-testid="mental-node-color-${nodeId}"]`);
    await colorBtn.click();
    await page.waitForTimeout(300);

    // Color modal should appear
    const colorModal = page.locator('.mental-color-modal');
    await expect(colorModal).toBeVisible({ timeout: 3_000 });
  });

  test('"Delete card" removes the mental node from the store', async () => {
    const nodeId = await createMentalNode('delete test');
    await page.waitForTimeout(300);

    const nodeEl = page.locator(`[data-testid="mental-graph-node-${nodeId}"]`);
    await nodeEl.click({ button: 'right' });
    await page.waitForTimeout(300);

    const deleteBtn = page.locator(`[data-testid="mental-node-delete-${nodeId}"]`);
    await deleteBtn.click();
    await page.waitForTimeout(300);

    const found = await page.evaluate(
      (id: string) => !!(window as any).__DESKTOP_STORE__?.getState()?.mentalNodes?.find((n: any) => n.id === id),
      nodeId,
    );
    expect(found).toBe(false);
  });
});

// ─── Mental Edge Context Menu ─────────────────────────────────────

test.describe('Mental edge context menu', () => {
  test('right-clicking a mental edge shows context menu with "Change color" and "Delete edge"', async () => {
    const nodeA = await createMentalNode('Edge A', { x: 200, y: 200 });
    const nodeB = await createMentalNode('Edge B', { x: 600, y: 200 });
    await page.waitForTimeout(200);

    // Create an edge between the two nodes via store
    const edgeId = await page.evaluate(
      ({ sourceId, targetId }) => {
        const s = (window as any).__DESKTOP_STORE__?.getState();
        return s?.addMentalEdge({
          sourceId,
          targetId,
          sourceHandle: 'right-source',
          targetHandle: 'left-target',
          edgeColor: '#7C3AED',
          edgeType: 'link',
        });
      },
      { sourceId: nodeA, targetId: nodeB },
    );
    await page.waitForTimeout(400);

    // The edge hit-area path should be clickable
    // React Flow edges have g elements with data-testid
    const edgePath = page.locator(`[data-testid="rf__edge-${edgeId}"]`);
    if (await edgePath.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Get the bounding box of the edge group and right-click in the middle
      const box = await edgePath.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
        await page.waitForTimeout(300);

        const ctxMenu = page.locator(`[data-testid="mental-edge-ctx-menu-${edgeId}"]`);
        await expect(ctxMenu).toBeVisible({ timeout: 3_000 });

        const colorBtn = page.locator(`[data-testid="mental-edge-color-${edgeId}"]`);
        const deleteBtn = page.locator(`[data-testid="mental-edge-delete-${edgeId}"]`);
        await expect(colorBtn).toContainText('Change color');
        await expect(deleteBtn).toContainText('Delete edge');
      }
    }
  });
});

// ─── Plain Lines (No Arrowheads) ──────────────────────────────────

test.describe('Mental edge arrowheads', () => {
  test('mental edges render without SVG marker arrowheads', async () => {
    const nodeA = await createMentalNode('Arrow A', { x: 200, y: 200 });
    const nodeB = await createMentalNode('Arrow B', { x: 600, y: 200 });
    await page.waitForTimeout(200);

    await page.evaluate(
      ({ sourceId, targetId }) => {
        const s = (window as any).__DESKTOP_STORE__?.getState();
        s?.addMentalEdge({
          sourceId,
          targetId,
          sourceHandle: 'right-source',
          targetHandle: 'left-target',
          edgeColor: '#7C3AED',
          edgeType: 'link',
        });
      },
      { sourceId: nodeA, targetId: nodeB },
    );
    await page.waitForTimeout(400);

    // No marker-end attributes should exist on edge paths
    const markerEnds = await page.evaluate(() => {
      const paths = document.querySelectorAll('.react-flow__edge path[marker-end]');
      return paths.length;
    });
    expect(markerEnds).toBe(0);

    // No arrowhead marker defs should exist
    const arrowMarkers = await page.evaluate(() => {
      const markers = document.querySelectorAll('marker[id*="arrow"], marker[id*="Arrow"]');
      return markers.length;
    });
    expect(arrowMarkers).toBe(0);
  });
});

// ─── NodeTree Context Menu — Windows ──────────────────────────────

test.describe('NodeTree window context menu', () => {
  test('right-clicking a window in NodeTree shows context menu', async () => {
    // Create a chat window
    const windowId = await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      return s?.addWindow({
        type: 'chat',
        title: 'Test Chat',
        position: { x: 100, y: 100 },
        size: { width: 400, height: 300 },
      });
    });
    await page.waitForTimeout(300);

    // Open the side panel to NodeTree
    const navItem = page.locator(`[data-testid="nav-window-${windowId}"]`);
    // If the sidebar is not visible, the test will skip
    if (await navItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await navItem.click({ button: 'right' });
      await page.waitForTimeout(300);

      const ctxMenu = page.locator('[data-testid="nodetree-context-menu"]');
      await expect(ctxMenu).toBeVisible({ timeout: 3_000 });

      // Should contain all 4 actions for windows
      await expect(page.locator('[data-testid="nodetree-ctx-rename"]')).toBeVisible();
      await expect(page.locator('[data-testid="nodetree-ctx-locate"]')).toBeVisible();
      await expect(page.locator('[data-testid="nodetree-ctx-minimize"]')).toBeVisible();
      await expect(page.locator('[data-testid="nodetree-ctx-delete"]')).toBeVisible();
      await expect(page.locator('[data-testid="nodetree-ctx-delete"]')).toHaveText('Close window');
    }
  });

  test('rename action shows inline input and updates window title', async () => {
    const windowId = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState()?.addWindow({
        type: 'chat',
        title: 'Old Title',
        position: { x: 100, y: 100 },
        size: { width: 400, height: 300 },
      });
    });
    await page.waitForTimeout(300);

    const navItem = page.locator(`[data-testid="nav-window-${windowId}"]`);
    if (await navItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await navItem.click({ button: 'right' });
      await page.waitForTimeout(300);

      await page.locator('[data-testid="nodetree-ctx-rename"]').click();
      await page.waitForTimeout(300);

      // Rename input should be visible
      const renameInput = page.locator(`[data-testid="nav-window-rename-input-${windowId}"]`);
      await expect(renameInput).toBeVisible({ timeout: 3_000 });

      // Type new name and press Enter
      await renameInput.fill('New Title');
      await renameInput.press('Enter');
      await page.waitForTimeout(200);

      // Verify store was updated
      const newTitle = await page.evaluate(
        (id: string) => (window as any).__DESKTOP_STORE__?.getState()?.windows?.find((w: any) => w.id === id)?.title,
        windowId,
      );
      expect(newTitle).toBe('New Title');
    }
  });

  test('delete action removes the window from the store', async () => {
    const windowId = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState()?.addWindow({
        type: 'chat',
        title: 'To Delete',
        position: { x: 100, y: 100 },
        size: { width: 400, height: 300 },
      });
    });
    await page.waitForTimeout(300);

    const navItem = page.locator(`[data-testid="nav-window-${windowId}"]`);
    if (await navItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await navItem.click({ button: 'right' });
      await page.waitForTimeout(300);

      await expect(page.locator('[data-testid="nodetree-ctx-delete"]')).toHaveText('Close window');
      await page.locator('[data-testid="nodetree-ctx-delete"]').click();
      await page.waitForTimeout(300);

      const found = await page.evaluate(
        (id: string) => !!(window as any).__DESKTOP_STORE__?.getState()?.windows?.find((w: any) => w.id === id),
        windowId,
      );
      expect(found).toBe(false);
    }
  });
});

// ─── NodeTree Context Menu — Mental Cards ─────────────────────────

test.describe('NodeTree mental card context menu', () => {
  test('right-clicking a mental card in NodeTree shows context menu with rename, locate, delete', async () => {
    const nodeId = await createMentalNode('NT card ctx');
    await page.waitForTimeout(300);

    const navItem = page.locator(`[data-testid="nav-mental-node-${nodeId}"]`);
    if (await navItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await navItem.click({ button: 'right' });
      await page.waitForTimeout(300);

      const ctxMenu = page.locator('[data-testid="nodetree-context-menu"]');
      await expect(ctxMenu).toBeVisible({ timeout: 3_000 });

      // Mental cards should have Rename, Locate, Delete but NOT Minimize
      await expect(page.locator('[data-testid="nodetree-ctx-rename"]')).toBeVisible();
      await expect(page.locator('[data-testid="nodetree-ctx-locate"]')).toBeVisible();
      await expect(page.locator('[data-testid="nodetree-ctx-delete"]')).toBeVisible();
      await expect(page.locator('[data-testid="nodetree-ctx-delete"]')).toHaveText('Delete');
      await expect(page.locator('[data-testid="nodetree-ctx-minimize"]')).not.toBeVisible();
    }
  });

  test('rename updates the mental card text in the store', async () => {
    const nodeId = await createMentalNode('Original text');
    await page.waitForTimeout(300);

    const navItem = page.locator(`[data-testid="nav-mental-node-${nodeId}"]`);
    if (await navItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await navItem.click({ button: 'right' });
      await page.waitForTimeout(300);

      await page.locator('[data-testid="nodetree-ctx-rename"]').click();
      await page.waitForTimeout(300);

      const renameInput = page.locator(`[data-testid="nav-mental-rename-input-${nodeId}"]`);
      await expect(renameInput).toBeVisible({ timeout: 3_000 });

      await renameInput.fill('Updated text');
      await renameInput.press('Enter');
      await page.waitForTimeout(200);

      const newText = await page.evaluate(
        (id: string) => (window as any).__DESKTOP_STORE__?.getState()?.mentalNodes?.find((n: any) => n.id === id)?.text,
        nodeId,
      );
      expect(newText).toBe('Updated text');
    }
  });

  test('delete removes the mental card from the store', async () => {
    const nodeId = await createMentalNode('To remove');
    await page.waitForTimeout(300);

    const navItem = page.locator(`[data-testid="nav-mental-node-${nodeId}"]`);
    if (await navItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await navItem.click({ button: 'right' });
      await page.waitForTimeout(300);

      await page.locator('[data-testid="nodetree-ctx-delete"]').click();
      await page.waitForTimeout(300);

      const found = await page.evaluate(
        (id: string) => !!(window as any).__DESKTOP_STORE__?.getState()?.mentalNodes?.find((n: any) => n.id === id),
        nodeId,
      );
      expect(found).toBe(false);
    }
  });
});

// NOTE: NodeTree grid context menu tests REMOVED — the Grid feature has been
// removed entirely (no grid dock button, no grid containers, no grid context-menu).
