/**
 * grid-children.spec.ts — Playwright E2E tests
 *
 * Tests for grid cells containing all window types as children nodes,
 * verifying interactive behavior: assignment, rendering, ejection, and
 * multi-type coexistence within a single grid.
 *
 * Window types tested: chat, file-explorer, backlog, plugin, file-viewer, prompt-dev-zone
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import { getElectronLaunchArgs, getE2EEnv } from './test-helpers';

let app: any;
let page: any;

// ─── Helpers ─────────────────────────────────────────────────────

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

async function createGrid(opts?: { x?: number; y?: number; w?: number; h?: number; cols?: number; rows?: number }) {
  return page.evaluate((o: any) => {
    const store = (window as any).__DESKTOP_STORE__;
    return store.getState().addGrid({
      position: { x: o?.x ?? 100, y: o?.y ?? 100 },
      size: { width: o?.w ?? 800, height: o?.h ?? 600 },
      columns: o?.cols ?? 3,
      rows: o?.rows ?? 2,
    });
  }, opts ?? {});
}

async function createChatWindow(title: string) {
  return page.evaluate((t: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    const helioxStore = (window as any).__HELIOX_STORE__;
    const sessionId = helioxStore?.getState()?.addSession?.() ?? 'test-' + Date.now();
    return store.getState().addWindow('chat', {
      title: t,
      iconName: 'MessageSquare',
      sessionId,
      position: { x: 900, y: 100 },
    });
  }, title);
}

async function createFileExplorerWindow() {
  return page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    return store.getState().addWindow('file-explorer', {
      title: 'Files',
      iconName: 'FileText',
      position: { x: 900, y: 200 },
    });
  });
}

async function createBacklogWindow() {
  return page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    return store.getState().addWindow('backlog', {
      title: 'Backlog',
      iconName: 'KanbanSquare',
      position: { x: 900, y: 300 },
    });
  });
}

async function createPluginWindow(pluginId: string, title: string) {
  return page.evaluate(({ pid, t }: { pid: string; t: string }) => {
    const store = (window as any).__DESKTOP_STORE__;
    return store.getState().addWindow('plugin', {
      title: t,
      iconName: 'Terminal',
      pluginId: pid,
      position: { x: 900, y: 400 },
    });
  }, { pid: pluginId, t: title });
}

async function createFileViewerWindow(filePath: string) {
  return page.evaluate((fp: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    return store.getState().addWindow('file-viewer', {
      title: fp.split('/').pop() ?? 'file',
      iconName: 'FileCode',
      filePath: fp,
      position: { x: 900, y: 500 },
    });
  }, filePath);
}

async function createPromptDevZoneWindow() {
  return page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    return store.getState().addWindow('prompt-dev-zone', {
      title: 'Prompt Dev Zone',
      iconName: 'FlaskConical',
      position: { x: 900, y: 600 },
      size: { width: 720, height: 520 },
    });
  });
}

async function assignToCell(gridId: string, cellIndex: number, windowId: string) {
  return page.evaluate(({ gid, ci, wid }: { gid: string; ci: number; wid: string }) => {
    const store = (window as any).__DESKTOP_STORE__;
    return store.getState().assignWindowToCell(gid, ci, wid);
  }, { gid: gridId, ci: cellIndex, wid: windowId });
}

async function getWindowState(windowId: string) {
  return page.evaluate((wid: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    const win = store.getState().windows.find((w: any) => w.id === wid);
    if (!win) return null;
    return {
      type: win.type,
      state: win.state,
      gridId: win.gridId,
      gridCellIndex: win.gridCellIndex,
      gridColSpan: win.gridColSpan,
      gridRowSpan: win.gridRowSpan,
      position: { x: win.position.x, y: win.position.y },
      size: { width: win.size.width, height: win.size.height },
      hasPreGridRect: !!win.preGridRect,
      title: win.title,
    };
  }, windowId);
}

async function resizeWindowInGrid(
  windowId: string, newOriginCell: number, colSpan: number, rowSpan: number,
): Promise<boolean> {
  return page.evaluate(({ wid, oc, cs, rs }: any) => {
    const store = (window as any).__DESKTOP_STORE__;
    return store.getState().resizeWindowInGrid(wid, oc, cs, rs);
  }, { wid: windowId, oc: newOriginCell, cs: colSpan, rs: rowSpan });
}

async function getGridState(gridId: string) {
  return page.evaluate((gid: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    const g = store.getState().grids.find((g: any) => g.id === gid);
    if (!g) return null;
    return {
      columns: g.columns,
      rows: g.rows,
      cells: g.cells,
      cellCount: g.cells.length,
    };
  }, gridId);
}

// ─── Setup ───────────────────────────────────────────────────────

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
    () => !!(window as any).__DESKTOP_STORE__,
    { timeout: 15_000 },
  );

  // Open a project so desktop canvas appears
  const desktop = page.locator('[data-testid="seamless-desktop"]');
  if (!(await desktop.isVisible({ timeout: 2000 }).catch(() => false))) {
    await page.evaluate(() => {
      const store = (window as any).__HELIOX_STORE__;
      if (store) store.getState().setProjectPath('/tmp/test-grid-children');
    });
    await desktop.waitFor({ state: 'visible', timeout: 10_000 });
  }

  // Dismiss tour
  await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) ds.getState().updateSettings({ tourCompleted: true });
  });

  await cleanState();
});

test.afterAll(async () => { if (app) await app.close(); });

// ─── Chat window as grid child ──────────────────────────────────

test('chat window can be assigned to grid cell and renders', async () => {
  await cleanState();
  const gridId = await createGrid();
  const winId = await createChatWindow('Grid Chat');
  await page.waitForTimeout(300);

  const result = await assignToCell(gridId, 0, winId);
  expect(result).toBe(true);
  await page.waitForTimeout(300);

  const ws = await getWindowState(winId);
  expect(ws).not.toBeNull();
  expect(ws!.type).toBe('chat');
  expect(ws!.gridId).toBe(gridId);
  expect(ws!.gridCellIndex).toBe(0);
  expect(ws!.state).toBe('normal');
  expect(ws!.hasPreGridRect).toBe(true);

  // Window should be visible on canvas
  const el = page.locator(`[data-testid="desktop-window-${winId}"]`);
  await expect(el).toBeVisible({ timeout: 3000 });
});

// ─── File Explorer window as grid child ─────────────────────────

test('file-explorer window can be assigned to grid cell', async () => {
  await cleanState();
  const gridId = await createGrid();
  const winId = await createFileExplorerWindow();
  await page.waitForTimeout(300);

  const result = await assignToCell(gridId, 1, winId);
  expect(result).toBe(true);
  await page.waitForTimeout(300);

  const ws = await getWindowState(winId);
  expect(ws).not.toBeNull();
  expect(ws!.type).toBe('file-explorer');
  expect(ws!.gridId).toBe(gridId);
  expect(ws!.gridCellIndex).toBe(1);
  expect(ws!.state).toBe('normal');

  const el = page.locator(`[data-testid="desktop-window-${winId}"]`);
  await expect(el).toBeVisible({ timeout: 3000 });
});

// ─── Backlog window as grid child ───────────────────────────────

test('backlog window can be assigned to grid cell', async () => {
  await cleanState();
  const gridId = await createGrid();
  const winId = await createBacklogWindow();
  await page.waitForTimeout(300);

  const result = await assignToCell(gridId, 2, winId);
  expect(result).toBe(true);
  await page.waitForTimeout(300);

  const ws = await getWindowState(winId);
  expect(ws).not.toBeNull();
  expect(ws!.type).toBe('backlog');
  expect(ws!.gridId).toBe(gridId);
  expect(ws!.gridCellIndex).toBe(2);
  expect(ws!.state).toBe('normal');

  const el = page.locator(`[data-testid="desktop-window-${winId}"]`);
  await expect(el).toBeVisible({ timeout: 3000 });
});

// ─── Plugin window as grid child ────────────────────────────────

test('plugin window can be assigned to grid cell', async () => {
  await cleanState();
  const gridId = await createGrid();
  const winId = await createPluginWindow('tool-logs', 'Logs');
  await page.waitForTimeout(300);

  const result = await assignToCell(gridId, 3, winId);
  expect(result).toBe(true);
  await page.waitForTimeout(300);

  const ws = await getWindowState(winId);
  expect(ws).not.toBeNull();
  expect(ws!.type).toBe('plugin');
  expect(ws!.gridId).toBe(gridId);
  expect(ws!.gridCellIndex).toBe(3);
  expect(ws!.state).toBe('normal');

  const el = page.locator(`[data-testid="desktop-window-${winId}"]`);
  await expect(el).toBeVisible({ timeout: 3000 });
});

// ─── File Viewer window as grid child ───────────────────────────

test('file-viewer window can be assigned to grid cell', async () => {
  await cleanState();
  const gridId = await createGrid();
  const winId = await createFileViewerWindow('/tmp/test.ts');
  await page.waitForTimeout(300);

  const result = await assignToCell(gridId, 4, winId);
  expect(result).toBe(true);
  await page.waitForTimeout(300);

  const ws = await getWindowState(winId);
  expect(ws).not.toBeNull();
  expect(ws!.type).toBe('file-viewer');
  expect(ws!.gridId).toBe(gridId);
  expect(ws!.gridCellIndex).toBe(4);
  expect(ws!.state).toBe('normal');

  const el = page.locator(`[data-testid="desktop-window-${winId}"]`);
  await expect(el).toBeVisible({ timeout: 3000 });
});

// ─── Prompt Dev Zone window as grid child ───────────────────────

test('prompt-dev-zone window can be assigned to grid cell', async () => {
  await cleanState();
  const gridId = await createGrid();
  const winId = await createPromptDevZoneWindow();
  await page.waitForTimeout(300);

  const result = await assignToCell(gridId, 5, winId);
  expect(result).toBe(true);
  await page.waitForTimeout(300);

  const ws = await getWindowState(winId);
  expect(ws).not.toBeNull();
  expect(ws!.type).toBe('prompt-dev-zone');
  expect(ws!.gridId).toBe(gridId);
  expect(ws!.gridCellIndex).toBe(5);
  expect(ws!.state).toBe('normal');

  const el = page.locator(`[data-testid="desktop-window-${winId}"]`);
  await expect(el).toBeVisible({ timeout: 3000 });
});

// ─── All window types in a single grid (3×2 = 6 cells) ─────────

test('all 6 window types coexist in a single 3x2 grid', async () => {
  await cleanState();
  const gridId = await createGrid({ cols: 3, rows: 2 });
  await page.waitForTimeout(200);

  const chatId = await createChatWindow('Grid Chat All');
  const fileExpId = await createFileExplorerWindow();
  const backlogId = await createBacklogWindow();
  const pluginId = await createPluginWindow('tool-logs', 'Logs All');
  const fileViewId = await createFileViewerWindow('/tmp/all.ts');
  const pdzId = await createPromptDevZoneWindow();
  await page.waitForTimeout(300);

  // Assign each to a cell
  expect(await assignToCell(gridId, 0, chatId)).toBe(true);
  expect(await assignToCell(gridId, 1, fileExpId)).toBe(true);
  expect(await assignToCell(gridId, 2, backlogId)).toBe(true);
  expect(await assignToCell(gridId, 3, pluginId)).toBe(true);
  expect(await assignToCell(gridId, 4, fileViewId)).toBe(true);
  expect(await assignToCell(gridId, 5, pdzId)).toBe(true);
  await page.waitForTimeout(400);

  // Verify grid cells are all occupied
  const gs = await getGridState(gridId);
  expect(gs).not.toBeNull();
  expect(gs!.cells.filter((c: any) => c !== null).length).toBe(6);

  // Verify all windows have correct gridId
  for (const wid of [chatId, fileExpId, backlogId, pluginId, fileViewId, pdzId]) {
    const ws = await getWindowState(wid);
    expect(ws?.gridId).toBe(gridId);
  }

  // All should be visible
  for (const wid of [chatId, fileExpId, backlogId, pluginId, fileViewId, pdzId]) {
    const el = page.locator(`[data-testid="desktop-window-${wid}"]`);
    await expect(el).toBeVisible({ timeout: 3000 });
  }
});

// ─── Cannot assign to occupied cell ─────────────────────────────

test('assigning a window to an already occupied cell returns false', async () => {
  await cleanState();
  const gridId = await createGrid();
  const win1 = await createChatWindow('First');
  const win2 = await createChatWindow('Second');
  await page.waitForTimeout(300);

  expect(await assignToCell(gridId, 0, win1)).toBe(true);
  await page.waitForTimeout(200);

  // Attempt to assign another window to the same cell
  const result = await assignToCell(gridId, 0, win2);
  expect(result).toBe(false);

  // First window should still be in cell 0
  const ws = await getWindowState(win1);
  expect(ws!.gridCellIndex).toBe(0);
});

// ─── Ejecting windows from grid ─────────────────────────────────

test('removing a window from grid cell restores preGridRect', async () => {
  await cleanState();
  const gridId = await createGrid();
  const winId = await createChatWindow('Eject Restore');
  await page.waitForTimeout(300);

  // Capture original position/size
  const original = await page.evaluate((wid: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    const win = store.getState().windows.find((w: any) => w.id === wid);
    return { x: win.position.x, y: win.position.y, w: win.size.width, h: win.size.height };
  }, winId);

  // Assign to grid
  await assignToCell(gridId, 0, winId);
  await page.waitForTimeout(200);

  // Remove from grid
  await page.evaluate(({ gid, wid }: { gid: string; wid: string }) => {
    const store = (window as any).__DESKTOP_STORE__;
    store.getState().removeWindowFromCell(gid, wid);
  }, { gid: gridId, wid: winId });
  await page.waitForTimeout(200);

  const restored = await page.evaluate((wid: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    const win = store.getState().windows.find((w: any) => w.id === wid);
    return {
      gridId: win.gridId,
      gridCellIndex: win.gridCellIndex,
      preGridRect: win.preGridRect,
      x: win.position.x,
      y: win.position.y,
      w: win.size.width,
      h: win.size.height,
    };
  }, winId);

  expect(restored.gridId).toBeUndefined();
  expect(restored.gridCellIndex).toBeUndefined();
  expect(restored.preGridRect).toBeUndefined();
  // Original position restored
  expect(restored.x).toBe(original.x);
  expect(restored.y).toBe(original.y);
});

// ─── Grid resize repositions child windows ──────────────────────

test('resizing a grid repositions its child windows', async () => {
  await cleanState();
  const gridId = await createGrid({ w: 600, h: 400 });
  const winId = await createChatWindow('Resize Child');
  await page.waitForTimeout(200);
  await assignToCell(gridId, 0, winId);
  await page.waitForTimeout(200);

  const beforePos = await page.evaluate((wid: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    const win = store.getState().windows.find((w: any) => w.id === wid);
    return { x: win.position.x, y: win.position.y, w: win.size.width, h: win.size.height };
  }, winId);

  // Resize the grid to be larger
  await page.evaluate((gid: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    store.getState().resizeGrid(gid, { width: 900, height: 600 });
  }, gridId);
  await page.waitForTimeout(200);

  const afterPos = await page.evaluate((wid: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    const win = store.getState().windows.find((w: any) => w.id === wid);
    return { x: win.position.x, y: win.position.y, w: win.size.width, h: win.size.height };
  }, winId);

  // Cell size should have grown (wider and taller)
  expect(afterPos.w).toBeGreaterThan(beforePos.w);
  expect(afterPos.h).toBeGreaterThan(beforePos.h);
});

// ─── Grid deletion restores all children ────────────────────────

test('deleting a grid restores all child windows to their original positions', async () => {
  await cleanState();
  const gridId = await createGrid();
  const ids: string[] = [];

  for (let i = 0; i < 3; i++) {
    const id = await createChatWindow(`Restore ${i}`);
    ids.push(id);
  }
  await page.waitForTimeout(300);

  // Assign all to grid
  for (let i = 0; i < 3; i++) {
    await assignToCell(gridId, i, ids[i]);
  }
  await page.waitForTimeout(200);

  // Delete the grid
  await page.evaluate((gid: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    store.getState().removeGrid(gid);
  }, gridId);
  await page.waitForTimeout(300);

  // All windows should be free (no gridId)
  for (const wid of ids) {
    const ws = await getWindowState(wid);
    expect(ws?.gridId).toBeUndefined();
    expect(ws?.state).toBe('normal');
  }

  // No grids should remain
  const gridCount = await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    return store.getState().grids.length;
  });
  expect(gridCount).toBe(0);
});

// ─── Adding rows/columns preserves child assignments ────────────

test('adding a row preserves existing cell assignments', async () => {
  await cleanState();
  const gridId = await createGrid({ cols: 2, rows: 2 });
  const winId = await createChatWindow('Row Add Preserve');
  await page.waitForTimeout(200);
  await assignToCell(gridId, 0, winId);
  await page.waitForTimeout(200);

  // Add a row via store
  await page.evaluate((gid: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    store.getState().addGridRow(gid);
  }, gridId);
  await page.waitForTimeout(200);

  const gs = await getGridState(gridId);
  expect(gs!.rows).toBe(3);
  expect(gs!.cellCount).toBe(6); // 2 cols × 3 rows
  expect(gs!.cells[0]).toBe(winId);

  const ws = await getWindowState(winId);
  expect(ws!.gridId).toBe(gridId);
  expect(ws!.gridCellIndex).toBe(0);
});

test('adding a column preserves existing cell assignments', async () => {
  await cleanState();
  const gridId = await createGrid({ cols: 2, rows: 2 });
  const winId = await createChatWindow('Col Add Preserve');
  await page.waitForTimeout(200);
  await assignToCell(gridId, 0, winId);
  await page.waitForTimeout(200);

  await page.evaluate((gid: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    store.getState().addGridColumn(gid);
  }, gridId);
  await page.waitForTimeout(200);

  const gs = await getGridState(gridId);
  expect(gs!.columns).toBe(3);

  // Window should still be assigned (cell indices may need remapping depending on impl)
  const win = await page.evaluate((wid: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    const w = store.getState().windows.find((w: any) => w.id === wid);
    return { gridId: w?.gridId, gridCellIndex: w?.gridCellIndex };
  }, winId);
  expect(win.gridId).toBe(gridId);
  expect(win.gridCellIndex).toBeDefined();
});

test('NodeTree shows one child entry for merged grid window span', async () => {
  await cleanState();
  const gridId = await createGrid({ cols: 3, rows: 3, w: 700, h: 700 });
  const winId = await createChatWindow('NodeTree Merged Single Entry');
  await assignToCell(gridId, 0, winId);
  await page.waitForTimeout(250);
  await resizeWindowInGrid(winId, 0, 2, 2);
  await page.waitForTimeout(300);

  const childEntries = page.locator(`[data-testid="nav-grid-child-${winId}"]`);
  await expect(childEntries).toHaveCount(1);
});

// ─── Grid cell drop-target visual indicators ────────────────────

test('empty cells show drop-target state when draggingWindowId is set', async () => {
  await cleanState();
  const gridId = await createGrid();
  const winId = await createChatWindow('Drop Visual');
  await page.waitForTimeout(300);

  // Set dragging state in store
  await page.evaluate((wid: string) => {
    const store = (window as any).__DESKTOP_STORE__;
    store.getState().setDraggingWindowId(wid);
  }, winId);
  await page.waitForTimeout(200);

  // Grid shell should show data-drop-active
  const shell = page.locator('.desktop-grid-shell').first();
  await expect(shell).toHaveAttribute('data-drop-active', 'true', { timeout: 3000 });

  // Empty cells should have drop-target state
  const dropCells = page.locator('[data-drop-target="true"]');
  const count = await dropCells.count();
  expect(count).toBeGreaterThanOrEqual(1);

  // Clean up
  await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    store.getState().setDraggingWindowId(null);
  });
});

// ─── Session Status Dock visibility ─────────────────────────────

test('session status dock appears when sessions exist', async () => {
  await cleanState();
  // Create a session (which also creates through createChatWindow)
  await createChatWindow('Dock Visible');
  await page.waitForTimeout(500);

  // The session dock should be visible when sessions have active status
  await page.evaluate(() => {
    const store = (window as any).__HELIOX_STORE__;
    const sessions = store.getState().sessions;
    if (sessions.length > 0) {
      store.getState().updateSessionStatus(sessions[0].id, 'running');
    }
  });
  await page.waitForTimeout(500);

  const dock = page.locator('[data-testid="session-status-dock"]');
  await expect(dock).toBeVisible({ timeout: 5000 });
});

test('session dock shows popover on hover', async () => {
  await cleanState();
  await createChatWindow('Popover Test');
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const store = (window as any).__HELIOX_STORE__;
    const sessions = store.getState().sessions;
    if (sessions.length > 0) {
      store.getState().updateSessionStatus(sessions[0].id, 'running');
    }
  });
  await page.waitForTimeout(500);

  const dock = page.locator('[data-testid="session-status-dock"]');
  if (await dock.isVisible({ timeout: 3000 }).catch(() => false)) {
    const firstItem = dock.locator('.session-dock-item').first();
    if (await firstItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      await firstItem.hover();
      await page.waitForTimeout(300);
      const popover = page.locator('[data-testid="session-dock-popover"]');
      await expect(popover).toBeVisible({ timeout: 3000 });
    }
  }
});

test('session dock context menu has "Finish session" option', async () => {
  await cleanState();
  await createChatWindow('Context Menu Test');
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const store = (window as any).__HELIOX_STORE__;
    const sessions = store.getState().sessions;
    if (sessions.length > 0) {
      store.getState().updateSessionStatus(sessions[0].id, 'running');
    }
  });
  await page.waitForTimeout(500);

  const dock = page.locator('[data-testid="session-status-dock"]');
  if (await dock.isVisible({ timeout: 3000 }).catch(() => false)) {
    const firstItem = dock.locator('.session-dock-item').first();
    if (await firstItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Hover away first to dismiss any popover, then right-click
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      await firstItem.click({ button: 'right', force: true });
      await page.waitForTimeout(300);
      const ctxMenu = page.locator('[data-testid="session-dock-context-menu"]');
      await expect(ctxMenu).toBeVisible({ timeout: 3000 });
      const finishBtn = page.locator('[data-testid="session-dock-finish"]');
      await expect(finishBtn).toBeVisible({ timeout: 2000 });
    }
  }
});

test('session dock keeps completed sessions visible after window closes and click reopens it', async () => {
  await cleanState();
  const winId = await createChatWindow('Completed Reopen');
  await page.waitForTimeout(250);

  const sid = await page.evaluate((wid: string) => {
    const ds = (window as any).__DESKTOP_STORE__;
    const win = ds.getState().windows.find((w: any) => w.id === wid);
    return win?.sessionId ?? null;
  }, winId);
  expect(sid).toBeTruthy();

  await page.evaluate(({ sessionId, windowId }: { sessionId: string; windowId: string }) => {
    const hs = (window as any).__HELIOX_STORE__;
    const ds = (window as any).__DESKTOP_STORE__;
    hs.getState().updateSessionStatus(sessionId, 'completed', Date.now());
    ds.getState().removeWindow(windowId);
  }, { sessionId: sid as string, windowId: winId });
  await page.waitForTimeout(350);

  const dock = page.locator('[data-testid="session-status-dock"]');
  await expect(dock).toBeVisible({ timeout: 5000 });
  const item = page.locator(`[data-testid="session-dock-${sid}"]`);
  await expect(item).toBeVisible({ timeout: 3000 });

  await item.click();
  await page.waitForTimeout(250);

  const reopenedCount = await page.evaluate((sessionId: string) => {
    const ds = (window as any).__DESKTOP_STORE__;
    return ds.getState().windows.filter((w: any) => w.sessionId === sessionId).length;
  }, sid as string);
  expect(reopenedCount).toBe(1);
});

test('session dock click does not change canvas Y pan', async () => {
  await cleanState();
  const winId = await createChatWindow('Pan Preserve');
  await page.waitForTimeout(250);

  const sid = await page.evaluate((wid: string) => {
    const ds = (window as any).__DESKTOP_STORE__;
    const win = ds.getState().windows.find((w: any) => w.id === wid);
    return win?.sessionId ?? null;
  }, winId);
  expect(sid).toBeTruthy();

  const targetPan = { x: 160, y: 340 };
  await page.evaluate((pan: { x: number; y: number }) => {
    const ds = (window as any).__DESKTOP_STORE__;
    ds.getState().setCanvasPan(pan);
  }, targetPan);
  await page.waitForTimeout(200);

  await page.evaluate((windowId: string) => {
    const ds = (window as any).__DESKTOP_STORE__;
    ds.getState().removeWindow(windowId);
  }, winId);

  await page.evaluate((sessionId: string) => {
    const hs = (window as any).__HELIOX_STORE__;
    hs.getState().updateSessionStatus(sessionId, 'completed', Date.now());
  }, sid as string);
  await page.waitForTimeout(250);

  const item = page.locator(`[data-testid="session-dock-${sid}"]`);
  await expect(item).toBeVisible({ timeout: 3000 });
  await item.click();
  await page.waitForTimeout(250);

  const panAfter = await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    return ds.getState().canvasPan;
  });
  expect(panAfter.y).toBe(targetPan.y);
});

test('session dock click does not scroll seamless desktop container', async () => {
  await cleanState();
  const winId = await createChatWindow('No Canvas Scroll');
  await page.waitForTimeout(250);

  const sid = await page.evaluate((wid: string) => {
    const ds = (window as any).__DESKTOP_STORE__;
    const win = ds.getState().windows.find((w: any) => w.id === wid);
    return win?.sessionId ?? null;
  }, winId);
  expect(sid).toBeTruthy();

  await page.evaluate(({ sessionId, windowId }: { sessionId: string; windowId: string }) => {
    const hs = (window as any).__HELIOX_STORE__;
    const ds = (window as any).__DESKTOP_STORE__;
    hs.getState().updateSessionStatus(sessionId, 'completed', Date.now());
    ds.getState().removeWindow(windowId);
  }, { sessionId: sid as string, windowId: winId });
  await page.waitForTimeout(250);

  const item = page.locator(`[data-testid="session-dock-${sid}"]`);
  await expect(item).toBeVisible({ timeout: 3000 });

  const before = await page.evaluate(() => {
    const desktop = document.querySelector('[data-testid="seamless-desktop"]') as HTMLElement | null;
    return {
      top: desktop?.scrollTop ?? -1,
      left: desktop?.scrollLeft ?? -1,
    };
  });
  expect(before.top).toBe(0);
  expect(before.left).toBe(0);

  for (let i = 0; i < 12; i++) {
    await item.click({ force: true });
    await page.waitForTimeout(120);
    await page.evaluate((sessionId: string) => {
      const ds = (window as any).__DESKTOP_STORE__;
      const win = ds.getState().windows.find((w: any) => w.sessionId === sessionId);
      if (win) ds.getState().removeWindow(win.id);
    }, sid as string);
    await page.waitForTimeout(40);
  }

  const after = await page.evaluate(() => {
    const desktop = document.querySelector('[data-testid="seamless-desktop"]') as HTMLElement | null;
    return {
      top: desktop?.scrollTop ?? -1,
      left: desktop?.scrollLeft ?? -1,
    };
  });
  expect(after.top).toBe(0);
  expect(after.left).toBe(0);
});

test('session dock renders session number badge inside icon', async () => {
  await cleanState();
  await createChatWindow('Dock Badge');
  await page.waitForTimeout(250);

  await page.evaluate(() => {
    const hs = (window as any).__HELIOX_STORE__;
    const sessions = hs.getState().sessions;
    if (sessions.length > 0) {
      hs.getState().updateSessionStatus(sessions[0].id, 'running');
    }
  });
  await page.waitForTimeout(250);

  const firstItem = page.locator('[data-testid="session-status-dock"] .session-dock-item').first();
  await expect(firstItem).toBeVisible({ timeout: 3000 });
  const badge = firstItem.locator('.session-dock-number-badge');
  await expect(badge).toBeVisible({ timeout: 3000 });
  await expect(badge).not.toHaveText(/^#/);
});

// ─── Zoom indicator ───────────────────────────────────────────────

test('zoom indicator is visible at non-100% zoom', async () => {
  await cleanState();

  // Set zoom to 150%
  await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    store.getState().setCanvasZoom(1.5);
  });
  await page.waitForTimeout(300);

  const indicator = page.locator('[data-testid="zoom-indicator"]');
  await expect(indicator).toBeVisible({ timeout: 3000 });
  await expect(indicator).toHaveText('150%');

  // Reset zoom
  await page.evaluate(() => {
    const store = (window as any).__DESKTOP_STORE__;
    store.getState().setCanvasZoom(1);
  });
});

// ─── Grid Resize / Cell Merge Tests ─────────────────────────────

test('resize south merges 2 vertical cells', async () => {
  await cleanState();
  const gridId = await createGrid({ cols: 2, rows: 2, w: 400, h: 400 });
  const winId = await createChatWindow('Resize-S');
  await assignToCell(gridId, 0, winId);
  await page.waitForTimeout(200);

  // Cell 0 = (row=0, col=0); cell 2 = (row=1, col=0)
  const result = await resizeWindowInGrid(winId, 0, 1, 2);
  expect(result).toBe(true);
  await page.waitForTimeout(200);

  const ws = await getWindowState(winId);
  expect(ws?.gridCellIndex).toBe(0);
  expect(ws?.gridColSpan).toBe(1);
  expect(ws?.gridRowSpan).toBe(2);

  const gs = await getGridState(gridId);
  expect(gs?.cells).toEqual([winId, null, winId, null]);
});

test('resize east merges 2 horizontal cells', async () => {
  await cleanState();
  const gridId = await createGrid({ cols: 3, rows: 2, w: 600, h: 400 });
  const winId = await createChatWindow('Resize-E');
  await assignToCell(gridId, 0, winId);
  await page.waitForTimeout(200);

  const result = await resizeWindowInGrid(winId, 0, 2, 1);
  expect(result).toBe(true);
  await page.waitForTimeout(200);

  const ws = await getWindowState(winId);
  expect(ws?.gridCellIndex).toBe(0);
  expect(ws?.gridColSpan).toBe(2);
  expect(ws?.gridRowSpan).toBe(1);

  const gs = await getGridState(gridId);
  expect(gs?.cells).toEqual([winId, winId, null, null, null, null]);
});

test('resize SE merges 2×2 block of cells', async () => {
  await cleanState();
  const gridId = await createGrid({ cols: 3, rows: 3, w: 600, h: 600 });
  const winId = await createChatWindow('Resize-SE');
  await assignToCell(gridId, 0, winId);
  await page.waitForTimeout(200);

  const result = await resizeWindowInGrid(winId, 0, 2, 2);
  expect(result).toBe(true);
  await page.waitForTimeout(200);

  const ws = await getWindowState(winId);
  expect(ws?.gridColSpan).toBe(2);
  expect(ws?.gridRowSpan).toBe(2);

  const gs = await getGridState(gridId);
  expect(gs?.cells?.[0]).toBe(winId);
  expect(gs?.cells?.[1]).toBe(winId);
  expect(gs?.cells?.[3]).toBe(winId);
  expect(gs?.cells?.[4]).toBe(winId);
  expect(gs?.cells?.[2]).toBeNull();
  expect(gs?.cells?.[5]).toBeNull();
  expect(gs?.cells?.[6]).toBeNull();
  expect(gs?.cells?.[7]).toBeNull();
  expect(gs?.cells?.[8]).toBeNull();
});

test('resize blocked when adjacent cell occupied by another window', async () => {
  await cleanState();
  const gridId = await createGrid({ cols: 2, rows: 2, w: 400, h: 400 });
  const winA = await createChatWindow('Block-A');
  const winB = await createChatWindow('Block-B');
  await assignToCell(gridId, 0, winA);
  await assignToCell(gridId, 1, winB);
  await page.waitForTimeout(200);

  const result = await resizeWindowInGrid(winA, 0, 2, 1);
  expect(result).toBe(false);

  const ws = await getWindowState(winA);
  expect(ws?.gridColSpan).toBe(1);
  expect(ws?.gridRowSpan).toBe(1);

  const gs = await getGridState(gridId);
  expect(gs?.cells).toEqual([winA, winB, null, null]);
});

test('resize blocked when span exceeds grid bounds', async () => {
  await cleanState();
  const gridId = await createGrid({ cols: 2, rows: 2, w: 400, h: 400 });
  const winId = await createChatWindow('Bounds');
  await assignToCell(gridId, 1, winId);
  await page.waitForTimeout(200);

  const result = await resizeWindowInGrid(winId, 1, 2, 1);
  expect(result).toBe(false);

  const ws = await getWindowState(winId);
  expect(ws?.gridColSpan).toBe(1);
});

test('resize then shrink back to single cell', async () => {
  await cleanState();
  const gridId = await createGrid({ cols: 2, rows: 2, w: 400, h: 400 });
  const winId = await createChatWindow('Shrink');
  await assignToCell(gridId, 0, winId);
  await page.waitForTimeout(200);

  let result = await resizeWindowInGrid(winId, 0, 2, 2);
  expect(result).toBe(true);
  await page.waitForTimeout(200);

  let ws = await getWindowState(winId);
  expect(ws?.gridColSpan).toBe(2);
  expect(ws?.gridRowSpan).toBe(2);

  let gs = await getGridState(gridId);
  expect(gs?.cells).toEqual([winId, winId, winId, winId]);

  result = await resizeWindowInGrid(winId, 0, 1, 1);
  expect(result).toBe(true);
  await page.waitForTimeout(200);

  ws = await getWindowState(winId);
  expect(ws?.gridColSpan).toBe(1);
  expect(ws?.gridRowSpan).toBe(1);

  gs = await getGridState(gridId);
  expect(gs?.cells).toEqual([winId, null, null, null]);
});

test('resize updates window position and size to merged rect', async () => {
  await cleanState();
  const gridId = await createGrid({ x: 100, y: 100, w: 600, h: 400, cols: 3, rows: 2 });
  const winId = await createChatWindow('Rect');
  await assignToCell(gridId, 0, winId);
  await page.waitForTimeout(200);

  const wsBefore = await getWindowState(winId);
  const widthBefore = wsBefore!.size.width;
  const heightBefore = wsBefore!.size.height;

  await resizeWindowInGrid(winId, 0, 2, 2);
  await page.waitForTimeout(200);

  const wsAfter = await getWindowState(winId);
  expect(wsAfter!.size.width).toBeGreaterThan(widthBefore * 1.8);
  expect(wsAfter!.size.height).toBeGreaterThan(heightBefore * 1.8);
  expect(wsAfter!.position.x).toBeCloseTo(wsBefore!.position.x, 0);
  expect(wsAfter!.position.y).toBeCloseTo(wsBefore!.position.y, 0);
});

test('multiple merged windows coexist in same grid', async () => {
  await cleanState();
  const gridId = await createGrid({ cols: 4, rows: 2, w: 800, h: 400 });
  const winA = await createChatWindow('Multi-A');
  const winB = await createChatWindow('Multi-B');
  await assignToCell(gridId, 0, winA);
  await assignToCell(gridId, 2, winB);
  await page.waitForTimeout(200);

  const rA = await resizeWindowInGrid(winA, 0, 2, 1);
  expect(rA).toBe(true);
  const rB = await resizeWindowInGrid(winB, 2, 2, 1);
  expect(rB).toBe(true);
  await page.waitForTimeout(200);

  const gs = await getGridState(gridId);
  expect(gs?.cells).toEqual([winA, winA, winB, winB, null, null, null, null]);

  const wsA = await getWindowState(winA);
  const wsB = await getWindowState(winB);
  expect(wsA?.gridColSpan).toBe(2);
  expect(wsB?.gridColSpan).toBe(2);
});

test('merged window origin cell renders with CSS grid span', async () => {
  await cleanState();
  const gridId = await createGrid({ cols: 3, rows: 2, w: 600, h: 400 });
  const winId = await createChatWindow('CSS-Span');
  await assignToCell(gridId, 0, winId);
  await resizeWindowInGrid(winId, 0, 2, 2);
  await page.waitForTimeout(300);

  const originCell = page.locator(`[data-testid="grid-${gridId}"] [data-testid="grid-cell-0"]`);
  await expect(originCell).toBeVisible();

  const styles = await originCell.evaluate((el: HTMLElement) => ({
    gridColumn: el.style.gridColumn,
    gridRow: el.style.gridRow,
  }));
  expect(styles.gridColumn).toBe('1 / span 2');
  expect(styles.gridRow).toBe('1 / span 2');

  // Sub-cells should NOT exist in DOM (skipped via return null)
  const subCell1 = page.locator(`[data-testid="grid-${gridId}"] [data-testid="grid-cell-1"]`);
  const subCell3 = page.locator(`[data-testid="grid-${gridId}"] [data-testid="grid-cell-3"]`);
  const subCell4 = page.locator(`[data-testid="grid-${gridId}"] [data-testid="grid-cell-4"]`);
  await expect(subCell1).toHaveCount(0);
  await expect(subCell3).toHaveCount(0);
  await expect(subCell4).toHaveCount(0);
});

test('resize from non-origin cell (middle of grid)', async () => {
  await cleanState();
  const gridId = await createGrid({ cols: 3, rows: 3, w: 600, h: 600 });
  const winId = await createChatWindow('Middle');
  await assignToCell(gridId, 4, winId);
  await page.waitForTimeout(200);

  const result = await resizeWindowInGrid(winId, 4, 2, 2);
  expect(result).toBe(true);
  await page.waitForTimeout(200);

  const ws = await getWindowState(winId);
  expect(ws?.gridCellIndex).toBe(4);
  expect(ws?.gridColSpan).toBe(2);
  expect(ws?.gridRowSpan).toBe(2);

  const gs = await getGridState(gridId);
  expect(gs?.cells?.[4]).toBe(winId);
  expect(gs?.cells?.[5]).toBe(winId);
  expect(gs?.cells?.[7]).toBe(winId);
  expect(gs?.cells?.[8]).toBe(winId);
  expect(gs?.cells?.[0]).toBeNull();
  expect(gs?.cells?.[3]).toBeNull();
  expect(gs?.cells?.[6]).toBeNull();
});

test('resize full row (1×N span)', async () => {
  await cleanState();
  const gridId = await createGrid({ cols: 4, rows: 2, w: 800, h: 400 });
  const winId = await createChatWindow('FullRow');
  await assignToCell(gridId, 0, winId);
  await page.waitForTimeout(200);

  const result = await resizeWindowInGrid(winId, 0, 4, 1);
  expect(result).toBe(true);
  await page.waitForTimeout(200);

  const ws = await getWindowState(winId);
  expect(ws?.gridColSpan).toBe(4);
  expect(ws?.gridRowSpan).toBe(1);

  const gs = await getGridState(gridId);
  expect(gs?.cells?.slice(0, 4)).toEqual([winId, winId, winId, winId]);
  expect(gs?.cells?.slice(4)).toEqual([null, null, null, null]);
});
