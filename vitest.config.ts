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
      // monaco-config.ts imports Monaco's language workers via Vite's `?worker`
      // suffix (see its comments). Vite's alias matcher (`entries.find(...)`)
      // uses the FIRST entry whose `find` matches — a match is either an exact
      // string or a `find + '/'` prefix — so these five exact specifiers MUST
      // be declared before the broader 'monaco-editor' alias below, otherwise
      // that broader alias would prefix-match them first and shadow them with
      // a path that doesn't resolve (the stub has no `esm/vs/...` subpaths).
      // See src/test-stubs/monaco-worker.ts.
      'monaco-editor/esm/vs/editor/editor.worker?worker': path.resolve(__dirname, 'src/test-stubs/monaco-worker.ts'),
      'monaco-editor/esm/vs/language/json/json.worker?worker': path.resolve(__dirname, 'src/test-stubs/monaco-worker.ts'),
      'monaco-editor/esm/vs/language/css/css.worker?worker': path.resolve(__dirname, 'src/test-stubs/monaco-worker.ts'),
      'monaco-editor/esm/vs/language/html/html.worker?worker': path.resolve(__dirname, 'src/test-stubs/monaco-worker.ts'),
      'monaco-editor/esm/vs/language/typescript/ts.worker?worker': path.resolve(__dirname, 'src/test-stubs/monaco-worker.ts'),
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
