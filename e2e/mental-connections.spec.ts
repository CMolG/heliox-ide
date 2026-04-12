/**
 * mental-connections.spec.ts — Playwright E2E tests for @xyflow/react connections
 *
 * Validates:
 * - Edges with sourceHandle/targetHandle render in the DOM
 * - Click-to-connect creates a visible edge between two nodes
 * - Drag-to-connect creates a visible edge between two nodes
 * - Ramification (drag to empty space) creates a new node + edge
 */
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';

let app: ElectronApplication;
let page: Page;

// ─── Boot helpers ─────────────────────────────────────────────────

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..')],
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ELECTRON_IS_DEV: '1',
      HELIOX_MODELS: 'copilot',
    },
    timeout: 30_000,
  });

  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

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
    if (ds) ds.getState().updateSettings({ tourCompleted: true });
  });
}

async function resetMentalState() {
  await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    if (!store) return;
    const s = store.getState();
    for (const w of [...s.windows]) s.removeWindow(w.id);
    for (const n of [...s.mentalNodes]) s.removeMentalNode(n.id);
    s.setMentalMode('square');
    s.setMentalTool('select');
    s.setMentalEditingNodeId(null);
  });
  await page.waitForTimeout(200);
}

/** Create two nodes spaced apart and return their IDs */
async function createTwoNodes(): Promise<{ nodeA: string; nodeB: string }> {
  const ids = await page.evaluate(() => {
    const s = (window as any).__DESKTOP_STORE__?.getState();
    if (!s) return { nodeA: '', nodeB: '' };
    const a = s.addMentalNode({
      position: { x: 100, y: 200 },
      width: 180, height: 100,
      text: 'Node A', color: '#EDE9FE', shape: 'square',
    });
    const b = s.addMentalNode({
      position: { x: 500, y: 200 },
      width: 180, height: 100,
      text: 'Node B', color: '#FBCFE8', shape: 'square',
    });
    return { nodeA: a, nodeB: b };
  });
  // Wait for React Flow to render and measure the nodes
  await page.waitForTimeout(500);
  return ids;
}

test.beforeEach(async () => {
  await ensureDesktop();
  await resetMentalState();
});

// ─── Edge rendering tests ─────────────────────────────────────────

test.describe('Edge rendering', () => {
  test('programmatic edge with sourceHandle/targetHandle renders in DOM', async () => {
    const { nodeA, nodeB } = await createTwoNodes();

    // Create an edge via the store
    await page.evaluate(({ a, b }) => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      if (s) s.addMentalEdge(a, b, 'link', 'right', 'left');
    }, { a: nodeA, b: nodeB });

    await page.waitForTimeout(500);

    // Verify edge exists in store
    const storeEdgeCount = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__?.getState()?.mentalEdges?.length ?? 0
    );
    expect(storeEdgeCount).toBe(1);

    // Verify edge renders in DOM (React Flow renders edges as SVG paths)
    const domEdgeCount = await page.evaluate(() =>
      document.querySelectorAll('.react-flow__edge').length
    );
    expect(domEdgeCount).toBe(1);
  });

  test('edge created via createRamificationFromDrop renders in DOM', async () => {
    const { nodeA } = await createTwoNodes();

    await page.evaluate((sourceId) => {
      const s = (window as any).__DESKTOP_STORE__?.getState();
      if (s) s.createRamificationFromDrop(sourceId, { x: 300, y: 400 });
    }, nodeA);

    await page.waitForTimeout(500);

    const edgeCount = await page.evaluate(() =>
      document.querySelectorAll('.react-flow__edge').length
    );
    expect(edgeCount).toBe(1);
  });
});

// ─── Click-to-connect tests ──────────────────────────────────────

