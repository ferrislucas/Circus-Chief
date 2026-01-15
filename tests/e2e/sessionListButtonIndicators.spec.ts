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
   * CRITICAL TEST: Real-time update of button indicator on session LIST view
   *
   * Steps:
   * 1. Navigate to session LIST view (not detail view)
   * 2. Verify no indicator is showing yet (no runs have happened)
   * 3. Trigger a command run via API (simulating background execution)
   * 4. Wait for the indicator to appear WITHOUT refreshing the page
   *
   * This tests the WebSocket/reactive update path.
   */
  test('should show button status indicator in real-time on session list', async ({ page }) => {
    // Capture browser console logs
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    // Navigate to the session LIST view (project sessions page)
    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Verify the session card is visible
    await expect(page.getByText('Test Session')).toBeVisible();

    // Initially, there should be no button status indicator
    // (no command has been run yet)
    const indicator = page.locator('.button-status-indicator');
    await expect(indicator).not.toBeVisible({ timeout: 2000 });

    // Now run the command via API (without navigating away)
    console.log('Running command via API...');
    const { runId } = await runCommandButton(session.id, button.id);
    console.log(`Command run started with runId: ${runId}`);

    // Wait for the command to complete
    const completedRun = await waitForCommandRunComplete(session.id, runId, 10000);
    console.log(`Command completed with status: ${completedRun.status}`);

    // THE KEY TEST: The indicator should now be visible WITHOUT page refresh
    // This verifies that the WebSocket update triggered a reactive update
    // in the SessionCard component on the list view.

    // Debug: Take a screenshot to see what's on the page
    await page.screenshot({ path: 'test-results/debug-before-indicator-check.png' });

    // Debug: Log the current HTML of the session card area
    const sessionCardHtml = await page.locator('.session-card').first().innerHTML();
    console.log('Session card HTML:', sessionCardHtml.substring(0, 500));

    // Wait a bit for WebSocket to deliver the update and Vue to re-render
    await page.waitForTimeout(2000);

    // Take another screenshot after waiting
    await page.screenshot({ path: 'test-results/debug-after-wait.png' });

    // Log updated HTML
    const updatedHtml = await page.locator('.session-card').first().innerHTML();
    console.log('Session card HTML after wait:', updatedHtml.substring(0, 1000));

    // Log all browser console logs
    console.log('All browser console logs:');
    consoleLogs.forEach(log => console.log('  ' + log));

    await expect(indicator).toBeVisible({ timeout: 5000 });

    // Verify it shows the success status (green checkmark)
    await expect(indicator).toHaveClass(/button-status-success/);

    // Verify the checkmark icon is shown
    await expect(indicator).toContainText('✓');
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
