/**
 * mental-map-ramification.spec.ts — Playwright E2E tests for Proposal 5: Mental Map Ramifications
 *
 * Responsibility:
 * - Verifies directed edge creation via store (sourceId → targetId).
 * - Tests ramification creation (node + edge pair atomically).
 * - Confirms edge type is correctly set to 'ramification' for drag-created sub-nodes.
 * - Validates edge color inheritance and edge deletion.
 * - Verifies React Flow canvas renders correctly with edges.
 *
 * Architecture note:
 * All store mutations use `window.__DESKTOP_STORE__` to avoid UI-flakiness.
 * The mental map is rendered via React Flow (`@xyflow/react`).
 */
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import { getElectronLaunchArgs, getE2EEnv } from './test-helpers';

let app: ElectronApplication;
let page: Page;

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

  await page.waitForFunction(
    () => !!(window as any).__HELIOX_STORE__ && !!(window as any).__DESKTOP_STORE__,
    { timeout: 15_000 },
  );

  // Set project path
  await page.evaluate(() => {
    const store = (window as any).__HELIOX_STORE__;
    if (store) store.getState().setProjectPath('/tmp/test-project');
  });
  await page.waitForTimeout(500);

  // Dismiss quick tour
  await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) ds.getState().updateSettings({ tourCompleted: true });
  });
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ─── Helpers ─────────────────────────────────────────────────────

async function resetMentalState() {
  await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    if (!store) return;
    const s = store.getState();
    for (const e of [...s.mentalEdges]) s.removeMentalEdge(e.id);
    for (const n of [...s.mentalNodes]) s.removeMentalNode(n.id);
  });
  await page.waitForTimeout(200);
}

// ─── Directed Edge Tests ────────────────────────────────────────

test.describe('Mental Map — Directed Edges', () => {
  test.beforeEach(async () => {
    await resetMentalState();
  });

  test('addMentalNode creates a node in the store', async () => {
    const nodeId = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      return s.addMentalNode({
        position: { x: 100, y: 100 },
        width: 160,
        height: 80,
        text: 'Test Node A',
        color: '#6366f1',
        shape: 'square',
      });
    });

    expect(nodeId).toBeTruthy();

    const node = await page.evaluate((id) => {
      const store = (window as any).__DESKTOP_STORE__;
      return store?.getState().mentalNodes.find((n: any) => n.id === id) ?? null;
    }, nodeId);

    expect(node).not.toBeNull();
    expect(node.text).toBe('Test Node A');
    expect(node.color).toBe('#6366f1');
  });

  test('addMentalEdge creates a directed edge (source → target)', async () => {
    // Create two nodes
    const ids = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      const aId = s.addMentalNode({
        position: { x: 100, y: 100 },
        width: 160, height: 80,
        text: 'Parent', color: '#10b981', shape: 'square',
      });
      const bId = s.addMentalNode({
        position: { x: 300, y: 200 },
        width: 160, height: 80,
        text: 'Child', color: '#6366f1', shape: 'square',
      });
      return { aId, bId };
    });

    expect(ids).not.toBeNull();

    // Create directed edge A → B
    const edgeId = await page.evaluate((nodeIds) => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      return s.addMentalEdge(nodeIds!.aId, nodeIds!.bId, 'link');
    }, ids);

    expect(edgeId).toBeTruthy();

    // Verify edge has correct direction
    const edge = await page.evaluate((eid) => {
      const store = (window as any).__DESKTOP_STORE__;
      return store?.getState().mentalEdges.find((e: any) => e.id === eid) ?? null;
    }, edgeId);

    expect(edge).not.toBeNull();
    expect(edge.sourceId).toBe(ids!.aId);
    expect(edge.targetId).toBe(ids!.bId);
    expect(edge.type).toBe('link');
  });

  test('addMentalEdge prevents duplicate edges', async () => {
    const result = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      const aId = s.addMentalNode({
        position: { x: 0, y: 0 }, width: 100, height: 60,
        text: 'A', color: '#fff', shape: 'square',
      });
      const bId = s.addMentalNode({
        position: { x: 200, y: 0 }, width: 100, height: 60,
        text: 'B', color: '#fff', shape: 'square',
      });
      const edge1 = s.addMentalEdge(aId, bId, 'link');
      const edge2 = s.addMentalEdge(aId, bId, 'link'); // duplicate
      return { edge1, edge2, edgeCount: store.getState().mentalEdges.length };
    });

    expect(result).not.toBeNull();
    // The duplicate should return null or the same edge
    // Edge count should still be 1
    expect(result!.edgeCount).toBe(1);
  });

  test('removeMentalEdge deletes an edge', async () => {
    const edgeId = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      const aId = s.addMentalNode({
        position: { x: 0, y: 0 }, width: 100, height: 60,
        text: 'X', color: '#fff', shape: 'square',
      });
      const bId = s.addMentalNode({
        position: { x: 200, y: 0 }, width: 100, height: 60,
        text: 'Y', color: '#fff', shape: 'square',
      });
      return s.addMentalEdge(aId, bId, 'link');
    });

    expect(edgeId).toBeTruthy();

    await page.evaluate((eid) => {
      const store = (window as any).__DESKTOP_STORE__;
      store?.getState().removeMentalEdge(eid);
    }, edgeId);

    const remaining = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      return store?.getState().mentalEdges.length ?? -1;
    });

    expect(remaining).toBe(0);
  });

  test('removeMentalNode cascades to edges', async () => {
    const data = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      const aId = s.addMentalNode({
        position: { x: 0, y: 0 }, width: 100, height: 60,
        text: 'Root', color: '#f87171', shape: 'square',
      });
      const bId = s.addMentalNode({
        position: { x: 200, y: 0 }, width: 100, height: 60,
        text: 'Leaf', color: '#f87171', shape: 'square',
      });
      s.addMentalEdge(aId, bId, 'ramification');
      return { aId, bId };
    });

    expect(data).not.toBeNull();

    // Remove the source node
    await page.evaluate((nodeId) => {
      const store = (window as any).__DESKTOP_STORE__;
      store?.getState().removeMentalNode(nodeId);
    }, data!.aId);

    const state = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      const s = store?.getState();
      return { nodeCount: s?.mentalNodes.length ?? -1, edgeCount: s?.mentalEdges.length ?? -1 };
    });

    // Node A removed, edge should be gone, node B should remain
    expect(state.nodeCount).toBe(1);
    expect(state.edgeCount).toBe(0);
  });
});

