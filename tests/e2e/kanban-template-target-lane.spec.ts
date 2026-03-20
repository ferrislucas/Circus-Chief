import { test, expect } from '@playwright/test';
import {
  BASE_URL,
  seedProject,
  seedProjectTemplate,
  updateTemplate,
  getSession,
  getKanbanBoard,
  cleanupCreatedResources,
  navigateAndWait,
  trackSession,
} from './helpers';

test.describe('Kanban: session created from template lands in target lane', () => {
  let project: any;
  let template: any;
  let targetLane: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();

    // 1. Seed project
    project = await seedProject('Kanban Template Lane Test', '/tmp/test-kanban-tpl');

    // 2. Fetch the kanban board — this triggers auto-creation of default lanes
    const board = await getKanbanBoard(project.id);

    // 3. Pick the "In Progress" lane
    targetLane = board.lanes.find((l: any) => l.name === 'In Progress');
    expect(targetLane, 'Expected default "In Progress" lane to exist').toBeTruthy();

    // 4. Create a template pointing at that lane
    template = await seedProjectTemplate(project.id, {
      name: 'Lane Template',
      prompt: 'Test prompt for kanban lane placement',
      targetLaneId: targetLane.id,
    });

    // 5. Set nextTemplateId to itself so the UI populates selectedTemplateId
    //    (which is what gets sent to the server as `templateId`)
    await updateTemplate(template.id, { nextTemplateId: template.id });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('session card appears in target lane and session.targetLaneId is set', async ({ page }) => {
    // Navigate to the new session form
    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/sessions/new`);

    // Wait for the template dropdown to be available
    await page.locator('#start-from-template').waitFor({ state: 'visible', timeout: 10000 });

    // Select our template from the "Start From Template" dropdown
    await page.selectOption('#start-from-template', template.id);

    // Verify prompt was auto-filled from the template
    const promptTextarea = page.locator('textarea#prompt');
    await expect(promptTextarea).toHaveValue(/Test prompt for kanban lane placement/);

    // Ensure "Start Immediately" is unchecked so we don't launch Claude
    // Find the toggle switch within the container that has "Start Immediately" text
    const startImmediatelyContainer = page.locator('text=Start Immediately').locator('xpath=ancestor::div[contains(@class, "thinking-toggle")]');
    const toggleSwitch = startImmediatelyContainer.locator('label.toggle-switch');
    const toggleInput = toggleSwitch.locator('input[type="checkbox"]');

    // Wait for the toggle to be available
    await toggleSwitch.waitFor({ state: 'visible', timeout: 5000 });

    // Check current state and toggle if needed
    const isChecked = await toggleInput.evaluate((input: HTMLInputElement) => input.checked);
    if (isChecked) {
      await toggleSwitch.click();
    }

    // Click "Create Draft"
    const createDraftButton = page.locator('button:has-text("Create Draft")');
    await createDraftButton.waitFor({ state: 'visible', timeout: 5000 });
    await createDraftButton.click();

    // Wait for redirect to session detail page
    await page.waitForURL(/\/sessions\/[a-f0-9-]+/, { timeout: 10000 });

    // Extract session ID from URL
    const url = page.url();
    const match = url.match(/\/sessions\/([a-f0-9-]+)/);
    expect(match, 'Expected to extract session ID from URL').toBeTruthy();
    const sessionId = match![1];
    trackSession(sessionId);

    // Navigate to kanban board
    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // Find the "In Progress" lane
    const lanes = page.locator('.kanban-lane');
    const laneCount = await lanes.count();
    let inProgressLane = null;
    for (let i = 0; i < laneCount; i++) {
      const laneEl = lanes.nth(i);
      const title = await laneEl.locator('.lane-title').textContent();
      if (title?.trim() === 'In Progress') {
        inProgressLane = laneEl;
        break;
      }
    }
    expect(inProgressLane, 'Expected to find "In Progress" lane on kanban board').toBeTruthy();

    // Assert the card exists in the "In Progress" lane
    const cards = inProgressLane!.locator('.kanban-card');
    await expect(cards).toHaveCount(1);

    // Assert session.targetLaneId is set correctly via API
    const session = await getSession(sessionId);
    expect(session).toBeTruthy();
    expect(session.targetLaneId).toBe(targetLane.id);
  });
});
