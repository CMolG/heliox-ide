/**
 * mental-map.spec.ts — Playwright E2E tests for the Heliox Mental Map tool
 *
 * Responsibility:
 * - Verifies that the mental map tool is reachable from the dock.
 * - Validates that the dropdown shows "Square", "Circle", and "Triangle"
 *   (not the legacy "Select"/"Ramification" labels).
 * - Confirms that activating a shape mode renders the React Flow canvas.
 * - Confirms that nodes created via draw-rectangle and double-click land in
 *   `mentalNodes[]` (visible in the React Flow surface) and NOT in `attachables[]`.
 * - Verifies node elements are visible in the DOM after creation.
 * - Verifies mode switching works correctly.
 *
 * Architecture note:
 * All store mutations use `window.__DESKTOP_STORE__` (exposed by App.tsx for E2E)
 * to avoid UI-flakiness and focus each test on its specific assertion.
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

  // Clear persisted state to ensure a clean test context
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // Wait for React + stores to be ready
  await page.waitForFunction(
    () => !!(window as any).__HELIOX_STORE__ && !!(window as any).__DESKTOP_STORE__,
    { timeout: 15_000 },
  );
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ─── Shared setup helpers ─────────────────────────────────────────

/** Navigate to the desktop canvas (set a fake project path if needed). */
async function ensureDesktop() {
  const desktop = page.locator('[data-testid="seamless-desktop"]');
  if (!(await desktop.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await page.evaluate(() => {
      const store = (window as any).__HELIOX_STORE__;
      if (store) store.getState().setProjectPath('/tmp/test-project');
    });
    await desktop.waitFor({ state: 'visible', timeout: 10_000 });
  }
  // Dismiss quick-tour so it doesn't block interactions
  await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) ds.getState().updateSettings({ tourCompleted: true });
  });
}

/** Reset mental state to a clean baseline between tests. */
async function resetMentalState() {
  await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    if (!store) return;
    const s = store.getState();
    // Close all desktop windows so mouse-event tests have empty canvas to draw on
    for (const w of [...s.windows]) s.removeWindow(w.id);
    // Clear all mental graph nodes + edges
    for (const n of [...s.mentalNodes]) s.removeMentalNode(n.id);
    // Reset mode to shapes and tool to select
    s.setMentalMode('square');
    s.setMentalTool('select');
    s.setMentalEditingNodeId(null);
  });
  await page.waitForTimeout(150);
}

test.beforeEach(async () => {
  await ensureDesktop();
  await resetMentalState();
});

// ─── Dock integration ─────────────────────────────────────────────

test.describe('Mental map dock button', () => {
  test('mental draw toggle button is visible in the dock', async () => {
    const btn = page.locator('[data-testid="dock-mental-draw-toggle"]');
    await expect(btn).toBeVisible({ timeout: 5_000 });
  });

  test('hovering the mental button opens a dropdown', async () => {
    const btn = page.locator('[data-testid="dock-mental-draw-toggle"]');
    await btn.hover();
    await page.waitForTimeout(300);
    // Dock popover should appear
    const popover = page.locator('.dock-mental-menu');
    await expect(popover).toBeVisible({ timeout: 3_000 });
  });

  test('dropdown contains only "Square" label (circle and triangle removed)', async () => {
    const btn = page.locator('[data-testid="dock-mental-draw-toggle"]');
    await btn.hover();
    await page.waitForTimeout(300);

    const popover = page.locator('.dock-mental-menu');
    await expect(popover).toBeVisible({ timeout: 3_000 });

    // Only Square should be in the dropdown
    await expect(popover).toContainText('Square');
    // Circle and Triangle should NOT appear
    await expect(popover).not.toContainText('Circle');
    await expect(popover).not.toContainText('Triangle');
    // Old tool label must NOT appear
    await expect(popover).not.toContainText('Select');
  });

  test('clicking "Square" option sets mentalMode to square', async () => {
    const btn = page.locator('[data-testid="dock-mental-draw-toggle"]');
    await btn.hover();
    await page.waitForTimeout(300);

    const squareOption = page.locator('.dock-mental-icon-option[aria-label="Square shape"]');
    await expect(squareOption).toBeVisible({ timeout: 3_000 });
    await squareOption.click();
    await page.waitForTimeout(200);

    const mode = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__?.getState()?.mentalMode,
    );
    expect(mode).toBe('square');
  });

});

