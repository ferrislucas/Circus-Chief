import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    // Increase default timeout from 5s to 10s. Under coverage instrumentation
    // the full suite runs much slower (jsdom environment setup dominates), and
    // normally-fast component mount/interaction tests can exceed the 5s default.
    testTimeout: 10000,
    // Automatically retry tests once to smooth over truly transient flakes
    // (e.g. a mount that briefly exceeds the timeout under CPU/disk load during
    // coverage runs). Real failures still surface because they fail on both the
    // initial run and the retry. Mirrors the server package configuration.
    retry: 1,
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
