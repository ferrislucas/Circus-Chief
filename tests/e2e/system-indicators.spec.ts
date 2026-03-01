import { test, expect } from '@playwright/test';

/**
 * E2E tests for System Resource Indicators.
 *
 * These indicators (CPU, Memory, Disk) appear in the app header and receive
 * real system metrics via WebSocket every ~5 seconds.
 *
 * Strategy: Navigate to home page and wait for DOM elements to appear as proof
 * that WebSocket messages have been received and processed. We do NOT use
 * waitForWebSocketMessage (broken - depends on uninitialized window.__testWebSocket).
 */
test.describe('System Resource Indicators', () => {
  // Allow generous time for initial WS broadcast (~5s) + rendering overhead
  test.describe.configure({ timeout: 30000 });

  let pageErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('indicators appear in the header within 15 seconds', async ({ page }) => {
    // Wait for the container to become visible (hidden until first WS broadcast)
    const container = await page.waitForSelector('[data-testid="system-indicators"]', {
      timeout: 15000,
    });
    expect(container).toBeTruthy();
  });

  test('all three indicators are present after data arrives', async ({ page }) => {
    // Wait for container to appear
    await page.waitForSelector('[data-testid="system-indicators"]', { timeout: 15000 });

    // CPU and memory are always present
    expect(await page.locator('[data-testid="indicator-cpu"]').count()).toBe(1);
    expect(await page.locator('[data-testid="indicator-memory"]').count()).toBe(1);

    // Disk may or may not be present depending on OS support (null on failure)
    // Just verify it doesn't cause an error
    const diskCount = await page.locator('[data-testid="indicator-disk"]').count();
    expect(diskCount).toBeGreaterThanOrEqual(0);
    expect(diskCount).toBeLessThanOrEqual(1);
  });

  test('bars have non-zero width after data arrives', async ({ page }) => {
    await page.waitForSelector('[data-testid="system-indicators"]', { timeout: 15000 });

    // Check CPU bar width
    const cpuBar = page.locator('[data-testid="indicator-bar-cpu"]');
    const cpuWidth = await cpuBar.evaluate((el) => el.getBoundingClientRect().width);
    expect(cpuWidth).toBeGreaterThan(0);

    // Check memory bar width
    const memBar = page.locator('[data-testid="indicator-bar-memory"]');
    const memWidth = await memBar.evaluate((el) => el.getBoundingClientRect().width);
    expect(memWidth).toBeGreaterThan(0);
  });

  test('CPU tooltip contains expected text format', async ({ page }) => {
    await page.waitForSelector('[data-testid="system-indicators"]', { timeout: 15000 });

    const cpuEl = page.locator('[data-testid="indicator-cpu"]');
    const title = await cpuEl.getAttribute('title');
    expect(title).toMatch(/^CPU: \d+%$/);
  });

  test('memory tooltip contains expected text format', async ({ page }) => {
    await page.waitForSelector('[data-testid="system-indicators"]', { timeout: 15000 });

    const memEl = page.locator('[data-testid="indicator-memory"]');
    const title = await memEl.getAttribute('title');
    expect(title).toMatch(/^RAM: [\d.]+ \/ [\d.]+ GB$/);
  });

  test('disk tooltip contains expected text format (when present)', async ({ page }) => {
    await page.waitForSelector('[data-testid="system-indicators"]', { timeout: 15000 });

    const diskCount = await page.locator('[data-testid="indicator-disk"]').count();
    if (diskCount === 0) {
      // Disk not available on this platform - test passes
      return;
    }

    const diskEl = page.locator('[data-testid="indicator-disk"]');
    const title = await diskEl.getAttribute('title');
    expect(title).toMatch(/^Disk: \d+ GB free$/);
  });

  test('indicators remain visible and stable over time', async ({ page }) => {
    await page.waitForSelector('[data-testid="system-indicators"]', { timeout: 15000 });

    // Read initial tooltip values
    const cpuEl = page.locator('[data-testid="indicator-cpu"]');
    const initialCpuTitle = await cpuEl.getAttribute('title');

    // Wait for a second broadcast cycle (>5s)
    await page.waitForTimeout(6000);

    // Component should still be visible
    expect(await page.locator('[data-testid="system-indicators"]').isVisible()).toBe(true);

    // Tooltip should still be in the correct format
    const updatedCpuTitle = await cpuEl.getAttribute('title');
    expect(updatedCpuTitle).toMatch(/^CPU: \d+%$/);

    // No JS errors should have occurred
    expect(pageErrors).toHaveLength(0);

    // Log both values for debugging (they may or may not have changed)
    console.log(`CPU title: initial="${initialCpuTitle}", updated="${updatedCpuTitle}"`);
  });

  test('color coding: each bar has a valid color', async ({ page }) => {
    await page.waitForSelector('[data-testid="system-indicators"]', { timeout: 15000 });

    // Valid RGB values for the three threshold colors:
    // --color-success: #3fb950 -> rgb(63, 185, 80)
    // --color-warning: #d29922 -> rgb(210, 153, 34)
    // --color-error:   #f85149 -> rgb(248, 81, 73)
    const validColors = [
      'rgb(63, 185, 80)',
      'rgb(210, 153, 34)',
      'rgb(248, 81, 73)',
    ];

    const cpuBarColor = await page.locator('[data-testid="indicator-bar-cpu"]').evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );
    expect(validColors).toContain(cpuBarColor);

    const memBarColor = await page.locator('[data-testid="indicator-bar-memory"]').evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );
    expect(validColors).toContain(memBarColor);
  });

  test('no JavaScript errors occur during rendering', async ({ page }) => {
    await page.waitForSelector('[data-testid="system-indicators"]', { timeout: 15000 });
    expect(pageErrors).toHaveLength(0);
  });
});
