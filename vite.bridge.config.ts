import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/bridge-app'),
  base: '/',
  build: {
    outDir: path.resolve(__dirname, 'dist-bridge'),
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
  },
  resolve: {
    alias: {
      '@bridge': path.resolve(__dirname, 'src/bridge-app'),
    },
  },
});