// ─── Canvas visibility ────────────────────────────────────────────

test.describe('Mental map canvas visibility', () => {
  test('React Flow canvas is visible in square mode', async () => {
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('square');
    });
    await page.waitForTimeout(200);

    const canvas = page.locator('[data-testid="mental-graph-canvas"]');
    await expect(canvas).toBeVisible({ timeout: 5_000 });
  });

  test('React Flow canvas is ALWAYS rendered (visible even in off mode)', async () => {
    // The canvas container is unconditionally mounted — it is always in the DOM.
    // "off" mode disables DRAWING TOOLS (crosshair cursor, draw-on-mousedown) but
    // does NOT unmount or hide the canvas. Mental cards persist regardless of mode.
    await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      // Clear all nodes — canvas should still be visible even with no nodes
      for (const n of [...(s?.mentalNodes ?? [])]) s?.removeMentalNode(n.id);
      s?.setMentalMode('off');
    });
    await page.waitForTimeout(200);

    const canvas = page.locator('[data-testid="mental-graph-canvas"]');
    await expect(canvas).toBeVisible({ timeout: 3_000 });
  });

  test('canvas has correct data-mental-tool attribute for select tool', async () => {
    await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      s?.setMentalMode('square');
      s?.setMentalTool('select');
    });
    await page.waitForTimeout(200);

    const canvas = page.locator('[data-testid="mental-graph-canvas"]');
    await expect(canvas).toHaveAttribute('data-mental-tool', 'select');
  });

  test('canvas data-mental-tool updates when ramification tool is active', async () => {
    await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      s?.setMentalMode('square');
      s?.setMentalTool('ramification');
    });
    await page.waitForTimeout(200);

    const canvas = page.locator('[data-testid="mental-graph-canvas"]');
    await expect(canvas).toHaveAttribute('data-mental-tool', 'ramification');
  });
});

// ─── Node creation ────────────────────────────────────────────────

