import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@claudetools/shared/contracts': resolve(__dirname, '../../packages/shared/src/contracts'),
      '@claudetools/shared': resolve(__dirname, '../../packages/shared/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.js'],
    setupFiles: [resolve(__dirname, 'setup.js')],
    // Run tests sequentially to avoid database conflicts
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
