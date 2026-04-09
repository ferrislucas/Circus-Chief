import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js', 'src/**/*.vue'],
      exclude: [
        'src/**/*.test.js',
        'src/**/*.spec.js',
        'src/main.js',
        'src/router.js',
      ],
      thresholds: {
        statements: 62,
        branches: 57,
        functions: 56,
        lines: 63,
      },
    },
  },
});