test.describe('Mental map node creation', () => {
  test('addMentalNode via store creates node in mentalNodes[] not attachables[]', async () => {
    const result = await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      const nodeId = s?.addMentalNode({
        position: { x: 200, y: 150 },
        width: 220,
        height: 120,
        text: 'Test node',
        color: '#EDE9FE',
        shape: 'square',
      });
      const state = (window as any).__DESKTOP_STORE__?.getState();
      return {
        nodeId,
        inMentalNodes: !!state?.mentalNodes?.find((n: any) => n.id === nodeId),
        inAttachables: !!state?.attachables?.find((a: any) => a.id === nodeId),
      };
    });

    expect(result.nodeId).toBeTruthy();
    expect(result.inMentalNodes).toBe(true);
    // Critical: must NOT end up in attachables (that was the original bug)
    expect(result.inAttachables).toBe(false);
  });

  test('node created via store is visible in the React Flow DOM', async () => {
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('square');
    });
    await page.waitForTimeout(200);

    const nodeId = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState()?.addMentalNode({
        position: { x: 100, y: 100 },
        width: 220,
        height: 120,
        text: 'Visible node',
        color: '#EDE9FE',
        shape: 'square',
      });
    });

    await page.waitForTimeout(300);

    // The mental card should be in the DOM with the right test id
    const nodeEl = page.locator(`[data-testid="mental-graph-node-${nodeId}"]`);
    await expect(nodeEl).toBeVisible({ timeout: 5_000 });
  });

  test('node card renders with the correct background color', async () => {
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('square');
    });
    await page.waitForTimeout(200);

    const nodeId = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState()?.addMentalNode({
        position: { x: 100, y: 100 },
        width: 220,
        height: 120,
        text: '',
        color: '#FBCFE8',
        shape: 'square',
      });
    });

    await page.waitForTimeout(300);

    const nodeEl = page.locator(`[data-testid="mental-graph-node-${nodeId}"]`);
    // With SVG-based shapes the color lives on the SVG shape fill, not
    // the card div's CSS background.
    const fill = await nodeEl.evaluate((el: HTMLElement) => {
      const svg = el.querySelector('.mental-shape-svg rect, .mental-shape-svg ellipse, .mental-shape-svg polygon');
      return svg?.getAttribute('fill') ?? '';
    });
    const isMatch = /fbcfe8/i.test(fill);
    expect(isMatch).toBe(true);
  });

  test('double-clicking on empty canvas creates a mental node', async () => {
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('square');
    });
    await page.waitForTimeout(200);

    const beforeCount = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__?.getState()?.mentalNodes?.length ?? 0,
    );

    // Double-click inside the React Flow canvas (pane area)
    const canvas = page.locator('[data-testid="mental-graph-canvas"]');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('mental-graph-canvas not found');

    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);

    const afterCount = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__?.getState()?.mentalNodes?.length ?? 0,
    );

    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  test('rectangle-draw on canvas creates a node in mentalNodes (not attachables)', async () => {
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('square');
    });
    await page.waitForTimeout(200);

    const beforeMentalCount = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__?.getState()?.mentalNodes?.length ?? 0,
    );
    const beforeAttachCount = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__?.getState()?.attachables?.filter((a: any) => a.type === 'mental')?.length ?? 0,
    );

    // Draw a rectangle on the desktop-canvas (not on a node/handle)
    const desktop = page.locator('[data-testid="seamless-desktop"]');
    const box = await desktop.boundingBox();
    if (!box) throw new Error('seamless-desktop not found');

    const startX = box.x + 300;
    const startY = box.y + 200;
    const endX = startX + 180;
    const endY = startY + 120;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 50, startY + 30);   // trigger draw mode
    await page.mouse.move(endX, endY);
    await page.mouse.up();
    await page.waitForTimeout(400);

    const afterMentalCount = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__?.getState()?.mentalNodes?.length ?? 0,
    );
    const afterAttachCount = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__?.getState()?.attachables?.filter((a: any) => a.type === 'mental')?.length ?? 0,
    );

    // A new node must appear in mentalNodes
    expect(afterMentalCount).toBeGreaterThan(beforeMentalCount);
    // The old bug: mental shapes were going into attachables — must NOT increase
    expect(afterAttachCount).toBe(beforeAttachCount);
  });

  test('rectangle-draw preview (crosshair rect) is shown while drawing', async () => {
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('square');
    });
    await page.waitForTimeout(200);

    const desktop = page.locator('[data-testid="seamless-desktop"]');
    const box = await desktop.boundingBox();
    if (!box) throw new Error('seamless-desktop not found');

    const startX = box.x + 250;
    const startY = box.y + 180;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY + 60);

    // Preview rect should be visible during draw
    const preview = page.locator('[data-testid="mental-draw-preview"]');
    await expect(preview).toBeVisible({ timeout: 2_000 });

    await page.mouse.up();
  });
});

// ─── Node deletion ────────────────────────────────────────────────

