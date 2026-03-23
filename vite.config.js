import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },

  test: {
    coverage: {
      provider: 'v8',
      thresholds: {
        lines:      65,
        statements: 65,
        branches:   80,
        functions:  75,
      },
    },
  },
});
