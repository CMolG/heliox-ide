/**
 * dock-fixed-on-pan.spec.ts — Regression guard for the "drifting docks" bug.
 *
 * The tool dock (`.fluxor-dock`) is chrome: it lives OUTSIDE the pannable canvas
 * layer and must stay visually pinned to the viewport while the seamless canvas
 * pans/zooms underneath it. Historically docks were reported to drift "off grid"
 * together with the canvas. These specs pan/zoom the canvas and assert the dock
 * does not move, while real canvas content does move.
 *
 * NOTE: The session-status-dock has been REMOVED and replaced by the HUD widget
 * system. Assertions for it have been removed from this file.
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
    () => !!(window as any).__FLUXOR_STORE__ && !!(window as any).__DESKTOP_STORE__,
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

/** Open a project, wipe canvas content, seed one plain window + one session, reset camera. */
async function setupDesktop() {
  const desktop = page.locator('[data-testid="seamless-desktop"]');
  if (!(await desktop.isVisible({ timeout: 2000 }).catch(() => false))) {
    await page.evaluate(() => {
      const store = (window as any).__FLUXOR_STORE__;
      if (store) store.getState().setProjectPath('/tmp/test-project');
    });
    await desktop.waitFor({ state: 'visible', timeout: 10_000 });
  }
  const windowCount = await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    const hs = (window as any).__FLUXOR_STORE__;
    ds.getState().updateSettings({ tourCompleted: true });
    ds.getState().setActiveTutorial(null);
    // Hard reset of canvas content via setState so persisted web-preview
    // windows (whose <webview> swallows synthetic mouse events) can't linger.
    ds.setState({ windows: [], attachables: [] });
    ds.getState().setCanvasPan({ x: 0, y: 0 });
    ds.getState().setCanvasZoom(1);
    ds.getState().addWindow('file-explorer', { title: 'Probe', position: { x: 80, y: 80 } });
    if (hs.getState().sessions.length === 0) hs.getState().addSession();
    return ds.getState().windows.length;
  });
  expect(windowCount).toBe(1); // exactly the probe — no lingering webviews
  await page.waitForTimeout(250);
}

/** Bounding boxes for the tool dock + the probe window. */
async function captureBoxes() {
  const tool = await page.locator('.fluxor-dock').boundingBox();
  const win = await page.locator('.desktop-window-shell').first().boundingBox();
  return { tool, win };
}

test.describe('Docks stay pinned while the canvas moves', () => {
  test.beforeEach(async () => { await setupDesktop(); });

  test('store-driven pan: dock fixed, canvas content moves', async () => {
    await expect(page.locator('.fluxor-dock')).toBeVisible();

    const before = await captureBoxes();
    const PAN = { x: 400, y: 260 };
    await page.evaluate((p) => (window as any).__DESKTOP_STORE__.getState().setCanvasPan(p), PAN);
    await page.waitForTimeout(250);
    const after = await captureBoxes();

    // Canvas window moved by the full pan delta.
    expect(Math.round(after.win!.x - before.win!.x)).toBe(PAN.x);
    expect(Math.round(after.win!.y - before.win!.y)).toBe(PAN.y);
    // Tool dock did NOT move.
    expect(Math.abs(after.tool!.x - before.tool!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.tool!.y - before.tool!.y)).toBeLessThanOrEqual(1);
  });

  test('store-driven zoom: dock fixed under canvas scale', async () => {
    const before = await captureBoxes();
    await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().setCanvasZoom(1.75));
    await page.waitForTimeout(250);
    const after = await captureBoxes();

    expect(Math.abs(after.tool!.x - before.tool!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.tool!.y - before.tool!.y)).toBeLessThanOrEqual(1);
  });

  test('plain wheel/trackpad scroll over canvas does not scroll-shift the docks', async () => {
    const before = await captureBoxes();
    const canvas = (await page.locator('[data-testid="seamless-desktop"]').boundingBox())!;
    await page.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.5);
    // Two-finger / trackpad scroll = wheel WITHOUT ctrl/meta (not a zoom gesture).
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(40, 60);
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(150);

    // The desktop container itself must never scroll (would offset all chrome).
    const scroll = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="seamless-desktop"]') as HTMLElement | null;
      const main = el?.closest('main') as HTMLElement | null;
      const layout = document.querySelector('.fluxor-layout') as HTMLElement | null;
      return {
        deskTop: el?.scrollTop ?? -1, deskLeft: el?.scrollLeft ?? -1,
        mainTop: main?.scrollTop ?? -1, mainLeft: main?.scrollLeft ?? -1,
        layoutTop: layout?.scrollTop ?? -1, layoutLeft: layout?.scrollLeft ?? -1,
      };
    });
    expect(scroll).toEqual({
      deskTop: 0, deskLeft: 0, mainTop: 0, mainLeft: 0, layoutTop: 0, layoutLeft: 0,
    });

    const after = await captureBoxes();
    expect(Math.abs(after.tool!.x - before.tool!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.tool!.y - before.tool!.y)).toBeLessThanOrEqual(1);
  });

  test('interactive middle-drag pan: dock fixed, canvas content moves', async () => {
    const canvas = (await page.locator('[data-testid="seamless-desktop"]').boundingBox())!;
    const before = await captureBoxes();
    await page.screenshot({ path: '/tmp/dock-pan-before.png' });

    // Start over empty canvas (right of the top-left probe, above the dock).
    const sx = canvas.x + canvas.width * 0.6;
    const sy = canvas.y + canvas.height * 0.45;
    const PAN = { x: 320, y: 200 };
    await page.mouse.move(sx, sy);
    await page.mouse.down({ button: 'middle' });
    // Let React commit isPanning=true before dispatching the move stream,
    // otherwise the stale handler closure drops the gesture.
    await page.waitForTimeout(80);
    await page.mouse.move(sx + PAN.x * 0.5, sy + PAN.y * 0.5, { steps: 6 });
    await page.mouse.move(sx + PAN.x, sy + PAN.y, { steps: 6 });
    await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(250);
    await page.screenshot({ path: '/tmp/dock-pan-after.png' });

    const pan = await page.evaluate(() => (window as any).__DESKTOP_STORE__.getState().canvasPan);
    const after = await captureBoxes();

    // The gesture must have actually panned (guards against a vacuous pass).
    expect(pan.x).toBeGreaterThan(200);
    // Window tracks the applied pan; tool dock does not move at all.
    expect(Math.abs((after.win!.x - before.win!.x) - pan.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.tool!.x - before.tool!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.tool!.y - before.tool!.y)).toBeLessThanOrEqual(1);
  });
});
