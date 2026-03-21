import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedCommandButton,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
  runCommandButtonAndWait,
  getCommandRun,
  getSession,
} from './helpers';

test.describe('Command Buttons - Remove Run from Session List', () => {
  test.describe.configure({ timeout: 60000 });

  let project;
  let session;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Session List Remove Bug', '/tmp/test');
    session = await seedSession(project.id, {
      prompt: 'Test session for list removal bug',
      name: 'List Remove Bug Session',
    });
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('removing run from session list view successfully removes the run', async ({ page }) => {
    // Step 1: Create and run a command button
    const button = await seedCommandButton(project.id, {
      label: 'List View Test',
      command: 'echo "This should be removed"',
      showOnList: true, // Critical: ensures button appears on session list
    });

    const run = await runCommandButtonAndWait(session.id, button.id, 15000);
    expect(run.status).toBe('success');

    // Step 2: Navigate to session LIST view (not detail view)
    await navigateAndWait(page, `/projects/${project.id}/sessions`);
    await page.waitForTimeout(1000); // Wait for WebSocket connection

    // Step 3: Verify status indicator is visible on session card
    const indicator = page.locator(
      `.session-card .button-status-indicator[title*="List View Test"]`
    ).first();
    await expect(indicator).toBeVisible({ timeout: 5000 });

    // Step 4: Remove the run from the session list view
    await indicator.click();
    await expect(page.locator('[data-testid="button-status-modal"]')).toBeVisible();

    // Click "Remove Run" and confirm
    await page.locator('[data-testid="remove-run-button"]').click();
    await expect(page.locator('[data-testid="confirm-remove-button"]')).toBeVisible();
    await page.locator('[data-testid="confirm-remove-button"]').click();

    // Modal should close after successful deletion
    await page.locator('[data-testid="button-status-modal"]').waitFor({ state: 'hidden', timeout: 5000 });

    // Step 5: Verify run was actually removed
    // The status indicator should no longer be visible
    await expect(indicator).not.toBeVisible({ timeout: 5000 });

    // Step 6: Verify database - run should be deleted
    const deletedRun = await getCommandRun(session.id, run.runId);
    expect(deletedRun).toBeNull();

    // Step 7: Verify session's latestCommandRuns no longer contains the run
    const sessionData = await getSession(session.id);
    const runInLatest = sessionData.latestCommandRuns?.find(r => r.runId === run.runId);
    expect(runInLatest).toBeUndefined();
  });

  test('contrast: removing run from session detail view also works correctly', async ({ page }) => {
    // This test verifies the detail view path (which already has sessionId) still works

    const button = await seedCommandButton(project.id, {
      label: 'Detail View Test',
      command: 'echo "This will be removed correctly"',
      showOnList: true,
    });

    const run = await runCommandButtonAndWait(session.id, button.id, 15000);
    expect(run.status).toBe('success');

    // Navigate to session DETAIL view
    await navigateAndWait(page, `/sessions/${session.id}`);
    await page.waitForTimeout(1000);

    // Find and click status indicator in the header panel
    const indicator = page.locator(
      `.command-status-bar .button-status-indicator[title*="Detail View Test"]`
    ).first();
    await expect(indicator).toBeVisible({ timeout: 5000 });
    await indicator.click();

    // Wait for modal and remove the run
    await expect(page.locator('[data-testid="button-status-modal"]')).toBeVisible();
    await page.locator('[data-testid="remove-run-button"]').click();
    await expect(page.locator('[data-testid="confirm-remove-button"]')).toBeVisible();
    await page.locator('[data-testid="confirm-remove-button"]').click();

    // Modal should close
    await page.locator('[data-testid="button-status-modal"]').waitFor({ state: 'hidden', timeout: 5000 });

    // Verify run was actually removed
    const deletedRun = await getCommandRun(session.id, run.runId);
    expect(deletedRun).toBeNull();

    const sessionData = await getSession(session.id);
    const runInLatest = sessionData.latestCommandRuns?.find(r => r.runId === run.runId);
    expect(runInLatest).toBeUndefined();
  });
});
