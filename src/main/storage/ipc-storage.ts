/**
 * Storage IPC Handlers (Main Process)
 *
 * Responsibility:
 * - Register ipcMain.handle channels for all storage layers
 * - Enforce the {layer}:{action} naming convention
 * - Return structured { success, data, error } responses on every call
 *
 * Boundaries:
 * - Owns: IPC channel registration and error normalization
 * - Does NOT own: storage implementation (delegated to settings-store, database, fs-storage)
 *
 * Channels:
 *   settings:get    — Read a settings key
 *   settings:set    — Write a settings key
 *   settings:delete — Remove a settings key
 *   settings:reset  — Reset all settings to defaults
 *   db:query        — Execute a SELECT query
 *   db:insert       — Execute an INSERT statement
 *   db:update       — Execute an UPDATE statement
 *   db:delete       — Execute a DELETE statement
 *   db:migrate      — Re-run pending migrations
 *   fs:readFile     — Read a file as UTF-8
 *   fs:writeFile    — Write content to a file
 *   fs:deleteFile   — Delete a file
 *   fs:listDir      — List directory contents
 */
import { ipcMain } from 'electron';
import { rmSync } from 'fs';
import { settingsGet, settingsSet, settingsDelete, settingsReset, SettingsSchema } from './settings-store';
import { dbQuery, dbInsert, dbUpdate, dbDelete, dbMigrate, dbRollback, dbStatus, closeDatabase, getDatabasePath } from './database';
import { fsReadFile, fsWriteFile, fsDeleteFile, fsListDir, registerSafeRoot } from './fs-storage';

// ─── IPC Result Shape ──────────────────────────────────────────────────────────
// All storage IPC handlers return this exact shape.
// The renderer should always check `success` before accessing `data`.

interface IpcStorageResult {
  success: boolean;
  data: unknown | null;
  error: string | null;
}

function ok(data: unknown = null): IpcStorageResult {
  return { success: true, data, error: null };
}

function fail(error: unknown): IpcStorageResult {
  const message = error instanceof Error ? error.message : String(error);
  return { success: false, data: null, error: message };
}

// ─── Handler Registration ──────────────────────────────────────────────────────

export function registerStorageIpcHandlers(): void {

  // ── Settings Layer (electron-store) ────────────────────────────────────────

  ipcMain.handle('settings:get', (_event, key: keyof SettingsSchema) => {
    try {
      return ok(settingsGet(key));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('settings:set', (_event, key: keyof SettingsSchema, value: unknown) => {
    try {
      settingsSet(key, value as SettingsSchema[typeof key]);
      return ok();
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('settings:delete', (_event, key: keyof SettingsSchema) => {
    try {
      settingsDelete(key);
      return ok();
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('settings:reset', () => {
    try {
      settingsReset();
      return ok();
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('app:hard-reset', () => {
    try {
      // 1. Wipe electron-store config (app settings)
      settingsReset();
      // 2. Close SQLite connection and delete the database files
      closeDatabase();
      const dbPath = getDatabasePath();
      for (const suffix of ['', '-wal', '-shm']) {
        try { rmSync(dbPath + suffix, { force: true }); } catch (_) { /* ignore missing */ }
      }
      return ok();
    } catch (err) {
      return fail(err);
    }
  });

  // ── Database Layer (better-sqlite3) ────────────────────────────────────────
  // SQL is always parameterized via the `params` array to prevent injection.
  // The renderer must NOT send raw SQL — only scoped handler methods.

  ipcMain.handle('db:query', (_event, sql: string, params?: unknown[]) => {
    try {
      return ok(dbQuery(sql, params));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('db:insert', (_event, sql: string, params?: unknown[]) => {
    try {
      return ok(dbInsert(sql, params));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('db:update', (_event, sql: string, params?: unknown[]) => {
    try {
      return ok(dbUpdate(sql, params));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('db:delete', (_event, sql: string, params?: unknown[]) => {
    try {
      return ok(dbDelete(sql, params));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('db:migrate', (_event, options?: { dryRun?: boolean }) => {
    try {
      return ok(dbMigrate(options));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('db:rollback', (_event, count?: number) => {
    try {
      return ok(dbRollback(count));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('db:status', () => {
    try {
      return ok(dbStatus());
    } catch (err) {
      return fail(err);
    }
  });

  // ── File System Layer (Node.js fs) ─────────────────────────────────────────
  // All paths are validated against registered safe roots before any I/O.

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    try {
      return ok(await fsReadFile(filePath));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    try {
      await fsWriteFile(filePath, content);
      return ok();
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('fs:deleteFile', async (_event, filePath: string) => {
    try {
      await fsDeleteFile(filePath);
      return ok();
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('fs:listDir', async (_event, dirPath: string) => {
    try {
      return ok(await fsListDir(dirPath));
    } catch (err) {
      return fail(err);
    }
  });

  // ── Utility: Register additional safe roots at runtime ─────────────────────
  // Called when a project is opened to allow fs operations within it.

  ipcMain.handle('fs:registerRoot', (_event, dirPath: string) => {
    try {
      registerSafeRoot(dirPath);
      return ok();
    } catch (err) {
      return fail(err);
    }
  });
}
