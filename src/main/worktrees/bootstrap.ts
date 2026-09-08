/**
 * bootstrap.ts — Making a fresh worktree runnable (Cockpit F2)
 *
 * Responsibility:
 * - Decides which command turns an empty worktree into a working checkout
 *   (lockfile detection, plus a per-project override the user can set once).
 * - Runs it with its cwd inside the worktree and streams its output line by
 *   line, so the session's own terminal is the log surface.
 *
 * Boundaries:
 * - Owns: the lockfile → command table, the override file's shape, the run and
 *   its timeout.
 * - Does NOT own: worktrees (worktree-manager.ts), IPC (ipc-worktrees.ts), or
 *   where a project's config directory lives (ipc-handlers.ts owns that path).
 *
 * Architectural role:
 * - Pure main-process module: node `fs`/`child_process` only, no Electron, so
 *   the whole file is unit-testable without an app instance.
 *
 * Why a worktree needs this at all: `git worktree add` carries the tracked
 * files and nothing else. `node_modules` is not in the tree, so an agent that
 * opens in a fresh worktree cannot build, cannot test, and cannot tell that
 * from a broken repository.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Ten minutes. A cold `pnpm install` here was measured at 17 s; this is the runaway guard. */
export const BOOTSTRAP_TIMEOUT_MS = 600_000;
/** The shell's own convention for "killed by a timeout" — `timeout(1)` uses 124 too. */
export const BOOTSTRAP_TIMEOUT_EXIT_CODE = 124;
/** Per-project override, in the project's config directory (userData, never the tree). */
export const COCKPIT_CONFIG_FILE = 'cockpit.json';

export interface CockpitProjectConfig {
  /**
   * `undefined` — never set, so detection decides.
   * `null`      — explicitly NONE: this project needs no bootstrap, and that is
   *               a decision, not a gap. Detection must not undo it.
   * `string`    — run exactly this.
   */
  bootstrapCommand?: string | null;
}

export interface BootstrapResolution {
  detected: string | null;
  override: string | null | undefined;
  effective: string | null;
}

export interface BootstrapRunResult {
  exitCode: number;
  durationMs: number;
}

/**
 * Lockfile → the command that installs from it, offline-first.
 *
 * `--prefer-offline` and not `--offline`, measured in javadaba-web on
 * 2026-09-08: a pure `--offline` install linked 1,701 packages in 17 s and
 * then FAILED on one tarball missing from the local store. Preferring the
 * store and falling back to the network is the only variant that finishes.
 * The frozen-lockfile flags are not performance — they are what stops a
 * bootstrap from rewriting the lockfile of the repository it was cloned from.
 */
const LOCKFILE_COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ['pnpm-lock.yaml', 'pnpm install --prefer-offline --frozen-lockfile'],
  ['package-lock.json', 'npm ci --prefer-offline'],
  ['yarn.lock', 'yarn install --frozen-lockfile'],
];

/**
 * `null` when nothing is recognised — a project with no lockfile needs no
 * bootstrap, and inventing one for it would make every session pay for a
 * command that cannot succeed.
 */
export function detectBootstrapCommand(projectRoot: string): string | null {
  for (const [lockfile, command] of LOCKFILE_COMMANDS) {
    if (fs.existsSync(path.join(projectRoot, lockfile))) return command;
  }
  return null;
}

/** The override wins whenever it EXISTS, `null` included. */
export function effectiveBootstrapCommand(
  detected: string | null,
  override: string | null | undefined,
): string | null {
  return override === undefined ? detected : override;
}

export async function readCockpitConfig(configDir: string): Promise<CockpitProjectConfig> {
  try {
    const raw = await fs.promises.readFile(path.join(configDir, COCKPIT_CONFIG_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as CockpitProjectConfig;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Absent or unreadable config is the same answer: nothing is overridden.
    return {};
  }
}

/** Merges into whatever else the file holds — this is not the only key it will ever have. */
export async function writeBootstrapOverride(
  configDir: string,
  command: string | null,
): Promise<void> {
  const current = await readCockpitConfig(configDir);
  const next: CockpitProjectConfig = { ...current, bootstrapCommand: command };
  await fs.promises.mkdir(configDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(configDir, COCKPIT_CONFIG_FILE),
    `${JSON.stringify(next, null, 2)}\n`,
    'utf-8',
  );
}

export async function resolveBootstrap(
  projectRoot: string,
  configDir: string,
): Promise<BootstrapResolution> {
  const detected = detectBootstrapCommand(projectRoot);
  const config = await readCockpitConfig(configDir);
  const override = 'bootstrapCommand' in config ? config.bootstrapCommand : undefined;
  return { detected, override, effective: effectiveBootstrapCommand(detected, override) };
}

/**
 * Runs `command` inside `worktreePath`, calling `onLine` once per output line
 * (stdout and stderr interleaved, in arrival order).
 *
 * `/bin/sh -c` rather than an argv array because what is stored is a COMMAND
 * as a person would type it — `pnpm install --prefer-offline --frozen-lockfile`
 * — and re-deriving argv from a string is how a quoting bug gets written. The
 * string comes from this machine's own config file, not from a network.
 */
export function runBootstrap(
  worktreePath: string,
  command: string,
  onLine: (line: string) => void,
  opts: { timeoutMs?: number } = {},
): Promise<BootstrapRunResult> {
  const timeoutMs = opts.timeoutMs ?? BOOTSTRAP_TIMEOUT_MS;
  const startedAt = Date.now();

  return new Promise<BootstrapRunResult>((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd: worktreePath,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    let timedOut = false;
    let settled = false;

    const emit = (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        onLine(buffer.slice(0, nl).replace(/\r$/, ''));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    };

    child.stdout?.on('data', (d: Buffer) => emit(d.toString('utf-8')));
    child.stderr?.on('data', (d: Buffer) => emit(d.toString('utf-8')));

    // SIGTERM first so a package manager can unwind its own temp files, then
    // SIGKILL — a bootstrap that ignores TERM must still not outlive the app.
    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref?.();
    }, timeoutMs);

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      // A last line with no trailing newline is still a line.
      if (buffer.trim()) onLine(buffer.replace(/\r$/, ''));
      buffer = '';
      resolve({ exitCode, durationMs: Date.now() - startedAt });
    };

    child.on('error', (err) => {
      onLine(`bootstrap could not start: ${err.message}`);
      finish(127);
    });
    child.on('close', (code, signal) => {
      if (timedOut) return finish(BOOTSTRAP_TIMEOUT_EXIT_CODE);
      // A signalled death has no exit code; 128+n is the shell's own encoding.
      finish(typeof code === 'number' ? code : (signal ? 143 : 1));
    });
  });
}
