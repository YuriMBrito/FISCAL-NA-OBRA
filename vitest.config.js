import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'utils/formula-engine.js',
        'utils/validators.js',
        'utils/formatters.js',
        'utils/server-validators.js',
        'utils/unit-normalizer.js',
        'utils/rbac.js',
        'utils/perf-debounce.js',
        'utils/dom-safe-v2.js',
        'modules/boletim-medicao/bm-calculos.js',
        'modules/aditivos/aditivos-calculos.js',
      ],
      thresholds: {
        lines:     75,
        functions: 75,
        branches:  65,
      },
    },
  },
});
