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

  test('"Session Settings" section appears for custom prompt automation', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Select "Run a custom prompt"
    await page.click('input[type="radio"][value="prompt"]');
    await expect(page.locator('textarea#custom-prompt')).toBeVisible();

    // "Session Settings" toggle button should be visible
    const sessionSettingsBtn = page.locator('button.section-toggle', { hasText: 'Session Settings' });
    await expect(sessionSettingsBtn).toBeVisible();

    // Click to expand
    await sessionSettingsBtn.click();

    // The agent settings body should now be visible
    await expect(page.locator('.agent-settings-body')).toBeVisible();

    // Auto-reschedule toggle should be visible inside
    const autoRescheduleLabel = page.locator('.agent-settings-body').locator('text=Auto-reschedule on errors');
    await expect(autoRescheduleLabel).toBeVisible();
  });

  test('"Session Settings" section is hidden for template and none automation types', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    const sessionSettingsBtn = page.locator('button.section-toggle', { hasText: 'Session Settings' });

    // "None" radio: section should NOT be visible
    await page.click('input[type="radio"][value="none"]');
    await expect(sessionSettingsBtn).not.toBeVisible();

    // "Run a template" radio: section should NOT be visible
    await page.click('input[type="radio"][value="template"]');
    await expect(sessionSettingsBtn).not.toBeVisible();

    // "Run a custom prompt" radio: section SHOULD be visible
    await page.click('input[type="radio"][value="prompt"]');
    await expect(sessionSettingsBtn).toBeVisible();
  });

  test('Slash Commands button appears for custom prompt automation', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Select "Run a custom prompt"
    await page.click('input[type="radio"][value="prompt"]');
    await expect(page.locator('textarea#custom-prompt')).toBeVisible();

    // The slash command button should be visible
    const slashBtn = page.locator('[data-testid="slash-command-button"]');
    await expect(slashBtn).toBeVisible();

    // Click it to open the wizard
    await slashBtn.click();

    // The slash command wizard should appear
    const wizard = page.locator('[data-testid="slash-command-wizard"]');
    await expect(wizard).toBeVisible();
  });

  test('agent settings persist after save and auto-expand when editing', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Select "Run a custom prompt"
    await page.click('input[type="radio"][value="prompt"]');

    // Enter a prompt
    await page.fill('textarea#custom-prompt', 'Test prompt for agent settings');

    // Expand "Session Settings"
    await page.click('button.section-toggle');
    await expect(page.locator('.agent-settings-body')).toBeVisible();

    // Enable auto-reschedule by clicking the toggle label (input is hidden by CSS)
    await page.locator('.agent-settings-body .toggle-switch-row').click();
    await expect(page.locator('.reschedule-settings')).toBeVisible();

    // Save the settings
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Re-open the lane settings
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Automation type should still be "prompt"
    const promptRadio = page.locator('input[type="radio"][value="prompt"]');
    await expect(promptRadio).toBeChecked();

    // Session Settings section should be auto-expanded (auto-reschedule was enabled)
    await expect(page.locator('.agent-settings-body')).toBeVisible();

    // Auto-reschedule should still be enabled - check the checkbox with force (input is hidden)
    const autoRescheduleCheckbox = page.locator('.agent-settings-body .toggle-switch-row input[type="checkbox"]');
    await expect(autoRescheduleCheckbox).toBeChecked();
  });

  test('agent settings are cleared when switching to None automation', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Set custom prompt with agent settings
    await page.click('input[type="radio"][value="prompt"]');
    await page.fill('textarea#custom-prompt', 'Test prompt');
    await page.click('button.section-toggle');
    // Click the toggle label to enable auto-reschedule (input is hidden by CSS)
    await page.locator('.agent-settings-body .toggle-switch-row').click();

    // Save
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Re-open and switch to "None"
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();
    await page.click('input[type="radio"][value="none"]');

    // Save with "None" automation
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Re-open the lane settings again
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Automation type should be "none"
    const noneRadio = page.locator('input[type="radio"][value="none"]');
    await expect(noneRadio).toBeChecked();

    // Session Settings section should NOT be visible
    const sessionSettingsBtn = page.locator('button.section-toggle', { hasText: 'Session Settings' });
    await expect(sessionSettingsBtn).not.toBeVisible();
  });
});
