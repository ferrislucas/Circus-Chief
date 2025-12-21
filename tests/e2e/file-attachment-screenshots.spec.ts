import { test } from '@playwright/test';
import { seedProject, seedSession, cleanupAll, updateSessionStatus } from './helpers';

const VIEWPORTS = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 },
];

test.describe('File Attachment Screenshots', () => {
  let project: any;
  let screenshotPaths: string[] = [];

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Screenshot Test', '/tmp/test');
    screenshotPaths = [];
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('capture file attachment UI at multiple screen sizes', async ({ page }) => {
    // Increase timeout for this test
    test.setTimeout(120000);

    // Take screenshots of the new session form with file attachment button
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/projects/${project.id}/sessions/new`);
      await page.waitForLoadState('networkidle');

      // Wait for the file attachment button to be visible
      await page.waitForSelector('.attach-btn', { timeout: 10000 });

      const path = `./screenshots/new-session-${viewport.name}.png`;
      await page.screenshot({ path, fullPage: false });
      screenshotPaths.push(path);
      console.log(`Captured: ${path}`);
    }

    // Create a session to show conversation tab with file attachment
    const session = await seedSession(project.id, {
      prompt: 'Test prompt for file attachments',
      name: 'File Attachment Demo',
    });

    // Force session to waiting status via API so we can see the input form
    await updateSessionStatus(session.id, 'waiting');
    console.log(`Updated session ${session.id} status to waiting`);

    // Take screenshots of conversation tab with file attachment input
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/sessions/${session.id}/conversation`);
      await page.waitForLoadState('networkidle');

      // Wait a bit for the status to be reflected in the UI
      await page.waitForTimeout(2000);

      // Try to find the input form, if not found, take a debug screenshot
      const inputFormVisible = await page.locator('.input-form').isVisible();

      if (!inputFormVisible) {
        // Take debug screenshot to see what's on the page
        await page.screenshot({ path: `./screenshots/debug-${viewport.name}.png`, fullPage: true });
        console.log(`Debug screenshot taken: ./screenshots/debug-${viewport.name}.png`);
        console.log(`Input form not visible. Page HTML snippet:`);
        const bodyHtml = await page.locator('body').innerHTML();
        console.log(bodyHtml.substring(0, 1000));
      }

      const path = `./screenshots/conversation-${viewport.name}.png`;
      await page.screenshot({ path, fullPage: false });
      screenshotPaths.push(path);
      console.log(`Captured: ${path}`);
    }

    // Log all captured screenshots
    console.log('\nAll screenshots captured:');
    screenshotPaths.forEach(p => console.log(`  - ${p}`));
  });
});
