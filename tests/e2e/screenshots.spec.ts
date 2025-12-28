import { test } from '@playwright/test';

test.describe('UI Screenshots', () => {
  test('capture project list page', async ({ page }) => {
    await page.goto('http://localhost:5173/projects');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/01-project-list.png', fullPage: true });
  });

  test('capture project detail with defaults', async ({ page }) => {
    await page.goto('http://localhost:5173/projects');
    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (await projectLink.isVisible()) {
      await projectLink.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: '/tmp/02-project-detail.png', fullPage: true });
    }
  });

  test('capture new session with defaults', async ({ page }) => {
    await page.goto('http://localhost:5173/projects');
    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (await projectLink.isVisible()) {
      await projectLink.click();
      await page.waitForTimeout(500);
      const newSessionBtn = page.locator('button:has-text("New Session")').first();
      if (await newSessionBtn.isVisible()) {
        await newSessionBtn.click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: '/tmp/03-new-session-defaults.png', fullPage: true });
      }
    }
  });
});
