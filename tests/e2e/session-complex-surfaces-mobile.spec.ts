import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedCanvasItem,
  seedCommandButton,
  cleanupCreatedResources,
  navigateAndWait,
} from './helpers';

const IPHONE_12_MINI = { width: 375, height: 812 };

async function expectPhoneSurface(page: import('@playwright/test').Page, selector: string) {
  await expect(page.locator(selector)).toBeVisible();
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

test.describe('Session complex surfaces — iPhone 12 mini audit', () => {
  let project: any;
  let session: any;

  test.beforeEach(async ({ page }) => {
    project = await seedProject('Visual audit long project name '.repeat(6), process.cwd());
    session = await seedSession(project.id, {
      prompt: 'Audit the compact surfaces with intentionally long content.',
      name: 'Visual audit workspace with a deliberately long operational name',
      startImmediately: false,
    });
    await seedCanvasItem(session.id, {
      type: 'text',
      filename: 'very-long-canvas-filename-for-phone-overflow-audit-and-action-discovery.txt',
      content: 'x'.repeat(1200),
    });
    await seedCommandButton(project.id, {
      label: 'Long output audit command',
      command: 'node -e "console.log(\'phone surface audit\')"',
    });
    await page.setViewportSize(IPHONE_12_MINI);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('keeps changes, canvas, and commands inside the 375px document with reachable actions', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}/changes`, { waitFor: '.changes-tab', timeout: 15000 });
    await expectPhoneSurface(page, '.changes-tab');
    await page.screenshot({ path: 'test-results/visual-audit/changes-375x812.png', fullPage: true });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`, { waitFor: '.canvas-file-list', timeout: 15000 });
    await expectPhoneSurface(page, '.canvas-tab');
    const canvasActions = page.locator('.canvas-header .btn-primary, .file-row .btn-menu');
    for (const action of await canvasActions.all()) {
      const box = await action.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: 'test-results/visual-audit/canvas-375x812.png', fullPage: true });

    await navigateAndWait(page, `/sessions/${session.id}/commands`, { waitFor: '[data-testid="run-button"]', timeout: 15000 });
    await expectPhoneSurface(page, '.commands-tab');
    const runButton = page.locator('[data-testid="run-button"]');
    const runBox = await runButton.boundingBox();
    expect(runBox?.height).toBeGreaterThanOrEqual(44);
    await expect(runButton).toBeInViewport();
    await page.screenshot({ path: 'test-results/visual-audit/commands-375x812.png', fullPage: true });
  });
});
