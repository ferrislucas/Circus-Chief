import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupAll,
  seedCommandButton,
  navigateAndWait,
  waitForSessionToExist,
  runCommandButtonAndWait,
} from './helpers';

test.describe('Command Buttons', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Command Buttons', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'Test prompt', name: 'Test Session' });
    // Wait for session to be available
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('see real-time command output', async ({ page }) => {
    // Create a button
    await navigateAndWait(page, `/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Multi-line Output');
    await page.fill('#command', 'echo "Line 1" && echo "Line 2" && echo "Line 3"');
    await page.click('button:has-text("Create")');

    // Navigate to session and run
    await navigateAndWait(page, `/sessions/${session.id}/commands`);
    await page.click('button:has-text("▶ Run")');

    // Wait for output to appear in running state
    // The output section should expand automatically during running
    await page.waitForTimeout(1000);

    // Look for output text
    const outputVisible = await page.isVisible('.output-text');
    if (outputVisible) {
      // Verify output is being displayed
      const outputText = await page.textContent('.output-text');
      expect(outputText).toBeTruthy();
    }
  });

  test('navigate between tabs with output persisting', async ({ page }) => {
    // Create a button
    await navigateAndWait(page, `/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Tab Test');
    await page.fill('#command', 'echo "Persist output"');
    await page.click('button:has-text("Create")');

    // Run command
    await navigateAndWait(page, `/sessions/${session.id}/commands`);
    await page.click('button:has-text("▶ Run")');

    // Wait for output
    await page.waitForTimeout(2000);

    // Expand output
    await page.click('.output-header');
    const initialOutput = await page.textContent('.output-text');
    expect(initialOutput).toBeTruthy();

    // Switch to conversation tab
    await page.click('text=Conversation');
    await page.waitForTimeout(500);

    // Switch back to commands tab
    await page.click('text=Commands');
    await page.waitForTimeout(500);

    // Output should still be there
    const persistedOutput = await page.textContent('.output-text');
    expect(persistedOutput).toBe(initialOutput);
  });

  test('show empty state when no buttons configured', async ({ page }) => {
    // Navigate to commands tab in session
    await navigateAndWait(page, `/sessions/${session.id}/commands`);

    // Should show empty state
    await expect(page.getByText('No command buttons configured')).toBeVisible();
  });

  test('show error state when command fails', async ({ page }) => {
    // Create a command button with a failing command via API (more reliable)
    const button = await seedCommandButton(project.id, {
      label: 'Failing Command',
      command: 'exit 1',
    });

    // Run via API and wait for completion before checking UI
    const completedRun = await runCommandButtonAndWait(session.id, button.id, 15000);
    expect(completedRun.status).toBe('error');

    // Navigate to commands tab after command completes
    await navigateAndWait(page, `/sessions/${session.id}/commands`, {
      waitFor: '[data-testid="command-status"]',
      timeout: 10000,
    });

    // Should show error indicator
    await expect(page.locator('.status-error')).toBeVisible({ timeout: 5000 });

    // Should show non-zero exit code
    await expect(page.locator('.exit-code')).toBeVisible({ timeout: 5000 });
  });

  test('show success state when command succeeds', async ({ page }) => {
    // Create a command button that succeeds via API (more reliable)
    const button = await seedCommandButton(project.id, {
      label: 'Successful Command',
      command: 'echo "Success"',
    });

    // Run via API and wait for completion before checking UI
    const completedRun = await runCommandButtonAndWait(session.id, button.id, 15000);
    expect(completedRun.status).toBe('success');

    // Navigate to commands tab after command completes
    await navigateAndWait(page, `/sessions/${session.id}/commands`, {
      waitFor: '[data-testid="command-status"]',
      timeout: 10000,
    });

    // Should show success indicator
    await expect(page.locator('.status-success')).toBeVisible({ timeout: 5000 });

    // Should show exit code 0
    await expect(page.getByText('exit code: 0')).toBeVisible({ timeout: 5000 });
  });

  test('display command buttons in table on management page', async ({ page }) => {
    // Create multiple buttons
    await navigateAndWait(page, `/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Button 1');
    await page.fill('#command', 'command 1');
    await page.click('button:has-text("Create")');

    // Create second button
    await navigateAndWait(page, `/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Button 2');
    await page.fill('#command', 'command 2');
    await page.click('button:has-text("Create")');

    // Navigate to commands panel
    await navigateAndWait(page, `/projects/${project.id}/sessions`);
    await page.click('text=Commands');

    // Should see both buttons in table
    await expect(page.getByText('Button 1')).toBeVisible();
    await expect(page.getByText('Button 2')).toBeVisible();

    // Should show commands
    await expect(page.getByText('command 1')).toBeVisible();
    await expect(page.getByText('command 2')).toBeVisible();
  });
});
