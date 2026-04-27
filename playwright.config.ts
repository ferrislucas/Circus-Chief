import { defineConfig, devices } from '@playwright/test';
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
  fullyParallel: true, // Enable parallel execution for faster test runs
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1, // Retry flaky tests
  workers: 4, // Run tests in parallel across 4 workers
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
    // Mobile projects are chromium under the hood. Playwright does not
    // emulate Safari WebKit or iOS URL-bar / visual-viewport divergence
    // — these projects only change viewport size + user-agent string.
    // True iOS validation lives in manual device QA; these are a smoke
    // test against narrow-viewport CSS layout.
    // Scoped to the overlay layout spec so existing specs still run
    // only under desktop chromium.
    {
      name: 'iphone-14',
      use: { browserName: 'chromium', ...devices['iPhone 14'] },
      testMatch: /session-chat-overlay-layout\.spec\.ts$/,
    },
    {
      name: 'ipad-pro',
      use: { browserName: 'chromium', ...devices['iPad Pro 11'] },
      testMatch: /session-chat-overlay-layout\.spec\.ts$/,
    },
  ],
  globalSetup: require.resolve('./tests/e2e/global-setup'),
  globalTeardown: require.resolve('./tests/e2e/global-teardown'),
});
