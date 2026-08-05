/**
 * forge.config.ts — Project runtime
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import type { MakerSquirrelConfig } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ── Code signing — env-gated, degrades to unsigned builds (audit 1.1) ───────
// None of these secrets exist in this repo yet, so every branch below is
// unreachable today and CI/local builds stay unsigned — that is expected
// (see docs/RELEASE_CHECKLIST.md). Nothing here throws or warns when the
// vars are absent; one summary line is logged at config-evaluation time
// ("package"/"make"/"publish"/"start" all read this file) so it is visible
// but never spammy.
//
// macOS:
//   APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID  — all three enable
//     osxNotarize (notarytool, app-specific-password strategy). Notarization
//     requires a signed app, so their presence also turns on osxSign.
//   OSX_SIGN_IDENTITY                           — explicit codesign identity
//     string (e.g. "Developer ID Application: Fluxor, Inc. (TEAMID)").
//     Optional even while notarizing: omit it and @electron/osx-sign
//     auto-discovers a "Developer ID Application" certificate from the
//     default keychain (`osxSign: true`).
//
// Windows (Squirrel):
//   WINDOWS_SIGN_PARAMS                          — raw signtool.exe params
//     string, passed through as-is (covers cloud/EV-cert signing setups).
//   WINDOWS_CERTIFICATE_FILE (+ WINDOWS_CERTIFICATE_PASSWORD) — simple
//     file-based Authenticode signing. Ignored when WINDOWS_SIGN_PARAMS is set.
interface MacSigningConfig {
  osxSign?: true | { identity: string };
  osxNotarize?: { appleId: string; appleIdPassword: string; teamId: string };
}

function resolveMacSigningConfig(): MacSigningConfig {
  const { APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID, OSX_SIGN_IDENTITY } = process.env;
  const notarizeReady = Boolean(APPLE_ID && APPLE_ID_PASSWORD && APPLE_TEAM_ID);
  const shouldSign = Boolean(OSX_SIGN_IDENTITY) || notarizeReady;

  if (!shouldSign) return {};

  return {
    osxSign: OSX_SIGN_IDENTITY ? { identity: OSX_SIGN_IDENTITY } : true,
    ...(notarizeReady
      ? { osxNotarize: { appleId: APPLE_ID!, appleIdPassword: APPLE_ID_PASSWORD!, teamId: APPLE_TEAM_ID! } }
      : {}),
  };
}

type WindowsSigningConfig = Pick<MakerSquirrelConfig, 'signWithParams' | 'certificateFile' | 'certificatePassword'>;

function resolveWindowsSigningConfig(): WindowsSigningConfig {
  const { WINDOWS_SIGN_PARAMS, WINDOWS_CERTIFICATE_FILE, WINDOWS_CERTIFICATE_PASSWORD } = process.env;

  if (WINDOWS_SIGN_PARAMS) return { signWithParams: WINDOWS_SIGN_PARAMS };

  if (WINDOWS_CERTIFICATE_FILE) {
    return {
      certificateFile: WINDOWS_CERTIFICATE_FILE,
      ...(WINDOWS_CERTIFICATE_PASSWORD ? { certificatePassword: WINDOWS_CERTIFICATE_PASSWORD } : {}),
    };
  }

  return {};
}

const macSigning = resolveMacSigningConfig();
const windowsSigning = resolveWindowsSigningConfig();

console.log(
  `[forge.config] macOS signing: ${macSigning.osxSign ? 'ENABLED' : 'unsigned'}` +
  `${macSigning.osxNotarize ? ' + notarization' : ''} · ` +
  `Windows signing: ${Object.keys(windowsSigning).length > 0 ? 'ENABLED' : 'unsigned'}`
);

// Per-push CI builds (ci.yml `build` job) set FLUXOR_MAKE_ZIP_ONLY=1 to emit a
// fast, dependency-light .zip of the packaged app on every OS — a real runnable
// build without the native/optional toolchains the polished installers need
// (maker-dmg's darwin-only `appdmg`, Squirrel.Windows, deb/rpm). Tagged
// releases (release.yml) and local `make` still build the full installer set.
// Legacy compat: HELIOX_MAKE_ZIP_ONLY is accepted as a deprecated fallback
// (Annex A env-var contract) — this stays a self-contained check rather than
// importing src/main's shared env-compat helper, since electron-forge loads
// this config directly, outside the app's Vite bundle.
const legacyZipOnlyEnv = process.env.HELIOX_MAKE_ZIP_ONLY; // Legacy compat
if (legacyZipOnlyEnv !== undefined && process.env.FLUXOR_MAKE_ZIP_ONLY === undefined) {
  console.warn('[forge.config] legacy HELIOX_MAKE_ZIP_ONLY is deprecated; use FLUXOR_MAKE_ZIP_ONLY');
}
const zipOnly = (process.env.FLUXOR_MAKE_ZIP_ONLY ?? legacyZipOnlyEnv) === '1';

// maker-dmg needs the darwin-only native `appdmg`, whose macos-alias/fs-xattr
// addons don't compile on hosted macOS runners (old native code, no prebuilds),
// so npm drops the optional chain and MakerDMG throws "Cannot find module
// 'appdmg'". Build the DMG only where appdmg actually resolved (local mac dev);
// CI ships the portable mac .zip instead — which is also exactly what
// Squirrel.Mac auto-update consumes, so the mac update path is unaffected.
const appdmgAvailable = existsSync('node_modules/appdmg/package.json');

/**
 * Modules that are NOT bundled and therefore have to travel inside the package
 * as real files.
 *
 * `vite.main.config.ts` marks these `external` on purpose:
 *  - `better-sqlite3` is a native addon — bundling it breaks the resolution of
 *    its `.node` binary.
 *  - `jsdom` reads its own on-disk assets via `__dirname`-relative
 *    `fs.readFileSync`, which bundling rewrites into ENOENT.
 *  - `playwright` is loaded through a runtime `await import('playwright')` (see
 *    src/snapshot-engine/runner.ts) and `snapshot-browser-installer.ts` spawns
 *    `playwright-core/cli.js` *by path*, explicitly assuming that file "lives
 *    inside app.asar".
 *
 * But `@electron-forge/plugin-vite` **does not copy `node_modules` when
 * packaging**: its own `packageAfterCopy` writes only a `package.json`, and its
 * `ignore` lets through just `/.vite`, on the assumption that everything is
 * bundled. Without the hook below the packaged app therefore ships an asar
 * whose only top-level entries are `/.vite` and `/package.json` — so the main
 * process runs `require("better-sqlite3")` at startup, throws MODULE_NOT_FOUND
 * before any handler is installed, and the app never opens a window. **None of
 * this is visible in development**, where `node_modules` is right there next to
 * the sources, nor in the E2E suite, which launches the dev bundle from the
 * repo root (see e2e/global-setup.ts) rather than the packaged binary.
 */
