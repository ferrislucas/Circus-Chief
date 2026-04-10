import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: [
        'src/**/*.test.js',
        'src/**/*.spec.js',
        'src/index.js',
      ],
      thresholds: {
        statements: 77,
        branches: 89,
        functions: 85,
        lines: 76,
      },
    },
  },
});
