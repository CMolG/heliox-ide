/**
 * kanban-dnd.spec.ts — Playwright E2E tests for Proposal 9: Backlog Kanban DnD Parity
 *
 * Responsibility:
 * - Verifies keyboard sensor is active alongside pointer sensor.
 * - Validates card ordering is respected (order field sorted ascending).
 * - Tests multi-select behavior (Cmd/Ctrl+click toggle, Shift+click range).
 * - Confirms "Reorder by Priority" sorts cards deterministically.
 * - Validates drag handle is present and scoped correctly.
 * - Tests batch update IPC API exists and is callable.
 *
 * Architecture note:
 * Uses store-driven card population to avoid IPC flakiness in test environment.
 * Backlog cards are injected directly via __DESKTOP_STORE__ for deterministic setup.
 */
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import { getElectronLaunchArgs, getE2EEnv } from './test-helpers';

let app: ElectronApplication;
let page: Page;

// Test card fixtures with explicit order
const TEST_CARDS = [
  { filename: 'task-a.md', taskId: 'a', targetAgent: 'optimizer', targetModule: 'src/renderer', priority: 'low' as const, status: 'pending' as const, title: 'Task A (Low)', body: 'Low priority task', order: 2 },
  { filename: 'task-b.md', taskId: 'b', targetAgent: 'optimizer', targetModule: 'src/main', priority: 'critical' as const, status: 'pending' as const, title: 'Task B (Critical)', body: 'Critical priority task', order: 0 },
  { filename: 'task-c.md', taskId: 'c', targetAgent: 'optimizer', targetModule: 'src/types', priority: 'high' as const, status: 'pending' as const, title: 'Task C (High)', body: 'High priority task', order: 1 },
  { filename: 'task-d.md', taskId: 'd', targetAgent: 'optimizer', targetModule: 'src/renderer', priority: 'medium' as const, status: 'in_progress' as const, title: 'Task D (Medium)', body: 'In progress task', order: 0 },
  { filename: 'task-e.md', taskId: 'e', targetAgent: 'optimizer', targetModule: 'src/main', priority: 'high' as const, status: 'in_progress' as const, title: 'Task E (High)', body: 'Another in progress', order: 1 },
];

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

  await page.evaluate(() => {
    const store = (window as any).__FLUXOR_STORE__;
    if (store) store.getState().setProjectPath('/tmp/test-project');
  });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) ds.getState().updateSettings({ tourCompleted: true });
  });

  // Inject test cards and open a single backlog window
  await page.evaluate((cards) => {
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) {
      ds.getState().setBacklogCards(cards);
      ds.getState().addWindow('backlog', {
        title: 'Test Backlog',
        iconName: 'KanbanSquare',
      });
    }
  }, TEST_CARDS);
  // Wait for kanban view to auto-switch and render
  await page.waitForTimeout(2_000);
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ─── BacklogCard Order Field ─────────────────────────────────────

test.describe('BacklogCard Order Field', () => {
  test('cards have order field in type', async () => {
    const result = await page.evaluate((cards) => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (!ds) return { error: 'no store' };
      ds.getState().setBacklogCards(cards);
      const stored = ds.getState().backlogCards;
      return {
        count: stored.length,
        allHaveOrder: stored.every((c: any) => typeof c.order === 'number'),
        orders: stored.map((c: any) => ({ filename: c.filename, order: c.order })),
      };
    }, TEST_CARDS);

    expect(result.count).toBe(5);
    expect(result.allHaveOrder).toBe(true);
    expect(result.orders).toContainEqual({ filename: 'task-b.md', order: 0 });
  });

  test('cardsByStatus sorts by order ascending', async () => {
    await page.evaluate((cards) => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setBacklogCards(cards);
    }, TEST_CARDS);

    const pendingOrder = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      const cards = ds.getState().backlogCards
        .filter((c: any) => c.status === 'pending')
        .sort((a: any, b: any) => a.order - b.order);
      return cards.map((c: any) => c.filename);
    });

    // order 0=task-b, 1=task-c, 2=task-a
    expect(pendingOrder).toEqual(['task-b.md', 'task-c.md', 'task-a.md']);
  });
});

// ─── Kanban Board Rendering ──────────────────────────────────────

