/**
 * File System Storage (Main Process)
 *
 * Responsibility:
 * - Managed file I/O for user-generated content and app exports
 * - Sandboxed to safe directories (userData, documents, project paths)
 *
 * Boundaries:
 * - Owns: file read/write/delete/list for export/import workflows
 * - Does NOT own: user preferences (use settings-store), structured data (use database),
 *   or ephemeral state (use renderer localStorage/sessionStorage)
 *
 * Capacity: Unlimited (disk bound)
 * Location: User-defined or {documents}/{appName}
 * Process: Main only — renderer accesses via IPC (fs:readFile/writeFile/deleteFile/listDir)
 */
import { readFile, writeFile, unlink, readdir, stat, mkdir } from 'fs/promises';
import { join, resolve, normalize } from 'path';
import { app } from 'electron';
import { existsSync } from 'fs';

// ─── Safety ────────────────────────────────────────────────────────────────────
// Prevent path traversal attacks by ensuring resolved paths stay within allowed roots.

const ALLOWED_ROOTS = new Set<string>();

/**
 * Register a directory as a safe root for file operations.
 * Called during initialization with userData, documents, and project paths.
 */
export function registerSafeRoot(dirPath: string): void {
  ALLOWED_ROOTS.add(normalize(resolve(dirPath)));
}

/**
 * Validate that a file path is within an allowed root directory.
 * Throws on path traversal attempts (e.g., ../../etc/passwd).
 */
function assertSafePath(filePath: string): string {
  const resolved = normalize(resolve(filePath));

  // If no roots registered, only allow absolute paths (startup guard)
  if (ALLOWED_ROOTS.size === 0) {
    throw new Error('[fs-storage] No safe roots registered. Call registerSafeRoot() first.');
  }

  for (const root of ALLOWED_ROOTS) {
    if (resolved.startsWith(root)) return resolved;
  }

  throw new Error(`[fs-storage] Path outside allowed roots: ${filePath}`);
}

// ─── File Operations ───────────────────────────────────────────────────────────

/**
 * Read a file as UTF-8 text.
 * Returns null if the file doesn't exist (soft failure for optional reads).
 */
export async function fsReadFile(filePath: string): Promise<string | null> {
  const safePath = assertSafePath(filePath);
  try {
    return await readFile(safePath, 'utf-8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Write content to a file. Creates parent directories if they don't exist.
 * Overwrites existing content (full replace, not append).
 */
export async function fsWriteFile(filePath: string, content: string): Promise<void> {
  const safePath = assertSafePath(filePath);
  const dir = join(safePath, '..');
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(safePath, content, 'utf-8');
}

/**
 * Delete a file. No-op if the file doesn't exist.
 */
export async function fsDeleteFile(filePath: string): Promise<void> {
  const safePath = assertSafePath(filePath);
  try {
    await unlink(safePath);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return;
    throw err;
  }
}

export interface FsDirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

/**
 * List the contents of a directory (non-recursive, one level deep).
 * Returns name, full path, isDirectory, and size for each entry.
 */
export async function fsListDir(dirPath: string): Promise<FsDirectoryEntry[]> {
  const safePath = assertSafePath(dirPath);
  const entries = await readdir(safePath);
  const results: FsDirectoryEntry[] = [];

  for (const name of entries) {
    const entryPath = join(safePath, name);
    try {
      const stats = await stat(entryPath);
      results.push({
        name,
        path: entryPath,
        isDirectory: stats.isDirectory(),
        size: stats.isDirectory() ? undefined : stats.size,
      });
    } catch {
      // Skip entries we can't stat (permissions, broken symlinks)
    }
  }

  return results;
}

/**
 * Initialize fs-storage by registering default safe roots.
 * Additional project paths should be registered via registerSafeRoot()
 * when projects are opened.
 */
export function initFsStorage(): void {
  registerSafeRoot(app.getPath('userData'));
  registerSafeRoot(app.getPath('documents'));
  registerSafeRoot(app.getPath('home'));
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
