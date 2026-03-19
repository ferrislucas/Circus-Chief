import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedKanbanLane,
  cleanupCreatedResources,
  navigateAndWait,
  API_URL,
} from './helpers';

test.describe('Kanban Lane Settings - Position Changes', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Kanban Position Test', '/tmp/test-kanban-pos');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  // Helper to setup test with default lanes
  async function setupTestLanes(page) {
    // First, fetch the kanban board to auto-create it with default lanes
    await fetch(`${API_URL}/api/projects/${project.id}/kanban`);

    // Navigate to kanban page
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // The board now has 4 default lanes: 'To Do', 'In Progress', 'Review', 'Done'
    // We'll use these for our position change tests
  }

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('canceling lane settings reverts position changes', async ({ page }) => {
    await setupTestLanes(page);

    // Use the default lanes: 'To Do', 'In Progress', 'Review', 'Done'
    const toDoLane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    const inProgressLane = page.locator('.kanban-lane').filter({ hasText: 'In Progress' });

    // Verify lanes exist
    await expect(toDoLane).toBeVisible();
    await expect(inProgressLane).toBeVisible();

    // Open settings for "In Progress" lane (position 2 of 4)
    await inProgressLane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Verify current position display
    const positionLabel = page.locator('.lane-position-label');
    await expect(positionLabel).toContainText('2 of 4');

    // Move lane to the right (position 3)
    const moveRightBtn = page.locator('.lane-position-controls').locator('button').nth(1);
    await expect(moveRightBtn).toBeEnabled();
    await moveRightBtn.click();

    // Position should update in modal
    await expect(positionLabel).toContainText('3 of 4');

    // Click Cancel
    await page.click('.modal-footer .btn-secondary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Wait for any WebSocket updates
    await page.waitForTimeout(1000);

    // Reload to ensure we have fresh state
    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();

    // Verify "In Progress" is still in position 2
    const lanesAfter = page.locator('.kanban-lane');
    const allLaneTitles = await lanesAfter.allTextContents();
    const indexToDo = allLaneTitles.findIndex(t => t.includes('To Do'));
    const indexInProgress = allLaneTitles.findIndex(t => t.includes('In Progress'));

    // "In Progress" should be after "To Do"
    expect(indexToDo).toBeLessThan(indexInProgress);
  });

  test('saving lane settings persists position changes', async ({ page }) => {
    await setupTestLanes(page);

    // Get initial lane order - should have 4 default lanes
    const lanesBefore = page.locator('.kanban-lane');
    await expect(lanesBefore).toHaveCount(4);
    expect(await lanesBefore.nth(0).locator('.lane-title').textContent()).toBe('To Do');
    expect(await lanesBefore.nth(1).locator('.lane-title').textContent()).toBe('In Progress');
    expect(await lanesBefore.nth(2).locator('.lane-title').textContent()).toBe('Review');
    expect(await lanesBefore.nth(3).locator('.lane-title').textContent()).toBe('Done');

    // Open settings for the first lane ("To Do")
    const firstLane = lanesBefore.nth(0);
    await firstLane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Verify current position
    const positionLabel = page.locator('.lane-position-label');
    await expect(positionLabel).toContainText('1 of 4');

    // Move lane to the right twice (to position 3)
    const moveRightBtn = page.locator('.lane-position-controls').locator('button').nth(1);
    await moveRightBtn.click();
    await expect(positionLabel).toContainText('2 of 4');
    await moveRightBtn.click();
    await expect(positionLabel).toContainText('3 of 4');

    // Save changes
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Wait for WebSocket updates
    await page.waitForTimeout(1000);

    // Verify lane order DID change
    const lanesAfter = page.locator('.kanban-lane');
    expect(await lanesAfter.nth(0).locator('.lane-title').textContent()).toBe('In Progress');
    expect(await lanesAfter.nth(1).locator('.lane-title').textContent()).toBe('Review');
    expect(await lanesAfter.nth(2).locator('.lane-title').textContent()).toBe('To Do');
    expect(await lanesAfter.nth(3).locator('.lane-title').textContent()).toBe('Done');
  });

  test('changing lane name and position together cancels both on cancel', async ({ page }) => {
    await setupTestLanes(page);

    const lane = page.locator('.kanban-lane').filter({ hasText: 'In Progress' });
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Change lane name
    await page.fill('#lane-name', 'Modified Progress');

    // Change lane position
    const moveRightBtn = page.locator('.lane-position-controls').locator('button').nth(1);
    await moveRightBtn.click();

    // Click Cancel
    await page.click('.modal-footer .btn-secondary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Re-open settings
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Verify both name and position are unchanged
    const nameInput = page.locator('#lane-name');
    await expect(nameInput).toHaveValue('In Progress');

    const positionLabel = page.locator('.lane-position-label');
    await expect(positionLabel).toContainText('2 of 4');
  });

  test('backdrop click cancels position changes', async ({ page }) => {
    await setupTestLanes(page);

    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Change position
    const moveRightBtn = page.locator('.lane-position-controls').locator('button').nth(1);
    await moveRightBtn.click();
    await expect(page.locator('.lane-position-label')).toContainText('2 of 4');

    // Click backdrop to close
    await page.mouse.click(10, 10);
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Wait for any updates
    await page.waitForTimeout(1000);

    // Verify lane order did NOT change
    const lanes = page.locator('.kanban-lane');
    expect(await lanes.nth(0).locator('.lane-title').textContent()).toBe('To Do');
  });

  test('rapid position changes before cancel', async ({ page }) => {
    await setupTestLanes(page);

    const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Rapidly click move right multiple times
    const moveRightBtn = page.locator('.lane-position-controls').locator('button').nth(1);
    await moveRightBtn.click();
    await moveRightBtn.click();
    await moveRightBtn.click();

    // Position should show we're at position 4 (last)
    await expect(page.locator('.lane-position-label')).toContainText('4 of 4');

    // Click Cancel
    await page.click('.modal-footer .btn-secondary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Wait for any updates
    await page.waitForTimeout(1000);

    // Verify lane is still at position 1
    const lanes = page.locator('.kanban-lane');
    expect(await lanes.nth(0).locator('.lane-title').textContent()).toBe('To Do');
  });

  test('position change with invalid lane name cannot save', async ({ page }) => {
    await setupTestLanes(page);

    const lane = page.locator('.kanban-lane').filter({ hasText: 'In Progress' });
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Clear the lane name (invalid)
    await page.fill('#lane-name', '');
    await page.fill('#lane-name', '   ');

    // Change lane position
    const moveRightBtn = page.locator('.lane-position-controls').locator('button').nth(1);
    await moveRightBtn.click();

    // Save button should be disabled
    const saveBtn = page.locator('.modal-footer .btn-primary');
    await expect(saveBtn).toBeDisabled();

    // Close modal
    await page.click('.close-btn');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Verify lane order did NOT change (since save was disabled)
    const lanes = page.locator('.kanban-lane');
    expect(await lanes.nth(1).locator('.lane-title').textContent()).toBe('In Progress');
  });

  test('position controls update disabled states correctly', async ({ page }) => {
    await setupTestLanes(page);

    // Test first lane (left button should be disabled)
    const firstLane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await firstLane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    const moveLeftBtn = page.locator('.lane-position-controls').locator('button').nth(0);
    const moveRightBtn = page.locator('.lane-position-controls').locator('button').nth(1);

    // At position 1, left should be disabled
    await expect(moveLeftBtn).toBeDisabled();
    await expect(moveRightBtn).toBeEnabled();

    // Move right
    await moveRightBtn.click();

    // Now both should be enabled (at position 2)
    await expect(moveLeftBtn).toBeEnabled();
    await expect(moveRightBtn).toBeEnabled();

    // Move right again
    await moveRightBtn.click();

    // At position 3, right should still be enabled (since there's position 4)
    await expect(moveLeftBtn).toBeEnabled();
    await expect(moveRightBtn).toBeEnabled();

    // Move right once more to reach position 4
    await moveRightBtn.click();

    // At position 4, right should be disabled
    await expect(moveLeftBtn).toBeEnabled();
    await expect(moveRightBtn).toBeDisabled();

    await page.click('.close-btn');
  });
});
