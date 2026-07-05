/**
 * vite.main.config.ts — Project runtime
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'electron', 'playwright', 'child_process', 'crypto', 'events', 'path', 'fs', 'fs/promises', 'util',
        'better-sqlite3',
        // jsdom (pulled in by performance-frontier's design-verifier) reads its
        // own on-disk assets — e.g. lib/jsdom/browser/default-stylesheet.css —
        // via __dirname-relative fs.readFileSync. Bundling rewrites those paths
        // and the main process throws ENOENT at load. Keep it external so it is
        // required from node_modules with correct asset resolution, exactly like
        // the better-sqlite3 native module above.
        'jsdom',
      ],
    },
  },
});
