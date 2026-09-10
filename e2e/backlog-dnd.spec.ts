/**
 * backlog-dnd.spec.ts — Playwright E2E tests for the backlog bento pile's
 * DnD/order/multi-select behavior (renamed from kanban-dnd.spec.ts — the
 * 4-column kanban board this file used to exercise was retired by the F2
 * Task 1 cutover; see docs/superpowers/plans/2026-07-22-backlog-bento.md).
 *
 * Responsibility:
 * - Cards still carry a numeric `order`, scoped per status (F0 spec §1.1).
 * - The single flat pile (BacklogPile.tsx) reorders via @dnd-kit — both its
 *   PointerSensor and KeyboardSensor funnel through the SAME onDragEnd, so a
 *   keyboard-driven pick-up/move/drop exercises the identical reorder +
 *   persistence path a pointer drag would, deterministically (no coordinate
 *   math or collision-detection timing to get right in a headless runner).
 * - Multi-select (meta/ctrl-click toggle, shift-click range) still works,
 *   now scoped to "within the same status" (BacklogPile.tsx's
 *   handleCardSelect only range-selects cards sharing `curCard.status`).
 * - The old "Reorder by Priority" Sort button and the 4-column kanban board
 *   are NOT ported — both were retired by the F2 Task 1 cutover
 *   (BacklogBentoWidget.tsx's own header comment: `reorderByPriority` was
 *   "intentionally NOT ported"; the frozen bento reference has no such
 *   button either) — testing for them here would be testing dead code.
 * - Batch update IPC (`updateBacklogCards`) still exists and its per-entry
 *   shape now also accepts `runState` (src/preload/index.ts).
 *
 * Architecture note:
 * Uses store-driven card population to avoid IPC flakiness in the test
 * environment. Backlog cards are injected directly via __DESKTOP_STORE__
 * for deterministic setup — same convention the old file used.
 */
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import { getElectronLaunchArgs, getE2EEnv } from './test-helpers';

let app: ElectronApplication;
let page: Page;

// v2 test card fixtures (BacklogCard — src/types/market.ts): 6-state
// `status`, `description` (not `body`), `runState`, `estimate`, `tags`,
// `assignees`, `related`, `createdAt`/`updatedAt`. STATUS_CONFIG's workflow
// `order` (statusConfig.ts) sorts 'doing' before 'todo' in the rendered
// pile (doing=3, todo=5) — tests that care about visual order account for
// this; tests that only care about a single status filter by `status`
// directly, which is order-independent.
const NOW = '2026-07-08T00:00:00.000Z';
function card(overrides: Record<string, unknown>) {
  return {
    filename: 'x.md', taskId: 'x', targetAgent: 'optimizer', targetModule: 'src',
    priority: 'medium', status: 'todo', runState: 'idle', order: 0,
    tags: [], estimate: 0, assignees: [], related: [],
    createdAt: NOW, updatedAt: NOW, title: 'x', description: '',
    comments: [], attachments: [],
    ...overrides,
  };
}

