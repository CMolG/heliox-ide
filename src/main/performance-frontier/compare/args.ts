/**
 * `pf:compare` CLI flag parsing (Step P3) — pulled out of cli.ts (which has a
 * side-effecting top-level `main().catch(...)` invocation, like every other
 * PF CLI entry point) into its own side-effect-free module so it can be unit
 * tested by importing it directly, without triggering `main()`.
 */
import type { PFSuite } from '../types';

// Superset of both pf:run's and pf:bench's suite lists (this tool only reads
// the ledger — it never constructs a case, so there is no risk of pointing
// at a suite the runner itself can't produce).
const VALID_SUITES: PFSuite[] = [
  'architecture',
  'analysis',
  'design',
  'business',
  'team-work',
  'flow-assembler',
  'development',
  'business-knowledge',
  'progression',
  'from-scratch',
];

const SUITE_ALIASES: Record<string, PFSuite> = {
  assembler: 'flow-assembler',
  business: 'business-knowledge',
};

function resolveSuiteName(value: string): string {
  if (SUITE_ALIASES[value]) return SUITE_ALIASES[value];
  if ((VALID_SUITES as string[]).includes(value)) return value;
  throw new Error(
    `Invalid PF suite "${value}" in --suites. Expected one of: ${VALID_SUITES.join(', ')} (aliases: assembler→flow-assembler).`,
  );
}

export interface CompareCliArgs {
  seed: number;
  suites?: string[];
}

/**
 * Parses `pf:compare`'s CLI flags out of an argv array. Pure (never reads
 * `process.argv` directly) so it's unit-testable without a subprocess.
 *
 * Edge: `--seed` is REQUIRED here (unlike pf:run's optional `--seed=`,
 * defaulted to 1) — pairing is meaningless without pinning to one exact
 * seed, so a missing/non-numeric value throws a clear, actionable error
 * rather than silently defaulting.
 */
export function parseCompareArgs(argv: readonly string[]): CompareCliArgs {
  const seedArg = argv.find((item) => item.startsWith('--seed='));
  if (!seedArg) {
    throw new Error('--seed=<n> is required (pf:compare pairs runs by exact seed).');
  }
  const rawSeed = seedArg.slice('--seed='.length);
  const seed = Number(rawSeed);
  if (!Number.isFinite(seed)) {
    throw new Error(`--seed must be a finite number, got "${rawSeed}".`);
  }

  const suitesArg = argv.find((item) => item.startsWith('--suites='));
  if (!suitesArg) {
    return { seed };
  }

  const raw = suitesArg.slice('--suites='.length);
  const values = raw.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
  if (values.length === 0) {
    throw new Error('--suites was provided but empty. Omit the flag to compare every suite.');
  }

  return { seed, suites: values.map(resolveSuiteName) };
}
