import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
} from './helpers';

test.describe('Debug: 404 Network Errors', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;
  let childSession: any;

  test.beforeEach(async () => {
    project = await seedProject('Debug 404 Test', '/tmp/debug-404-test');
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parentSession.id);
    childSession = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child session prompt',
      name: 'Child Session',
    });
    await waitForSessionToExist(childSession.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('identify 404 resource errors', async ({ page }) => {
    const failedResources: any[] = [];

    // Capture failed responses
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedResources.push({
          url: response.url(),
          status: response.status(),
          statusText: response.statusText(),
        });
        console.log(`FAILED RESPONSE: ${response.status()} ${response.statusText()} - ${response.url()}`);
      }
    });

    // Navigate to parent session
    await navigateAndWait(page, `/sessions/${parentSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    // Click tree handle to open overlay
    const handle = page.locator('[data-testid="session-tree-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();

    // Wait for overlay
    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);

    // Click the button
    const addBtn = overlay.locator('[data-testid="overlay-add-session-btn"]');
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();

    // Wait for action to complete
    await page.waitForTimeout(2000);

    // Report findings
    console.log('\n=== FAILED RESOURCES (404+) ===');
    console.log(`Total failed resources: ${failedResources.length}`);
    if (failedResources.length > 0) {
      failedResources.forEach((resource) => {
        console.log(`  ${resource.status} ${resource.statusText}: ${resource.url}`);
      });
    }
  });
});