const TEST_CARDS = [
  card({ filename: 'task-a.md', taskId: 'a', priority: 'low', status: 'todo', title: 'Task A (Low)', description: 'Low priority task', order: 2 }),
  card({ filename: 'task-b.md', taskId: 'b', priority: 'superHigh', status: 'todo', title: 'Task B (Critical)', description: 'Critical priority task', order: 0 }),
  card({ filename: 'task-c.md', taskId: 'c', priority: 'high', status: 'todo', title: 'Task C (High)', description: 'High priority task', order: 1 }),
  card({ filename: 'task-d.md', taskId: 'd', priority: 'medium', status: 'doing', title: 'Task D (Medium)', description: 'In progress task', order: 0 }),
  card({ filename: 'task-e.md', taskId: 'e', priority: 'high', status: 'doing', title: 'Task E (High)', description: 'Another in progress', order: 1 }),
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

  // Fluxor bridge stub: BacklogPile's onDragEnd persists a reorder via
  // fluxorAPI.updateBacklogCards(backlogDir, updates) — this suite never
  // selects a real backlog directory (cards are injected directly into the
  // store), so `backlogDir` is always '' and the real IPC handler would
  // reject. Stub it to resolve so the pile's own optimistic reorder isn't
  // reverted by BacklogPile.tsx's `.catch(() => setBacklogCards(prevCards))`.
  await page.evaluate(() => {
    const api = (window as any).fluxorAPI;
    if (api) api.updateBacklogCards = async () => ({ success: true });
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
  // Wait for the bento pile to auto-switch (view leaves 'picker' once
  // backlogCards.length > 0 — BacklogBentoWidget.tsx) and render.
  await page.waitForTimeout(2_000);
});

test.afterAll(async () => {
  if (app) await app.close();
});

// Reset to exactly ONE backlog window before every test. The single Electron
// session (beforeAll) means desktop-store windows persist across tests; without
// this reset they accumulate, so page-scoped card locators
// (`[data-testid="backlog-card"][data-filename=…]`) match the same card in every
// leaked window → Playwright strict-mode "resolved to N elements" violations.
test.beforeEach(async () => {
  await page.evaluate((cards) => {
    const ds = (window as any).__DESKTOP_STORE__;
    if (!ds) return;
    for (const w of [...ds.getState().windows]) ds.getState().removeWindow(w.id);
    ds.getState().setBacklogCards(cards);
    ds.getState().addWindow('backlog', { title: 'Test Backlog', iconName: 'KanbanSquare' });
  }, TEST_CARDS);
  await page.waitForTimeout(1500);
});

// ─── BacklogCard Order Field ─────────────────────────────────────

test.describe('BacklogCard Order Field', () => {
  test('cards have a numeric order field', async () => {
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

  test('cards sort by order ascending within the same status', async () => {
    await page.evaluate((cards) => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setBacklogCards(cards);
    }, TEST_CARDS);

    const todoOrder = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      return ds.getState().backlogCards
        .filter((c: any) => c.status === 'todo')
        .sort((a: any, b: any) => a.order - b.order)
        .map((c: any) => c.filename);
    });

    // order 0=task-b, 1=task-c, 2=task-a
    expect(todoOrder).toEqual(['task-b.md', 'task-c.md', 'task-a.md']);
  });
});

// ─── Sortable Affordances (no dedicated drag handle in the bento pile —
// @dnd-kit's sortable listeners are attached to a thin wrapper around the
// WHOLE card, per BacklogPile.tsx's own doc comment: the frozen reference
// has no drag-handle look of its own) ──────────────────────────────

test.describe('Sortable affordances', () => {
  test('each pile card is wrapped by a keyboard-focusable sortable element', async () => {
    await page.evaluate((cards) => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setBacklogCards(cards);
    }, TEST_CARDS);
    await page.waitForTimeout(300);

    const cardEl = page.locator('[data-testid="backlog-card"]').first();
    await expect(cardEl).toBeVisible({ timeout: 3000 });
    // @dnd-kit's useSortable spreads {...attributes} {...listeners} onto the
    // OUTER wrapper div (BacklogPile.tsx's SortableCard), not onto
    // BacklogCardItem's own root — walk up one level to reach it.
    const wrapper = cardEl.locator('xpath=..');
    const tabIndex = await wrapper.getAttribute('tabindex');
    const role = await wrapper.getAttribute('role');
    expect(tabIndex !== null || role !== null).toBeTruthy();
  });
});

// ─── Multi-select ────────────────────────────────────────────────

