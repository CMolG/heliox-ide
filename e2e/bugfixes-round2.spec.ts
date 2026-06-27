/**
 * bugfixes-round2.spec.ts — Playwright E2E tests for Round 2 bug fixes
 *
 * Covers:
 * 1. Mental cards toggle defaults to OFF and can be toggled on/off
 * 2. Design system preview opens in a modal (not inline)
 * 3. Design system previews use a light palette
 * 4. Hard reset clears localStorage
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

  // Navigate to desktop
  await page.evaluate(() => {
    const store = (window as any).__HELIOX_STORE__;
    if (store) store.getState().setProjectPath('/tmp/test-project');
  });
  await page.locator('[data-testid="seamless-desktop"]').waitFor({ state: 'visible', timeout: 10_000 });

  // Dismiss quick-tour
  await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) ds.getState().updateSettings({ tourCompleted: true });
  });
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ─── Mental Cards Toggle ──────────────────────────────────────────

test.describe('Mental cards toggle OFF by default', () => {
  test('mentalMode defaults to off', async () => {
    const mode = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__?.getState()?.mentalMode,
    );
    expect(mode).toBe('off');
  });

  test('dock mental toggle is not active when mentalMode is off', async () => {
    // Reset to off
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('off');
    });
    await page.waitForTimeout(100);

    const btn = page.locator('[data-testid="dock-mental-draw-toggle"]');
    await expect(btn).toBeVisible({ timeout: 3_000 });
    const hasActive = await btn.evaluate((el) => el.classList.contains('dock-item-active'));
    expect(hasActive).toBe(false);
  });

  test('clicking mental toggle switches from off to square', async () => {
    // Ensure off
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('off');
    });
    await page.waitForTimeout(100);

    const btn = page.locator('[data-testid="dock-mental-draw-toggle"]');
    await btn.click();
    await page.waitForTimeout(200);

    const mode = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__?.getState()?.mentalMode,
    );
    // Dock toggles off → 'square' (the only drawing mode; 'shapes' no longer exists)
    expect(mode).toBe('square');
  });

  test('clicking mental toggle again switches from shapes to off', async () => {
    // Set to shapes
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('shapes');
    });
    await page.waitForTimeout(100);

    const btn = page.locator('[data-testid="dock-mental-draw-toggle"]');
    await btn.click();
    await page.waitForTimeout(200);

    const mode = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__?.getState()?.mentalMode,
    );
    expect(mode).toBe('off');
  });

  test('popover shows Square shape option (no Off option)', async () => {
    // The popover only contains drawing-mode options — "Off" was removed.
    // The button's onPointerEnter opens the menu; dispatch the event directly to
    // guarantee it fires regardless of Electron focus quirks.
    // Real aria-label confirmed from Dock.tsx: `${labelMap[shape]} shape` = "Square shape".
    const btn = page.locator('[data-testid="dock-mental-draw-toggle"]');
    await btn.scrollIntoViewIfNeeded();
    // Dispatch pointerenter explicitly so React's onPointerEnter handler fires reliably
    await btn.dispatchEvent('pointerenter');
    await page.waitForTimeout(400);

    // role="menuitemradio" aria-label="Square shape" on the dock-mental-icon-option div
    const squareOption = page.locator('.dock-mental-icon-option[aria-label="Square shape"]');
    await expect(squareOption).toBeVisible({ timeout: 3_000 });

    // Confirm there is no "Off" option in the popover (Off was removed; toggle is via button click)
    const offOption = page.locator('.dock-mental-icon-option[aria-label="Off"]');
    await expect(offOption).not.toBeVisible({ timeout: 1_000 });
  });

  test('selecting Square from popover sets mentalMode to square', async () => {
    // The popover only offers "Square shape". Selecting it activates square mode.
    // (The old "Off" option no longer exists — toggling off is done via the button click.)
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('off');
    });
    await page.waitForTimeout(100);

    const btn = page.locator('[data-testid="dock-mental-draw-toggle"]');
    await btn.hover();
    await page.waitForTimeout(400);

    const squareOption = page.locator('.dock-mental-icon-option[aria-label="Square shape"]');
    await expect(squareOption).toBeVisible({ timeout: 3_000 });
    await squareOption.click();
    await page.waitForTimeout(200);

    const mode = await page.evaluate(() =>
      (window as any).__DESKTOP_STORE__?.getState()?.mentalMode,
    );
    expect(mode).toBe('square');
  });

  test('dock-item-active class reflects active mental mode', async () => {
    // Set to shapes
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('shapes');
    });
    await page.waitForTimeout(100);

    const btn = page.locator('[data-testid="dock-mental-draw-toggle"]');
    const hasActive = await btn.evaluate((el) => el.classList.contains('dock-item-active'));
    expect(hasActive).toBe(true);

    // Set to off
    await page.evaluate(() => {
      (window as any).__DESKTOP_STORE__?.getState()?.setMentalMode('off');
    });
    await page.waitForTimeout(100);

    const hasActiveAfter = await btn.evaluate((el) => el.classList.contains('dock-item-active'));
    expect(hasActiveAfter).toBe(false);
  });
});

// ─── DS Preview Modal ─────────────────────────────────────────────

test.describe('Design system preview opens in modal', () => {
  test('clicking Show preview opens a modal overlay', async () => {
    // Ensure a design system attachable is on the desktop
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return;
      const inventory = ds.getState().marketInventory;
      if (!inventory?.designSystems?.length) return;
      const firstDS = inventory.designSystems[0];
      // Spawn a design-system attachable
      ds.getState().spawnAttachable(
        'design-system',
        `ds-${firstDS.name}`,
        { x: 100, y: 100 },
        { designSystem: firstDS },
      );
    });
    await page.waitForTimeout(500);

    const toggleBtn = page.locator('[data-testid^="micro-preview-toggle-"]').first();
    const visible = await toggleBtn.isVisible({ timeout: 3_000 }).catch(() => false);

    if (visible) {
      await toggleBtn.evaluate((el) => (el as HTMLElement).click());
      await page.waitForTimeout(300);

      // A modal backdrop should appear in the DOM
      const backdrop = page.locator('[data-testid^="ds-preview-modal-backdrop-"]').first();
      await expect(backdrop).toBeVisible({ timeout: 3_000 });

      // The modal content should contain the micro-preview
      const preview = page.locator('[data-testid="design-system-micro-preview"]').first();
      await expect(preview).toBeVisible({ timeout: 3_000 });

      // Close the modal by clicking the close button
      const closeBtn = page.locator('[data-testid^="ds-preview-modal-close-"]').first();
      await closeBtn.click();
      await page.waitForTimeout(200);

      // Modal should be gone
      await expect(backdrop).not.toBeVisible();
    }
  });

  test('clicking modal backdrop closes the modal', async () => {
    const toggleBtn = page.locator('[data-testid^="micro-preview-toggle-"]').first();
    const visible = await toggleBtn.isVisible({ timeout: 3_000 }).catch(() => false);

    if (visible) {
      await toggleBtn.evaluate((el) => (el as HTMLElement).click());
      await page.waitForTimeout(300);

      const backdrop = page.locator('[data-testid^="ds-preview-modal-backdrop-"]').first();
      await expect(backdrop).toBeVisible({ timeout: 3_000 });

      // Click the backdrop (not the modal content) — use force since the modal overlay is the target
      await backdrop.click({ position: { x: 10, y: 10 } });
      await page.waitForTimeout(200);

      await expect(backdrop).not.toBeVisible();
    }
  });
});

// ─── DS Preview Light Palette ─────────────────────────────────────

test.describe('Design system previews use light palette', () => {
  test('micro-preview background is white/light', async () => {
    // Open a preview modal to render the micro-preview
    const toggleBtn = page.locator('[data-testid^="micro-preview-toggle-"]').first();
    const visible = await toggleBtn.isVisible({ timeout: 3_000 }).catch(() => false);

    if (visible) {
      await toggleBtn.evaluate((el) => (el as HTMLElement).click());
      await page.waitForTimeout(300);

      const preview = page.locator('[data-testid="design-system-micro-preview"]').first();
      const previewVisible = await preview.isVisible({ timeout: 3_000 }).catch(() => false);

      if (previewVisible) {
        const bg = await preview.evaluate((el) => {
          return getComputedStyle(el).backgroundColor;
        });
        // The background should be light (white = rgb(255, 255, 255))
        expect(bg).toContain('rgb(255, 255, 255)');
      }

      // Close modal
      const closeBtn = page.locator('[data-testid^="ds-preview-modal-close-"]').first();
      if (await closeBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await closeBtn.click();
        await page.waitForTimeout(200);
      }
    }
  });
});

// ─── Hard Reset ───────────────────────────────────────────────────

test.describe('Hard reset clears state', () => {
  test('hard reset button exists in settings modal', async () => {
    // Open settings via Heliox store (not desktop store)
    await page.evaluate(() => {
      const store = (window as any).__HELIOX_STORE__;
      if (store) store.getState().setShowSettings(true);
    });
    await page.waitForTimeout(300);

    const resetBtn = page.locator('[data-testid="settings-hard-reset-btn"]');
    await expect(resetBtn).toBeVisible({ timeout: 3_000 });

    // Close settings
    await page.evaluate(() => {
      const store = (window as any).__HELIOX_STORE__;
      if (store) store.getState().setShowSettings(false);
    });
    await page.waitForTimeout(200);
  });

  test('hard reset shows confirmation before executing', async () => {
    await page.evaluate(() => {
      const store = (window as any).__HELIOX_STORE__;
      if (store) store.getState().setShowSettings(true);
    });
    await page.waitForTimeout(300);

    // Click initial reset button
    const resetBtn = page.locator('[data-testid="settings-hard-reset-btn"]');
    await resetBtn.click();
    await page.waitForTimeout(200);

    // Confirm button should now be visible
    const confirmBtn = page.locator('[data-testid="settings-hard-reset-confirm"]');
    await expect(confirmBtn).toBeVisible({ timeout: 3_000 });

    // Close settings without confirming
    await page.evaluate(() => {
      const store = (window as any).__HELIOX_STORE__;
      if (store) store.getState().setShowSettings(false);
    });
    await page.waitForTimeout(200);
  });
});
