/**
 * browser-ipc.ts — Main Process Module
 *
 * Responsibility:
 * - Registers IPC handles for the M2 browser-control surface.
 * - Delegates all work to `browserController` — this file is pure IPC plumbing.
 *
 * Boundaries:
 * - Main process only — no renderer imports, no DOM/React.
 * - Does NOT accept a mainWindow argument (unlike dev-server watcher) because
 *   none of these channels push events back to the renderer.
 *
 * IPC channels (all follow the {success, data?, error?} convention):
 *   'browser:attach'       args: [webContentsId: number]
 *   'browser:goto'         args: [webContentsId: number, url: string]
 *   'browser:observe'      args: [webContentsId: number]
 *   'browser:act'          args: [webContentsId: number, elementId: number, action: BrowserAction, value?: string]
 *   'browser:extract-seo'  args: [webContentsId: number, url?: string]
 *   'browser:detach'       args: [webContentsId: number]
 *   'browser:set-agent-surface'  args: [webContentsId: number | null]
 */
// src/main/browser/browser-ipc.ts — IPC bridge for M2 native CDP browser control

import { ipcMain } from 'electron';
import { browserController } from './browser-controller';
import type { BrowserAction } from '../../types/browser';

// ─── IPC handler registration ──────────────────────────────────────────────────

/**
 * Register all browser-control IPC handlers.
 * Called from `src/main/index.ts` alongside the other registrar functions
 * (registerIpcHandlers, registerContextMapIpcHandlers, registerDevServerIpcHandlers).
 *
 * No mainWindow reference is needed — none of these channels push events to the renderer.
 */
export function registerBrowserIpcHandlers(): void {

  // ── browser:attach ───────────────────────────────────────────────────────────
  ipcMain.handle('browser:attach', async (_event, id: number) => {
    try {
      await browserController.attach(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── browser:goto ─────────────────────────────────────────────────────────────
  ipcMain.handle('browser:goto', async (_event, id: number, url: string) => {
    try {
      const data = await browserController.goto(id, url);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── browser:observe ──────────────────────────────────────────────────────────
  ipcMain.handle('browser:observe', async (_event, id: number) => {
    try {
      const data = await browserController.observePage(id);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── browser:act ──────────────────────────────────────────────────────────────
  ipcMain.handle(
    'browser:act',
    async (_event, id: number, elementId: number, action: BrowserAction, value?: string) => {
      try {
        const data = await browserController.act(id, elementId, action, value);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // ── browser:extract-seo ──────────────────────────────────────────────────────
  ipcMain.handle('browser:extract-seo', async (_event, id: number, url?: string) => {
    try {
      const data = await browserController.extractSeo(id, url);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── browser:detach ───────────────────────────────────────────────────────────
  ipcMain.handle('browser:detach', async (_event, id: number) => {
    try {
      await browserController.detach(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── browser:set-agent-surface ────────────────────────────────────────────────
  // Records which preview's webContents is the active agent surface — the
  // MAIN-side source of truth that M3's toolset reads via
  // browserController.getActiveAgentSurfaceId(). Pass null to clear on unlink.
  ipcMain.handle('browser:set-agent-surface', (_event, id: number | null) => {
    try {
      browserController.setActiveAgentSurface(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
