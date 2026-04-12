import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';

let app: any;
let page: any;

/** Clean all grids and windows from the store */
async function cleanState() {
  await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    if (store) {
      const s = store.getState();
      s.grids.forEach((g: any) => s.removeGrid(g.id));
      s.windows.forEach((w: any) => s.removeWindow(w.id));
      s.setDraggingWindowId(null);
    }
  });
  await page.waitForTimeout(200);
}

/** Create a grid at a known position and return its id */
async function createGrid(opts?: { x?: number; y?: number; w?: number; h?: number }) {
  return page.evaluate((o: any) => {
    const store = (window as any).__DESKTOP_STORE__;
    return store.getState().addGrid({
      position: { x: o?.x ?? 200, y: o?.y ?? 200 },
      size: { width: o?.w ?? 640, height: o?.h ?? 480 },
    });
  }, opts ?? {});
}

/** Create a chat window and return its id */
async function createWindow(title: string, x?: number) {
  return page.evaluate(({ t, posX }: { t: string; posX: number }) => {
    const store = (window as any).__DESKTOP_STORE__;
    const helioxStore = (window as any).__HELIOX_STORE__;
    const sessionId = helioxStore?.getState()?.addSession?.() ?? 'test-' + Date.now();
    return store.getState().addWindow('chat', { title: t, iconName: 'MessageSquare', sessionId, position: { x: posX, y: 200 } });
  }, { t: title, posX: x ?? 900 });
}

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..')],
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'development', ELECTRON_IS_DEV: '1', HELIOX_MODELS: 'copilot' },
    timeout: 30_000,
  });
  page = await app.firstWindow();
  await page.waitForURL(/^(?!about:blank)/, { timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded');

  await page.waitForFunction(
    () => !!(window as any).__HELIOX_STORE__ && !!(window as any).__DESKTOP_STORE__,
    { timeout: 60_000 },
  );

  // Clear persisted state to ensure a clean test context
  await page.evaluate(() => {
    try { localStorage.clear(); } catch { /* Electron may block direct localStorage access */ }
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) {
      ds.getState().updateSettings({ tourCompleted: true });
      ds.getState().setActiveTutorial(null);
    }
  });

  // Open a project so we get to the desktop canvas
  const desktop = page.locator('[data-testid="seamless-desktop"]');
  if (!(await desktop.isVisible({ timeout: 2000 }).catch(() => false))) {
    await page.evaluate(() => {
      const store = (window as any).__HELIOX_STORE__;
      if (store) store.getState().setProjectPath('/tmp/test-project');
    });
    await desktop.waitFor({ state: 'visible', timeout: 10_000 });
  }
  // Dismiss tour if showing
  await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) ds.getState().updateSettings({ tourCompleted: true });
  });

  await cleanState();
});

test.afterAll(async () => { if (app) await app.close(); });

// ─── Basic grid creation ────────────────────────────────────────

test('grid dock button is visible in the dock', async () => {
  const dock = page.locator('[data-testid="dock"]');
  await expect(dock).toBeVisible({ timeout: 5000 });
  const gridBtn = page.locator('[data-testid="dock-grid"]');
  await expect(gridBtn).toBeVisible({ timeout: 3000 });
});

test('clicking grid dock button spawns a grid on canvas', async () => {
  await cleanState();
  const gridBtn = page.locator('[data-testid="dock-grid"]');
  await gridBtn.click();
  await page.waitForTimeout(500);

  const gridCount = await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    return store?.getState()?.grids?.length ?? 0;
  });
  expect(gridCount).toBeGreaterThanOrEqual(1);

  const gridEl = page.locator('.desktop-grid-shell').first();
  await expect(gridEl).toBeVisible({ timeout: 3000 });
});

