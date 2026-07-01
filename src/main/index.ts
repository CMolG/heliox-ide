/**
 * Main Process Architecture (Electron)
 *
 * This module is intentionally small and acts as the application bootstrap layer.
 * It owns:
 *  - storage initialization (Phase 0 — before any window or IPC)
 *  - window lifecycle (create/restore/persist BrowserWindow state)
 *  - shell-level UI integration (dock icon, native menu)
 *  - IPC handler registration delegation
 *
 * It does NOT own business logic for agents, snapshots, or project operations.
 * Those responsibilities live behind IPC handlers in `src/main/ipc-handlers.ts`.
 *
 * Startup Order:
 *  Phase 0 — Initialize storage (SQLite migrations → electron-store → fs roots → storage IPC)
 *  Phase 1 — Restore window geometry from settings store
 *  Phase 2 — Load renderer entrypoint
 *  Phase 3 — Platform integrations + app menu
 */
import { app, BrowserWindow, Menu, nativeImage } from 'electron';
import path from 'path';
import { registerIpcHandlers } from './ipc-handlers';
import { registerContextMapIpcHandlers } from './context-map';
import { registerDevServerIpcHandlers } from './browser/dev-server-watcher';
import { registerBrowserIpcHandlers } from './browser/browser-ipc';
import { initializeStorage, shutdownStorage } from './storage';
import { settingsGet, settingsSet } from './storage/settings-store';
import { browserController } from './browser/browser-controller';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

function loadWindowState(): WindowState {
  // Best-effort restore via electron-store (replaces raw fs reads).
  // Invalid/corrupt state should never block startup.
  try {
    return settingsGet('windowState');
  } catch {
    return { width: 1440, height: 900 };
  }
}

function saveWindowState(win: BrowserWindow): void {
  // If currently maximized, persist the "normal" bounds so restore is sane.
  const isMaximized = win.isMaximized();
  const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized,
  };
  try {
    settingsSet('windowState', state);
  } catch { /* non-critical — silently ignore */ }
}

function createWindow(): BrowserWindow {
  // ── Phase 1: Restore previous window geometry ───────────────────────────────
  const savedState = loadWindowState();

  // Resolve icon path — works in both dev and packaged builds
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../../assets/icon.png');

  const mainWindow = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    x: savedState.x,
    y: savedState.y,
    minWidth: 1024,
    minHeight: 700,
    title: 'Heliox IDE',
    titleBarStyle: 'hiddenInset',
    icon: iconPath,
    backgroundColor: '#0c0a09',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // M1 — required to allow <webview> tags in the renderer for embedded preview windows
      webviewTag: true,
    },
  });

  if (savedState.isMaximized) {
    mainWindow.maximize();
  }

  // Persist window state on resize/move (debounced via close event)
  mainWindow.on('close', () => saveWindowState(mainWindow));

  // ── Phase 2: Load renderer entrypoint (dev server or packaged file) ────────
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  registerIpcHandlers(mainWindow);
  registerContextMapIpcHandlers(mainWindow);
  registerDevServerIpcHandlers(mainWindow);
  // M2 — native CDP browser control (no mainWindow needed — no push events)
  registerBrowserIpcHandlers();

  return mainWindow;
}

// ── M1/M4 Security guard — harden every <webview> that the renderer mounts ───
// Strips any preload the page tries to set, and enforces context isolation so
// guest content can never escape into Node.js. Called once at app level, before
// any window is created, so it covers all BrowserWindows including future ones.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (_evt, wp) => {
    // Remove any preload the page tried to inject — only our controlled
    // renderer is allowed to run privileged code.
    delete (wp as Record<string, unknown>).preload;
    delete (wp as Record<string, unknown>).preloadURL;
    wp.nodeIntegration = false;
    wp.contextIsolation = true;
  });

  // M4 — after the guest WebContents is live, lock down navigation and popups.
  // Guest preview content may only navigate http/https (or stay at about:blank);
  // file:, chrome:, data: etc. are blocked, and window.open is fully denied.
  contents.on('did-attach-webview', (_e, guest) => {
    guest.setWindowOpenHandler(() => ({ action: 'deny' }));
    guest.on('will-navigate', (evt, navUrl) => {
      if (!/^https?:\/\//i.test(navUrl) && navUrl !== 'about:blank') {
        evt.preventDefault();
      }
    });
  });
});

app.whenReady().then(() => {
  // ── Phase 0: Initialize all storage before anything else ────────────────────
  // Order: SQLite migrations → electron-store → fs roots → storage IPC handlers
  initializeStorage();

  // ── Phase 3: Platform integrations + app menu ───────────────────────────────
  // Set macOS dock icon
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../assets/icon.png');
    try { app.dock.setIcon(nativeImage.createFromPath(dockIconPath)); } catch { /* ignore */ }
  }

  createWindow();

  // Build application menu
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('heliox:menu-open-project');
          },
        },
        {
          label: 'Close Project',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('heliox:menu-close-project');
          },
        },
        { type: 'separator' },
        {
          label: 'Switch Project',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('heliox:menu-switch-project');
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  app.on('activate', () => {
    // macOS UX convention: recreate a window when activating with none open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // macOS keeps apps alive after last window closes; other platforms quit.
  if (process.platform !== 'darwin') app.quit();
});

// Graceful shutdown — checkpoint SQLite WAL and tear down all CDP sessions +
// the headless agent window so no orphaned Chrome processes linger.
app.on('will-quit', () => {
  browserController.disposeAll();
  shutdownStorage();
});