const EXTERNAL_MODULES = ['better-sqlite3', 'jsdom', 'playwright'];

/**
 * Dependencies that only exist to compile/download a binary at INSTALL time and
 * are never used at runtime. `better-sqlite3` declares `prebuild-install`,
 * which drags in ~20 packages (tar-fs, rc, semver…) of pure noise. The whole
 * branch is pruned, not just its root.
 */
const INSTALL_TIME_ONLY = new Set(['prebuild-install']);

/**
 * Directory a dependency actually resolves to, following npm's own rule: a
 * nested `<parent>/node_modules/<dep>` wins over the hoisted top-level copy.
 *
 * This distinction is not academic. npm leaves `jsdom/node_modules/tr46@6`
 * nested (the hoisted `tr46` is a different major), and only that nested copy
 * declares — and requires — `punycode`. A walker that reads the hoisted
 * manifests only never sees `punycode`, and `require('jsdom')` dies with
 * "Cannot find module 'punycode/'" in the packaged app while resolving
 * perfectly in development.
 */
function resolveModuleDir(fromDir: string, dependency: string): string | null {
  // Node's own algorithm: try `<dir>/node_modules/<dep>` for the module's own
  // directory and then every ancestor, up to the project root. Checking only
  // the immediate directory would miss the common shape where npm nests a
  // conflicting major one level up — `jsdom/node_modules/whatwg-url` resolving
  // `tr46` from `jsdom/node_modules/tr46@6`, not from the hoisted `tr46@5`.
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', dependency);
    if (existsSync(join(candidate, 'package.json'))) return candidate;

    const parent = dirname(dir);
    if (parent === dir || parent === '.' || parent === '') break;
    dir = parent;
  }

  const hoisted = join('node_modules', dependency);
  if (existsSync(join(hoisted, 'package.json'))) return hoisted;

  return null;
}

/**
 * Top-level module names whose trees have to be copied so the external modules
 * can resolve every `require` they make, computed by walking manifests.
 *
 * Deliberately computed rather than hand-listed: `jsdom` alone pulls in 37
 * transitive packages. A hand-maintained list is a time bomb — forget one
 * transitive dep, the package still builds without an error, and the installed
 * app dies the first time it touches that code path.
 *
 * Only top-level names are returned: nested `node_modules` travel along with
 * their parent's recursive copy, but they are still *traversed*, because their
 * own dependencies may resolve back out to hoisted packages (see
 * `resolveModuleDir`).
 */