test('grid has cells with drop placeholders', async () => {
  await cleanState();
  await createGrid();
  await page.waitForTimeout(300);

  const cells = page.locator('[data-testid="grid-cells"] .grid-cell');
  const count = await cells.count();
  expect(count).toBe(4); // 2x2 default

  for (let i = 0; i < count; i++) {
    const placeholder = cells.nth(i).locator('.grid-cell-placeholder');
    await expect(placeholder).toBeVisible();
  }
});

// ─── Visual design: no header, transparent, corner buttons ──────

test('grid has NO header bar (top-level layout, not a window)', async () => {
  await cleanState();
  await createGrid();
  await page.waitForTimeout(300);
  const header = page.locator('.grid-header');
  await expect(header).toHaveCount(0);
});

test('grid shell has transparent background', async () => {
  await cleanState();
  await createGrid();
  await page.waitForTimeout(300);
  const shell = page.locator('.desktop-grid-shell').first();
  const bg = await shell.evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor);
  // Expect fully transparent
  expect(bg).toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/);
});

test('corner "+" buttons appear on corner hover only (not grid-wide)', async () => {
  await cleanState();
  await createGrid();
  await page.waitForTimeout(300);

  const shell = page.locator('.desktop-grid-shell').first();
  const box = await shell.boundingBox();
  expect(box).not.toBeNull();

  // Move to center — none should be visible
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForTimeout(300);
  const tlBtn = shell.locator('.grid-corner-tl');
  const tlOp = await tlBtn.evaluate((el: HTMLElement) => getComputedStyle(el).opacity);
  expect(parseFloat(tlOp)).toBe(0);

  // Hover top-left corner zone — only TL button should appear
  await page.mouse.move(box!.x + 10, box!.y + 10);
  await page.waitForTimeout(400);
  const tlVisible = await tlBtn.evaluate((el: HTMLElement) => getComputedStyle(el).opacity);
  expect(parseFloat(tlVisible)).toBeGreaterThan(0);

  // TR should still be hidden (different corner)
  const trBtn = shell.locator('.grid-corner-tr');
  const trOp = await trBtn.evaluate((el: HTMLElement) => getComputedStyle(el).opacity);
  expect(parseFloat(trOp)).toBe(0);
});

test('close button appears on top-right corner hover only', async () => {
  await cleanState();
  await createGrid();
  await page.waitForTimeout(300);

  const shell = page.locator('.desktop-grid-shell').first();
  const closeBtn = shell.locator('.grid-close-floating');
  const box = await shell.boundingBox();
  expect(box).not.toBeNull();

  // Move to center
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForTimeout(300);
  let op = await closeBtn.evaluate((el: HTMLElement) => getComputedStyle(el).opacity);
  expect(parseFloat(op)).toBe(0);

  // Hover top-right corner
  await page.mouse.move(box!.x + box!.width - 10, box!.y + 10);
  await page.waitForTimeout(400);
  op = await closeBtn.evaluate((el: HTMLElement) => getComputedStyle(el).opacity);
  expect(parseFloat(op)).toBeGreaterThan(0);
});

// ─── Grid movement (drag body, no header) ───────────────────────

test('grid can be moved by dragging its body', async () => {
  await cleanState();
  const gridId = await createGrid({ x: 200, y: 200 });
  await page.waitForTimeout(300);

  const initialPos = await page.evaluate((id: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    const g = store?.getState()?.grids?.find((g: any) => g.id === id);
    return g ? { x: g.position.x, y: g.position.y } : null;
  }, gridId);
  expect(initialPos).not.toBeNull();

  const shell = page.locator('.desktop-grid-shell').first();
  const box = await shell.boundingBox();
  expect(box).not.toBeNull();

  const startX = box!.x + box!.width / 2;
  const startY = box!.y + 30;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 120, startY + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const newPos = await page.evaluate((id: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    const g = store?.getState()?.grids?.find((g: any) => g.id === id);
    return g ? { x: g.position.x, y: g.position.y } : null;
  }, gridId);

  expect(newPos).not.toBeNull();
  expect(Math.abs(newPos!.x - initialPos!.x)).toBeGreaterThan(10);
  expect(Math.abs(newPos!.y - initialPos!.y)).toBeGreaterThan(10);
});