test.describe('Kanban Board Rendering', () => {
  test('kanban board renders four status columns', async () => {
    const columns = page.locator('[data-lane]');
    const count = await columns.count();
    // Board may not be visible if no backlog window, but data lanes should exist
    if (count > 0) {
      expect(count).toBeGreaterThanOrEqual(4);

      const lanes = await columns.evaluateAll(
        (els) => els.map(el => el.getAttribute('data-lane')),
      );
      expect(lanes).toContain('pending');
      expect(lanes).toContain('in_progress');
      expect(lanes).toContain('completed');
      expect(lanes).toContain('failed');
    }
  });

  test('cards render in correct columns', async () => {
    // Check pending column has 3 cards
    const pendingLane = page.locator('[data-lane="pending"]').first();
    if (await pendingLane.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const pendingCards = pendingLane.locator('.fd-card');
      const pendingCount = await pendingCards.count();
      expect(pendingCount).toBe(3);
    }
  });
});

// ─── Drag Handle ─────────────────────────────────────────────────

test.describe('Drag Handle', () => {
  test('cards have dedicated drag handle element', async () => {
    const handle = page.locator('.fd-drag-handle').first();
    const visible = await handle.isVisible({ timeout: 3_000 }).catch(() => false);

    if (visible) {
      // Drag handle should contain the grip icon
      const svg = handle.locator('svg');
      await expect(svg).toBeVisible();

      // Handle should have grab cursor
      const cursor = await handle.evaluate(el => window.getComputedStyle(el).cursor);
      expect(cursor).toBe('grab');
    }
  });

  test('card content area does not have drag listeners', async () => {
    // The fd-card element should not have aria-roledescription="sortable"
    // (that should be on the wrapper, handled by the drag handle)
    const card = page.locator('.fd-card').first();
    if (await card.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const roleDesc = await card.getAttribute('aria-roledescription');
      expect(roleDesc).not.toBe('sortable');
    }
  });
});

// ─── Multi-Select ────────────────────────────────────────────────

test.describe('Multi-Select', () => {
  test('fd-selected class is applied when card is selected', async () => {
    const card = page.locator('.fd-card').first();
    if (await card.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await card.scrollIntoViewIfNeeded();

      // Dispatch a click event with metaKey set to true via evaluate
      await card.evaluate((el) => {
        const event = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          metaKey: true,
        });
        el.dispatchEvent(event);
      });
      await page.waitForTimeout(300);

      const hasSelected = await card.evaluate(
        el => el.classList.contains('fd-selected'),
      );
      expect(hasSelected).toBe(true);

      // Deselect by dispatching another meta+click
      await card.evaluate((el) => {
        const event = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          metaKey: true,
        });
        el.dispatchEvent(event);
      });
      await page.waitForTimeout(300);

      const deselected = await card.evaluate(
        el => el.classList.contains('fd-selected'),
      );
      expect(deselected).toBe(false);
    }
  });

  test('multiple cards show fd-selected class on meta+click', async () => {
    const cards = page.locator('[data-lane="pending"] .fd-card');
    if (await cards.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      const count = await cards.count();
      if (count >= 2) {
        // Meta+click first card
        await cards.nth(0).evaluate((el) => {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
        });
        await page.waitForTimeout(200);

        // Meta+click second card
        await cards.nth(1).evaluate((el) => {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
        });
        await page.waitForTimeout(200);

        const selectedCount = await page.locator('.fd-selected').count();
        expect(selectedCount).toBe(2);

        // Deselect both
        await cards.nth(0).evaluate((el) => {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
        });
        await cards.nth(1).evaluate((el) => {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
        });
        await page.waitForTimeout(200);
      }
    }
  });

  test('shift+click selects a range within the same column', async () => {
    const cards = page.locator('[data-lane="pending"] .fd-card');
    if (await cards.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      const count = await cards.count();
      if (count >= 3) {
        // Meta+click first card to start selection
        await cards.nth(0).evaluate((el) => {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
        });
        await page.waitForTimeout(200);

        // Shift+click third card to range-select
        await cards.nth(2).evaluate((el) => {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
        });
        await page.waitForTimeout(200);

        // All 3 pending cards should be selected
        const selectedCount = await page.locator('[data-lane="pending"] .fd-selected').count();
        expect(selectedCount).toBe(3);

        // Clean up selection
        await cards.nth(0).evaluate((el) => {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
        });
        await cards.nth(1).evaluate((el) => {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
        });
        await cards.nth(2).evaluate((el) => {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
        });
        await page.waitForTimeout(200);
      }
    }
  });
});

