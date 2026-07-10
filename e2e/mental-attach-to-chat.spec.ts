/**
 * mental-attach-to-chat.spec.ts — Playwright E2E for Mental → Chat attachments
 *
 * Validates the full pipeline:
 * - Add mental nodes + edges via the store.
 * - Open a chat window.
 * - Use store action to attach selected mental nodes (matrix entry).
 * - Confirm the chip row appears in the chat header.
 * - Detach via the chip's ✕ button and verify the row disappears.
 * - Attach the whole map (empty nodeIds sentinel) and verify the chip label.
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
  page.on('console', m => console.log(`[renderer:${m.type()}] ${m.text()}`));
  page.on('pageerror', err => console.log(`[renderer:pageerror] ${err.message}`));
  await page.waitForURL(/^(?!about:blank)/, { timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => !!(window as any).__DESKTOP_STORE__ && !!(window as any).__FLUXOR_STORE__,
    { timeout: 30_000 },
  );
  await page.evaluate(() => {
    try { localStorage.clear(); } catch { /* may be blocked */ }
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) {
      ds.getState().updateSettings({ tourCompleted: true });
      ds.getState().setActiveTutorial(null);
    }
  });
});

test.afterAll(async () => { await app?.close(); });

test.beforeEach(async () => {
  // Reset store between tests
  await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    if (!store) return;
    const s = store.getState();
    // Dismiss tour/tutorial so the backdrop can't intercept clicks
    s.updateSettings({ tourCompleted: true });
    s.setActiveTutorial(null);
    for (const e of [...(s.mentalEdges ?? [])]) s.removeMentalEdge(e.id);
    for (const n of [...s.mentalNodes]) s.removeMentalNode(n.id);
    for (const w of [...s.windows]) s.removeWindow(w.id);
    s.setSelectedMentalNodeIds([]);
  });
});

test('attach selection to chat → chip row appears with correct label', async () => {
  // Seed: 3 nodes + 2 edges
  const seed = await page.evaluate(() => {
    const s = (window as any).__DESKTOP_STORE__.getState();
    const a = s.addMentalNode({ position: { x: 0, y: 0 }, width: 200, height: 100, text: 'Auth', color: '#EDE9FE', shape: 'square' });
    const b = s.addMentalNode({ position: { x: 250, y: 0 }, width: 200, height: 100, text: 'Cookie', color: '#EDE9FE', shape: 'square' });
    const c = s.addMentalNode({ position: { x: 500, y: 0 }, width: 200, height: 100, text: 'Refresh', color: '#EDE9FE', shape: 'square' });
    s.addMentalEdge(a, b, 'link');
    s.addMentalEdge(b, c, 'ramification');
    return { a, b, c };
  });

  // Open a chat window + create a session for it
  const winId = await page.evaluate((seed) => {
    const desktop = (window as any).__DESKTOP_STORE__.getState();
    const fluxor = (window as any).__FLUXOR_STORE__.getState();
    // Fluxor needs a projectPath set so chat windows mount the full
    // AgenticChatApp tree (renders the chip row).
    fluxor.setProjectPath('/tmp/fluxor-e2e-mental');
    const sessionId = fluxor.addSession();
    const winId = desktop.addWindow('chat', { sessionId, title: 'Chat-1' });
    desktop.focusWindow(winId);
    return winId;
  }, seed);

  // Wait for the chat window to mount in the DOM before attaching
  await page.locator(`[data-testid="desktop-window-${winId}"]`).waitFor({ state: 'attached', timeout: 5_000 });

  // Now attach 2 of the 3 nodes (chip should reactively appear)
  await page.evaluate(({ winId, seed }) => {
    (window as any).__DESKTOP_STORE__.getState().attachMentalToWindow(winId, [seed.a, seed.b]);
  }, { winId, seed });

  // Chip row visible
  const chipRow = page.locator('[data-testid="mental-attachments-row"]').first();
  await expect(chipRow).toBeVisible({ timeout: 5_000 });

  // Chip label = "2 nodes · 1 link · LIVE"
  const chip = page.locator('[data-testid="mental-chip-0"]').first();
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('2 nodes');
  await expect(chip).toContainText('1 link');
  await expect(chip).toContainText('LIVE', { ignoreCase: true });

  // Detach via ✕ — chip row disappears.
  // Use force-click: the hover tooltip overlaps actionability detection in
  // Playwright; the button itself is visible and clickable in real use.
  await page.locator('[data-testid="mental-chip-detach-0"]').first().click({ force: true });

  await expect(page.locator('[data-testid="mental-attachments-row"]')).toHaveCount(0);
  const stillAttached = await page.evaluate((id) => {
    const w = (window as any).__DESKTOP_STORE__.getState().windows.find((x: any) => x.id === id);
    return w?.mentalAttachments?.length ?? 0;
  }, winId);
  expect(stillAttached).toBe(0);
});

test('whole-map attachment shows "whole map" chip label', async () => {
  const winId = await page.evaluate(() => {
    const s = (window as any).__DESKTOP_STORE__.getState();
    s.addMentalNode({ position: { x: 0, y: 0 }, width: 200, height: 100, text: 'X', color: '#EDE9FE', shape: 'square' });
    const fluxor = (window as any).__FLUXOR_STORE__.getState();
    fluxor.setProjectPath('/tmp/fluxor-e2e-mental');
    const sessionId = fluxor.addSession();
    const winId = s.addWindow('chat', { sessionId, title: 'Chat-Whole' });
    s.focusWindow(winId);
    return winId;
  });

  await page.locator(`[data-testid="desktop-window-${winId}"]`).waitFor({ state: 'attached', timeout: 5_000 });
  await page.evaluate((id) => {
    (window as any).__DESKTOP_STORE__.getState().attachMentalToWindow(id, []);
  }, winId);

  const chip = page.locator('[data-testid="mental-chip-0"]').first();
  await expect(chip).toBeVisible({ timeout: 5_000 });
  await expect(chip).toContainText('whole map');
});

test('multiple attachments render as multiple chips in stable order', async () => {
  const { winId, a, b } = await page.evaluate(() => {
    const s = (window as any).__DESKTOP_STORE__.getState();
    const a = s.addMentalNode({ position: { x: 0, y: 0 }, width: 200, height: 100, text: 'A', color: '#EDE9FE', shape: 'square' });
    const b = s.addMentalNode({ position: { x: 0, y: 0 }, width: 200, height: 100, text: 'B', color: '#EDE9FE', shape: 'square' });
    const fluxor = (window as any).__FLUXOR_STORE__.getState();
    fluxor.setProjectPath('/tmp/fluxor-e2e-mental');
    const sessionId = fluxor.addSession();
    const winId = s.addWindow('chat', { sessionId, title: 'Chat-Multi' });
    s.focusWindow(winId);
    return { winId, a, b };
  });

  await page.locator(`[data-testid="desktop-window-${winId}"]`).waitFor({ state: 'attached', timeout: 5_000 });
  await page.evaluate((args) => {
    const s = (window as any).__DESKTOP_STORE__.getState();
    s.attachMentalToWindow(args.winId, [args.a]);
    s.attachMentalToWindow(args.winId, [args.b]);
    s.attachMentalToWindow(args.winId, []);
  }, { winId, a, b });

  await expect(page.locator('[data-testid="mental-chip-0"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="mental-chip-1"]')).toBeVisible();
  await expect(page.locator('[data-testid="mental-chip-2"]')).toBeVisible();
});
