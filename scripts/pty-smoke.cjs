/**
 * pty-smoke.cjs — Does `node-pty` load under THIS Electron's ABI?
 *
 *   npx electron scripts/pty-smoke.cjs
 *
 * Why this file is in the tree rather than a line in a report: `node-pty` is
 * the only native module the agent-session window depends on, and a native
 * module that resolves under `node` can still fail to load under `electron`.
 * The failure mode is silent from the UI's side — the window opens, the spawn
 * IPC rejects, and nothing says "wrong ABI".
 *
 * Measured on 2026-09-08 (Electron 41.2.0 / ABI 145, darwin-arm64): node-pty
 * 1.1.0 is a **N-API** addon (`node-addon-api ^7.1.0`) and ships a prebuilt
 * `prebuilds/darwin-arm64/pty.node`, which its own loader (`lib/utils.js`,
 * `loadNativeModule`) falls back to when `build/Release` is absent. N-API is
 * ABI-stable across Node and Electron versions, so NO `electron-rebuild` step
 * is required on this platform — run this script to confirm that before
 * assuming it, and after any Electron major bump.
 *
 * Exit code 0 = the module loaded, a PTY spawned, and its output came back.
 */
const { app } = require('electron');

app.whenReady().then(() => {
  let pty;
  try {
    pty = require('node-pty');
  } catch (err) {
    console.error('[pty-smoke] FAIL — node-pty did not load under Electron:', err.message);
    console.error('[pty-smoke] Try: npx electron-rebuild -f -w node-pty');
    app.exit(1);
    return;
  }

  console.log(`[pty-smoke] electron=${process.versions.electron} node=${process.versions.node} modules(ABI)=${process.versions.modules}`);

  let output = '';
  const proc = pty.spawn('/bin/echo', ['pty-ok'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
  });

  proc.onData((data) => { output += data; });

  proc.onExit(({ exitCode, signal }) => {
    const trimmed = output.trim();
    console.log(`[pty-smoke] data=${JSON.stringify(trimmed)} exitCode=${exitCode} signal=${signal ?? 'none'}`);
    const ok = exitCode === 0 && trimmed.includes('pty-ok');
    console.log(ok ? '[pty-smoke] PASS' : '[pty-smoke] FAIL');
    app.exit(ok ? 0 : 1);
  });

  // A PTY that never exits would hang the smoke run — bound it.
  setTimeout(() => {
    console.error('[pty-smoke] FAIL — timed out waiting for the PTY to exit');
    app.exit(1);
  }, 10_000);
});
