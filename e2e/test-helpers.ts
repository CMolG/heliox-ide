/**
 * e2e/test-helpers.ts — Shared helpers for Playwright E2E tests
 *
 * Provides utilities for launching Electron with an isolated user data
 * directory so test data never leaks into or from the development app.
 */
import fs from 'fs';
import path from 'path';

/**
 * Returns the isolated userData directory created by global-setup.ts.
 * Falls back to a new temp directory if the marker file is missing.
 */
export function getE2EUserDataDir(): string {
  const markerPath = path.join(__dirname, '.e2e-user-data-dir');
  try {
    return fs.readFileSync(markerPath, 'utf-8').trim();
  } catch {
    // Fallback: create inline (shouldn't happen with proper config)
    const os = require('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heliox-e2e-fallback-'));
    return tmpDir;
  }
}

/**
 * Default Electron launch args that include the isolated user data dir.
 */
export function getElectronLaunchArgs(): string[] {
  return [
    path.join(__dirname, '..'),
    `--user-data-dir=${getE2EUserDataDir()}`,
  ];
}

/**
 * Default environment variables for E2E test launches.
 */
export function getE2EEnv(): Record<string, string> {
  return {
    ...process.env as Record<string, string>,
    NODE_ENV: 'development',
    ELECTRON_IS_DEV: '1',
    HELIOX_MODELS: process.env.HELIOX_E2E_MODELS ?? 'copilot',
  };
}
