/**
 * legacy-migration.ts — Main process
 *
 * Responsibility:
 * - One-shot, best-effort rename of pre-Fluxor config directories to their
 *   current names the first time they're touched after upgrading from
 *   Heliox: the project-scaffolding dir created by `fluxor:init` (formerly
 *   `heliox:init`), and the per-project hidden `.fluxor/` dir (context map +
 *   Performance Frontier output + Arena leaderboard).
 *
 * Boundaries:
 * - Owns: detecting an old path with no corresponding new path yet, and
 *   performing the on-disk rename.
 * - Does NOT own: deciding WHEN to check (callers — app startup, CLI
 *   startup, project-open — decide that) or the `~/.fluxor/market-signing`
 *   key directory (that one is read-fallback only, never renamed — see
 *   `scripts/market-sign.ts`).
 *
 * Every function here is deliberately a no-op unless the OLD path exists and
 * the NEW path does not, so calling these repeatedly (once per project open,
 * once per app launch) is safe and idempotent after the first successful
 * rename. Failures are logged and swallowed — a best-effort migration must
 * never block startup or a project from opening.
 */
import { existsSync, renameSync } from 'fs';
import { join } from 'path';
import { log } from '../logger';
import { warnOnce } from './warn-once';

function migrateDir(oldDir: string, newDir: string): void {
  if (!existsSync(oldDir) || existsSync(newDir)) return;
  try {
    renameSync(oldDir, newDir);
    warnOnce(`Legacy compat: migrated ${oldDir} -> ${newDir} (pre-Fluxor directory renamed automatically).`);
  } catch (err) {
    log.warn(`[legacy-migration] failed to migrate ${oldDir} -> ${newDir}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function migrateFile(oldPath: string, newPath: string): void {
  if (!existsSync(oldPath) || existsSync(newPath)) return;
  try {
    renameSync(oldPath, newPath);
    warnOnce(`Legacy compat: renamed ${oldPath} -> ${newPath} (pre-Fluxor filename renamed automatically).`);
  } catch (err) {
    log.warn(`[legacy-migration] failed to rename ${oldPath} -> ${newPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Legacy compat: renames `<base>/heliox` → `<base>/fluxor` if the old dir
 * exists and the new one does not. `base` is normally `process.cwd()` (the
 * CLI convention) or an opened project's root.
 */
export function migrateLegacyProjectDir(base: string): void {
  migrateDir(join(base, 'heliox'), join(base, 'fluxor'));
}

/**
 * Legacy compat: renames `<base>/.heliox` → `<base>/.fluxor` if the old dir
 * exists and the new one does not (this carries context-map.json and
 * performance-frontier/ along with it, since it's a directory-level rename),
 * then renames the Arena leaderboard file inside if it still carries its old
 * name.
 */
export function migrateLegacyDotDir(base: string): void {
  const oldDir = join(base, '.heliox');
  const newDir = join(base, '.fluxor');
  migrateDir(oldDir, newDir);

  // Legacy compat: the leaderboard file itself was also renamed by the rebrand.
  migrateFile(
    join(newDir, 'performance-frontier', 'heliox-leaderboard.json'),
    join(newDir, 'performance-frontier', 'fluxor-leaderboard.json'),
  );
}

/** Runs both project-dir migrations for `base` in one call. */
export function migrateLegacyDirectories(base: string): void {
  migrateLegacyProjectDir(base);
  migrateLegacyDotDir(base);
}
