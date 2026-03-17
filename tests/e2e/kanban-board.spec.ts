import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  navigateAndWait,
} from './helpers';

test.describe('Kanban Board', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Kanban Test Project', '/tmp/test-kanban');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('session should not appear twice after adding to a lane', async ({ page }) => {
    // Seed a session to add to the board
    const session = await seedSession(project.id, {
      prompt: 'Test kanban dedup',
      name: 'Kanban Dedup Session',
      startImmediately: false,
    });

    // Navigate to the kanban tab
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // The board comes with default lanes. Use the first lane ("To Do") for this test.
    // Find the "To Do" lane by its title text
    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await expect(lane).toBeVisible();

    // Click "+ Add Session" on the To Do lane specifically
    await lane.locator('.add-session-btn').click();

    // Wait for the modal and session list to load
    await expect(page.locator('.modal-content')).toBeVisible();
    await page.waitForSelector('.session-item', { timeout: 10000 });

    // Select the session
    await page.locator('.session-item').first().click();

    // Click "Add to Lane"
    await page.click('.modal-footer .btn-primary');

    // Wait for the modal to close
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Wait a moment for any WebSocket events to arrive
    await page.waitForTimeout(1000);

    // Assert the To Do lane contains exactly ONE card (not two from the race condition)
    const cards = lane.locator('.kanban-card');
    await expect(cards).toHaveCount(1);
  });

  test('lane settings custom prompt textarea uses resizable handle', async ({ page }) => {
    // Navigate to the kanban tab
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // Use the first default lane ("To Do") for settings test
    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await expect(lane).toBeVisible();

    // Open lane settings via the gear button on the To Do lane
    await lane.locator('.lane-settings-btn').click();

    // Wait for the settings modal to appear
    await expect(page.locator('.modal-content')).toBeVisible();

    // Select "Run a custom prompt" radio option
    await page.click('input[type="radio"][value="prompt"]');

    // Wait for the custom prompt textarea to appear
    await expect(page.locator('textarea#custom-prompt')).toBeVisible();

    // Assert that the prompt area contains a .resize-handle element,
    // proving ResizableTextarea is in use rather than a plain <textarea>
    const resizeHandle = page.locator('.resizable-textarea-wrapper .resize-handle');
    await expect(resizeHandle).toBeVisible();
  });
});