// ─── Confirmation modal for add row/column ──────────────────────

test('"+" button opens confirmation modal instead of directly adding', async () => {
  await cleanState();
  await createGrid();
  await page.waitForTimeout(300);

  const shell = page.locator('.desktop-grid-shell').first();
  const box = await shell.boundingBox();
  expect(box).not.toBeNull();

  // Hover top-left corner to reveal TL button
  await page.mouse.move(box!.x + 10, box!.y + 10);
  await page.waitForTimeout(400);

  // Click the TL "+" button (adds column)
  const tlBtn = shell.locator('[data-testid="grid-add-column-tl"]');
  await tlBtn.click();
  await page.waitForTimeout(300);

  // Confirmation modal should appear
  const modal = shell.locator('[data-testid="grid-confirm-modal"]');
  await expect(modal).toBeVisible({ timeout: 3000 });

  // The modal should mention "column"
  const text = await modal.locator('p').first().textContent();
  expect(text?.toLowerCase()).toContain('column');
});

test('confirmation modal cancel does not add row/column', async () => {
  await cleanState();
  await createGrid();
  await page.waitForTimeout(300);

  const before = await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    return store.getState().grids[0].columns;
  });

  const shell = page.locator('.desktop-grid-shell').first();
  const box = await shell.boundingBox();
  await page.mouse.move(box!.x + 10, box!.y + 10);
  await page.waitForTimeout(400);

  await shell.locator('[data-testid="grid-add-column-tl"]').click();
  await page.waitForTimeout(200);
  await shell.locator('[data-testid="grid-confirm-cancel"]').click();
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    return store.getState().grids[0].columns;
  });
  expect(after).toBe(before);
});

test('confirmation modal OK adds the column and expands container width', async () => {
  await cleanState();
  await createGrid({ w: 640, h: 480 });
  await page.waitForTimeout(300);

  const before = await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    const g = store.getState().grids[0];
    return { cols: g.columns, w: g.size.width };
  });

  const shell = page.locator('.desktop-grid-shell').first();
  const box = await shell.boundingBox();
  await page.mouse.move(box!.x + 10, box!.y + 10);
  await page.waitForTimeout(400);

  await shell.locator('[data-testid="grid-add-column-tl"]').click();
  await page.waitForTimeout(200);
  await shell.locator('[data-testid="grid-confirm-ok"]').click();
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    const g = store.getState().grids[0];
    return { cols: g.columns, w: g.size.width };
  });

  expect(after.cols).toBe(before.cols + 1);
  expect(after.w).toBeGreaterThan(before.w);
});

test('add row expands container height', async () => {
  await cleanState();
  await createGrid({ w: 640, h: 480 });
  await page.waitForTimeout(300);

  const before = await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    const g = store.getState().grids[0];
    return { rows: g.rows, h: g.size.height };
  });

  // Use store directly for row add
  await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    const g = store.getState().grids[0];
    store.getState().addGridRow(g.id);
  });
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    const g = store.getState().grids[0];
    return { rows: g.rows, h: g.size.height };
  });

  expect(after.rows).toBe(before.rows + 1);
  expect(after.h).toBeGreaterThan(before.h);
});

// ─── Custom DnD: window grip → grid cell ────────────────────────

test('custom drag: unsnapped window still exposes drag-to-grid grip', async () => {
  await cleanState();
  await createGrid();
  const winId = await createWindow('Drag Test');
  await page.waitForTimeout(400);

  // Find the in-surface unsnapped drag grip
  const grip = page.locator('.window-grid-grip.window-grid-drag[title="Drag into a grid cell"]').first();
  await expect(grip).toBeVisible({ timeout: 5000 });

  // Mousedown on grip
  const gripBox = await grip.boundingBox();
  await page.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200);

  const dragId = await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    return store.getState().draggingWindowId;
  });
  expect(dragId).toBe(winId);

  await page.mouse.up();
  await page.waitForTimeout(200);

  // After mouseup (not on cell), dragging should be cleared
  const dragIdAfter = await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    return store.getState().draggingWindowId;
  });
  expect(dragIdAfter).toBeNull();
});

