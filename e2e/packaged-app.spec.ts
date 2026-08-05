/**
 * e2e/packaged-app.spec.ts — Smoke tests against the PACKAGED application
 *
 * Why this file exists (and why it is different from every other spec here):
 *
 * Every other E2E spec launches Electron against the repo root — the dev bundle,
 * with the whole `node_modules` tree sitting right next to it (see
 * `e2e/global-setup.ts`, which even starts the renderer dev server). That is a
 * fine harness for UI behaviour, but it is structurally blind to an entire
 * class of defect: anything that only breaks once the app is *packaged*.
 *
 * The concrete one this file was written for: `@electron-forge/plugin-vite` does
 * not copy `node_modules` when packaging, so a module the main bundle keeps
 * `external` (better-sqlite3, jsdom, playwright — see `vite.main.config.ts` and
 * the `EXTERNAL_MODULES` hook in `forge.config.ts`) simply is not there at
 * runtime. Symptom: the installed app's main process throws MODULE_NOT_FOUND at
 * startup and NEVER opens a window. Development never notices.
 *
 * Isolation contract — this suite must not touch the developer's real data:
 *  - `--user-data-dir` points inside this suite's own temp directory, so
 *    electron-store, the SQLite file and `fluxor.log` land there.
 *  - `cwd` ALSO points inside that temp directory. `--user-data-dir` alone is
 *    not enough: `src/main/index.ts` calls `migrateLegacyDirectories(process.cwd())`
 *    at startup (it *renames* a legacy `./heliox` directory to `./fluxor`), and
 *    several main-process modules write `./.fluxor/**` relative to the cwd.
 *    Launching with the repo as cwd would let the suite rewrite the working tree.
 *
 * Running it: `npm run package` first (or `npm run test:e2e:packaged`, which
 * does both). Without a packaged app present the tests skip with a pointer
 * rather than failing a plain `npx playwright test` on a fresh clone.
 */
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '..');

/**
 * Path of the packaged executable Electron Packager produced for this host.
 *
 * Packager's output directory is `out/<productName>-<platform>-<arch>` and the
 * binary name is pinned by `packagerConfig.executableName` ("fluxor-ide"), so
 * both are derivable — no globbing, no guessing which build is the fresh one.
 */
function packagedExecutablePath(): string {
  const dir = path.join(REPO_ROOT, 'out', `Fluxor IDE-${process.platform}-${process.arch}`);

  if (process.platform === 'darwin') {
    return path.join(dir, 'Fluxor IDE.app', 'Contents', 'MacOS', 'fluxor-ide');
  }
  if (process.platform === 'win32') {
    return path.join(dir, 'fluxor-ide.exe');
  }
  return path.join(dir, 'fluxor-ide');
}

const executablePath = packagedExecutablePath();
const packaged = fs.existsSync(executablePath);

test.describe('Packaged application', () => {
  test.skip(!packaged, `No packaged app at ${executablePath} — run \`npm run package\` first.`);

  let app: ElectronApplication;
  let sandbox: string;

  test.beforeAll(async () => {
    // One sandbox for both the userData dir and the process cwd (see header).
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxor-packaged-e2e-'));
    const userDataDir = path.join(sandbox, 'user-data');
    const workDir = path.join(sandbox, 'cwd');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });

    app = await electron.launch({
      executablePath,
      args: [`--user-data-dir=${userDataDir}`],
      cwd: workDir,
      // Deliberately NOT the dev env of `e2e/test-helpers.ts`: this run must
      // exercise the production code path (renderer loaded from inside the
      // asar, no dev server).
      env: {
        ...(process.env as Record<string, string>),
        FLUXOR_MODELS: process.env.FLUXOR_E2E_MODELS ?? 'copilot',
      },
      timeout: 60_000,
    });
  });

  test.afterAll(async () => {
    await app?.close();
    if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
  });

  test('opens its main window', async () => {
    // The regression this whole file guards: with `node_modules` missing from
    // the package, the main process died on `require("better-sqlite3")` before
    // `createWindow()` and this call timed out.
    const window = await app.firstWindow({ timeout: 60_000 });
    await window.waitForLoadState('domcontentloaded');
    expect(await window.title()).toBeTruthy();
  });

  test('ships the externalised main-process modules it requires at runtime', async () => {
    // `better-sqlite3` and `jsdom` are proven by the window opening at all —
    // the bundle requires both at module scope, before `createWindow()`.
    // `playwright` is the third external and is loaded LAZILY (a runtime
    // `await import('playwright')` in the snapshot engine, plus
    // `playwright-core/cli.js` spawned by path in snapshot-browser-installer.ts,
    // whose header states the file "lives inside app.asar"). Nothing at startup
    // would notice it missing, so assert it explicitly from the main process.
    const resolved = await app.evaluate(async () => {
      // `playwright-core/package.json` and not `…/cli.js`: playwright-core's
      // "exports" map blocks the deep import, which is exactly why
      // `playwrightCliPath()` resolves the manifest and joins 'cli.js' next to
      // it. Mirror that resolution so this assertion tests the real path.
      // `require` is not in scope inside an evaluated function, so rebuild one
      // anchored at the main bundle — the exact resolution base the app itself
      // uses at runtime.
      const mainModule = (process as unknown as { mainModule: NodeJS.Module }).mainModule;
      const { createRequire } = mainModule.require('module') as typeof import('module');
      const requireFromMain = createRequire(mainModule.filename);

      const results: Record<string, string> = {};
      for (const request of ['playwright', 'playwright-core/package.json']) {
        try {
          results[request] = requireFromMain.resolve(request);
        } catch (error) {
          results[request] = `FAILED: ${(error as Error).message}`;
        }
      }
      return results;
    });

    expect(resolved['playwright']).not.toContain('FAILED');
    expect(resolved['playwright-core/package.json']).not.toContain('FAILED');
  });

  test('serves the renderer from the package, not from a dev server', async () => {
    const window = await app.firstWindow();
    // A packaged build loads `file://…/index.html` (src/main/index.ts uses
    // loadFile when MAIN_WINDOW_VITE_DEV_SERVER_URL is undefined). Seeing an
    // http:// URL here would mean the run silently attached to a dev server and
    // proved nothing about the package.
    expect(window.url()).toMatch(/^file:\/\//);
  });

  test('reaches the native SQLite layer through IPC', async () => {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // `db:status` runs a real query through better-sqlite3 in the main process,
    // so it can only answer if the native addon was both shipped and loadable —
    // i.e. it also covers `asar.unpack: '**/*.node'`, since dlopen cannot read
    // a shared library from inside an archive.
    const status = await window.evaluate(async () => {
      const api = (window as unknown as {
        fluxorAPI?: { dbStatus?: () => Promise<unknown> };
      }).fluxorAPI;
      if (!api?.dbStatus) return { missing: true };
      return await api.dbStatus();
    });

    expect(status).not.toMatchObject({ missing: true });
    expect(status).toMatchObject({ success: true });
  });

  test('writes its data inside the sandbox, not next to the sources', async () => {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // The isolation half of the contract (see header). Asserting the redirect
    // actually took effect is the only way to know the suite is not quietly
    // running against — and mutating — the developer's own working tree.
    // `getDatabasePath()` is `<userData>/app.db`, so the SQLite file landing in
    // the sandbox proves both that the redirect took and that migrations ran
    // against this run's own database rather than the developer's.
    expect(fs.existsSync(path.join(sandbox, 'user-data', 'app.db'))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, 'app.db'))).toBe(false);
  });
});
