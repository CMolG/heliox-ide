/**
 * Database Layer (Main Process)
 *
 * Responsibility:
 * - SQLite-backed structured storage for relational/queryable data
 * - Schema migrations via JSON changelog files (Liquibase-inspired)
 * - Parameterized query execution with structured error handling
 *
 * Boundaries:
 * - Owns: database connection lifecycle, query execution
 * - Does NOT own: migration definitions (see migrations/*.json),
 *   migration execution logic (see migration-runner.ts),
 *   user preferences (use settings-store), file exports (use fs-storage),
 *   or ephemeral UI state (use renderer localStorage/sessionStorage)
 *
 * Capacity: Unlimited (disk bound)
 * Location: {userData}/app.db
 * Process: Main only — renderer accesses via IPC (db:query/insert/update/delete/migrate)
 */
import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { mkdirSync } from 'fs';
import {
  runMigrations,
  rollbackMigrations,
  getMigrationStatus,
  type MigrationResult,
  type MigrationStatus,
} from './migration-runner';
import { CHANGESETS } from './migrations';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DbRow {
  [key: string]: unknown;
}

export interface DbQueryResult {
  rows: DbRow[];
  changes?: number;
  lastInsertRowid?: number | bigint;
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let db: Database.Database | null = null;

/**
 * Initialize the SQLite database and run pending changelog migrations.
 * Must be called first during storage initialization (Phase 1).
 *
 * WAL mode is enabled for better concurrent read performance
 * and crash safety (no corruption on unexpected shutdown).
 *
 * Migration flow:
 * 1. Open/create database file
 * 2. Enable WAL mode + foreign keys
 * 3. Apply pending changesets from the static registry
 */
export function initDatabase(): Database.Database {
  if (db) return db;

  const userDataPath = app.getPath('userData');
  mkdirSync(userDataPath, { recursive: true });

  const dbPath = join(userDataPath, 'app.db');
  db = new Database(dbPath);

  // WAL mode: better read concurrency, safer against corruption
  db.pragma('journal_mode = WAL');
  // Foreign keys must be explicitly enabled per-connection in SQLite
  db.pragma('foreign_keys = ON');

  // Apply pending changelog migrations
  runMigrations(db, CHANGESETS);

  return db;
}

/**
 * Get the initialized database instance.
 * Throws if called before initDatabase() — a programming error.
 */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('[database] Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// ─── Query API ─────────────────────────────────────────────────────────────────
// All methods use parameterized queries to prevent SQL injection.
// Return types follow the { success, data, error } IPC convention.

/**
 * Execute a SELECT query with optional parameters.
 * Returns all matching rows as plain objects.
 */
export function dbQuery(sql: string, params: unknown[] = []): DbQueryResult {
  const stmt = getDatabase().prepare(sql);
  const rows = stmt.all(...params) as DbRow[];
  return { rows };
}

/**
 * Execute an INSERT statement with parameters.
 * Returns the lastInsertRowid and number of changes.
 */
export function dbInsert(sql: string, params: unknown[] = []): DbQueryResult {
  const stmt = getDatabase().prepare(sql);
  const result = stmt.run(...params);
  return {
    rows: [],
    changes: result.changes,
    lastInsertRowid: result.lastInsertRowid,
  };
}

/**
 * Execute an UPDATE statement with parameters.
 * Returns the number of rows affected.
 */
export function dbUpdate(sql: string, params: unknown[] = []): DbQueryResult {
  const stmt = getDatabase().prepare(sql);
  const result = stmt.run(...params);
  return { rows: [], changes: result.changes };
}

/**
 * Execute a DELETE statement with parameters.
 * Returns the number of rows deleted.
 */
export function dbDelete(sql: string, params: unknown[] = []): DbQueryResult {
  const stmt = getDatabase().prepare(sql);
  const result = stmt.run(...params);
  return { rows: [], changes: result.changes };
}

// ─── Migration API (exposed via IPC) ───────────────────────────────────────────

/**
 * Run pending migrations. Supports dry-run mode.
 * Called via db:migrate IPC channel.
 */
export function dbMigrate(options?: { dryRun?: boolean }): MigrationResult {
  return runMigrations(getDatabase(), CHANGESETS, options);
}

/**
 * Roll back the last N applied migrations.
 * Called via db:rollback IPC channel.
 */
export function dbRollback(count: number = 1): MigrationResult {
  return rollbackMigrations(getDatabase(), CHANGESETS, count);
}

/**
 * Get the full migration status (applied, pending, checksum mismatches).
 * Called via db:status IPC channel.
 */
export function dbStatus(): MigrationStatus[] {
  return getMigrationStatus(getDatabase(), CHANGESETS);
}

/**
 * Gracefully close the database connection.
 * Call during app shutdown to ensure WAL is checkpointed.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function getDatabasePath(): string {
  return join(app.getPath('userData'), 'app.db');
}
