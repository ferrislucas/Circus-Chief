import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedKanbanLane,
  cleanupCreatedResources,
  navigateAndWait,
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

  // Helper to create test lanes for position testing
  async function setupTestLanes(page) {
    // Navigate to kanban page first to auto-create the board with default lanes
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // Create our custom lanes for position testing at the end
    // Note: sortOrder determines lane order. We use higher values to put them after defaults.
    await seedKanbanLane(project.id, { name: 'Lane A', sortOrder: 100 });
    await seedKanbanLane(project.id, { name: 'Lane B', sortOrder: 101 });
    await seedKanbanLane(project.id, { name: 'Lane C', sortOrder: 102 });

    // Reload the page to pick up the new lanes
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });
  }

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('canceling lane settings reverts position changes', async ({ page }) => {
    await setupTestLanes(page);

    // Find our test lanes (they should be at the end)
    const laneA = page.locator('.kanban-lane').filter({ hasText: 'Lane A' });
    const laneB = page.locator('.kanban-lane').filter({ hasText: 'Lane B' });
    const laneC = page.locator('.kanban-lane').filter({ hasText: 'Lane C' });

    // Verify lanes exist and are in correct order
    await expect(laneA).toBeVisible();
    await expect(laneB).toBeVisible();
    await expect(laneC).toBeVisible();

    // Open settings for Lane B (middle of our 3 test lanes)
    await laneB.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Get total lane count for position display
    const allLanes = await page.locator('.kanban-lane').count();

    // Verify current position display (Lane B should be in the middle)
    const positionLabel = page.locator('.lane-position-label');
    await expect(positionLabel).toContainText(`${allLanes - 1} of ${allLanes}`);

    // Move lane to the right (last position)
    const moveRightBtn = page.locator('.lane-position-controls').locator('button').nth(1);
    await expect(moveRightBtn).toBeEnabled();
    await moveRightBtn.click();

    // Position should update in modal to show it's last
    await expect(positionLabel).toContainText(`${allLanes} of ${allLanes}`);
    await expect(moveRightBtn).toBeDisabled();

    // Click Cancel
    await page.click('.modal-footer .btn-secondary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Wait for any WebSocket updates
    await page.waitForTimeout(1000);

    // Reload to ensure we have fresh state
    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();

    // Verify Lane B is still in its original position (between A and C)
    const lanesAfter = page.locator('.kanban-lane');
    const laneAText = await lanesAfter.filter({ hasText: 'Lane A' }).locator('.lane-title').textContent();
    const laneBText = await lanesAfter.filter({ hasText: 'Lane B' }).locator('.lane-title').textContent();
    const laneCText = await lanesAfter.filter({ hasText: 'Lane C' }).locator('.lane-title').textContent();

    // Get all lane titles to verify order
    const allLaneTitles = await lanesAfter.allTextContents();
    const indexA = allLaneTitles.findIndex(t => t.includes('Lane A'));
    const indexB = allLaneTitles.findIndex(t => t.includes('Lane B'));
    const indexC = allLaneTitles.findIndex(t => t.includes('Lane C'));

    // Lane B should be between A and C
    expect(indexA).toBeLessThan(indexB);
    expect(indexB).toBeLessThan(indexC);
  });

  test('saving lane settings persists position changes', async ({ page }) => {
    await setupTestLanes(page);

    // Get initial lane order
    const lanesBefore = page.locator('.kanban-lane');
    await expect(lanesBefore).toHaveCount(3);
    expect(await lanesBefore.nth(0).locator('.lane-title').textContent()).toBe('First Lane');
    expect(await lanesBefore.nth(1).locator('.lane-title').textContent()).toBe('Second Lane');

    // Open settings for the first lane
    const firstLane = lanesBefore.nth(0);
    await firstLane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Verify current position
    const positionLabel = page.locator('.lane-position-label');
    await expect(positionLabel).toContainText('1 of 3');

    // Move lane to the right twice (to position 2)
    const moveRightBtn = page.locator('.lane-position-controls').locator('button').nth(1);
    await moveRightBtn.click();
    await expect(positionLabel).toContainText('2 of 3');
    await moveRightBtn.click();
    await expect(positionLabel).toContainText('3 of 3');

    // Save changes
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Wait for WebSocket updates
    await page.waitForTimeout(1000);

    // Verify lane order DID change
    const lanesAfter = page.locator('.kanban-lane');
    expect(await lanesAfter.nth(0).locator('.lane-title').textContent()).toBe('Second Lane');
    expect(await lanesAfter.nth(1).locator('.lane-title').textContent()).toBe('Third Lane');
    expect(await lanesAfter.nth(2).locator('.lane-title').textContent()).toBe('First Lane');
  });

  test('changing lane name and position together cancels both on cancel', async ({ page }) => {
    await setupTestLanes(page);

    const lane = page.locator('.kanban-lane').filter({ hasText: 'Second Lane' });
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Change lane name
    await page.fill('#lane-name', 'Modified Name');

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
    await expect(nameInput).toHaveValue('Second Lane');

    const positionLabel = page.locator('.lane-position-label');
    await expect(positionLabel).toContainText('2 of 3');
  });

  test('backdrop click cancels position changes', async ({ page }) => {
    await setupTestLanes(page);

    const lane = page.locator('.kanban-lane').filter({ hasText: 'First Lane' });
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Change position
    const moveRightBtn = page.locator('.lane-position-controls').locator('button').nth(1);
    await moveRightBtn.click();
    await expect(page.locator('.lane-position-label')).toContainText('2 of 3');

    // Click backdrop to close
    await page.mouse.click(10, 10);
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Wait for any updates
    await page.waitForTimeout(1000);

    // Verify lane order did NOT change
    const lanes = page.locator('.kanban-lane');
    expect(await lanes.nth(0).locator('.lane-title').textContent()).toBe('First Lane');
  });

  test('escape key cancels position changes', async ({ page }) => {
    await setupTestLanes(page);

    const lane = page.locator('.kanban-lane').filter({ hasText: 'Third Lane' });
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Change position (move left)
    const moveLeftBtn = page.locator('.lane-position-controls').locator('button').nth(0);
    await moveLeftBtn.click();
    await expect(page.locator('.lane-position-label')).toContainText('2 of 3');

    // Press Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Wait for any updates
    await page.waitForTimeout(1000);

    // Verify lane order did NOT change
    const lanes = page.locator('.kanban-lane');
    expect(await lanes.nth(2).locator('.lane-title').textContent()).toBe('Third Lane');
  });

  test('rapid position changes before cancel', async ({ page }) => {
    await setupTestLanes(page);

    const lane = page.locator('.kanban-lane').filter({ hasText: 'First Lane' });
    await lane.locator('.lane-settings-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();

    // Rapidly click move right multiple times
    const moveRightBtn = page.locator('.lane-position-controls').locator('button').nth(1);
    await moveRightBtn.click();
    await moveRightBtn.click();

    // Position should show we're at position 3
    await expect(page.locator('.lane-position-label')).toContainText('3 of 3');

    // Click Cancel
    await page.click('.modal-footer .btn-secondary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Wait for any updates
    await page.waitForTimeout(1000);

    // Verify lane is still at position 1
    const lanes = page.locator('.kanban-lane');
    expect(await lanes.nth(0).locator('.lane-title').textContent()).toBe('First Lane');
  });

  test('position change with invalid lane name cannot save', async ({ page }) => {
    await setupTestLanes(page);

    const lane = page.locator('.kanban-lane').filter({ hasText: 'Second Lane' });
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
    expect(await lanes.nth(1).locator('.lane-title').textContent()).toBe('Second Lane');
  });

  test('position controls update disabled states correctly', async ({ page }) => {
    await setupTestLanes(page);

    // Test first lane (left button should be disabled)
    const firstLane = page.locator('.kanban-lane').filter({ hasText: 'First Lane' });
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

    // At position 3, right should be disabled
    await expect(moveLeftBtn).toBeEnabled();
    await expect(moveRightBtn).toBeDisabled();

    await page.click('.close-btn');
  });
});
