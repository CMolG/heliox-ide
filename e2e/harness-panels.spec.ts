/**
 * harness-panels.spec.ts — Playwright E2E tests for the harness toolbar panels
 *
 * Responsibility:
 * - Verifies that the three harness panel toggle buttons are present in the
 *   MentalGraphCanvas toolbar (scorecard, arena, time-travel).
 * - Verifies that clicking each toggle mounts its corresponding panel, and
 *   clicking again unmounts it.
 * - Does NOT test deep panel behaviour — only mount/unmount toggling.
 *
 * Setup:
 * The harness toolbar lives inside MentalGraphCanvas, which is unconditionally
 * rendered once the desktop canvas is active. No special mental-mode is needed;
 * the toolbar is always present alongside MetaChat at the bottom-right corner.
 */
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import { getElectronLaunchArgs, getE2EEnv } from './test-helpers';

let app: ElectronApplication;
let page: Page;

// ─── Boot ────────────────────────────────────────────────────────────────────

test.beforeAll(async () => {
  app = await electron.launch({
    args: getElectronLaunchArgs(),
    cwd: path.join(__dirname, '..'),
    env: getE2EEnv(),
    timeout: 30_000,
  });

  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // Clear persisted state so no stale panel or tour state bleeds in
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

// ─── Shared setup ─────────────────────────────────────────────────────────────

/** Ensure the seamless desktop canvas is visible (project path set if needed). */
async function ensureDesktop() {
  const desktop = page.locator('[data-testid="seamless-desktop"]');
  if (!(await desktop.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await page.evaluate(() => {
      const store = (window as any).__HELIOX_STORE__;
      if (store) store.getState().setProjectPath('/tmp/test-project');
    });
    await desktop.waitFor({ state: 'visible', timeout: 10_000 });
  }
  // Dismiss the quick-tour overlay so it does not intercept clicks
  await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) ds.getState().updateSettings({ tourCompleted: true });
  });
}

test.beforeEach(async () => {
  await ensureDesktop();
  // Brief settle so React finishes any pending re-renders
  await page.waitForTimeout(150);
});

// ─── Toggle button presence ───────────────────────────────────────────────────

test.describe('Harness toolbar — button presence', () => {
  test('scorecard toggle button is visible in the harness toolbar', async () => {
    const btn = page.locator('[data-testid="harness-scorecard-toggle"]');
    await expect(btn).toBeVisible({ timeout: 5_000 });
  });

  test('arena toggle button is visible in the harness toolbar', async () => {
    const btn = page.locator('[data-testid="harness-arena-toggle"]');
    await expect(btn).toBeVisible({ timeout: 5_000 });
  });

  test('time-travel toggle button is visible in the harness toolbar', async () => {
    const btn = page.locator('[data-testid="harness-timetravel-toggle"]');
    await expect(btn).toBeVisible({ timeout: 5_000 });
  });
});

// ─── Scorecard panel toggle ───────────────────────────────────────────────────

test.describe('Scorecard panel — mount/unmount toggle', () => {
  test('clicking scorecard toggle shows scorecard-panel', async () => {
    const toggle = page.locator('[data-testid="harness-scorecard-toggle"]');
    await toggle.click();
    await expect(page.locator('[data-testid="scorecard-panel"]')).toBeVisible({ timeout: 3_000 });
  });

  test('clicking scorecard toggle again hides scorecard-panel', async () => {
    const toggle = page.locator('[data-testid="harness-scorecard-toggle"]');
    // First click: open (may already be open from a previous test — click idempotently)
    const panel = page.locator('[data-testid="scorecard-panel"]');
    const alreadyOpen = await panel.isVisible({ timeout: 500 }).catch(() => false);
    if (!alreadyOpen) await toggle.click();
    await expect(panel).toBeVisible({ timeout: 3_000 });
    // Second click: close
    await toggle.click();
    await expect(panel).not.toBeVisible({ timeout: 3_000 });
  });
});

// ─── Arena panel toggle ───────────────────────────────────────────────────────

test.describe('Arena panel — mount/unmount toggle', () => {
  test('clicking arena toggle shows arena-panel', async () => {
    const toggle = page.locator('[data-testid="harness-arena-toggle"]');
    await toggle.click();
    await expect(page.locator('[data-testid="arena-panel"]')).toBeVisible({ timeout: 3_000 });
  });

  test('clicking arena toggle again hides arena-panel', async () => {
    const toggle = page.locator('[data-testid="harness-arena-toggle"]');
    const panel = page.locator('[data-testid="arena-panel"]');
    const alreadyOpen = await panel.isVisible({ timeout: 500 }).catch(() => false);
    if (!alreadyOpen) await toggle.click();
    await expect(panel).toBeVisible({ timeout: 3_000 });
    await toggle.click();
    await expect(panel).not.toBeVisible({ timeout: 3_000 });
  });
});

// ─── Time-travel panel toggle ─────────────────────────────────────────────────

test.describe('Time-travel panel — mount/unmount toggle', () => {
  test('clicking time-travel toggle shows time-travel-panel in its initial state', async () => {
    const toggle = page.locator('[data-testid="harness-timetravel-toggle"]');
    await toggle.click();
    // The panel itself carries data-testid="time-travel-panel" (set inside TimeTravelPanel.tsx)
    const panel = page.locator('[data-testid="time-travel-panel"]');
    await expect(panel).toBeVisible({ timeout: 3_000 });
  });

  test('clicking time-travel toggle again hides time-travel-panel', async () => {
    const toggle = page.locator('[data-testid="harness-timetravel-toggle"]');
    const panel = page.locator('[data-testid="time-travel-panel"]');
    const alreadyOpen = await panel.isVisible({ timeout: 500 }).catch(() => false);
    if (!alreadyOpen) await toggle.click();
    await expect(panel).toBeVisible({ timeout: 3_000 });
    await toggle.click();
    await expect(panel).not.toBeVisible({ timeout: 3_000 });
  });
});
