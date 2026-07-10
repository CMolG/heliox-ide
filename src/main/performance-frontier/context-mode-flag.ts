/**
 * `--context-mode` CLI flag (Step P1, docs/superpowers/plans/2026-07-10-flow-context-modes.md).
 *
 * Shared by `pf:run` (cli.ts) and `pf:bench` (bench/cli.ts) — pulled out of
 * both call sites (rather than copy-pasted, unlike `parseSuite`/`parseSeed`,
 * which legitimately diverge per-CLI in their valid-suite lists) because the
 * validation here is byte-identical in both places and this is new code, not
 * an existing convention to preserve. Pure functions taking `argv`/a logger
 * as parameters (never reading `process.argv`/`console` directly) so they are
 * unit-testable without spawning a CLI subprocess.
 */
import type { PFContextMode, PFSuite } from './types';

export const VALID_PF_CONTEXT_MODES: readonly PFContextMode[] = ['blind', 'feedback'];

/**
 * Suites that never call `executeAgenticFlow` (see runner.ts) — today, only
 * `flow-assembler` (it drives `assemblePipeline` directly and never touches
 * an `AgenticFlow`). `--context-mode` has structurally nothing to affect for
 * these suites; `warnIfContextModeIsNoop` surfaces that instead of silently
 * accepting a flag that does nothing.
 */
export const CONTEXT_MODE_NOOP_SUITES: readonly PFSuite[] = ['flow-assembler'];

/**
 * Parses `--context-mode=blind|feedback` out of an argv array.
 * Returns `undefined` when the flag is absent (caller then defaults to
 * whatever the flow itself carries — see runner.ts). Throws a clear,
 * actionable error for any other value, matching this codebase's existing
 * `--suite=` validation style (cli.ts/bench/cli.ts `parseSuite`).
 */
export function parseContextModeFlag(argv: readonly string[]): PFContextMode | undefined {
  const arg = argv.find((item) => item.startsWith('--context-mode='));
  if (!arg) return undefined;

  const value = arg.slice('--context-mode='.length);
  if ((VALID_PF_CONTEXT_MODES as readonly string[]).includes(value)) {
    return value as PFContextMode;
  }

  throw new Error(
    `Invalid --context-mode "${value}". Expected one of: ${VALID_PF_CONTEXT_MODES.join(', ')}.`,
  );
}

/**
 * Warns (does not throw — the run still proceeds normally in blind) when
 * `--context-mode` was explicitly passed for a suite that can never act on
 * it. Silence here would look like the flag was honored when it structurally
 * cannot be.
 */
export function warnIfContextModeIsNoop(
  suite: PFSuite | undefined,
  contextMode: PFContextMode | undefined,
  log: (message: string) => void = console.warn,
): void {
  if (!contextMode || !suite) return;
  if (!CONTEXT_MODE_NOOP_SUITES.includes(suite)) return;

  log(
    `[Performance Frontier] --context-mode=${contextMode} is a no-op for suite "${suite}" — `
    + 'it never executes an AgenticFlow (see runner.ts).',
  );
}
