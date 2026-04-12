/**
 * vite.preload.config.ts — Project runtime
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron'],
      output: {
        entryFileNames: 'preload.js',
      },
    },
  },
});
