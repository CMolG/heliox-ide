/**
 * e2e/global-setup.ts — Playwright Global Setup
 *
 * Creates a unique temporary directory for Electron userData so that:
 * 1. E2E test data is fully isolated from the development app
 * 2. Each test run starts with a clean state
 * 3. No persisted electron-store or localStorage leaks between runs
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { spawn } from 'child_process';

const RENDERER_PORT = 5173;
const RENDERER_HOST = '127.0.0.1';

function waitForRenderer(serverPid: number, logPath: string): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = 30_000;

  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(`http://${RENDERER_HOST}:${RENDERER_PORT}`, (res) => {
        res.resume();
        resolve();
      });

      req.on('error', () => {
        try {
          process.kill(serverPid, 0);
        } catch {
          const logs = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
          reject(new Error(`Heliox renderer dev server exited before startup.\n${logs}`));
          return;
        }

        if (Date.now() - startedAt > timeoutMs) {
          const logs = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
          reject(new Error(`Timed out waiting for Heliox renderer on ${RENDERER_HOST}:${RENDERER_PORT}.\n${logs}`));
          return;
        }

        setTimeout(poll, 250);
      });

      req.setTimeout(1_000, () => {
        req.destroy();
      });
    };

    poll();
  });
}

export default async function globalSetup() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heliox-e2e-'));
  process.env.HELIOX_E2E_USER_DATA = tmpDir;

  // Write the path to a well-known file so test workers can read it
  const markerPath = path.join(__dirname, '.e2e-user-data-dir');
  fs.writeFileSync(markerPath, tmpDir, 'utf-8');

  // The compiled Electron main process loads http://localhost:5173 in dev.
  // Start Heliox's renderer explicitly so Electron never attaches to a
  // different project that happens to be running on the default Vite port.
  const repoRoot = path.join(__dirname, '..');
  const vitePidPath = path.join(__dirname, '.e2e-vite-pid');
  const viteLogPath = path.join(__dirname, '.e2e-vite.log');
  const logFd = fs.openSync(viteLogPath, 'w');
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const renderer = spawn(command, [
    'vite',
    '--config',
    'vite.renderer.config.ts',
    '--host',
    RENDERER_HOST,
    '--port',
    String(RENDERER_PORT),
    '--strictPort',
  ], {
    cwd: repoRoot,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', logFd, logFd],
    detached: process.platform !== 'win32',
  });

  if (!renderer.pid) {
    throw new Error('Failed to start Heliox renderer dev server for E2E.');
  }

  fs.writeFileSync(vitePidPath, String(renderer.pid), 'utf-8');
  renderer.unref();
  await waitForRenderer(renderer.pid, viteLogPath);
}