// ─── Ramification Tests ─────────────────────────────────────────

test.describe('Mental Map — Ramification Tool', () => {
  test.beforeEach(async () => {
    await resetMentalState();
  });

  test('createRamificationFromDrop creates node + edge atomically', async () => {
    // Create source node first
    const sourceId = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      return s.addMentalNode({
        position: { x: 100, y: 100 },
        width: 160, height: 80,
        text: 'Source Node',
        color: '#a78bfa',
        shape: 'square',
      });
    });

    expect(sourceId).toBeTruthy();

    // Create ramification
    const result = await page.evaluate((srcId) => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      s.createRamificationFromDrop(srcId, { x: 400, y: 300 });
      const newState = store.getState();
      return {
        nodeCount: newState.mentalNodes.length,
        edgeCount: newState.mentalEdges.length,
        lastEdge: newState.mentalEdges[newState.mentalEdges.length - 1],
        lastNode: newState.mentalNodes[newState.mentalNodes.length - 1],
      };
    }, sourceId);

    expect(result).not.toBeNull();
    // Should have 2 nodes (source + new) and 1 edge
    expect(result!.nodeCount).toBe(2);
    expect(result!.edgeCount).toBe(1);

    // Edge should be type 'ramification'
    expect(result!.lastEdge.type).toBe('ramification');

    // Edge should go from source to new node
    expect(result!.lastEdge.sourceId).toBe(sourceId);
    expect(result!.lastEdge.targetId).toBe(result!.lastNode.id);

    // New node should inherit source color
    const sourceColor = await page.evaluate((srcId) => {
      const store = (window as any).__DESKTOP_STORE__;
      const n = store?.getState().mentalNodes.find((n: any) => n.id === srcId);
      return n?.color;
    }, sourceId);

    expect(result!.lastNode.color).toBe(sourceColor);
  });

  test('updateMentalEdgeColor changes edge color', async () => {
    const data = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      if (!store) return null;
      const s = store.getState();
      const aId = s.addMentalNode({
        position: { x: 0, y: 0 }, width: 100, height: 60,
        text: 'A', color: '#fff', shape: 'square',
      });
      const bId = s.addMentalNode({
        position: { x: 200, y: 0 }, width: 100, height: 60,
        text: 'B', color: '#fff', shape: 'square',
      });
      const edgeId = s.addMentalEdge(aId, bId, 'link');
      return { edgeId };
    });

    expect(data?.edgeId).toBeTruthy();

    await page.evaluate((eid) => {
      const store = (window as any).__DESKTOP_STORE__;
      store?.getState().updateMentalEdgeColor(eid, '#ff6b6b');
    }, data!.edgeId);

    const color = await page.evaluate((eid) => {
      const store = (window as any).__DESKTOP_STORE__;
      return store?.getState().mentalEdges.find((e: any) => e.id === eid)?.color;
    }, data!.edgeId);

    expect(color).toBe('#ff6b6b');
  });

  test('mentalTool can be toggled between select and ramification', async () => {
    const initial = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      return store?.getState().mentalTool;
    });

    expect(initial).toBe('select');

    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      store?.getState().setMentalTool('ramification');
    });

    const updated = await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      return store?.getState().mentalTool;
    });

    expect(updated).toBe('ramification');

    // Reset
    await page.evaluate(() => {
      const store = (window as any).__DESKTOP_STORE__;
      store?.getState().setMentalTool('select');
    });
  });
});
