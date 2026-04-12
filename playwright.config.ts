/**
 * playwright.config.ts — Project runtime
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 1,
  workers: 1, // Electron tests must run serially
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