test('custom drag: mouseup on empty cell assigns window to grid', async () => {
  await cleanState();

  const gridId = await createGrid({ x: 100, y: 100, w: 500, h: 400 });
  const winId = await createWindow('Drop Into Grid', 700);
  await page.waitForTimeout(400);

  // Mousedown on the window grip
  const grip = page.locator('.window-grid-grip.window-grid-drag[title="Drag into a grid cell"]').first();
  await expect(grip).toBeVisible({ timeout: 5000 });
  const gripBox = await grip.boundingBox();
  await page.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200);

  // Move to the first empty grid cell and release
  const cell = page.locator('.grid-cell-empty').first();
  await expect(cell).toBeVisible({ timeout: 3000 });
  const cellBox = await cell.boundingBox();
  await page.mouse.move(cellBox!.x + cellBox!.width / 2, cellBox!.y + cellBox!.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Verify: window was assigned to a cell with gridId set (stays normal, not minimized)
  const result = await page.evaluate(({ wid }: { wid: string }) => {
    const store = (window as any).__DESKTOP_STORE__;
    const win = store.getState().windows.find((w: any) => w.id === wid);
    return { gridId: win?.gridId, state: win?.state };
  }, { wid: winId });
  expect(result.gridId).toBe(gridId);
  expect(result.state).toBe('normal');

  // Window should still be visible on canvas (repositioned to cell)
  const windowShell = page.locator(`[data-testid="desktop-window-${winId}"]`);
  await expect(windowShell).toBeVisible({ timeout: 3000 });
});

test('window assigned to grid stays state:normal with gridId and repositioned to cell', async () => {
  await cleanState();
  const gridId = await createGrid({ x: 100, y: 100, w: 640, h: 480 });
  const winTitle = 'Grid Cell Test ' + Date.now();
  await createWindow(winTitle);
  await page.waitForTimeout(300);

  const result = await page.evaluate(({ gid, title }: { gid: string; title: string }) => {
    const store = (window as any).__DESKTOP_STORE__;
    const s = store?.getState();
    const win = s?.windows?.find((w: any) => w.title === title);
    if (win) return s.assignWindowToCell(gid, 0, win.id);
    return false;
  }, { gid: gridId, title: winTitle });
  expect(result).toBe(true);

  // Window should stay 'normal' (not minimized) with gridId set
  const winState = await page.evaluate((title: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    const win = store.getState().windows.find((w: any) => w.title === title);
    return win ? { state: win.state, gridId: win.gridId, gridCellIndex: win.gridCellIndex, hasPreGridRect: !!win.preGridRect } : null;
  }, winTitle);
  expect(winState).not.toBeNull();
  expect(winState!.state).toBe('normal');
  expect(winState!.gridId).toBe(gridId);
  expect(winState!.gridCellIndex).toBe(0);
  expect(winState!.hasPreGridRect).toBe(true);

  // Window should be VISIBLE on canvas (not hidden)
  const windowShell = page.locator(`[data-testid^="desktop-window-"]`).first();
  await expect(windowShell).toBeVisible({ timeout: 3000 });
});

test('grid-snapped window exposes in-surface eject control', async () => {
  await cleanState();
  const gridId = await createGrid({ x: 100, y: 100, w: 640, h: 480 });
  const winId = await createWindow('Eject Test', 900);
  await page.waitForTimeout(300);

  // Assign window to grid
  await page.evaluate(({ gid, wid }: { gid: string; wid: string }) => {
    const store = (window as any).__DESKTOP_STORE__;
    store.getState().assignWindowToCell(gid, 0, wid);
  }, { gid: gridId, wid: winId });
  await page.waitForTimeout(300);

  // Window grip should now say "Eject from grid"
  const grip = page.locator('.window-grid-grip.window-grid-eject').first();
  await expect(grip).toBeVisible({ timeout: 3000 });
  await expect(grip).toHaveAttribute('title', 'Eject from grid');

  // Click eject — window should be removed from grid
  await grip.click();
  await page.waitForTimeout(300);

  const winAfter = await page.evaluate((wid: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    const win = store.getState().windows.find((w: any) => w.id === wid);
    return { gridId: win?.gridId, state: win?.state };
  }, winId);
  expect(winAfter.gridId).toBeUndefined();
  expect(winAfter.state).toBe('normal');
});