test.describe('Click-to-connect', () => {
  test('clicking source then target handle creates an edge', async () => {
    const { nodeA, nodeB } = await createTwoNodes();

    // Wait for handles to be visible
    const sourceHandle = page.locator(`[data-testid="mental-graph-node-${nodeA}"]`)
      .locator('.react-flow__handle.source')
      .first();
    const targetHandle = page.locator(`[data-testid="mental-graph-node-${nodeB}"]`)
      .locator('.react-flow__handle.target')
      .first();

    await expect(sourceHandle).toBeAttached({ timeout: 3_000 });
    await expect(targetHandle).toBeAttached({ timeout: 3_000 });

    // Click source handle
    await sourceHandle.click({ force: true });
    await page.waitForTimeout(300);

    // Click target handle
    await targetHandle.click({ force: true });
    await page.waitForTimeout(500);

    // Verify edge in store
    const edgeCount = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__?.getState()?.mentalEdges?.length ?? 0
    );
    expect(edgeCount).toBe(1);

    // Verify edge in DOM
    const domEdges = await page.evaluate(() =>
      document.querySelectorAll('.react-flow__edge').length
    );
    expect(domEdges).toBe(1);
  });
});

// ─── Drag-to-connect tests ──────────────────────────────────────

test.describe('Drag-to-connect', () => {
  test('dragging from source handle to target handle creates an edge', async () => {
    const { nodeA, nodeB } = await createTwoNodes();

    // Get handle bounding boxes
    const sourceHandle = page.locator(`[data-testid="mental-graph-node-${nodeA}"]`)
      .locator('[data-handlepos="right"]');
    const targetHandle = page.locator(`[data-testid="mental-graph-node-${nodeB}"]`)
      .locator('[data-handlepos="left"]');

    await expect(sourceHandle).toBeAttached({ timeout: 3_000 });
    await expect(targetHandle).toBeAttached({ timeout: 3_000 });

    const sourceBox = await sourceHandle.boundingBox();
    const targetBox = await targetHandle.boundingBox();

    expect(sourceBox).toBeTruthy();
    expect(targetBox).toBeTruthy();

    // Drag from source to target
    const sx = sourceBox!.x + sourceBox!.width / 2;
    const sy = sourceBox!.y + sourceBox!.height / 2;
    const tx = targetBox!.x + targetBox!.width / 2;
    const ty = targetBox!.y + targetBox!.height / 2;

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(tx, ty, { steps: 20 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Verify edge in store
    const edgeCount = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__?.getState()?.mentalEdges?.length ?? 0
    );
    expect(edgeCount).toBe(1);
  });

  test('handle bounds are populated for nodes', async () => {
    const { nodeA } = await createTwoNodes();

    // Verify the node has .source and .target handle elements in the DOM
    const handleInfo = await page.evaluate((id) => {
      const nodeEl = document.querySelector(`[data-testid="mental-graph-node-${id}"]`);
      if (!nodeEl) return { found: false, sourceCount: 0, targetCount: 0, handleIds: [] as string[] };

      const rfNodeEl = nodeEl.closest('.react-flow__node');
      if (!rfNodeEl) return { found: false, sourceCount: 0, targetCount: 0, handleIds: [] as string[] };

      const sourceHandles = rfNodeEl.querySelectorAll('.react-flow__handle.source');
      const targetHandles = rfNodeEl.querySelectorAll('.react-flow__handle.target');

      const handleIds: string[] = [];
      rfNodeEl.querySelectorAll('.react-flow__handle').forEach((h) => {
        handleIds.push(h.getAttribute('data-handleid') || 'none');
      });

      return {
        found: true,
        sourceCount: sourceHandles.length,
        targetCount: targetHandles.length,
        handleIds,
      };
    }, nodeA);

    expect(handleInfo.found).toBe(true);
    expect(handleInfo.sourceCount).toBeGreaterThanOrEqual(1);
    expect(handleInfo.targetCount).toBeGreaterThanOrEqual(1);
    expect(handleInfo.handleIds).toContain('top');
    expect(handleInfo.handleIds).toContain('right');
    expect(handleInfo.handleIds).toContain('bottom');
    expect(handleInfo.handleIds).toContain('left');
  });
});
