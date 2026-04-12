/**
 * Storage Initialization Orchestrator (Main Process)
 *
 * Responsibility:
 * - Enforces the correct startup order for all storage layers
 * - Single entry point for storage lifecycle (init + shutdown)
 *
 * Boundaries:
 * - Owns: initialization sequencing and shutdown coordination
 * - Does NOT own: individual storage implementations (delegated to sub-modules)
 *
 * Initialization Order (strict):
 *  Phase 1 — Run SQLite migrations (db:migrate)
 *  Phase 2 — Load electron-store and validate schema
 *  Phase 3 — Initialize filesystem storage (register safe roots)
 *  Phase 4 — Register all IPC handlers for storage channels
 *
 * BrowserWindow must NOT be created until this function resolves.
 */
import { initDatabase, closeDatabase } from './database';
import { initSettingsStore } from './settings-store';
import { initFsStorage } from './fs-storage';
import { registerStorageIpcHandlers } from './ipc-storage';

let initialized = false;

/**
 * Initialize all storage layers in the required order.
 *
 * Call once from app.whenReady(), before creating any BrowserWindow.
 * Idempotent — subsequent calls are no-ops.
 *
 * Why this order matters:
 * - SQLite first: migrations must complete before any data reads
 * - electron-store second: may depend on DB state in future
 * - fs-storage third: needs userData path (available after app ready)
 * - IPC handlers last: all backends must be ready before renderer can invoke them
 */
export function initializeStorage(): void {
  if (initialized) return;

  // Phase 1: Database — run migrations, establish WAL mode
  initDatabase();

  // Phase 2: Settings — load/validate electron-store config.json
  initSettingsStore();

  // Phase 3: File system — register safe root directories
  initFsStorage();

  // Phase 4: IPC — expose storage:* channels to renderer
  registerStorageIpcHandlers();

  initialized = true;
}

/**
 * Graceful shutdown of all storage layers.
 * Call during app 'before-quit' or 'will-quit' event.
 *
 * Order: close DB last (may need to flush pending writes).
 * electron-store and fs need no explicit teardown.
 */
export function shutdownStorage(): void {
  closeDatabase();
  initialized = false;
}
