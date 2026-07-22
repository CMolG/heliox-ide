// src/main/backlog/watcher.ts
//
// Native fs.watch (no chokidar — the mandatory new dependency is already the
// YAML parser; fs.watch on a flat, non-recursive directory is well-supported
// on macOS/Linux/Windows and needs no second new dependency). Known caveat
// (task doc's own flagged risk): reliability may differ for a `.backlog` on
// a network/external volume (the `isExternal` picker case) — test both.
import { watch, type FSWatcher } from 'fs';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { parseBacklogCard } from './frontmatter';
import type { BacklogCardV2 } from '../../types/market';

const DEBOUNCE_MS = 300;

interface WatchEntry { fsWatcher: FSWatcher; timer: ReturnType<typeof setTimeout> | null }
const activeWatches = new Map<string, WatchEntry>();

async function readAllCards(backlogDir: string, projectRoot: string): Promise<BacklogCardV2[]> {
  const entries = await readdir(backlogDir).catch(() => [] as string[]);
  const cards: BacklogCardV2[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    try {
      const filePath = join(backlogDir, entry);
      const { readFile } = await import('fs/promises');
      const content = await readFile(filePath, 'utf-8');
      const card = await parseBacklogCard(filePath, content, { projectRoot });
      if (card) cards.push(card);
    } catch { /* skip unreadable card, matches existing read-backlog-dir behavior */ }
  }
  cards.sort((a, b) => a.order - b.order);
  return cards;
}

export async function startBacklogWatch(
  mainWindow: BrowserWindow,
  backlogDir: string,
  projectRoot: string,
): Promise<void> {
  stopBacklogWatch(backlogDir);

  const push = async () => {
    if (mainWindow.isDestroyed()) { stopBacklogWatch(backlogDir); return; }
    const cards = await readAllCards(backlogDir, projectRoot);
    mainWindow.webContents.send('fluxor:backlog-changed', { backlogDir, cards });
  };

  const debouncedPush = () => {
    const entry = activeWatches.get(backlogDir);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { void push(); }, DEBOUNCE_MS);
  };

  const fsWatcher = watch(backlogDir, () => debouncedPush());
  activeWatches.set(backlogDir, { fsWatcher, timer: null });
}

export function stopBacklogWatch(backlogDir?: string): void {
  if (backlogDir !== undefined) {
    const entry = activeWatches.get(backlogDir);
    if (entry) {
      entry.fsWatcher.close();
      if (entry.timer) clearTimeout(entry.timer);
      activeWatches.delete(backlogDir);
    }
    return;
  }
  for (const [dir, entry] of activeWatches) {
    entry.fsWatcher.close();
    if (entry.timer) clearTimeout(entry.timer);
    activeWatches.delete(dir);
  }
}

/**
 * Channels ({success, error?} convention, matches dev-server-watcher.ts):
 *   'fluxor:watch-backlog-dir'   args: [backlogDir, projectRoot]
 *   'fluxor:unwatch-backlog-dir' args: [backlogDir]
 * Push event: 'fluxor:backlog-changed' payload: { backlogDir, cards: BacklogCardV2[] }
 */
export function registerBacklogWatcherIpcHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('fluxor:watch-backlog-dir', async (_event, backlogDir: string, projectRoot: string) => {
    try {
      await startBacklogWatch(mainWindow, backlogDir, projectRoot);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('fluxor:unwatch-backlog-dir', async (_event, backlogDir: string) => {
    try {
      stopBacklogWatch(backlogDir);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  mainWindow.on('closed', () => stopBacklogWatch());
}