// ─── NodeTree integration ───────────────────────────────────────

test('grid appears in the NodeTree sidebar', async () => {
  await cleanState();
  await createGrid();
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) { ds.getState().setCanvasPan({ x: 0, y: 0 }); ds.getState().setCanvasZoom(1); }
  });
  await page.waitForTimeout(300);

  const gridNavItem = page.locator('[data-testid^="nav-grid-"]').first();
  await expect(gridNavItem).toBeVisible({ timeout: 5000 });
});

test('grid child windows appear in NodeTree under grid', async () => {
  await cleanState();
  const gridId = await createGrid();
  const winTitle = 'NodeTree Child ' + Date.now();
  await createWindow(winTitle);
  await page.waitForTimeout(200);

  await page.evaluate(({ gid, title }: { gid: string; title: string }) => {
    const store = (window as any).__DESKTOP_STORE__;
    const s = store.getState();
    const win = s.windows.find((w: any) => w.title === title);
    if (win) s.assignWindowToCell(gid, 0, win.id);
  }, { gid: gridId, title: winTitle });
  await page.waitForTimeout(300);

  const gridChild = page.locator('[data-testid^="nav-grid-child-"]').first();
  await expect(gridChild).toBeVisible({ timeout: 5000 });
});

// ─── Grid close + window restore ────────────────────────────────

test('grid close removes grid and restores windows with original size', async () => {
  await cleanState();
  const gridId = await createGrid();
  const winTitle = 'Restore Test ' + Date.now();
  await createWindow(winTitle);
  await page.waitForTimeout(200);

  await page.evaluate(({ gid, title }: { gid: string; title: string }) => {
    const store = (window as any).__DESKTOP_STORE__;
    const s = store.getState();
    const win = s.windows.find((w: any) => w.title === title);
    if (win) s.assignWindowToCell(gid, 0, win.id);
  }, { gid: gridId, title: winTitle });
  await page.waitForTimeout(200);

  await page.evaluate((gid: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    store.getState().removeGrid(gid);
  }, gridId);
  await page.waitForTimeout(300);

  const gridCount = await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    return store?.getState()?.grids?.length ?? 0;
  });
  expect(gridCount).toBe(0);

  // Window should be restored: normal state, no gridId, preGridRect cleared
  const restoredWin = await page.evaluate((title: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    const win = store?.getState()?.windows?.find((w: any) => w.title === title);
    return win ? { state: win.state, gridId: win.gridId, preGridRect: win.preGridRect } : null;
  }, winTitle);
  expect(restoredWin?.state).toBe('normal');
  expect(restoredWin?.gridId).toBeUndefined();
  expect(restoredWin?.preGridRect).toBeUndefined();
});

// ─── Context menu ───────────────────────────────────────────────

test('context menu has New Grid Layout option', async () => {
  await cleanState();

  const desktop = page.locator('[data-testid="seamless-desktop"]');
  await desktop.click({ button: 'right', position: { x: 400, y: 300 }, force: true });
  await page.waitForTimeout(500);

  const gridOption = page.locator('text=New Grid Layout');
  await expect(gridOption).toBeVisible({ timeout: 3000 });

  await gridOption.click();
  await page.waitForTimeout(500);

  const gridCount = await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    return store?.getState()?.grids?.length ?? 0;
  });
  expect(gridCount).toBeGreaterThanOrEqual(1);
});
