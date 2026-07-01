/**
 * snapshot-browser-installer.ts — On-demand Chromium for the snapshot engine (audit 1.7)
 *
 * Packaged builds used to ship `node_modules/playwright/.local-browsers` as an
 * `extraResource` (forge.config.ts) — on its own that was >350MB and inflated
 * every installer. It is no longer bundled. Instead, the one Chromium build
 * `SnapshotRunner` (src/snapshot-engine/runner.ts) needs is downloaded once,
 * lazily, the first time a snapshot run actually starts.
 *
 * Contract:
 *  - Dev (non-packaged): no-op. Playwright resolves browsers from
 *    node_modules exactly as it always has (whatever `npx playwright install`
 *    put there locally) — nothing about the dev workflow changes.
 *  - Packaged: browsers live under `{userData}/pw-browsers`. If that
 *    directory is missing/empty, spawn Playwright's own bundled CLI
 *    (`playwright-core/cli.js`) with `install chromium`, targeting that
 *    directory via the PLAYWRIGHT_BROWSERS_PATH env var. The spawned process
 *    is `process.execPath` (the Electron binary itself — a plain system
 *    Node.js is not guaranteed to exist on the user's machine) run with
 *    ELECTRON_RUN_AS_NODE=1, which keeps Electron's asar-aware module
 *    loading active (needed because playwright-core/cli.js lives inside
 *    app.asar) while behaving like plain Node for this one-shot script.
 *
 * IMPORTANT — env var ordering: Playwright's browser registry resolves and
 * *caches* its lookup directory from PLAYWRIGHT_BROWSERS_PATH the moment
 * 'playwright' is first loaded into a process — see
 * node_modules/playwright-core/lib/server/registry/index.js, where
 * `registryDirectory` is a module-level constant computed once via an IIFE.
 * That is why `snapshot-engine/runner.ts` imports 'playwright' *lazily*
 * (dynamic `import()` inside `SnapshotRunner.init()`) instead of as a static
 * top-level import — `init()` is only ever called after `ensureSnapshotBrowsers()`
 * (below) has set this env var, in `agent-manager.ts#initialize`. Do not
 * change that back to a static import without re-solving this ordering
 * problem; doing so would silently make Playwright ignore the directory this
 * module downloads into.
 */
import { app } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import { existsSync, readdirSync } from 'fs';

/** Thrown when the one-time Chromium download cannot complete. */
export class SnapshotBrowserInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotBrowserInstallError';
  }
}

const OFFLINE_GUIDANCE =
  'Snapshot engine needs a one-time browser download. Check your internet connection and try again.';

/** Progress callback — human-readable status lines, not structured events (see module header). */
export type SnapshotBrowserProgress = (message: string) => void;

// Dedupe concurrent callers (e.g. two flows kicking off snapshot runs back to
// back) onto a single in-flight install instead of racing two installers
// against the same target directory.
let inFlight: Promise<void> | null = null;

export function snapshotBrowsersDir(): string {
  return path.join(app.getPath('userData'), 'pw-browsers');
}

/**
 * Cheap, version-agnostic "is something installed here" check: a non-empty
 * target directory. Deliberately does not parse Playwright's internal
 * per-browser directory naming (that is an implementation detail that
 * changes across Playwright versions) — worst case a corrupted prior install
 * surfaces as a clear launch-time error from Playwright itself, not a silent
 * wrong answer here.
 */
export function isAlreadyInstalled(dir: string): boolean {
  try {
    return existsSync(dir) && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * Locate playwright-core's CLI entry on disk. `playwright-core`'s package.json
 * "exports" map blocks deep imports like `playwright-core/cli` (verified
 * against this repo's installed version — see snapshot-browser-installer.test.ts),
 * so it must be resolved via the one stable, always-exported subpath
 * (`./package.json`) and joined with the known-fixed `cli.js` filename next to
 * it. This works identically unpacked and inside app.asar: Node's resolver and
 * Electron's asar-fs patches both apply to the process calling this.
 */
export function resolvePlaywrightCliEntry(): string {
  const pkgJsonPath = require.resolve('playwright-core/package.json');
  return path.join(path.dirname(pkgJsonPath), 'cli.js');
}

function runInstall(targetDir: string, onProgress?: SnapshotBrowserProgress): Promise<void> {
  return new Promise((resolve, reject) => {
    let cliEntry: string;
    try {
      cliEntry = resolvePlaywrightCliEntry();
    } catch (err) {
      reject(new SnapshotBrowserInstallError(
        `Could not locate Playwright's CLI to install browsers: ${err instanceof Error ? err.message : String(err)}`,
      ));
      return;
    }

    onProgress?.('Downloading Chromium for snapshot runs (one-time)…');

    const child = spawn(process.execPath, [cliEntry, 'install', 'chromium'], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PLAYWRIGHT_BROWSERS_PATH: targetDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) onProgress?.(text);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) onProgress?.(text);
    });

    child.on('error', (err) => {
      reject(new SnapshotBrowserInstallError(`${OFFLINE_GUIDANCE} (${err.message})`));
    });

    child.on('close', (code) => {
      if (code === 0 && isAlreadyInstalled(targetDir)) {
        onProgress?.('Snapshot browser ready.');
        resolve();
      } else {
        reject(new SnapshotBrowserInstallError(OFFLINE_GUIDANCE));
      }
    });
  });
}

/**
 * Ensures a Chromium build is available for the snapshot engine, downloading
 * it once (packaged builds only) if missing. Safe to call every time a
 * snapshot run starts — resolves immediately once installed, and concurrent
 * calls share one in-flight install.
 *
 * Call this lazily, right before the first `SnapshotRunner.init()` of a
 * session (see agent-manager.ts#initialize) — never at app boot.
 */
export function ensureSnapshotBrowsers(onProgress?: SnapshotBrowserProgress): Promise<void> {
  if (!app.isPackaged) {
    // Dev: identical to today — Playwright resolves node_modules/.local-browsers
    // (or wherever `npx playwright install` put them) on its own.
    return Promise.resolve();
  }

  const targetDir = snapshotBrowsersDir();
  // Set unconditionally and *before* anything might load 'playwright' — see
  // the ordering note in the module header. Idempotent and cheap even when
  // already installed.
  process.env.PLAYWRIGHT_BROWSERS_PATH = targetDir;

  if (isAlreadyInstalled(targetDir)) {
    return Promise.resolve();
  }

  if (!inFlight) {
    inFlight = runInstall(targetDir, onProgress).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
