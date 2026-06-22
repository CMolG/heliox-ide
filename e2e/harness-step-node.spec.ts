/**
 * harness-step-node.spec.ts — Phase 1 harness canvas E2E
 *
 * Verifies the dnd-kit → xyflow bridge: a draggable mod badge can be dropped
 * onto a StepNode, and the StepNode's persisted store data receives the mod.
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

async function ensureDesktop() {
  const desktop = page.locator('[data-testid="seamless-desktop"]');
  if (!(await desktop.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await page.evaluate(() => {
      (window as any).__HELIOX_STORE__?.getState()?.setProjectPath('/tmp/test-project');
    });
    await desktop.waitFor({ state: 'visible', timeout: 10_000 });
  }
  await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__?.getState();
    if (!store) return;
    store.updateSettings({ tourCompleted: true });
    for (const w of [...store.windows]) store.removeWindow(w.id);
    for (const n of [...store.mentalNodes]) store.removeMentalNode(n.id);
    store.setMentalMode('off');
  });
}

test('draggable mod badge drops into a StepNode and updates step data', async () => {
  await ensureDesktop();

  await page.locator('[data-testid="add-step-node-button"]').click();
  const step = page.locator('[data-testid^="step-node-"]').first();
  await expect(step).toBeVisible({ timeout: 5_000 });

  const badge = page.locator('[data-testid="draggable-mod-badge-strict-linting"]').first();
  await expect(badge).toBeVisible({ timeout: 5_000 });

  const badgeBox = await badge.boundingBox();
  const stepBox = await step.boundingBox();
  expect(badgeBox).not.toBeNull();
  expect(stepBox).not.toBeNull();

  await page.mouse.move(badgeBox!.x + badgeBox!.width / 2, badgeBox!.y + badgeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(stepBox!.x + stepBox!.width / 2, stepBox!.y + stepBox!.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(step).toContainText('Strict Linting');

  const stepState = await page.evaluate(() => {
    const nodes = (window as any).__DESKTOP_STORE__?.getState()?.mentalNodes ?? [];
    const stepNode = nodes.find((node: any) => node.type === 'step');
    return {
      type: stepNode?.type,
      mods: stepNode?.data?.mods?.map((mod: any) => mod.name) ?? [],
    };
  });

  expect(stepState).toEqual({
    type: 'step',
    mods: ['strict-linting'],
  });
});