test.describe('Mental map node deletion', () => {
  test('deleting a node removes it from mentalNodes', async () => {
    const nodeId = await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      s?.setMentalMode('square');
      return s?.addMentalNode({
        position: { x: 100, y: 100 },
        width: 220,
        height: 120,
        text: 'To delete',
        color: '#EDE9FE',
        shape: 'square',
      });
    });

    await page.waitForTimeout(300);

    // Delete via store
    await page.evaluate((id: string) => {
      (window as any).__DESKTOP_STORE__?.getState()?.removeMentalNode(id);
    }, nodeId);

    await page.waitForTimeout(200);

    const found = await page.evaluate(
      (id: string) => !!(window as any).__DESKTOP_STORE__?.getState()?.mentalNodes?.find((n: any) => n.id === id),
      nodeId,
    );
    expect(found).toBe(false);
  });

  test('deleting a node removes its card from the DOM', async () => {
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('square');
    });
    await page.waitForTimeout(200);

    const nodeId = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState()?.addMentalNode({
        position: { x: 100, y: 100 },
        width: 220,
        height: 120,
        text: 'DOM delete test',
        color: '#EDE9FE',
        shape: 'square',
      });
    });

    await page.waitForTimeout(300);
    await expect(page.locator(`[data-testid="mental-graph-node-${nodeId}"]`)).toBeVisible({ timeout: 3_000 });

    await page.evaluate((id: string) => {
      (window as any).__DESKTOP_STORE__?.getState()?.removeMentalNode(id);
    }, nodeId);

    await page.waitForTimeout(200);
    await expect(page.locator(`[data-testid="mental-graph-node-${nodeId}"]`)).not.toBeVisible({ timeout: 3_000 });
  });

  test('right-click context menu on node shows Delete card option', async () => {
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('square');
    });
    await page.waitForTimeout(200);

    const nodeId = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState()?.addMentalNode({
        position: { x: 300, y: 200 },
        width: 220,
        height: 120,
        text: 'Context menu test',
        color: '#EDE9FE',
        shape: 'square',
      });
    });

    await page.waitForTimeout(400);

    const nodeEl = page.locator(`[data-testid="mental-graph-node-${nodeId}"]`);
    await expect(nodeEl).toBeVisible({ timeout: 5_000 });
    await nodeEl.click({ button: 'right' });
    await page.waitForTimeout(200);

    // The context menu delete button
    const deleteBtn = page.locator(`[data-testid="mental-node-delete-${nodeId}"]`);
    await expect(deleteBtn).toBeVisible({ timeout: 3_000 });
  });

  test('context menu delete removes node from DOM and store', async () => {
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('square');
    });
    await page.waitForTimeout(200);

    const nodeId = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState()?.addMentalNode({
        position: { x: 300, y: 200 },
        width: 220,
        height: 120,
        text: 'Delete via menu',
        color: '#EDE9FE',
        shape: 'square',
      });
    });

    await page.waitForTimeout(400);

    const nodeEl = page.locator(`[data-testid="mental-graph-node-${nodeId}"]`);
    await expect(nodeEl).toBeVisible({ timeout: 5_000 });
    await nodeEl.click({ button: 'right' });
    await page.waitForTimeout(200);

    const deleteBtn = page.locator(`[data-testid="mental-node-delete-${nodeId}"]`);
    await deleteBtn.click();
    await page.waitForTimeout(300);

    // Node gone from DOM
    await expect(nodeEl).not.toBeVisible({ timeout: 3_000 });

    // Node gone from store
    const found = await page.evaluate(
      (id: string) => !!(window as any).__DESKTOP_STORE__?.getState()?.mentalNodes?.find((n: any) => n.id === id),
      nodeId,
    );
    expect(found).toBe(false);
  });
});

// ─── Edges ────────────────────────────────────────────────────────

