/**
 * env-compat.ts — Main process
 *
 * Responsibility:
 * - Single choke point for reading `FLUXOR_*` environment variables, with a
 *   deprecated fallback to the pre-rebrand `HELIOX_*` name.
 *
 * Boundaries:
 * - Owns: the FLUXOR_* vs HELIOX_* precedence rule and its one-time-per-name
 *   deprecation warning.
 * - Does NOT own: parsing/coercion of the returned string (callers already
 *   do `Number(...)`, `?? default`, etc. — this module only resolves which
 *   raw string, if any, applies).
 *
 * Legacy compat: HELIOX_* is accepted as a deprecated fallback until v0.4.0
 * (per the 2026-07-10 Heliox → Fluxor rebranding plan, Anexo A). Every
 * `process.env.HELIOX_*` read in `src/main` must route through here instead
 * of reading `process.env` directly, so the deprecation path is exercised
 * uniformly and the warning fires at most once per legacy name per process.
 */
import { warnOnce } from './warn-once';

/**
 * Reads `process.env[name]` (a `FLUXOR_*` variable), falling back to the
 * corresponding legacy `HELIOX_*` name when the new one is unset. The legacy
 * fallback logs a one-time deprecation warning; the new name never does.
 *
 * @param name - Must be a `FLUXOR_`-prefixed env var name.
 */
export function readBrandEnv(name: `FLUXOR_${string}`): string | undefined {
  const current = process.env[name];
  if (current !== undefined) return current;

  // Legacy compat: pre-rename deployments/scripts may still export HELIOX_*.
  const legacy = name.replace(/^FLUXOR_/, 'HELIOX_');
  const legacyValue = process.env[legacy];
  if (legacyValue !== undefined) {
    warnOnce(`${legacy} está deprecada; usa ${name}`);
  }
  return legacyValue;
}
