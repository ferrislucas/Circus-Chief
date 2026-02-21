import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupAll,
  seedCommandButton,
  navigateAndWait,
  waitForSessionToExist,
  runCommandButton,
  waitForCommandRunComplete,
} from './helpers';

/**
 * Tests for command button status indicators on the session LIST view.
 *
 * This test verifies that when a command button is run (via API),
 * the status indicator updates in REAL-TIME on the session list view,
 * without requiring a page refresh.
 *
 * Bug context: The buttonStatusesToDisplay computed property in SessionCard.vue
 * was not reactively updating when latestCommandRuns changed because Vue
 * wasn't tracking the dependency properly.
 */
test.describe('Session List Command Button Indicators', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;
  let button: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Button Indicators Test', '/tmp');
    session = await seedSession(project.id, { prompt: 'Test prompt', name: 'Test Session' });
    // Wait for session to be available
    await waitForSessionToExist(session.id);

    // Create a command button with showOnList: true
    // This is critical - only buttons with showOnList appear on the session list
    button = await seedCommandButton(project.id, {
      label: 'Test Button',
      command: 'echo "hello"',
      showOnList: true,
    });
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  /**
   * Test: Running state shows during command execution
   */
  test('should show running indicator while command executes', async ({ page }) => {
    // Create a longer-running command for this test
    const longButton = await seedCommandButton(project.id, {
      label: 'Long Command',
      command: 'sleep 3 && echo "done"',
      showOnList: true,
    });

    // Navigate to the session LIST view
    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Verify the session card is visible
    await expect(page.getByText('Test Session')).toBeVisible();

    // Run the command (don't wait for completion)
    console.log('Running long command via API...');
    const { runId } = await runCommandButton(session.id, longButton.id);
    console.log(`Command run started with runId: ${runId}`);

    // The running indicator should appear
    const runningIndicator = page.locator('.button-status-running');
    await expect(runningIndicator).toBeVisible({ timeout: 5000 });

    // It should show the running icon
    await expect(runningIndicator).toContainText('⊙');

    // Wait for completion
    await waitForCommandRunComplete(session.id, runId, 10000);

    // After completion, it should show success
    const successIndicator = page.locator('.button-status-success');
    await expect(successIndicator).toBeVisible({ timeout: 5000 });
  });

  /**
   * Test: Error state shows when command fails
   */
  test('should show error indicator when command fails', async ({ page }) => {
    // Create a failing command
    const failButton = await seedCommandButton(project.id, {
      label: 'Fail Command',
      command: 'exit 1',
      showOnList: true,
    });

    // Navigate to the session LIST view
    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Verify the session card is visible
    await expect(page.getByText('Test Session')).toBeVisible();

    // Run the command
    const { runId } = await runCommandButton(session.id, failButton.id);

    // Wait for completion
    await waitForCommandRunComplete(session.id, runId, 10000);

    // The error indicator should appear
    const errorIndicator = page.locator('.button-status-error');
    await expect(errorIndicator).toBeVisible({ timeout: 5000 });

    // It should show the error icon
    await expect(errorIndicator).toContainText('✕');
  });

  /**
   * Test: Clicking indicator opens modal with details
   */
  test('should open modal when clicking status indicator', async ({ page }) => {
    // Navigate to the session LIST view
    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Run a command first
    const { runId } = await runCommandButton(session.id, button.id);
    await waitForCommandRunComplete(session.id, runId, 10000);

    // Wait for indicator to appear
    const indicator = page.locator('.button-status-indicator');
    await expect(indicator).toBeVisible({ timeout: 5000 });

    // Click the indicator
    await indicator.click();

    // Modal should appear with command output
    const modal = page.locator('.modal-overlay');
    await expect(modal).toBeVisible({ timeout: 3000 });
  });
});
