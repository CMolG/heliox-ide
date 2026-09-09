/**
 * vendors.ts — Agent vendor registry (Cockpit F1)
 *
 * Responsibility:
 * - Declares the four CLI vendors a session window can host, how each one is
 *   invoked, and how its initial prompt reaches it.
 * - Resolves the binary to launch (with a per-vendor environment override) and
 *   detects which vendors are actually installed on this machine.
 *
 * Boundaries:
 * - Owns: argv shape per vendor, the binary-resolution rule, availability probe.
 * - Does NOT own: spawning (pty-manager.ts), IPC (ipc-pty.ts), or any UI.
 *
 * Architectural role:
 * - Pure module in the main process. It loads no native code and touches no
 *   Electron API, which is what lets both this file and its unit test run
 *   under vitest without a rebuilt `node-pty`.
 *
 * Why the Cockpit launches a vendor CLI at all: the reduced harness does not
 * reimplement a harness — it runs `claude`/`codex`/`opencode` where `.harness/`
 * already lives, so the project's own rules, hooks and skills load unchanged.
 * See `.harness/plans/2026-09-08-fluxor-cockpit-reduced-harness.md` (javadaba-web).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// The id union is declared with the window metadata that carries it
// (src/types/desktop.ts) so the renderer and this registry cannot drift into
// two lists; re-exported here because this file is where vendors are defined.
import type { AgentVendorId } from '../../types/desktop';

export type { AgentVendorId };

export interface AgentVendor {
  id: AgentVendorId;
  label: string;
  /** Default executable name, resolved through PATH unless overridden. */
  bin: string;
  /**
   * How the session's first prompt reaches the agent.
   *  - `'arg'`  — it is part of argv, delivered by the spawn itself.
   *  - `'type'` — the CLI has no initial-prompt flag, so the prompt has to be
   *               TYPED into the live PTY once its TUI is up (see
   *               `PROMPT_TYPE_DELAY_MS` in the renderer's agent-sessions.ts).
   */
  promptDelivery: 'arg' | 'type';
  buildArgs(opts: { prompt?: string; extraArgs?: string[] }): string[];
}

/**
 * Verified on this machine, 2026-09-08, by reading each CLI's own `--help`:
 * `claude [options] [prompt]` and `codex [options] [prompt]` both take the
 * initial prompt as a trailing positional argument. `opencode` in TUI mode is
 * `opencode [project]` — the positional is a DIRECTORY, not a prompt, and the
 * TUI has no initial-prompt flag at all, so passing one there would silently
 * change the working directory instead of asking anything.
 */
export const AGENT_VENDORS: Record<AgentVendorId, AgentVendor> = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    bin: 'claude',
    promptDelivery: 'arg',
    buildArgs: ({ prompt, extraArgs }) => [...(extraArgs ?? []), ...(prompt ? [prompt] : [])],
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    bin: 'codex',
    promptDelivery: 'arg',
    buildArgs: ({ prompt, extraArgs }) => [...(extraArgs ?? []), ...(prompt ? [prompt] : [])],
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    bin: 'opencode',
    promptDelivery: 'type',
    // The prompt is deliberately absent from argv — see `promptDelivery`.
    buildArgs: ({ extraArgs }) => [...(extraArgs ?? [])],
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini CLI',
    bin: 'gemini',
    promptDelivery: 'arg',
    // UNVERIFIED: `gemini` is not installed on this machine (2026-09-08), so
    // `-i <prompt>` is taken from its published docs and has never been run
    // here. First person with it installed should confirm before trusting it.
    buildArgs: ({ prompt, extraArgs }) => [...(extraArgs ?? []), ...(prompt ? ['-i', prompt] : [])],
  },
};

export const AGENT_VENDOR_IDS = Object.keys(AGENT_VENDORS) as AgentVendorId[];

