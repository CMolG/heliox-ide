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
 *  Phase -1 — Crash reporter (audit 1.8a) — synchronous, before the app is ready
 *  Phase 0 — Initialize storage (SQLite migrations → electron-store → fs roots → storage IPC)
 *  Phase 1 — Restore window geometry from settings store
 *  Phase 2 — Load renderer entrypoint
 *  Phase 3 — Platform integrations + app menu + auto-update + telemetry ping
 */
import { app, BrowserWindow, Menu, nativeImage, session, crashReporter } from 'electron';
import path from 'path';
import { updateElectronApp } from 'update-electron-app';
import { registerIpcHandlers } from './ipc-handlers';
import { registerContextMapIpcHandlers } from './context-map';
import { registerDevServerIpcHandlers } from './browser/dev-server-watcher';
import { registerBacklogWatcherIpcHandlers } from './backlog/watcher';
import { registerBrowserIpcHandlers } from './browser/browser-ipc';
import { initializeStorage, shutdownStorage } from './storage';
import { settingsGet, settingsSet } from './storage/settings-store';
import { browserController } from './browser/browser-controller';
import { sendTelemetryLaunchPing } from './telemetry-ping';
import { migrateLegacyDirectories } from './lib/legacy-migration';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// ── Crash reporting (audit 1.8a) — as early as possible, dev and packaged ───
// `uploadToServer: false`: dumps are written locally only
// (app.getPath('crashDumps'), logged once below) and never leave the
// machine. This is distinct from the opt-in telemetry ping in
// telemetry-ping.ts — crash dumps exist so a user can find/attach one on
// request; nothing here is transmitted automatically.
crashReporter.start({
  uploadToServer: false,
  productName: 'Fluxor IDE',
  ignoreSystemCrashHandler: false,
});

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

// ── Content-Security-Policy (audit 1.3) — packaged builds only ──────────────
// Dev is intentionally exempt: Vite's dev server needs eval'd HMR chunks and a
// ws:// connection that this policy would otherwise block, and dev has no
// untrusted end user to protect. Constraints each directive serves:
//   default-src 'self'   — deny-by-default fallback for any directive not listed
//   script-src 'self'    — renderer JS ships in the app bundle only; Monaco is
//                          self-hosted (monaco-config.ts) so no CDN script is needed
//   style-src  ... 'unsafe-inline' — Tailwind + inline React style props
//   font-src   'self' data:        — self-hosted @fontsource packages
//   img-src    ... data: blob:     — data-URI icons/avatars + generated blob previews
//   media-src  ... blob:           — generated/recorded audio-video blobs
//   worker-src ... blob:           — Monaco language workers / blob-constructed workers
//   connect-src 'self' https: ws://localhost:* http://localhost:*
//                                  — LLM/API calls (https), local MCP HTTP servers
//                                    and the dev-server preview ports
//   frame-src  http: https:        — <webview> previews (WebPreviewApp.tsx) navigate
//                                    arbitrary dev-server/user URLs; already restricted
//                                    to http/https by the will-navigate guard below
//   object-src 'none'    — no plugin/embed content
//   base-uri   'self'    — blocks <base>-tag injection from redirecting relative URLs
//   form-action 'none'   — the app renders no HTML forms that should ever submit
const PACKAGED_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https: ws://localhost:* http://localhost:*",
  'frame-src http: https:',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function registerPackagedContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [PACKAGED_CSP],
      },
    });
  });
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
    title: 'Fluxor IDE',
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
  registerBacklogWatcherIpcHandlers(mainWindow);
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
  // Legacy compat: rename any pre-Fluxor `heliox/`/`.heliox/` dirs at the cwd
  // before anything else touches disk — best-effort, never blocks startup.
  // Per-project dirs are additionally migrated on project open (see
  // context-map/store.ts's ensureContextMap), since `process.cwd()` here
  // isn't necessarily the user's opened project.
  migrateLegacyDirectories(process.cwd());

  // ── Phase 0: Initialize all storage before anything else ────────────────────
  // Order: SQLite migrations → electron-store → fs roots → storage IPC handlers
  initializeStorage();

  // Crash dumps directory is only meaningful once the app is ready on every
  // platform; log it once so a user/support thread can be pointed at it.
  console.log(`[crash-reporter] local dumps: ${app.getPath('crashDumps')}`);

  // Packaged only — see registerPackagedContentSecurityPolicy for rationale.
  // Vite's dev server (HMR eval + ws) would break under this policy.
  if (app.isPackaged) {
    registerPackagedContentSecurityPolicy();
  }

  // ── Auto-update (audit 1.2) — packaged only ─────────────────────────────
  // Inert today: update.electronjs.org requires the repo to be public with
  // at least one published release (see docs/RELEASE_CHECKLIST.md) — neither
  // is true yet, so this just polls hourly and finds nothing. Safe to leave
  // wired for that day, gated behind the same settings flag a user could
  // flip off (Settings, once there's UI for it — the key already exists).
  if (app.isPackaged) {
    try {
      if (settingsGet('autoUpdateEnabled')) {
        updateElectronApp({
          repo: 'CMolG/fluxor-ide',
          updateInterval: '1 hour',
          notifyUser: true,
        });
      }
    } catch (err) {
      console.error('[auto-update] failed to initialize:', err);
    }
  }

  // Anonymous install/launch ping (audit 1.8b) — no-op unless the user has
  // opted in AND an endpoint is configured; never awaited so a slow/offline
  // endpoint cannot delay window creation. See telemetry-ping.ts.
  void sendTelemetryLaunchPing();

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
            if (win) win.webContents.send('fluxor:menu-open-project');
          },
        },
        {
          label: 'Close Project',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('fluxor:menu-close-project');
          },
        },
        { type: 'separator' },
        {
          label: 'Switch Project',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('fluxor:menu-switch-project');
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
