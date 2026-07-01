/**
 * vitest.config.ts — Project runtime
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // See src/test-stubs/monaco-editor.ts for why the real package can't run
      // under vitest at all (unresolvable "module"-only entry, then a jsdom
      // crash even once resolved). Test-only — the real renderer bundle never
      // sees this alias.
      'monaco-editor': path.resolve(__dirname, 'src/test-stubs/monaco-editor.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
