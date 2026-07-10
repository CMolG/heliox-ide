/**
 * warn-once.ts — Main process
 *
 * Responsibility:
 * - Dedupe repeated deprecation-style warnings so a legacy-compat code path
 *   that fires many times per process (once per env read, once per legacy
 *   flow import, once per legacy directory found) logs its warning exactly
 *   once instead of flooding the log sink.
 *
 * Boundaries:
 * - Owns: in-memory dedup of warning messages for the lifetime of the process.
 * - Does NOT own: where the warning is written (delegates to the shared
 *   SafeLogger in `./logger`).
 *
 * Used by the rebrand's legacy-compat shims: env-compat.ts (deprecated env
 * var fallback), flow-export/fluxor-flow.ts (legacy flow-format import), and
 * legacy-migration.ts (directory rename notices).
 */
import { log } from '../logger';

const seen = new Set<string>();

/**
 * Logs `message` via the shared logger's warn sink, but only the first time
 * this exact message is seen in the current process.
 */
export function warnOnce(message: string): void {
  if (seen.has(message)) return;
  seen.add(message);
  log.warn(message);
}

/**
 * Test-only: clears the dedup set so unit tests can assert `warnOnce` fires
 * again in a fresh "run" instead of bleeding state across test cases.
 */
export function resetWarnOnceForTests(): void {
  seen.clear();
}
