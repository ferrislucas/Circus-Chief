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
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: getBaseURL(),
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
