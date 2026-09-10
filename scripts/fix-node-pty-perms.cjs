/**
 * fix-node-pty-perms.cjs — postinstall repair for node-pty's `spawn-helper`
 *
 * node-pty 1.1.0 ships prebuilt binaries (`prebuilds/<platform>-<arch>/`) and
 * its own install script only checks that the DIRECTORY exists. On macOS the
 * `spawn-helper` in that directory arrives mode 644 — **not executable** — and
 * nothing in the package ever fixes it.
 *
 * The failure that causes is the worst kind: `pty.spawn()` throws
 * `posix_spawnp failed.` with no `code` and no mention of the helper, which is
 * the SAME message you get for a missing binary or an unreachable cwd. Every
 * agent session dies at launch and the error points nowhere. Measured here on
 * 2026-09-08 (darwin-arm64, node 24 and Electron 41 alike).
 *
 * A source build (`npm_config_build_from_source=true npm rebuild node-pty`)
 * produces `build/Release/` with correct modes and sidesteps it — but it is a
 * manual step nobody will remember, and a fresh `npm ci` restores the broken
 * prebuild. So the exec bit is restored here, at the one moment the breakage
 * is introduced.
 *
 * Deliberately: no dependencies, never throws, never fails an install. If
 * node-pty is not installed (or a future version ships this correctly) this is
 * a silent no-op.
 *
 * Verify with: `npx electron scripts/pty-smoke.cjs`
 */
const fs = require('node:fs');
const path = require('node:path');

const NODE_PTY = path.join(__dirname, '..', 'node_modules', 'node-pty');

// The three directories node-pty's own loader searches, in its order
// (node_modules/node-pty/lib/utils.js → loadNativeModule).
const CANDIDATE_DIRS = [
  path.join(NODE_PTY, 'build', 'Release'),
  path.join(NODE_PTY, 'build', 'Debug'),
  path.join(NODE_PTY, 'prebuilds', `${process.platform}-${process.arch}`),
];

let fixed = 0;
for (const dir of CANDIDATE_DIRS) {
  const helper = path.join(dir, 'spawn-helper');
  try {
    const mode = fs.statSync(helper).mode;
    // Already executable by the owner — nothing to do.
    if (mode & 0o100) continue;
    fs.chmodSync(helper, 0o755);
    console.log(`[fix-node-pty-perms] chmod +x ${path.relative(process.cwd(), helper)}`);
    fixed++;
  } catch {
    // Absent on this platform/build shape — expected, not an error.
  }
}

if (fixed === 0) {
  // Quiet on the happy path: an install log nobody reads is noise.
  process.exit(0);
}
