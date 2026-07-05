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
//     string (e.g. "Developer ID Application: Heliox, Inc. (TEAMID)").
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

// Per-push CI builds (ci.yml `build` job) set HELIOX_MAKE_ZIP_ONLY=1 to emit a
// fast, dependency-light .zip of the packaged app on every OS — a real runnable
// build without the native/optional toolchains the polished installers need
// (maker-dmg's darwin-only `appdmg`, Squirrel.Windows, deb/rpm). Tagged
// releases (release.yml) and local `make` still build the full installer set.
const zipOnly = process.env.HELIOX_MAKE_ZIP_ONLY === '1';

const installerMakers = [
  new MakerSquirrel({ name: 'HelioxIDE', ...windowsSigning }),
  new MakerDMG({ format: 'ULFO' }),
  new MakerDeb({
    options: {
      maintainer: 'Heliox',
      homepage: 'https://heliox.dev',
    },
  }),
  new MakerRpm({ options: { name: 'heliox-ide' } }),
];

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Heliox IDE',
    // The deb/rpm makers look for the packaged binary by the lowercase package
    // name ("heliox-ide"), but Packager names it after `name` ("Heliox IDE")
    // by default — the mismatch failed the Linux `make` with "could not find
    // the Electron app binary". Pin the executable filename so every maker
    // resolves it consistently across platforms.
    executableName: 'heliox-ide',
    icon: './assets/icon',
    extraResource: [
      // Playwright's Chromium build is no longer bundled here (audit 1.7 —
      // it alone was >350MB). Packaged builds download it on demand via
      // src/main/snapshot-browser-installer.ts, the first time a snapshot
      // run actually needs it.
      './assets/icon.png',
    ],
    asar: true,
    ...macSigning,
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
        name: 'heliox-ide',
      },
      prerelease: true,
      // Audit 1.10 — CI always produces a draft. A human runs the QA matrix
      // in docs/RELEASE_CHECKLIST.md and clicks "Publish" once the
      // checksums job (release.yml) has attached SHA256SUMS; nothing goes
      // live to users straight off a tag push.
      draft: true,
    }),
  ],
};

export default config;