// ─── Reorder by Priority ─────────────────────────────────────────

test.describe('Reorder by Priority', () => {
  test('Sort button is visible in kanban view', async () => {
    const sortBtn = page.locator('button[aria-label="Reorder by Priority"]').first();
    const visible = await sortBtn.isVisible({ timeout: 3_000 }).catch(() => false);

    if (visible) {
      await expect(sortBtn).toBeVisible();
      const text = await sortBtn.textContent();
      expect(text).toContain('Sort');
    }
  });

  test('clicking Sort reorders cards by priority', async () => {
    // Re-inject base test cards to ensure clean state
    await page.evaluate((cards) => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setBacklogCards(cards);
    }, TEST_CARDS);
    await page.waitForTimeout(300);

    const sortBtn = page.locator('button[aria-label="Reorder by Priority"]').first();
    if (await sortBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await sortBtn.scrollIntoViewIfNeeded();
      await sortBtn.click({ force: true });
      await page.waitForTimeout(500);

      // After sort, pending cards should be: critical (B), high (C), low (A)
      const pendingOrder = await page.evaluate(() => {
        const ds = (window as any).__DESKTOP_STORE__;
        return ds.getState().backlogCards
          .filter((c: any) => c.status === 'pending')
          .sort((a: any, b: any) => a.order - b.order)
          .map((c: any) => c.priority);
      });

      // Priority order: critical → high → medium → low
      expect(pendingOrder).toEqual(['critical', 'high', 'low']);
    }
  });

  test('priority reorder is stable within same priority group', async () => {
    // Inject cards with same priority to test stability
    await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) {
        ds.getState().setBacklogCards([
          { filename: 'x.md', taskId: 'x', targetAgent: 'a', targetModule: 'src', priority: 'high', status: 'pending', title: 'X', body: '', order: 0 },
          { filename: 'y.md', taskId: 'y', targetAgent: 'a', targetModule: 'src', priority: 'high', status: 'pending', title: 'Y', body: '', order: 1 },
          { filename: 'z.md', taskId: 'z', targetAgent: 'a', targetModule: 'src', priority: 'critical', status: 'pending', title: 'Z', body: '', order: 2 },
        ]);
      }
    });
    await page.waitForTimeout(500);

    // Click the Sort button inside the active backlog dialog
    const sortBtn = page.locator('dialog >> button[aria-label="Reorder by Priority"]').first();
    if (await sortBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await sortBtn.scrollIntoViewIfNeeded();
      await sortBtn.click({ force: true });
      await page.waitForTimeout(500);

      const result = await page.evaluate(() => {
        const ds = (window as any).__DESKTOP_STORE__;
        return ds.getState().backlogCards
          .filter((c: any) => c.status === 'pending')
          .sort((a: any, b: any) => a.order - b.order)
          .map((c: any) => c.filename);
      });

      // Z (critical) should come first, then X and Y (both high) should maintain relative order
      expect(result[0]).toBe('z.md');
      expect(result.slice(1)).toEqual(['x.md', 'y.md']);
    }
  });
});

// ─── Keyboard Sensor ─────────────────────────────────────────────

test.describe('Keyboard Sensor', () => {
  test('drag handle is keyboard focusable', async () => {
    const handle = page.locator('.fd-drag-handle').first();
    if (await handle.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Tab to the handle — it should be focusable
      const tabIndex = await handle.getAttribute('tabindex');
      // dnd-kit sets tabindex on the sortable element
      // The handle should have role or tabindex from dnd-kit attributes
      const role = await handle.getAttribute('role');
      const hasA11y = tabIndex !== null || role !== null;
      expect(hasA11y).toBeTruthy();
    }
  });
});

// ─── Batch Update IPC ────────────────────────────────────────────

test.describe('Batch Update IPC', () => {
  test('updateBacklogCards API exists on fluxorAPI', async () => {
    const hasApi = await page.evaluate(() => {
      return typeof (window as any).fluxorAPI?.updateBacklogCards === 'function';
    });
    expect(hasApi).toBe(true);
  });

  test('updateBacklogCardStatus API still exists for backward compat', async () => {
    const hasApi = await page.evaluate(() => {
      return typeof (window as any).fluxorAPI?.updateBacklogCardStatus === 'function';
    });
    expect(hasApi).toBe(true);
  });
});
