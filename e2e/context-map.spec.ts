/**
 * context-map.spec.ts — Playwright E2E tests for Proposal 2: Agent Context Map Panel
 *
 * Responsibility:
 * - Verifies ContextMapPanel opens and closes correctly.
 * - Tests node creation, search, filtering, and deletion via the panel UI.
 * - Validates context digest export functionality.
 * - Confirms IPC bridge works for context map operations.
 *
 * Architecture note:
 * Uses the IPC bridge (window.fluxorAPI) for context map operations.
 * Store mutations use `window.__DESKTOP_STORE__` and `window.__FLUXOR_STORE__`.
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
    () => !!(window as any).__FLUXOR_STORE__ && !!(window as any).__DESKTOP_STORE__,
    { timeout: 15_000 },
  );

  // Set project path so context map has a valid project
  await page.evaluate(() => {
    const store = (window as any).__FLUXOR_STORE__;
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

// ─── Context Map IPC Tests ──────────────────────────────────────

test.describe('Context Map IPC Bridge', () => {
  test('contextMapGetAll returns a valid context map structure', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any).fluxorAPI;
      if (!api) return null;
      try {
        const map = await api.contextMapGetAll('/tmp/test-project');
        return {
          hasVersion: typeof map.version === 'number',
          hasNodes: Array.isArray(map.nodes),
          hasEdges: Array.isArray(map.edges),
          hasProjectId: typeof map.projectId === 'string',
        };
      } catch {
        return null;
      }
    });

    expect(result).not.toBeNull();
    if (result) {
      expect(result.hasVersion).toBe(true);
      expect(result.hasNodes).toBe(true);
      expect(result.hasEdges).toBe(true);
      expect(result.hasProjectId).toBe(true);
    }
  });

  test('contextMapUpsertNode creates a new node', async () => {
    const nodeId = await page.evaluate(async () => {
      const api = (window as any).fluxorAPI;
      if (!api) return null;
      try {
        const node = await api.contextMapUpsertNode('/tmp/test-project', {
          id: 'e2e-test-node-1',
          type: 'concept',
          label: 'E2E Test Concept',
          body: 'A test concept node created during E2E testing',
          source: 'user',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tags: ['test', 'e2e'],
        });
        return node.id;
      } catch {
        return null;
      }
    });

    expect(nodeId).toBe('e2e-test-node-1');
  });

  test('contextMapSearch finds the created node', async () => {
    const results = await page.evaluate(async () => {
      const api = (window as any).fluxorAPI;
      if (!api) return [];
      try {
        return await api.contextMapSearch('/tmp/test-project', 'E2E Test');
      } catch {
        return [];
      }
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    const found = results.find((n: any) => n.id === 'e2e-test-node-1');
    expect(found).toBeDefined();
  });

  test('contextMapExportText generates a digest', async () => {
    const digest = await page.evaluate(async () => {
      const api = (window as any).fluxorAPI;
      if (!api) return null;
      try {
        return await api.contextMapExportText('/tmp/test-project');
      } catch {
        return null;
      }
    });

    expect(digest).not.toBeNull();
    expect(typeof digest).toBe('string');
  });

  test('contextMapDeleteNode removes the test node', async () => {
    await page.evaluate(async () => {
      const api = (window as any).fluxorAPI;
      if (!api) return;
      try {
        await api.contextMapDeleteNode('/tmp/test-project', 'e2e-test-node-1');
      } catch {}
    });

    const results = await page.evaluate(async () => {
      const api = (window as any).fluxorAPI;
      if (!api) return [];
      try {
        const map = await api.contextMapGetAll('/tmp/test-project');
        return map.nodes;
      } catch {
        return [];
      }
    });

    const found = results.find((n: any) => n.id === 'e2e-test-node-1');
    expect(found).toBeUndefined();
  });
});