function dependencyClosure(roots: string[]): string[] {
  const topLevel = new Set<string>();
  const visited = new Set<string>();
  const pending: string[] = [];

  for (const root of roots) {
    const dir = join('node_modules', root);
    if (!existsSync(join(dir, 'package.json'))) continue;
    topLevel.add(root);
    pending.push(dir);
  }

  while (pending.length > 0) {
    const dir = pending.pop()!;
    if (visited.has(dir)) continue;
    visited.add(dir);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require(join(process.cwd(), dir, 'package.json')) as {
      dependencies?: Record<string, string>;
    };

    for (const dependency of Object.keys(pkg.dependencies ?? {})) {
      if (INSTALL_TIME_ONLY.has(dependency)) continue;

      const resolved = resolveModuleDir(dir, dependency);
      if (!resolved) continue;

      if (resolved === join('node_modules', dependency)) topLevel.add(dependency);
      pending.push(resolved);
    }
  }

  return [...topLevel].sort();
}

const installerMakers = [
  new MakerSquirrel({ name: 'FluxorIDE', authors: 'Fluxor', setupIcon: './assets/icon.ico', ...windowsSigning }),
  ...(appdmgAvailable ? [new MakerDMG({ format: 'ULFO', icon: './assets/icon.icns' })] : []),
  new MakerDeb({
    options: {
      maintainer: 'Fluxor',
      homepage: 'https://helioxide.com',
    },
  }),
  new MakerRpm({ options: { name: 'fluxor-ide' } }),
];

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Fluxor IDE',
    // The deb/rpm makers look for the packaged binary by the lowercase package
    // name ("fluxor-ide"), but Packager names it after `name` ("Fluxor IDE")
    // by default — the mismatch failed the Linux `make` with "could not find
    // the Electron app binary". Pin the executable filename so every maker
    // resolves it consistently across platforms.
    executableName: 'fluxor-ide',
    icon: './assets/icon',
    extraResource: [
      // Playwright's Chromium build is no longer bundled here (audit 1.7 —
      // it alone was >350MB). Packaged builds download it on demand via
      // src/main/snapshot-browser-installer.ts, the first time a snapshot
      // run actually needs it.
      './assets/icon.png',
    ],
    asar: {
      // The native `.node` addon has to stay OUTSIDE the asar: `dlopen` cannot
      // load a shared library from inside an archive.
      unpack: '**/*.node',
    },
    ...macSigning,
  },
  hooks: {
    // See EXTERNAL_MODULES above for why this hook has to exist at all.
    async packageAfterCopy(_forgeConfig, buildPath) {
      const { cp, mkdir } = await import('node:fs/promises');
      const destination = join(buildPath, 'node_modules');
      await mkdir(destination, { recursive: true });

      const modules = dependencyClosure(EXTERNAL_MODULES);
      for (const moduleName of modules) {
        await cp(join('node_modules', moduleName), join(destination, moduleName), {
          recursive: true,
          // `dereference`: @javadaba/daba-engine comes in through `npm link`
          // while the private registry has no token, and a symlink inside a
          // .app does not survive the copy. Harmless for the others.
          dereference: true,
        });
      }
      console.log(`[forge.config] External modules packaged (${modules.length}): ${modules.join(', ')}`);
    },
  },
  makers: [
    // Always produced: a portable .zip of the packaged app on every OS — the
    // reliable per-push CI artifact. Installers are added on top unless a
    // zip-only build was requested (see `zipOnly` above).
    new MakerZIP({}, ['darwin', 'linux', 'win32']),
    ...(zipOnly ? [] : installerMakers),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.ts' },
        { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts' },
      ],
      renderer: [
        { name: 'main_window', config: 'vite.renderer.config.ts' },
      ],
    }),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: 'CMolG',
        name: 'fluxor-ide',
      },
      // Full (non-prerelease) releases only — update.electronjs.org and GitHub's
      // /releases/latest both EXCLUDE prereleases, so auto-update and the web's
      // stable-download resolution can only ever see a non-prerelease release.
      prerelease: false,
      // Audit 1.10 — CI always produces a draft. A human runs the QA matrix
      // in docs/RELEASE_CHECKLIST.md and clicks "Publish" once the
      // checksums job (release.yml) has attached SHA256SUMS; nothing goes
      // live to users straight off a tag push.
      draft: true,
    }),
  ],
};

export default config;
