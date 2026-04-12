/**
 * vite.preload.e2e.config.ts — E2E test build for preload process
 *
 * Mirrors forge's preload build: CJS format, inlined dynamic imports,
 * external electron.
 */
import { defineConfig } from 'vite';
import path from 'path';
import { builtinModules } from 'module';

const nodeBuiltins = builtinModules.flatMap((m) => [m, `node:${m}`]);

export default defineConfig({
  build: {
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      external: ['electron', 'electron/renderer', ...nodeBuiltins],
      input: path.resolve(__dirname, 'src/preload/index.ts'),
      output: {
        format: 'cjs',
        inlineDynamicImports: true,
        entryFileNames: 'preload.js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
});
