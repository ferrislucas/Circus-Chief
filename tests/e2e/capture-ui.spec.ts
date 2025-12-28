import { test, expect } from '@playwright/test';
import { seedProject, cleanupAll } from './helpers';

test.describe('Capture UI Screenshots - Project Edit View with Session Defaults', () => {
  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('capture project list view', async ({ page }) => {
    // Create a test project so we have something to display
    await seedProject('[TEST] Screenshot Demo', '/tmp/screenshot-demo');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Full page screenshot of project list
    await page.screenshot({
      path: 'screenshots/01-project-list.png',
      fullPage: true
    });
  });

  test('capture project detail view', async ({ page }) => {
    const project = await seedProject('[TEST] Session Defaults Demo', '/tmp/session-defaults-demo');

    // Navigate to projects list
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click on the test project
    const projectLink = page.locator(`a[href="/projects/${project.id}/sessions"]`);
    await expect(projectLink).toBeVisible();
    await projectLink.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Full page screenshot of project detail
    await page.screenshot({
      path: 'screenshots/02-project-detail.png',
      fullPage: true
    });
  });

  test('capture project edit view - full page', async ({ page }) => {
    const project = await seedProject('[TEST] Edit Defaults Demo', '/tmp/edit-defaults-demo');

    // Navigate to project edit page
    await page.goto(`/projects/${project.id}/edit`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Full page screenshot of edit form
    await page.screenshot({
      path: 'screenshots/03-project-edit-full.png',
      fullPage: true
    });
  });

  test('capture session defaults section collapsed', async ({ page }) => {
    const project = await seedProject('[TEST] Defaults Section Demo', '/tmp/defaults-section-demo');

    // Navigate to project edit page
    await page.goto(`/projects/${project.id}/edit`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Find and verify Session Defaults details element
    const defaultsDetails = page.locator('details', {
      has: page.locator('summary:has-text("Session Defaults")')
    }).first();

    await expect(defaultsDetails).toBeVisible();

    // Ensure it's not already open
    const isOpen = await defaultsDetails.evaluate(el => (el as HTMLDetailsElement).open);
    if (isOpen) {
      await defaultsDetails.click();
      await page.waitForTimeout(300);
    }

    // Scroll to the section
    await defaultsDetails.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    // Screenshot with section visible
    await page.screenshot({
      path: 'screenshots/04-session-defaults-collapsed.png',
      fullPage: true
    });
  });

  test('capture session defaults section expanded', async ({ page }) => {
    const project = await seedProject('[TEST] Expanded Defaults Demo', '/tmp/expanded-defaults-demo');

    // Navigate to project edit page
    await page.goto(`/projects/${project.id}/edit`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Find Session Defaults details element
    const defaultsDetails = page.locator('details', {
      has: page.locator('summary:has-text("Session Defaults")')
    }).first();

    await expect(defaultsDetails).toBeVisible();

    // Open the details section
    const isOpen = await defaultsDetails.evaluate(el => (el as HTMLDetailsElement).open);
    if (!isOpen) {
      await defaultsDetails.click();
      await page.waitForTimeout(500);
    }

    // Scroll to make the entire section visible
    await defaultsDetails.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    // Full page screenshot with expanded section
    await page.screenshot({
      path: 'screenshots/05-session-defaults-expanded.png',
      fullPage: true
    });
  });

  test('capture session defaults form fields', async ({ page }) => {
    const project = await seedProject('[TEST] Defaults Fields Demo', '/tmp/defaults-fields-demo');

    // Navigate to project edit page
    await page.goto(`/projects/${project.id}/edit`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Find and expand Session Defaults section
    const defaultsDetails = page.locator('details', {
      has: page.locator('summary:has-text("Session Defaults")')
    }).first();

    await expect(defaultsDetails).toBeVisible();

    const isOpen = await defaultsDetails.evaluate(el => (el as HTMLDetailsElement).open);
    if (!isOpen) {
      await defaultsDetails.click();
      await page.waitForTimeout(500);
    }

    // Scroll to section
    await defaultsDetails.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    // Get the content area of the details element
    const contentArea = defaultsDetails.locator('div').first();

    // Take a zoomed screenshot of just the defaults section
    const boundingBox = await contentArea.boundingBox();
    if (boundingBox) {
      await page.screenshot({
        path: 'screenshots/06-session-defaults-zoomed.png',
        clip: {
          x: Math.max(0, boundingBox.x - 20),
          y: Math.max(0, boundingBox.y - 20),
          width: boundingBox.width + 40,
          height: Math.min(boundingBox.height + 40, page.viewportSize()?.height || 720)
        }
      });
    }
  });

  test('capture new session form with defaults badges', async ({ page }) => {
    const project = await seedProject('[TEST] New Session Demo', '/tmp/new-session-demo');

    // Set some defaults so we can see the badges in the new session form
    // This is done via API by the helper

    // Navigate to project detail page
    await page.goto(`/projects/${project.id}/sessions`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Look for New Session button
    const newSessionBtn = page.locator('button, a').filter({ hasText: /New Session|Create/ }).first();

    if (await newSessionBtn.isVisible()) {
      await newSessionBtn.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Full page screenshot of new session form
      await page.screenshot({
        path: 'screenshots/07-new-session-form.png',
        fullPage: true
      });
    }
  });
});
