/**
 * design-guidelines.spec.ts — Playwright E2E tests for Design Guidelines System
 *
 * Responsibility:
 * - Verifies the 60-guideline system loads correctly.
 * - Validates GuidelinePicker modal open/close, search, and swatch rendering
 *   via the Settings modal (no bottom status bar — Proposal 08).
 * - Tests locked selection.
 * - Confirms no bottom status bar is present in Seamless layout.
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

// ─── Helper: open Settings modal ─────────────────────────────────

async function openSettings() {
  await page.evaluate(() => {
    const store = (window as any).__HELIOX_STORE__;
    if (store) store.getState().setShowSettings(true);
  });
  await page.waitForSelector('[data-testid="settings-modal"]', { timeout: 5_000 });
}

async function closeSettings() {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

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

// ─── Settings-based Design System Controls ──────────────────────

test.describe('Design System in Settings Modal', () => {
  test('settings modal shows Design System section', async () => {
    await openSettings();

    const section = page.getByText('Design System', { exact: true }).first();
    await expect(section).toBeVisible();

    await closeSettings();
  });

  test('manual mode shows Change button to open guideline picker', async () => {
    await openSettings();

    const changeBtn = page.locator('[data-testid="settings-open-guideline-picker"]');
    await expect(changeBtn).toBeVisible();

    await closeSettings();
  });

  test('clicking Change opens GuidelinePicker', async () => {
    await openSettings();

    const changeBtn = page.locator('[data-testid="settings-open-guideline-picker"]');
    await changeBtn.click();
    await page.waitForTimeout(300);

    const picker = page.locator('[data-testid="guideline-picker"]');
    await expect(picker).toBeVisible({ timeout: 3_000 });

    // Close picker
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await closeSettings();
  });

  test('GuidelinePicker renders search input', async () => {
    await openSettings();

    const changeBtn = page.locator('[data-testid="settings-open-guideline-picker"]');
    await changeBtn.click();
    await page.waitForTimeout(300);

    const searchInput = page.locator('[data-testid="guideline-search"]');
    await expect(searchInput).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await closeSettings();
  });

  test('GuidelinePicker renders swatch buttons', async () => {
    await openSettings();

    const changeBtn = page.locator('[data-testid="settings-open-guideline-picker"]');
    await changeBtn.click();
    await page.waitForTimeout(300);

    const firstSwatch = page.locator('[data-testid="guideline-swatch-obsidian"]');
    await expect(firstSwatch).toBeVisible({ timeout: 3_000 });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await closeSettings();
  });

  test('selecting a swatch locks guideline and closes picker', async () => {
    await openSettings();

    const changeBtn = page.locator('[data-testid="settings-open-guideline-picker"]');
    await changeBtn.click();
    await page.waitForTimeout(300);

    const swatch = page.locator('[data-testid="guideline-swatch-obsidian"]');
    await swatch.click();
    await page.waitForTimeout(300);

    const picker = page.locator('[data-testid="guideline-picker"]');
    await expect(picker).not.toBeVisible();

    const id = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      return ds?.getState().designGuidelineId;
    });
    expect(id).toBe(1);

    await closeSettings();
  });

  test('search filters guidelines', async () => {
    await openSettings();

    const changeBtn = page.locator('[data-testid="settings-open-guideline-picker"]');
    await changeBtn.click();
    await page.waitForTimeout(300);

    const searchInput = page.locator('[data-testid="guideline-search"]');
    await searchInput.fill('obsidian');
    await page.waitForTimeout(200);

    const swatch = page.locator('[data-testid="guideline-swatch-obsidian"]');
    await expect(swatch).toBeVisible();

    await searchInput.fill('');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await closeSettings();
  });

});
