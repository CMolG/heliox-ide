/**
 * fatal-log.ts — Main process
 *
 * Persists the *reason* an app instance died.
 *
 * `crashReporter` (index.ts, Phase -1) only catches NATIVE crashes — a
 * segfault in Chromium or a native module. It writes nothing for the far more
 * common failure a developer actually hits: an uncaught JavaScript exception
 * in the main process, a rejected promise nobody awaited, or a renderer that
 * got killed. Those paths print to stdout and vanish with the terminal, which
 * makes a dev-mode death forensically silent — empty Crashpad dir, no .ips, no
 * log, nothing to read the morning after.
 *
 * This module closes that gap with four listeners that append one durable line
 * (plus stack) to `<userData>/fluxor.log` and then get out of the way.
 *
 * Behavior-preservation is the whole design constraint here:
 *   - `uncaughtException` uses `prependListener`, so Electron's own handler
 *     (the "A JavaScript error occurred in the main process" dialog in
 *     packaged builds) still runs immediately afterward, unchanged.
 *   - `unhandledRejection` rethrows, because ANY listener on that event
 *     suppresses Node's default `--unhandled-rejections=throw`. Rethrowing
 *     turns it back into an uncaughtException, which is exactly what would
 *     have happened with no listener at all.
 *   - `render-process-gone` / `child-process-gone` are observational only —
 *     Electron has no default behavior for them to override.
 *
 * Net effect: identical crash semantics, plus a file to read.
 */
import { app } from 'electron';
import { log } from './logger';

let installed = false;

/**
 * Installs the fatal-path listeners. Idempotent, and safe to call before
 * `app.whenReady()` — the logger resolves its sink lazily and falls back to
 * `process.cwd()` if `getPath('userData')` is not answerable yet.
 */
export function installFatalHandlers(): void {
  if (installed) return;
  installed = true;

  // Runs BEFORE Electron's built-in handler (see module header) — log, then
  // let the platform do exactly what it does today.
  process.prependListener('uncaughtException', (error: Error, origin: string) => {
    log.fatal(`uncaughtException (origin=${origin}):`, error);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    log.fatal('unhandledRejection:', reason instanceof Error ? reason : String(reason));
    // Restore Node's default: an unhandled rejection is a crash, not a warning.
    throw reason;
  });

  app.on('render-process-gone', (_event, _webContents, details) => {
    // `reason` is 'crashed' | 'oom' | 'killed' | 'launch-failed' | ...
    // A renderer death is what the user experiences as a blank window, so it
    // is worth a fatal line even though the main process survives it.
    log.fatal(`render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });

  app.on('child-process-gone', (_event, details) => {
    // Covers the GPU process, utility processes and pepper plugins. A GPU
    // process that keeps dying is a real, reproducible class of "the app
    // crashed" that leaves no other trace.
    log.fatal(
      `child-process-gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}` +
      (details.name ? ` name=${details.name}` : ''),
    );
  });
}
