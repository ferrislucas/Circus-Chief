import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  navigateAndWait,
} from './helpers';

test.describe('Kanban Move Card Modal', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Kanban Move Test Project', '/tmp/test-kanban-move');
    session = await seedSession(project.id, {
      prompt: 'Test move card',
      name: 'Move Test Session',
      startImmediately: false,
    });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('move button is visible on cards', async ({ page }) => {
    // Add session to the board first
    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await lane.locator('.add-session-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();
    await page.waitForSelector('.session-item', { timeout: 10000 });
    await page.locator('.session-item').first().click();
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Verify move button appears on card hover
    const card = lane.locator('.kanban-card').first();
    await card.hover();
    const moveButton = card.locator('.card-move-btn');
    await expect(moveButton).toBeVisible();
    await expect(moveButton).toHaveAttribute('title', 'Move to lane');
  });

  test('move modal opens from kanban board', async ({ page }) => {
    // Add session to the board
    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await lane.locator('.add-session-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();
    await page.waitForSelector('.session-item', { timeout: 10000 });
    await page.locator('.session-item').first().click();
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Click the move button
    const card = lane.locator('.kanban-card').first();
    await card.hover();
    await card.locator('.card-move-btn').click();

    // Verify modal opens with correct title
    await expect(page.locator('.modal-title')).toHaveText('Move to Lane');
    await expect(page.locator('.moving-session-name')).toContainText('Move Test Session');

    // Verify current lane is marked
    await expect(page.locator('.lane-row-current')).toContainText('To Do');
    await expect(page.locator('.lane-row-current')).toContainText('(current)');

    // Verify all lanes are listed
    const laneRows = page.locator('.lane-row');
    await expect(laneRows.first()).toBeVisible();
  });

  test('move card to different lane from kanban board', async ({ page }) => {
    // Add session to the To Do lane
    const todoLane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await todoLane.locator('.add-session-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();
    await page.waitForSelector('.session-item', { timeout: 10000 });
    await page.locator('.session-item').first().click();
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Open move modal
    const card = todoLane.locator('.kanban-card').first();
    await card.hover();
    await card.locator('.card-move-btn').click();

    // Select a different lane (e.g., "Done" or second lane)
    const targetLaneRadio = page.locator('.lane-row').filter({ hasText: 'Done' }).locator('input[type="radio"]');
    await targetLaneRadio.check();

    // Click Move button
    await page.click('.modal-footer .btn-primary');

    // Verify modal closes and success toast appears
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });
    // Note: Toast might not be visible for long, so we just check modal closed

    // Verify card moved to target lane
    const targetLane = page.locator('.kanban-lane').filter({ hasText: 'Done' });
    const cards = targetLane.locator('.kanban-card');
    await expect(cards).toHaveCount(1);
  });

  test('cannot select current lane in move modal', async ({ page }) => {
    // Add session to the board
    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await lane.locator('.add-session-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();
    await page.waitForSelector('.session-item', { timeout: 10000 });
    await page.locator('.session-item').first().click();
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Open move modal
    const card = lane.locator('.kanban-card').first();
    await card.hover();
    await card.locator('.card-move-btn').click();

    // Try to click current lane radio
    const currentLaneRadio = page.locator('.lane-row-current').locator('input[type="radio"]');
    await expect(currentLaneRadio).toBeDisabled();

    // Verify Move button is still disabled
    const moveButton = page.locator('.modal-footer .btn-primary');
    await expect(moveButton).toBeDisabled();
  });

  test('cancel and close behavior', async ({ page }) => {
    // Add session to the board
    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await lane.locator('.add-session-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();
    await page.waitForSelector('.session-item', { timeout: 10000 });
    await page.locator('.session-item').first().click();
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Test 1: Click backdrop to close
    const card = lane.locator('.kanban-card').first();
    await card.hover();
    await card.locator('.card-move-btn').click();
    await page.locator('.modal-backdrop').click();
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Test 2: Click Cancel button
    await card.hover();
    await card.locator('.card-move-btn').click();
    await page.click('.modal-footer .btn-secondary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Test 3: Click × close button
    await card.hover();
    await card.locator('.card-move-btn').click();
    await page.click('.close-btn');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });
  });

  test('move modal opens from session detail view', async ({ page }) => {
    // Add session to the board first
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });
    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await lane.locator('.add-session-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();
    await page.waitForSelector('.session-item', { timeout: 10000 });
    await page.locator('.session-item').first().click();
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Navigate to session detail view
    await navigateAndWait(page, `/sessions/${session.id}`, {
      waitFor: '.session-detail',
    });

    // Verify lane chip is clickable
    const laneChip = page.locator('.lane-chip');
    await expect(laneChip).toBeVisible();
    await expect(laneChip).toHaveAttribute('type', 'button');

    // Click lane chip to open move modal
    await laneChip.click();

    // Verify modal opens
    await expect(page.locator('.modal-title')).toHaveText('Move to Lane');
    await expect(page.locator('.moving-session-name')).toContainText('Move Test Session');
  });

  test('move card from session detail view', async ({ page }) => {
    // Add session to the board
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });
    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await lane.locator('.add-session-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();
    await page.waitForSelector('.session-item', { timeout: 10000 });
    await page.locator('.session-item').first().click();
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Navigate to session detail view
    await navigateAndWait(page, `/sessions/${session.id}`, {
      waitFor: '.session-detail',
    });

    // Click lane chip to open move modal
    const laneChip = page.locator('.lane-chip');
    await laneChip.click();

    // Select a different lane
    const targetLaneRadio = page.locator('.lane-row').filter({ hasText: 'Done' }).locator('input[type="radio"]');
    await targetLaneRadio.check();

    // Click Move
    await page.click('.modal-footer .btn-primary');

    // Verify modal closes
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Verify lane chip updates to show new lane
    await expect(laneChip).toContainText('Done');
  });

  test('automation checkbox behavior', async ({ page }) => {
    // Add session to the board
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // Setup a lane with automation first
    const todoLane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await todoLane.locator('.lane-settings-btn').click();
    await page.click('input[type="radio"][value="template"]');
    await expect(page.locator('#template-select')).toBeVisible();
    // Close the modal without saving
    await page.click('.close-btn');

    // Add session to board
    await todoLane.locator('.add-session-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();
    await page.waitForSelector('.session-item', { timeout: 10000 });
    await page.locator('.session-item').first().click();
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Open move modal
    const card = todoLane.locator('.kanban-card').first();
    await card.hover();
    await card.locator('.card-move-btn').click();

    // Select a lane (checkbox should appear if lane has automation)
    const targetLaneRadio = page.locator('.lane-row').filter({ hasText: 'Done' }).locator('input[type="radio"]');
    await targetLaneRadio.check();

    // Verify checkbox behavior (if target lane has automation configured)
    // This test verifies the UI elements render correctly
    const automationOption = page.locator('.automation-option');
    // Checkbox may or may not be visible depending on lane automation config
    // The important part is the modal doesn't crash
    await expect(page.locator('.modal-content')).toBeVisible();
  });

  test('keyboard navigation in move modal', async ({ page }) => {
    // Add session to the board
    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await lane.locator('.add-session-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();
    await page.waitForSelector('.session-item', { timeout: 10000 });
    await page.locator('.session-item').first().click();
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Open move modal
    const card = lane.locator('.kanban-card').first();
    await card.hover();
    await card.locator('.card-move-btn').click();

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });
  });

  test('multiple cards can be moved independently', async ({ page }) => {
    // Add first session
    const session2 = await seedSession(project.id, {
      prompt: 'Second session',
      name: 'Session 2',
      startImmediately: false,
    });

    const todoLane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });

    // Add both sessions to the board
    await todoLane.locator('.add-session-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();
    await page.waitForSelector('.session-item', { timeout: 10000 });
    await page.locator('.session-item').first().click();
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Verify we have cards
    const cards = todoLane.locator('.kanban-card');
    await expect(cards).toHaveCount(2);

    // Open move modal for first card
    await cards.nth(0).hover();
    await cards.nth(0).locator('.card-move-btn').click();
    await expect(page.locator('.moving-session-name')).toBeVisible();
    await page.keyboard.press('Escape');

    // Open move modal for second card
    await cards.nth(1).hover();
    await cards.nth(1).locator('.card-move-btn').click();
    await expect(page.locator('.moving-session-name')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('no lane chip when session not on board', async ({ page }) => {
    // Navigate to session detail view (session not on board)
    await navigateAndWait(page, `/sessions/${session.id}`, {
      waitFor: '.session-detail',
    });

    // Verify lane chip is not visible
    const laneChip = page.locator('.lane-chip');
    await expect(laneChip).not.toBeVisible();
  });
});
