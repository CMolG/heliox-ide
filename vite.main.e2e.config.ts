/**
 * vite.main.e2e.config.ts — E2E test build configuration for main process
 *
 * Builds the main process with MAIN_WINDOW_VITE_DEV_SERVER_URL defined
 * so Electron connects to the Vite dev server during E2E tests.
 */
import { defineConfig } from 'vite';
import path from 'path';
import { builtinModules } from 'module';
import fs from 'fs';

const nodeBuiltins = builtinModules.flatMap((m) => [m, `node:${m}`]);
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
const deps = Object.keys(pkg.dependencies || {});
const devDeps = Object.keys(pkg.devDependencies || {});
const allDeps = [...deps, ...devDeps];

export default defineConfig({
  define: {
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify('http://localhost:5173'),
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/main/index.ts'),
      fileName: () => '[name].js',
      formats: ['cjs'],
    },
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      external: [
        'electron',
        ...nodeBuiltins,
        ...allDeps,
      ],
    },
  },
});
