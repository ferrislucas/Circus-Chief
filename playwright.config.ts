import { defineConfig } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';

function getBaseURL(): string {
  if (process.env.BASE_URL) return process.env.BASE_URL;

  const portFile = '.server-port';
  if (existsSync(portFile)) {
    const port = readFileSync(portFile, 'utf-8').trim();
    return `http://localhost:${port}`;
  }

  return 'http://localhost:5000';
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Disable parallel to prevent race conditions between tests
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1, // Retry flaky tests
  workers: 1,
  reporter: 'list',
  timeout: 30000, // Increase default timeout for slow tests
  expect: {
    timeout: 10000, // Increase expect timeout
  },
  use: {
    baseURL: getBaseURL(),
    trace: 'on-first-retry',
    actionTimeout: 10000, // Timeout for individual actions
    navigationTimeout: 30000, // Timeout for navigation
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  globalSetup: require.resolve('./tests/e2e/global-setup'),
  globalTeardown: require.resolve('./tests/e2e/global-teardown'),
});
