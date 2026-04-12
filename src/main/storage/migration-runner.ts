/**
 * Changelog Migration Runner (Main Process)
 *
 * Responsibility:
 * - Load JSON changelog files from src/main/storage/migrations/
 * - Validate checksums to detect tampered migrations
 * - Apply pending migrations (up) or rollback applied ones (down)
 * - Track applied state in an `applied_migrations` table (not just user_version)
 * - Support dry-run mode and status reporting
 *
 * Boundaries:
 * - Owns: migration discovery, ordering, checksum validation, execution, rollback
 * - Does NOT own: the database connection (receives it as a parameter)
 *
 * Inspired by Liquibase changelogs but native to the Node.js/SQLite stack:
 * - JSON changeset files instead of XML/YAML
 * - SHA-256 checksums instead of MD5
 * - SQLite-aware (no unsupported DDL)
 * - Zero JVM dependency
 */
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// ─── Changelog Types ───────────────────────────────────────────────────────────

export interface Changeset {
  id: string;
  version: number;
  author: string;
  description: string;
  created: string;
  up: string[];
  down: string[];
  checksum: string;
}

export interface AppliedMigration {
  id: string;
  version: number;
  description: string;
  checksum: string;
  applied_at: string;
  execution_ms: number;
}

export interface MigrationStatus {
  id: string;
  version: number;
  description: string;
  state: 'applied' | 'pending' | 'checksum_mismatch';
  checksum: string;
  appliedAt?: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  errors: string[];
  currentVersion: number;
}

// ─── Checksum ──────────────────────────────────────────────────────────────────

/**
 * Compute a SHA-256 checksum from the up + down SQL arrays.
 * This detects if a migration file was modified after being applied.
 * Only the SQL content matters — metadata (author, description) can change freely.
 */
export function computeChecksum(changeset: Pick<Changeset, 'up' | 'down'>): string {
  const content = [...changeset.up, '---', ...changeset.down].join('\n');
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ─── Changelog Loader ──────────────────────────────────────────────────────────

/**
 * Load all JSON changelog files from the migrations directory.
 * Files must be named NNN-*.json and are sorted by filename (version order).
 *
 * Each file is validated:
 * - Must have id, version, up[], down[]
 * - Versions must be sequential (no gaps, no duplicates)
 * - If checksum field is empty, it's auto-computed and the file is valid
 * - If checksum field is set, it's validated against computed value
 */
export function loadChangesets(migrationsDir: string): Changeset[] {
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  const changesets: Changeset[] = [];

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    const raw = readFileSync(filePath, 'utf-8');
    let changeset: Changeset;

    try {
      changeset = JSON.parse(raw) as Changeset;
    } catch {
      throw new Error(`[migrations] Invalid JSON in ${file}`);
    }

    if (!changeset.id || !changeset.version || !Array.isArray(changeset.up) || !Array.isArray(changeset.down)) {
      throw new Error(`[migrations] Missing required fields in ${file} (need: id, version, up[], down[])`);
    }

    // Auto-compute checksum if empty (first-time or development)
    const computed = computeChecksum(changeset);
    if (!changeset.checksum || changeset.checksum === '') {
      changeset.checksum = computed;
    } else if (changeset.checksum !== computed) {
      throw new Error(
        `[migrations] Checksum mismatch in ${file}: ` +
        `expected ${changeset.checksum}, computed ${computed}. ` +
        `Migration SQL was modified after initial authoring.`
      );
    }

    changesets.push(changeset);
  }

  // Validate version sequence: must be 1, 2, 3, ... with no gaps
  for (let i = 0; i < changesets.length; i++) {
    if (changesets[i].version !== i + 1) {
      throw new Error(
        `[migrations] Version gap: expected ${i + 1}, got ${changesets[i].version} ` +
        `in changeset "${changesets[i].id}"`
      );
    }
  }

  return changesets;
}

// ─── Tracking Table ────────────────────────────────────────────────────────────

/**
 * Ensure the applied_migrations tracking table exists.
 * This replaces the simple user_version pragma with full audit history:
 * which migrations ran, when, how long they took, and their checksum at apply-time.
 */
function ensureTrackingTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS applied_migrations (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL UNIQUE,
      description TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      execution_ms INTEGER NOT NULL DEFAULT 0
    )
  `);
}

/**
 * Get all previously applied migrations, ordered by version.
 */
function getAppliedMigrations(database: Database.Database): AppliedMigration[] {
  return database
    .prepare('SELECT * FROM applied_migrations ORDER BY version ASC')
    .all() as AppliedMigration[];
}

// ─── Migration Runner ──────────────────────────────────────────────────────────

/**
 * Apply all pending migrations in order within a single transaction.
 *
 * Behavior:
 * - Skips already-applied migrations (matched by id)
 * - Validates checksums of applied migrations (detects tampering)
 * - Applies pending migrations sequentially
 * - Updates both the tracking table and user_version pragma
 * - Entire batch is atomic: if any migration fails, all roll back
 *
 * Returns a result with applied/skipped/error lists.
 */
export function runMigrations(
  database: Database.Database,
  changesets: Changeset[],
  options: { dryRun?: boolean } = {},
): MigrationResult {
  ensureTrackingTable(database);

  const applied = getAppliedMigrations(database);
  const appliedMap = new Map(applied.map(m => [m.id, m]));

  const result: MigrationResult = {
    applied: [],
    skipped: [],
    errors: [],
    currentVersion: applied.length > 0 ? Math.max(...applied.map(m => m.version)) : 0,
  };

  const pending = changesets.filter(cs => !appliedMap.has(cs.id));

  // Check for checksum mismatches on already-applied migrations
  for (const cs of changesets) {
    const prev = appliedMap.get(cs.id);
    if (prev && prev.checksum !== cs.checksum) {
      result.errors.push(
        `Checksum mismatch for "${cs.id}": applied=${prev.checksum}, current=${cs.checksum}`
      );
    }
  }

  if (result.errors.length > 0) return result;
  if (pending.length === 0) return result;
  if (options.dryRun) {
    result.applied = pending.map(cs => `[dry-run] ${cs.id}`);
    return result;
  }

  // Apply all pending migrations in one transaction
  const migrate = database.transaction(() => {
    for (const changeset of pending) {
      const start = Date.now();

      for (const sql of changeset.up) {
        database.exec(sql);
      }

      const elapsed = Date.now() - start;

      database.prepare(`
        INSERT INTO applied_migrations (id, version, description, checksum, execution_ms)
        VALUES (?, ?, ?, ?, ?)
      `).run(changeset.id, changeset.version, changeset.description, changeset.checksum, elapsed);

      database.pragma(`user_version = ${changeset.version}`);
      result.applied.push(changeset.id);
    }
  });

  migrate();
  result.currentVersion = pending[pending.length - 1].version;
  return result;
}

// ─── Rollback ──────────────────────────────────────────────────────────────────

/**
 * Roll back the last N applied migrations in reverse order.
 *
 * Each rollback:
 * - Executes the `down` SQL statements
 * - Removes the row from applied_migrations
 * - Updates user_version to the previous migration (or 0 if fully rolled back)
 *
 * Entire rollback batch is atomic.
 */
export function rollbackMigrations(
  database: Database.Database,
  changesets: Changeset[],
  count: number = 1,
): MigrationResult {
  ensureTrackingTable(database);

  const applied = getAppliedMigrations(database);
  const changesetMap = new Map(changesets.map(cs => [cs.id, cs]));

  const toRollback = applied.slice(-count).reverse();

  const result: MigrationResult = {
    applied: [],
    skipped: [],
    errors: [],
    currentVersion: applied.length > 0 ? Math.max(...applied.map(m => m.version)) : 0,
  };

  if (toRollback.length === 0) return result;

  // Validate all rollback targets have down SQL available
  for (const migration of toRollback) {
    const changeset = changesetMap.get(migration.id);
    if (!changeset) {
      result.errors.push(`Changeset file not found for applied migration "${migration.id}"`);
      return result;
    }
    if (changeset.down.length === 0) {
      result.errors.push(`No down SQL defined for "${migration.id}" — rollback not possible`);
      return result;
    }
  }

  const rollback = database.transaction(() => {
    for (const migration of toRollback) {
      const changeset = changesetMap.get(migration.id)!;

      for (const sql of changeset.down) {
        database.exec(sql);
      }

      database.prepare('DELETE FROM applied_migrations WHERE id = ?').run(migration.id);
      result.applied.push(`[rolled-back] ${migration.id}`);
    }

    // Set user_version to the highest remaining migration, or 0
    const remaining = database
      .prepare('SELECT MAX(version) as max_version FROM applied_migrations')
      .get() as { max_version: number | null };

    const newVersion = remaining?.max_version ?? 0;
    database.pragma(`user_version = ${newVersion}`);
    result.currentVersion = newVersion;
  });

  rollback();
  return result;
}

// ─── Status Report ─────────────────────────────────────────────────────────────

/**
 * Return the full migration status: which are applied, pending, or have checksum issues.
 * Useful for diagnostics and the db:migrate IPC response.
 */
export function getMigrationStatus(
  database: Database.Database,
  changesets: Changeset[],
): MigrationStatus[] {
  ensureTrackingTable(database);

  const applied = getAppliedMigrations(database);
  const appliedMap = new Map(applied.map(m => [m.id, m]));

  return changesets.map(cs => {
    const prev = appliedMap.get(cs.id);
    if (!prev) {
      return { id: cs.id, version: cs.version, description: cs.description, state: 'pending' as const, checksum: cs.checksum };
    }
    if (prev.checksum !== cs.checksum) {
      return { id: cs.id, version: cs.version, description: cs.description, state: 'checksum_mismatch' as const, checksum: cs.checksum, appliedAt: prev.applied_at };
    }
    return { id: cs.id, version: cs.version, description: cs.description, state: 'applied' as const, checksum: cs.checksum, appliedAt: prev.applied_at };
  });
}