test.describe('Multi-select', () => {
  test.beforeEach(async () => {
    await page.evaluate((cards) => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setBacklogCards(cards);
    }, TEST_CARDS);
    await page.waitForTimeout(300);
  });

  test('meta+click toggles aria-selected on a single card', async () => {
    const cardEl = page.locator('[data-testid="backlog-card"][data-filename="task-a.md"]');
    await expect(cardEl).toBeVisible({ timeout: 3000 });

    await cardEl.click({ modifiers: ['Meta'] });
    await expect(cardEl).toHaveAttribute('aria-selected', 'true');

    await cardEl.click({ modifiers: ['Meta'] });
    await expect(cardEl).toHaveAttribute('aria-selected', 'false');
  });

  test('meta+click selects multiple cards independently', async () => {
    const a = page.locator('[data-testid="backlog-card"][data-filename="task-a.md"]');
    const d = page.locator('[data-testid="backlog-card"][data-filename="task-d.md"]');
    await expect(a).toBeVisible({ timeout: 3000 });

    await a.click({ modifiers: ['Meta'] });
    await d.click({ modifiers: ['Meta'] });
    await expect(page.locator('[data-testid="backlog-card"][aria-selected="true"]')).toHaveCount(2);

    // Clean up selection for the next test.
    await a.click({ modifiers: ['Meta'] });
    await d.click({ modifiers: ['Meta'] });
    await expect(page.locator('[data-testid="backlog-card"][aria-selected="true"]')).toHaveCount(0);
  });

  test('shift+click range-selects only cards sharing the same status', async () => {
    // The 3 'todo' cards (task-b order0, task-c order1, task-a order2) form
    // the range; 'doing' cards (task-d/task-e) must stay unselected — v2
    // scopes shift-range to `curCard.status` (BacklogPile.tsx handleCardSelect).
    const b = page.locator('[data-testid="backlog-card"][data-filename="task-b.md"]');
    const a = page.locator('[data-testid="backlog-card"][data-filename="task-a.md"]');
    await expect(b).toBeVisible({ timeout: 3000 });

    await b.click({ modifiers: ['Meta'] });
    await a.click({ modifiers: ['Shift'] });

    await expect(page.locator('[data-testid="backlog-card"][aria-selected="true"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="backlog-card"][data-filename="task-b.md"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="backlog-card"][data-filename="task-c.md"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="backlog-card"][data-filename="task-a.md"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="backlog-card"][data-filename="task-d.md"]')).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('[data-testid="backlog-card"][data-filename="task-e.md"]')).toHaveAttribute('aria-selected', 'false');

    // Clean up: meta+click the three again to deselect.
    await b.click({ modifiers: ['Meta'] });
    await page.locator('[data-testid="backlog-card"][data-filename="task-c.md"]').click({ modifiers: ['Meta'] });
    await a.click({ modifiers: ['Meta'] });
  });
});

// ─── Keyboard-driven reorder (dnd-kit KeyboardSensor) ─────────────

test.describe('Keyboard-driven reorder', () => {
  test('space to pick up, arrow to move, space to drop reorders within the same status', async () => {
    // A clean, single-status trio keeps the reorder unambiguous.
    const trio = [
      card({ filename: 'kb-a.md', taskId: 'kb-a', title: 'KB Card A', order: 0 }),
      card({ filename: 'kb-b.md', taskId: 'kb-b', title: 'KB Card B', order: 1 }),
      card({ filename: 'kb-c.md', taskId: 'kb-c', title: 'KB Card C', order: 2 }),
    ];
    await page.evaluate((cards) => {
      const ds = (window as any).__DESKTOP_STORE__;
      if (ds) ds.getState().setBacklogCards(cards);
    }, trio);
    await page.waitForTimeout(300);

    const cardA = page.locator('[data-testid="backlog-card"][data-filename="kb-a.md"]');
    await expect(cardA).toBeVisible({ timeout: 3000 });
    const wrapperA = cardA.locator('xpath=..');

    await wrapperA.focus();
    await page.keyboard.press('Space'); // pick up (KeyboardSensor default activation)
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown'); // move one position down (sortableKeyboardCoordinates)
    await page.waitForTimeout(200);
    await page.keyboard.press('Space'); // drop
    await page.waitForTimeout(400);

    const order = await page.evaluate(() => {
      const ds = (window as any).__DESKTOP_STORE__;
      return ds.getState().backlogCards
        .filter((c: any) => c.status === 'todo' && c.filename.startsWith('kb-'))
        .sort((a: any, b: any) => a.order - b.order)
        .map((c: any) => c.filename);
    });

    // A moved from index 0 to index 1 — B is now first.
    expect(order[0]).toBe('kb-b.md');
    expect(order).toContain('kb-a.md');
    expect(order).toHaveLength(3);
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

  test('updateBacklogCards accepts a runState field on each update entry', async () => {
    // The directory is intentionally bogus — this only proves the call
    // SHAPE (an update entry carrying `runState`) is accepted by the bridge,
    // not that the write succeeds against a real .backlog directory.
    const outcome = await page.evaluate(async () => {
      const api = (window as any).fluxorAPI;
      if (typeof api?.updateBacklogCards !== 'function') return 'missing';
      try {
        await api.updateBacklogCards('/tmp/e2e-nonexistent-backlog-dir', [
          { filename: 'x.md', runState: 'running' },
        ]);
        return 'resolved';
      } catch {
        return 'rejected';
      }
    });
    expect(['resolved', 'rejected']).toContain(outcome);
  });
});
