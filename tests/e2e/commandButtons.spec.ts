import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupAll,
  navigateAndWait,
  waitForSessionToExist,
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
    // Create a button via UI
    await navigateAndWait(page, `/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Multi-line Output');
    await page.fill('#command', 'echo "Line 1" && echo "Line 2" && echo "Line 3"');
    await page.click('button:has-text("Create")');

    // Navigate to session and run
    await navigateAndWait(page, `/sessions/${session.id}/commands`);
    await page.click('button:has-text("▶ Run")');

    // Wait for command to finish (status indicator transitions away from running)
    await expect(page.locator('[data-testid="command-status"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.status-running')).toBeHidden({ timeout: 15000 });

    // Expand output section
    await page.click('.output-header');

    // Verify output is displayed
    const outputText = await page.textContent('.output-text');
    expect(outputText).toBeTruthy();
  });

  test('navigate between tabs with output persisting', async ({ page }) => {
    // Create a button via UI
    await navigateAndWait(page, `/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Tab Test');
    await page.fill('#command', 'echo "Persist output"');
    await page.click('button:has-text("Create")');

    // Run command
    await navigateAndWait(page, `/sessions/${session.id}/commands`);
    await page.click('button:has-text("▶ Run")');

    // Wait for command to finish
    await expect(page.locator('.status-running')).toBeHidden({ timeout: 15000 });

    // Expand output
    await page.click('.output-header');
    const initialOutput = await page.textContent('.output-text');
    expect(initialOutput).toBeTruthy();

    // Switch to conversation tab and back
    await page.click('text=Conversation');
    await expect(page.locator('.commands-tab')).toBeHidden();
    await page.click('text=Commands');
    await expect(page.locator('.output-text')).toBeVisible({ timeout: 5000 });

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
    // Create a command button with a failing command via UI
    await navigateAndWait(page, `/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Failing Command');
    await page.fill('#command', 'exit 1');
    await page.click('button:has-text("Create")');

    // Navigate to commands tab and run
    await navigateAndWait(page, `/sessions/${session.id}/commands`);
    await page.click('button:has-text("▶ Run")');

    // Wait for command to complete — the status indicator transitions from running to error.
    // Use .status-error (non-zero exit) which appears once the WebSocket delivers the result.
    await expect(page.locator('.status-error')).toBeVisible({ timeout: 15000 });

    // Should show a non-zero exit code in the output section
    await expect(page.locator('.exit-code')).toBeVisible({ timeout: 5000 });
  });

  test('show success state when command succeeds', async ({ page }) => {
    // Create a command button that succeeds via UI
    await navigateAndWait(page, `/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Successful Command');
    await page.fill('#command', 'echo "Success"');
    await page.click('button:has-text("Create")');

    // Navigate to commands tab and run
    await navigateAndWait(page, `/sessions/${session.id}/commands`);
    await page.click('button:has-text("▶ Run")');

    // Wait for command to complete — the status indicator transitions from running to success.
    await expect(page.locator('.status-success')).toBeVisible({ timeout: 15000 });

    // Should show exit code 0 in the output section
    await expect(page.getByText('exit code: 0')).toBeVisible({ timeout: 5000 });
  });

  test('display command buttons in table on management page', async ({ page }) => {
    // Create multiple buttons via UI
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
