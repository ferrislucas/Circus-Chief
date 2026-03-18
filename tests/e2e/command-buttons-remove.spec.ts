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
  getCommandRuns,
  getSession,
  openButtonStatusModal,
  removeCommandRunViaUI,
  verifyRunDeleted,
  waitForCommandCompletion,
} from './helpers';

test.describe('Command Buttons - Remove Run Feature', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Command Buttons Remove', '/tmp/test');
    session = await seedSession(project.id, {
      prompt: 'Test prompt for remove run',
      name: 'Remove Run Test Session',
    });
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test.describe('Basic Remove Run Flow', () => {
    test('can remove a completed command run', async ({ page }) => {
      // Step 1: Create a command button via API
      const button = await seedCommandButton(project.id, {
        label: 'Test Command',
        command: 'echo "Hello, World!"',
        showOnList: true,
      });

      // Step 2: Run the command and wait for completion
      const run = await runCommandButtonAndWait(session.id, button.id, 15000);
      expect(run.status).toBe('success');
      expect(run.exitCode).toBe(0);

      // Step 3: Navigate to session and verify status indicator shows ✓
      await navigateAndWait(page, `/sessions/${session.id}`);
      // Wait for WebSocket to connect and receive button status updates
      await page.waitForTimeout(1000);
      const status = await waitForCommandCompletion(page, 'Test Command', 15000);
      expect(status).toBe('success');

      // Step 4: Click the status indicator in SessionHeaderPanel to open modal
      await openButtonStatusModal(page, 'Test Command');

      // Step 5: Verify modal opens showing run details
      await expect(page.locator('[data-testid="button-status-modal"]')).toBeVisible();
      await expect(page.locator('[data-testid="button-status-badge"]')).toHaveText('Success');
      await expect(page.getByText(run.runId)).toBeVisible();

      // Step 6: Click "Remove Run" button in modal footer
      await expect(page.locator('[data-testid="remove-run-button"]')).toBeVisible();
      await page.locator('[data-testid="remove-run-button"]').click();

      // Step 7: Verify confirmation dialog appears
      await expect(page.locator('[data-testid="confirm-remove-button"]')).toBeVisible();
      await expect(page.getByText('Are you sure?')).toBeVisible();

      // Step 8: Click "Confirm" button
      await page.locator('[data-testid="confirm-remove-button"]').click();

      // Step 9: Verify modal closes after successful deletion
      await page.locator('[data-testid="button-status-modal"]').waitFor({ state: 'hidden', timeout: 5000 });

      // Step 10: Verify run disappears from SessionHeaderPanel status indicators
      // The status indicator should no longer be visible for this button
      await expect(
        page.locator(`.command-status-bar .button-status-indicator[title*="Test Command"]`)
      ).not.toBeVisible({ timeout: 5000 });

      // Step 11: Verify database: run deleted from command_runs table
      const deletedRun = await getCommandRun(session.id, run.runId);
      expect(deletedRun).toBeNull();

      // Step 12: Verify database: run removed from session's latestCommandRuns array
      const updatedSession = await getSession(session.id);
      const latestRuns = updatedSession.latestCommandRuns || [];
      const runStillInLatest = latestRuns.find((r: any) => r.runId === run.runId);
      expect(runStillInLatest).toBeUndefined();
    });

    test('can remove a failed command run', async ({ page }) => {
      // Step 1: Create a command button with failing command
      const button = await seedCommandButton(project.id, {
        label: 'Failing Command',
        command: 'exit 1',
        showOnList: true,
      });

      // Step 2: Run the command
      const run = await runCommandButtonAndWait(session.id, button.id, 15000);
      expect(run.status).toBe('error');
      expect(run.exitCode).toBe(1);

      // Step 3: Navigate to session and verify error status (✕ indicator)
      await navigateAndWait(page, `/sessions/${session.id}`);
      // Wait for WebSocket to connect and receive button status updates
      await page.waitForTimeout(1000);
      const status = await waitForCommandCompletion(page, 'Failing Command', 15000);
      expect(status).toBe('error');

      // Step 4: Click status indicator to open modal
      await openButtonStatusModal(page, 'Failing Command');

      // Step 5: Verify modal shows error status and exit code
      await expect(page.locator('[data-testid="button-status-badge"]')).toHaveText('Error');
      await expect(page.getByText(`Exit Code:`, { exact: false })).toBeVisible();
      // Use a more specific selector for the exit code value
      await expect(page.locator('.detail-value').filter({ hasText: '1' }).first()).toBeVisible();

      // Step 6: Close the modal before trying to remove (modal is still open)
      await page.locator('.btn-primary:has-text("Close")').click();
      await expect(page.locator('[data-testid="button-status-modal"]')).not.toBeVisible();

      // Step 7: Remove the failed run
      await removeCommandRunViaUI(page, 'Failing Command');

      // Step 7: Verify it's removed from UI and database
      await expect(
        page.locator(`.command-status-bar .button-status-indicator[title*="Failing Command"]`)
      ).not.toBeVisible({ timeout: 5000 });

      const deletedRun = await getCommandRun(session.id, run.runId);
      expect(deletedRun).toBeNull();
    });
  });

  test.describe('Cancel Removal', () => {
    test('can cancel run removal', async ({ page }) => {
      // Step 1: Complete a command run
      const button = await seedCommandButton(project.id, {
        label: 'Cancelable Command',
        command: 'echo "Test"',
        showOnList: true,
      });
      const run = await runCommandButtonAndWait(session.id, button.id, 15000);

      // Step 2: Navigate to session and click status indicator to open modal
      await navigateAndWait(page, `/sessions/${session.id}`);
      // Wait for WebSocket to connect and receive button status updates
      await page.waitForTimeout(1000);
      await waitForCommandCompletion(page, 'Cancelable Command', 15000);
      await openButtonStatusModal(page, 'Cancelable Command');

      // Step 3: Click "Remove Run" button
      await page.locator('[data-testid="remove-run-button"]').click();

      // Step 4: Verify confirmation dialog appears
      await expect(page.locator('[data-testid="confirm-remove-button"]')).toBeVisible();
      await expect(page.locator('[data-testid="cancel-remove-button"]')).toBeVisible();
      await expect(page.getByText('Are you sure?')).toBeVisible();

      // Step 5: Click "Cancel" button
      await page.locator('[data-testid="cancel-remove-button"]').click();

      // Step 6: Verify confirmation dialog disappears
      await expect(page.locator('[data-testid="confirm-remove-button"]')).not.toBeVisible();

      // Step 7: Verify "Remove Run" button is still visible
      await expect(page.locator('[data-testid="remove-run-button"]')).toBeVisible();

      // Step 8: Verify run still exists in database and UI
      const existingRun = await getCommandRun(session.id, run.runId);
      expect(existingRun).not.toBeNull();
      expect(existingRun.runId).toBe(run.runId);

      // Step 9: Verify modal remains open
      await expect(page.locator('[data-testid="button-status-modal"]')).toBeVisible();
    });
  });

  test.describe('Cannot Remove Running Command', () => {
    test('cannot remove running command', async ({ page }) => {
      // Step 1: Create a long-running command
      const button = await seedCommandButton(project.id, {
        label: 'Long Running',
        command: 'sleep 10',
        showOnList: true,
      });

      // Step 2: Start the command (don't wait for completion)
      const response = await fetch(`${process.env.API_URL || 'http://localhost:5000'}/api/sessions/${session.id}/command-buttons/${button.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const { runId } = await response.json();

      // Step 3: Navigate to session
      await navigateAndWait(page, `/sessions/${session.id}`);
      // Wait for WebSocket to connect
      await page.waitForTimeout(1000);

      // Step 4: Wait for running status (⊙ indicator, pulsing)
      const runningIndicator = page.locator(
        `.command-status-bar .button-status-indicator.button-status-running[title*="Long Running"]`
      );
      await runningIndicator.waitFor({ state: 'visible', timeout: 5000 });

      // Step 5: Click status indicator to open modal
      await openButtonStatusModal(page, 'Long Running');

      // Step 6: Verify "Remove Run" button is NOT visible in modal
      await expect(page.locator('[data-testid="remove-run-button"]')).not.toBeVisible();

      // Step 7: Close modal
      await page.locator('.btn-primary:has-text("Close")').click();

      // Step 8: Wait for command to complete (or kill it)
      // We'll kill it to speed up the test
      await fetch(`${process.env.API_URL || 'http://localhost:5000'}/api/sessions/${session.id}/command-buttons/runs/${runId}/kill`, {
        method: 'POST',
      });

      // Wait for kill to process
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Step 9: Refresh page or reopen modal
      await page.reload();
      // Wait for WebSocket to connect after reload
      await page.waitForTimeout(1000);
      // After killing, wait for killed status (error status)
      const status = await waitForCommandCompletion(page, 'Long Running', 15000);
      expect(status === 'error' || status === 'success').toBeTruthy();

      // Step 10: Verify "Remove Run" button is now visible (for completed/killed run)
      await openButtonStatusModal(page, 'Long Running');
      await expect(page.locator('[data-testid="remove-run-button"]')).toBeVisible();
    });
  });

  test.describe('WebSocket Synchronization', () => {
    test('removal syncs across multiple browser tabs', async ({ context }) => {
      // Step 1: Create and run a command
      const button = await seedCommandButton(project.id, {
        label: 'Sync Test',
        command: 'echo "WebSocket sync"',
        showOnList: true,
      });
      const run = await runCommandButtonAndWait(session.id, button.id, 15000);

      // Step 2: Open same session in two browser contexts (tabs)
      const pageA = await context.newPage();
      const pageB = await context.newPage();

      await navigateAndWait(pageA, `/sessions/${session.id}`);
      await navigateAndWait(pageB, `/sessions/${session.id}`);

      // Wait for WebSocket to connect in both tabs
      await pageA.waitForTimeout(1000);
      await pageB.waitForTimeout(1000);

      // Step 3: Wait for status indicator to appear in both tabs
      await waitForCommandCompletion(pageA, 'Sync Test', 15000);
      await waitForCommandCompletion(pageB, 'Sync Test', 15000);

      // Verify both tabs show the indicator
      await expect(
        pageA.locator(`.command-status-bar .button-status-indicator[title*="Sync Test"]`)
      ).toBeVisible();
      await expect(
        pageB.locator(`.command-status-bar .button-status-indicator[title*="Sync Test"]`)
      ).toBeVisible();

      // Step 4: In Tab A, click status indicator and remove the run
      await removeCommandRunViaUI(pageA, 'Sync Test');

      // Step 5: Confirm deletion in Tab A
      await expect(
        pageA.locator(`.command-status-bar .button-status-indicator[title*="Sync Test"]`)
      ).not.toBeVisible({ timeout: 5000 });

      // Step 6: Verify run disappears from Tab B's status indicators (via WebSocket)
      await expect(
        pageB.locator(`.command-status-bar .button-status-indicator[title*="Sync Test"]`)
      ).not.toBeVisible({ timeout: 5000 });

      // Step 7: Verify both tabs show consistent state
      const indicatorA = pageA.locator(`.command-status-bar .button-status-indicator[title*="Sync Test"]`);
      const indicatorB = pageB.locator(`.command-status-bar .button-status-indicator[title*="Sync Test"]`);

      const countA = await indicatorA.count();
      const countB = await indicatorB.count();

      expect(countA).toBe(0);
      expect(countB).toBe(0);

      await pageA.close();
      await pageB.close();
    });
  });

  test.describe('Project-Level Synchronization', () => {
    test('removal updates session list indicators', async ({ page }) => {
      // Step 1: Create and run a command in a session
      const button = await seedCommandButton(project.id, {
        label: 'Project Sync Test',
        command: 'echo "Project level sync"',
        showOnList: true,
      });
      const run = await runCommandButtonAndWait(session.id, button.id, 15000);

      // Step 2: Navigate to project session list
      await navigateAndWait(page, `/projects/${project.id}/sessions`);

      // Step 3: Verify session card shows status indicator for the button
      // The indicator should be visible in the session list view
      await expect(
        page.locator(`.button-status-indicator[title*="Project Sync Test"]`)
      ).toBeVisible({ timeout: 5000 });

      // Step 4: Return to session detail view
      await navigateAndWait(page, `/sessions/${session.id}`);

      // Step 5: Remove the run via SessionHeaderPanel
      await removeCommandRunViaUI(page, 'Project Sync Test');

      // Step 6: Navigate back to project session list
      await navigateAndWait(page, `/projects/${project.id}/sessions`);

      // Step 7: Verify session card NO LONGER shows the status indicator
      // Only shows indicator if button has a latest run
      await expect(
        page.locator(`.button-status-indicator[title*="Project Sync Test"]`)
      ).not.toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Remove Run with Output', () => {
    test('can remove run with large output', async ({ page }) => {
      // Step 1: Create command that generates substantial output
      const button = await seedCommandButton(project.id, {
        label: 'Large Output',
        command: 'seq 1 100',
        showOnList: true,
      });
      const run = await runCommandButtonAndWait(session.id, button.id, 15000);

      // Step 2: Navigate to session
      await navigateAndWait(page, `/sessions/${session.id}`);
      // Wait for WebSocket to connect and receive button status updates
      await page.waitForTimeout(1000);
      await waitForCommandCompletion(page, 'Large Output', 15000);

      // Step 3: Click status indicator to open modal
      await openButtonStatusModal(page, 'Large Output');

      // Step 4: Verify output is displayed in modal
      await expect(page.locator('[data-testid="button-status-modal"]')).toBeVisible();
      // Note: The modal doesn't show full output, just run details

      // Step 5: Close the modal before trying to remove
      await page.locator('.btn-primary:has-text("Close")').click();
      await expect(page.locator('[data-testid="button-status-modal"]')).not.toBeVisible();

      // Step 6: Remove the run
      await removeCommandRunViaUI(page, 'Large Output');

      // Step 6: Verify modal closes
      await expect(page.locator('[data-testid="button-status-modal"]')).not.toBeVisible();

      // Step 7: Verify output is cleared from UI (status indicator gone)
      await expect(
        page.locator(`.command-status-bar .button-status-indicator[title*="Large Output"]`)
      ).not.toBeVisible({ timeout: 5000 });

      // Step 8: Verify run is removed from database
      await verifyRunDeleted(session.id, run.runId);
    });
  });

  test.describe('Remove Run When Button Has Multiple Historical Runs', () => {
    test('removing latest run updates correctly when button has history', async ({ page }) => {
      // Step 1: Create a command button
      const button = await seedCommandButton(project.id, {
        label: 'Multi Run',
        command: 'echo "Run $RANDOM"',
        showOnList: true,
      });

      // Step 2: Run it three times (waiting for completion between runs)
      const run1 = await runCommandButtonAndWait(session.id, button.id, 15000);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Delay between runs

      const run2 = await runCommandButtonAndWait(session.id, button.id, 15000);
      await new Promise(resolve => setTimeout(resolve, 1000));

      const run3 = await runCommandButtonAndWait(session.id, button.id, 15000);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait after final run

      // Step 3: After each run, verify status indicator updates
      await navigateAndWait(page, `/sessions/${session.id}`);
      // Wait for WebSocket to connect
      await page.waitForTimeout(1000);
      await waitForCommandCompletion(page, 'Multi Run', 15000);

      // Get the session to check latestCommandRuns
      let sessionData = await getSession(session.id);
      expect(sessionData.latestCommandRuns).toHaveLength(1);
      expect(sessionData.latestCommandRuns[0].runId).toBe(run3.runId);

      // Step 4: Remove the latest (third) run
      await removeCommandRunViaUI(page, 'Multi Run');

      // Reload page to force fresh state from server
      await page.reload();
      // Wait for WebSocket to reconnect
      await page.waitForTimeout(1000);

      // Debug: Check session data immediately after deletion
      sessionData = await getSession(session.id);
      console.log('After deletion, latestCommandRuns:', sessionData.latestCommandRuns);
      console.log('Expected run2.runId:', run2.runId);

      // Step 5: Verify status indicator now shows the SECOND run's status
      // The indicator should reappear with run2's details
      const indicator = page.locator(
        `.command-status-bar .button-status-indicator[title*="Multi Run"]`
      );

      // Wait for status indicator to reappear (WebSocket update + session refetch)
      await expect(indicator).toBeVisible({ timeout: 5000 });

      // Re-open modal to check which run is shown
      await openButtonStatusModal(page, 'Multi Run');
      await expect(page.getByText(run2.runId)).toBeVisible();

      // Step 6: Verify database: third run deleted, first two runs still exist
      const deletedRun3 = await getCommandRun(session.id, run3.runId);
      expect(deletedRun3).toBeNull();

      const existingRun1 = await getCommandRun(session.id, run1.runId);
      expect(existingRun1).not.toBeNull();

      const existingRun2 = await getCommandRun(session.id, run2.runId);
      expect(existingRun2).not.toBeNull();

      // Verify session's latestCommandRuns now shows run2
      sessionData = await getSession(session.id);
      expect(sessionData.latestCommandRuns).toHaveLength(1);
      expect(sessionData.latestCommandRuns[0].runId).toBe(run2.runId);
    });
  });

  test.describe('Edge Case: Race Condition - WebSocket Update During Removal', () => {
    test('handles WebSocket update when run is deleted elsewhere', async ({ context }) => {
      // Step 1: Create and run a command
      const button = await seedCommandButton(project.id, {
        label: 'Race Condition',
        command: 'echo "Race test"',
        showOnList: true,
      });
      const run = await runCommandButtonAndWait(session.id, button.id, 15000);

      // Step 2: Open session in two browser tabs
      const pageA = await context.newPage();
      const pageB = await context.newPage();

      await navigateAndWait(pageA, `/sessions/${session.id}`);
      await navigateAndWait(pageB, `/sessions/${session.id}`);

      await waitForCommandCompletion(pageA, 'Race Condition', 15000);
      await waitForCommandCompletion(pageB, 'Race Condition', 15000);

      // Step 3: In Tab A, start removal process (click "Remove Run", see confirmation)
      await openButtonStatusModal(pageA, 'Race Condition');
      await pageA.locator('[data-testid="remove-run-button"]').click();

      // Step 4: In Tab B, quickly remove the same run via modal
      await removeCommandRunViaUI(pageB, 'Race Condition');

      // Step 5: In Tab A, click "Confirm"
      // This should handle the error gracefully (API returns 404)
      const confirmButton = pageA.locator('[data-testid="confirm-remove-button"]');

      // Click confirm - it may fail silently or show an error
      try {
        await confirmButton.click();
        // Wait a moment for any error handling
        await pageA.waitForTimeout(1000);
      } catch (e) {
        // Error is expected in this race condition scenario
      }

      // Step 6: Verify Tab A handles the error gracefully (API returns 404)
      // The modal should close regardless
      await pageA.locator('[data-testid="button-status-modal"]').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {
        // If modal doesn't close, close it manually
        return pageA.locator('.btn-primary:has-text("Close")').click().catch(() => {});
      });

      // Step 7: Verify both tabs end up in consistent state (run removed)
      await expect(
        pageA.locator(`.command-status-bar .button-status-indicator[title*="Race Condition"]`)
      ).not.toBeVisible({ timeout: 5000 });

      await expect(
        pageB.locator(`.command-status-bar .button-status-indicator[title*="Race Condition"]`)
      ).not.toBeVisible({ timeout: 5000 });

      // Verify run is deleted from database
      await verifyRunDeleted(session.id, run.runId);

      await pageA.close();
      await pageB.close();
    });
  });

  test.describe('Database Verification', () => {
    test('verify database integrity after removal', async ({ page }) => {
      // This test focuses on database state verification
      const button = await seedCommandButton(project.id, {
        label: 'DB Test',
        command: 'echo "Database integrity"',
        showOnList: true,
      });
      const run = await runCommandButtonAndWait(session.id, button.id, 15000);

      // Navigate and remove
      await navigateAndWait(page, `/sessions/${session.id}`);
      await waitForCommandCompletion(page, 'DB Test', 15000);
      await removeCommandRunViaUI(page, 'DB Test');

      // Verify all database states
      await verifyRunDeleted(session.id, run.runId);

      // Additional check: all other runs should still exist
      const allRuns = await getCommandRuns(session.id);
      const deletedRun = allRuns.find(r => r.runId === run.runId);
      expect(deletedRun).toBeUndefined();
    });
  });
});
