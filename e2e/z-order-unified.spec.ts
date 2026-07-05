/**
 * z-order-unified.spec.ts — Regression guard for the unified z-stack.
 *
 * Verifies that clicking a window rises it above mental nodes, and clicking a
 * mental node (bringMentalToFront) rises it above the window — using a single
 * interleaved z-index space instead of the old two-layer binary topLayer flag.
 *
 * NOTE: This spec is NOT run in CI by default. Run manually with:
 *   npx playwright test e2e/z-order-unified.spec.ts
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

/** Reset canvas to known state: one chat window overlapping one mental card. */
async function setupCanvas() {
  const desktop = page.locator('[data-testid="seamless-desktop"]');
  if (!(await desktop.isVisible({ timeout: 2000 }).catch(() => false))) {
    await page.evaluate(() => {
      const store = (window as any).__HELIOX_STORE__;
      if (store) store.getState().setProjectPath('/tmp/test-project');
    });
    await desktop.waitFor({ state: 'visible', timeout: 10_000 });
  }
  await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    ds.getState().updateSettings({ tourCompleted: true });
    ds.getState().setActiveTutorial(null);
    // Hard reset
    ds.setState({ windows: [], attachables: [], mentalNodes: [], mentalEdges: [], mentalZ: {} });
    ds.getState().setCanvasPan({ x: 0, y: 0 });
    ds.getState().setCanvasZoom(1);

    // Spawn one chat window at a known position
    ds.getState().addWindow('file-explorer', {
      title: 'Z-Order Probe',
      position: { x: 200, y: 200 },
      size: { width: 420, height: 360 },
    });

    // Spawn one mental card overlapping the window
    ds.getState().addMentalNode({
      position: { x: 300, y: 250 },
      width: 200,
      height: 120,
      text: 'z-order card',
      color: '#BFDBFE',
      shape: 'square',
    });
  });
  await page.waitForTimeout(300);
}

