import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@claudetools/shared/contracts': resolve(__dirname, '../shared/src/contracts'),
      '@claudetools/shared': resolve(__dirname, '../shared/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.js', 'test/**/*.test.js'],
    setupFiles: ['./test/setup.js'],
  },
});