test.describe('Mental map edges', () => {
  test('addMentalEdge creates a directed edge between two nodes', async () => {
    const result = await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      const a = s?.addMentalNode({ position: { x: 100, y: 100 }, width: 220, height: 120, text: 'A', color: '#EDE9FE', shape: 'square' });
      const b = s?.addMentalNode({ position: { x: 400, y: 100 }, width: 220, height: 120, text: 'B', color: '#EDE9FE', shape: 'square' });
      const edgeId = s?.addMentalEdge(a, b, 'link');
      const edges = (window as any).__DESKTOP_STORE__?.getState()?.mentalEdges;
      return {
        edgeId,
        edgeCount: edges?.length,
        edge: edges?.find((e: any) => e.id === edgeId),
      };
    });

    expect(result.edgeId).toBeTruthy();
    expect(result.edgeCount).toBeGreaterThan(0);
    expect(result.edge?.type).toBe('link');
  });

  test('self-edge is rejected', async () => {
    const result = await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      const a = s?.addMentalNode({ position: { x: 100, y: 100 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
      return s?.addMentalEdge(a, a);
    });
    expect(result).toBeNull();
  });

  test('removeMentalNode cascades to delete its edges', async () => {
    const result = await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      const a = s?.addMentalNode({ position: { x: 100, y: 100 }, width: 220, height: 120, text: 'A', color: '#EDE9FE', shape: 'square' });
      const b = s?.addMentalNode({ position: { x: 400, y: 100 }, width: 220, height: 120, text: 'B', color: '#EDE9FE', shape: 'square' });
      s?.addMentalEdge(a, b, 'link');
      const edgesBeforeDelete = (window as any).__DESKTOP_STORE__?.getState()?.mentalEdges?.length;
      s?.removeMentalNode(a);
      const edgesAfterDelete = (window as any).__DESKTOP_STORE__?.getState()?.mentalEdges?.length;
      return { edgesBeforeDelete, edgesAfterDelete };
    });

    expect(result.edgesBeforeDelete).toBe(1);
    expect(result.edgesAfterDelete).toBe(0);
  });
});

// ─── Mode switching ───────────────────────────────────────────────

test.describe('Mental map mode switching', () => {
  test('switching from square to off keeps the React Flow canvas visible', async () => {
    // The canvas is always rendered regardless of mentalMode.
    // Switching to "off" disables drawing tool interactions but does NOT hide the canvas.
    // Mental cards already on the canvas remain visible — the canvas is never unmounted.
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('square');
    });
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid="mental-graph-canvas"]')).toBeVisible({ timeout: 3_000 });

    await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      // Clear all nodes — canvas should still be present even with no nodes
      for (const n of [...(s?.mentalNodes ?? [])]) s?.removeMentalNode(n.id);
      s?.setMentalMode('off');
    });
    await page.waitForTimeout(200);
    // Canvas remains visible — switching to off only affects drawing tool affordances
    await expect(page.locator('[data-testid="mental-graph-canvas"]')).toBeVisible({ timeout: 3_000 });
  });

  test('switching from off back to square restores the canvas', async () => {
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('off');
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('square');
    });
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid="mental-graph-canvas"]')).toBeVisible({ timeout: 3_000 });
  });

  test('nodes created in square mode remain in store after mode switch', async () => {
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('square');
    });
    await page.waitForTimeout(200);

    const nodeId = await page.evaluate(() => {
      return (window as any).__DESKTOP_STORE__?.getState()?.addMentalNode({
        position: { x: 100, y: 100 },
        width: 220,
        height: 120,
        text: 'Persisted node',
        color: '#EDE9FE',
        shape: 'square',
      });
    });

    // Switch to circle and back
    await page.evaluate(() => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      s?.setMentalMode('circle');
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('square');
    });
    await page.waitForTimeout(300);

    // Node still in store
    const found = await page.evaluate(
      (id: string) => !!(window as any).__DESKTOP_STORE__?.getState()?.mentalNodes?.find((n: any) => n.id === id),
      nodeId,
    );
    expect(found).toBe(true);

    // Node still visible in DOM
    const nodeEl = page.locator(`[data-testid="mental-graph-node-${nodeId}"]`);
    await expect(nodeEl).toBeVisible({ timeout: 3_000 });
  });
});