/**
 * Environment variable that overrides a vendor's binary, e.g.
 * `FLUXOR_AGENT_BIN_CLAUDE=/path/to/fake-agent.sh`.
 *
 * This is the e2e seam: the suite points a vendor at a deterministic fixture
 * script instead of the real CLI, so the terminal path is exercised end to end
 * without an LLM, a network call or a login.
 */
export function vendorBinEnvVar(id: AgentVendorId): string {
  return `FLUXOR_AGENT_BIN_${id.toUpperCase()}`;
}

export function resolveVendorBin(vendor: AgentVendor, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[vendorBinEnvVar(vendor.id)];
  return override && override.trim() ? override.trim() : vendor.bin;
}

/**
 * Environment variable that prepends extra arguments to a vendor's argv, e.g.
 * `FLUXOR_AGENT_EXTRA_ARGS_CLAUDE="--model haiku"`.
 *
 * A per-machine DEVELOPER SEAM, deliberately not a setting: it is how the F5
 * field test pins a cheap model and a permission mode for a run of throwaway
 * probes, and how anyone can try a flag against a real CLI without editing the
 * vendor registry. Nothing in the product's UI writes it and nothing reads it
 * back — a flag that belonged in the product would belong in the registry.
 */
export function vendorExtraArgsEnvVar(id: AgentVendorId): string {
  return `FLUXOR_AGENT_EXTRA_ARGS_${id.toUpperCase()}`;
}

/**
 * Splits the variable on whitespace, and that is the WHOLE rule: no quoting,
 * no escapes, no shell.
 *
 * Documented rather than fixed, because the alternative is worse. Implementing
 * quoting here would be a second, subtly different shell parser sitting in
 * front of a spawn that never goes through a shell — the kind of thing that is
 * right for a year and then swallows a `--flag "a b"` in a way nobody can see
 * from the terminal. An argument with a space in it goes in the vendor
 * registry, where it can be a real array element.
 */
export function resolveVendorExtraArgs(
  id: AgentVendorId,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env[vendorExtraArgsEnvVar(id)];
  if (!raw || !raw.trim()) return [];
  return raw.trim().split(/\s+/);
}

export interface VendorAvailability {
  id: AgentVendorId;
  label: string;
  available: boolean;
  /** Absolute path `which` reported, when the vendor is available. */
  path?: string;
}

/** Minimal shape of `promisify(execFile)` — the only part this module uses. */
export type ExecFileFn = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile) as unknown as ExecFileFn;

/**
 * Resolves one binary through `which`, returning its absolute path or `null`.
 *
 * This is also the ONLY reliable way to tell "that CLI is not installed" apart
 * from any other spawn failure: node-pty reports both a missing binary and an
 * unreachable cwd as the same message — `posix_spawnp failed.`, with no
 * `code` — so the spawn path pre-flights with this instead of pattern-matching
 * an error string (measured on macOS, 2026-09-08). `which` also accepts an
 * absolute path, which is what the `FLUXOR_AGENT_BIN_*` override supplies.
 */
export async function whichBin(
  bin: string,
  execFileFn: ExecFileFn = execFileAsync,
): Promise<string | null> {
  try {
    const { stdout } = await execFileFn('which', [bin]);
    return stdout.trim().split('\n')[0]?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Probes every vendor with `which <bin>`. Never throws and never rejects: a
 * missing binary is an ANSWER ("not installed", which the picker renders as a
 * disabled entry with that reason), not an error the caller has to handle.
 */
export async function detectVendors(
  execFileFn: ExecFileFn = execFileAsync,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VendorAvailability[]> {
  return Promise.all(
    AGENT_VENDOR_IDS.map(async (id) => {
      const vendor = AGENT_VENDORS[id];
      const resolved = await whichBin(resolveVendorBin(vendor, env), execFileFn);
      return resolved
        ? { id, label: vendor.label, available: true, path: resolved }
        : { id, label: vendor.label, available: false };
    }),
  );
}
