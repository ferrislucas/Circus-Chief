import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@circuschief/shared/contracts': resolve(__dirname, '../shared/src/contracts'),
      '@circuschief/shared': resolve(__dirname, '../shared/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.js', 'test/**/*.test.js'],
    setupFiles: ['./test/setup.js'],
    // Run tests sequentially to avoid database singleton race conditions
    // The DatabaseManager singleton is shared across all test files,
    // and concurrent initDatabase() calls cause race conditions
    fileParallelism: false,
    testTimeout: 10000, // Increase default timeout from 5s to 10s
    // Automatically retry tests once to smooth over truly transient flakes
    // (e.g. "socket hang up" from supertest under CPU/disk load). Real failures
    // still surface because they'll fail on both the initial run and the retry.
    retry: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: [
        'src/**/*.test.js',
        'src/**/*.spec.js',
        'src/index.js',
        'src/db/migrations/**',
      ],
      thresholds: {
        statements: 81,
        branches: 78,
        functions: 85,
        lines: 81,
      },
    },
  },
});
