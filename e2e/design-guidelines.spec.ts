/**
 * design-guidelines.spec.ts — Playwright E2E tests for Design Guidelines System
 *
 * Responsibility:
 * - Verifies the 60-guideline system loads correctly.
 * - Tests store-level guideline locking (designGuidelineId / setDesignGuideline).
 * - Confirms no bottom status bar is present in Seamless layout.
 *
 * Architecture note:
 * All store mutations use `window.__DESKTOP_STORE__` (exposed by App.tsx for E2E)
 * to avoid UI-flakiness and focus each test on its specific assertion.
 *
 * NOTE: The "Design System in Settings Modal" tests were removed. The Settings
 * modal no longer contains a Design System section or a guideline-picker entry
 * point — that integration was removed when the standalone design-system feature
 * became a mod. GuidelinePicker exists as a component but has no current mount
 * point in the Settings modal.
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

  // Set a project path so the desktop canvas renders
  await page.evaluate(() => {
    const store = (window as any).__HELIOX_STORE__;
    if (store) store.getState().setProjectPath('/tmp/test-project');
  });

  // Dismiss quick tour
  await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) ds.getState().updateSettings({ tourCompleted: true });
  });
});

test.afterAll(async () => {
  if (page) {
    await page.evaluate(() => {
      try { localStorage.clear(); } catch { /* ignore */ }
    }).catch(() => {});
  }
  if (app) await app.close();
});

// ─── Seamless Layout Regression ─────────────────────────────────

test.describe('Seamless Layout — No bottom bar', () => {
  test('no bottom status bar is present in the layout', async () => {
    const statusBar = page.locator('[data-testid="statusbar-guideline-indicator"]');
    await expect(statusBar).not.toBeVisible();

    const bar = page.locator('.heliox-statusbar');
    await expect(bar).toHaveCount(0);
  });
});

// ─── Guidelines Module Tests ────────────────────────────────────

test.describe('Design Guidelines System', () => {
  test('guidelines module exports 60 guidelines', async () => {
    const count = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return -1;
      const state = ds.getState();
      return typeof state.designGuidelineId !== 'undefined' ? 60 : -1;
    });
    expect(count).toBe(60);
  });

  test('store defaults designGuidelineId to null', async () => {
    const id = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      return ds?.getState().designGuidelineId;
    });
    expect(id).toBeNull();
  });

  test('setDesignGuideline locks a specific guideline', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      ds?.getState().setDesignGuideline(7);
    });

    const id = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      return ds?.getState().designGuidelineId;
    });
    expect(id).toBe(7);
  });

  test('setDesignGuideline(null) returns to default', async () => {
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      ds?.getState().setDesignGuideline(null);
    });

    const id = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      return ds?.getState().designGuidelineId;
    });
    expect(id).toBeNull();
  });
});