test.describe('Unified z-stack: windows and mental nodes interleave by recency', () => {
  test.beforeEach(setupCanvas);

  test('clicking the window (focusWindow) puts its zIndex above mentalZ of the card', async () => {
    const result = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      const state = ds.getState();
      const win = state.windows[0];
      const node = state.mentalNodes[0];

      // Bring mental card to front first
      state.bringMentalToFront(node.id);
      const mentalZAfterBring = ds.getState().mentalZ[node.id];

      // Now focus the window — it must rise above the card
      state.focusWindow(win.id);
      const winZAfterFocus = ds.getState().windows.find((w: any) => w.id === win.id)?.zIndex ?? 0;
      const mentalZFinal = ds.getState().mentalZ[node.id];

      return { winZAfterFocus, mentalZFinal, mentalZAfterBring };
    });

    expect(result.mentalZAfterBring).toBeGreaterThan(0);
    expect(result.winZAfterFocus).toBeGreaterThan(result.mentalZFinal);
  });

  test('bringMentalToFront puts the card mentalZ above the window zIndex', async () => {
    const result = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      const state = ds.getState();
      const win = state.windows[0];
      const node = state.mentalNodes[0];

      // Focus window first so its z is high
      state.focusWindow(win.id);
      const winZAfterFocus = ds.getState().windows.find((w: any) => w.id === win.id)?.zIndex ?? 0;

      // Now bring mental to front — its z must exceed the window z
      state.bringMentalToFront(node.id);
      const mentalZAfterBring = ds.getState().mentalZ[node.id];

      return { winZAfterFocus, mentalZAfterBring };
    });

    expect(result.winZAfterFocus).toBeGreaterThan(0);
    expect(result.mentalZAfterBring).toBeGreaterThan(result.winZAfterFocus);
  });

  test('screenshot of unified z-stack for visual inspection', async () => {
    // Set up a clear visual state: card on top of window
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      const state = ds.getState();
      const win = state.windows[0];
      const node = state.mentalNodes[0];
      state.focusWindow(win.id);
      state.bringMentalToFront(node.id);
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'test-results/z-order-unified.png' });
  });

  test('the whole map (nodes AND connecting edges) rises above a window as one unit', async () => {
    // A connected pair whose edge crosses over a window. Raising the component
    // must lift the edge too — not just the cards — otherwise the link hides
    // behind the window and it reads as "only the node came forward".
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      ds.setState({ windows: [], attachables: [], mentalNodes: [], mentalEdges: [], mentalZ: {} });
      ds.getState().setCanvasPan({ x: 0, y: 0 });
      ds.getState().setCanvasZoom(1);
      ds.getState().addWindow('file-explorer', {
        title: 'Crossed Window', position: { x: 300, y: 250 }, size: { width: 400, height: 300 },
      });
      const a = ds.getState().addMentalNode({ position: { x: 120, y: 330 }, width: 160, height: 100, text: 'A', color: '#BFDBFE', shape: 'square' });
      const b = ds.getState().addMentalNode({ position: { x: 720, y: 330 }, width: 160, height: 100, text: 'B', color: '#BFDBFE', shape: 'square' });
      ds.getState().addMentalEdge(a, b, 'link');
      ds.getState().focusWindow(ds.getState().windows[0].id); // window on top first
      (window as any).__ZTEST__ = { a, b };
    });
    await page.waitForTimeout(300);

    const store = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      const { a } = (window as any).__ZTEST__;
      ds.getState().bringMentalToFront(a); // raise the component
      const st = ds.getState();
      const { a: ai, b: bi } = (window as any).__ZTEST__;
      return { mza: st.mentalZ[ai], mzb: st.mentalZ[bi], winZ: st.windows[0].zIndex };
    });
    expect(store.mza).toBe(store.mzb);           // both endpoints raised together
    expect(store.mza).toBeGreaterThan(store.winZ); // above the window

    await page.waitForTimeout(200);

    // DOM ground truth: the edge's effective stacking must be >= the window's.
    const domZ = await page.evaluate(() => {
      const effectiveZ = (el: Element | null): number => {
        let cur: Element | null = el;
        while (cur && cur !== document.body) {
          const zi = getComputedStyle(cur).zIndex;
          if (zi && zi !== 'auto') return parseInt(zi, 10);
          cur = cur.parentElement;
        }
        return 0;
      };
      return {
        edgeZ: effectiveZ(document.querySelector('.react-flow__edge')),
        winZ: effectiveZ(document.querySelector('.desktop-window')),
      };
    });
    expect(domZ.edgeZ).toBeGreaterThanOrEqual(domZ.winZ);

    await page.screenshot({ path: 'test-results/z-order-edge-rises.png' });
  });

  test('clicking a connection (edge) brings its whole map to front', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      ds.setState({ windows: [], attachables: [], mentalNodes: [], mentalEdges: [], mentalZ: {} });
      ds.getState().setCanvasPan({ x: 0, y: 0 });
      ds.getState().setCanvasZoom(1);
      // Window sits BELOW the edge line so the edge stays clickable.
      ds.getState().addWindow('file-explorer', { title: 'W', position: { x: 250, y: 560 }, size: { width: 360, height: 240 } });
      const a = ds.getState().addMentalNode({ position: { x: 120, y: 330 }, width: 160, height: 100, text: 'A', color: '#BFDBFE', shape: 'square' });
      const b = ds.getState().addMentalNode({ position: { x: 480, y: 330 }, width: 160, height: 100, text: 'B', color: '#BFDBFE', shape: 'square' });
      ds.getState().addMentalEdge(a, b, 'link');
      ds.getState().focusWindow(ds.getState().windows[0].id); // window high z
      (window as any).__ZTEST__ = { a, b };
    });
    await page.waitForTimeout(300);

    const winZ = await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().windows[0].zIndex);

    // Click the connection itself (not a node).
    await page.locator('.react-flow__edge').first().click({ force: true });
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      const { a, b } = (window as any).__ZTEST__;
      const st = ds.getState();
      return { za: st.mentalZ[a] ?? 0, zb: st.mentalZ[b] ?? 0 };
    });
    expect(after.za).toBe(after.zb);          // whole map, not just one endpoint
    expect(after.za).toBeGreaterThan(winZ);   // raised above the previously-top window
  });
});
