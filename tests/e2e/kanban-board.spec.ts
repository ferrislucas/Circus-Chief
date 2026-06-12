import { test, expect } from '@playwright/test';
import {
  API_URL,
  seedProject,
  seedSession,
  seedChildSession,
  cleanupCreatedResources,
  navigateAndWait,
  seedCommandButton,
  runCommandButton,
  waitForCommandRunComplete,
  waitForSessionToExist,
} from './helpers';

async function getKanbanBoard(projectId: string) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/kanban`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch kanban board: ${response.status} ${text}`);
  }
  return response.json();
}

async function addSessionToLane(projectId: string, sessionId: string, laneId: string) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/kanban/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, laneId }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to add session to lane: ${response.status} ${text}`);
  }
  return response.json();
}

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

  test('kanban cards show Circus Command status indicators without navigating on click', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test kanban command status',
      name: 'Kanban Command Status Session',
      startImmediately: false,
    });
    await waitForSessionToExist(session.id);

    const board = await getKanbanBoard(project.id);
    const todoLane = board.lanes.find((lane: any) => lane.name === 'To Do') || board.lanes[0];
    await addSessionToLane(project.id, session.id, todoLane.id);

    const visibleButton = await seedCommandButton(project.id, {
      label: 'Kanban Visible Command',
      command: 'echo "kanban visible"',
      showOnList: true,
    });
    await seedCommandButton(project.id, {
      label: 'Kanban Hidden Command',
      command: 'echo "kanban hidden"',
      showOnList: false,
    });

    const { runId } = await runCommandButton(session.id, visibleButton.id);
    await waitForCommandRunComplete(session.id, runId, 10000);

    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    const card = page.locator('.kanban-card').filter({ hasText: 'Kanban Command Status Session' });
    await expect(card).toBeVisible();

    const indicator = card.locator('.button-status-indicator[title*="Kanban Visible Command"]');
    await expect(indicator).toBeVisible({ timeout: 10000 });
    await expect(card.locator('.button-status-indicator[title*="Kanban Hidden Command"]')).toHaveCount(0);

    await indicator.click();

    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/kanban`));
    await expect(page.locator('[data-testid="button-status-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-status-badge"]')).toContainText('Success');
  });

  test('child sessions should not appear in "Add Session" modal', async ({ page }) => {
    // Create a root session
    const rootSession = await seedSession(project.id, {
      prompt: 'Root session',
      name: 'Root Session',
      startImmediately: false,
    });

    // Create a child session
    const childSession = await seedChildSession(project.id, rootSession.id, {
      prompt: 'Child session',
      name: 'Child Session',
    });

    // Navigate to kanban tab
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // Open "Add Session" modal
    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await lane.locator('.add-session-btn').click();

    // Wait for modal and sessions to load
    await expect(page.locator('.modal-content')).toBeVisible();
    await page.waitForSelector('.session-item', { timeout: 10000 });

    // Get all session names in the list
    const sessionNames = await page.locator('.session-name').allTextContents();

    // Assert root session is visible
    expect(sessionNames).toContain('Root Session');

    // Assert child session is NOT visible
    expect(sessionNames).not.toContain('Child Session');
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
