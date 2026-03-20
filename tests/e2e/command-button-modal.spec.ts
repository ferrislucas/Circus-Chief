import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedCommandButton,
  cleanupAll,
  navigateAndWait,
  waitForSessionToExist,
  runCommandButton,
  waitForCommandRunComplete,
} from './helpers';

test.describe('Command Button Status Modal', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Modal Test', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'Test prompt', name: 'Modal Test Session' });
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('displays started and completed times for successful command', async ({ page }) => {
    // Create a command button that succeeds
    const button = await seedCommandButton(project.id, {
      label: 'Echo Test',
      command: 'echo "Hello World"',
      showOnList: true,
    });

    // Run the command and wait for completion
    const { runId } = await runCommandButton(session.id, button.id);
    await waitForCommandRunComplete(session.id, runId);

    // Navigate to session detail (where CommandButtonStatusBar is shown)
    await navigateAndWait(page, `/sessions/${session.id}`);

    // Click the status indicator in the CommandButtonStatusBar to open modal
    await page.locator('[data-testid="button-status-indicator"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.click('[data-testid="button-status-indicator"]');

    // Wait for modal to appear
    await expect(page.locator('[data-testid="button-status-modal"]')).toBeVisible({ timeout: 5000 });

    // Verify both Started and Completed times are shown
    const modalText = await page.textContent('[data-testid="button-status-modal"]');
    expect(modalText).toContain('Started');
    expect(modalText).toContain('Completed');
    expect(modalText).toContain('Success');
  });

  test('displays started and failed times for error command', async ({ page }) => {
    // Create a command button that fails
    const button = await seedCommandButton(project.id, {
      label: 'Fail Test',
      command: 'exit 1',
      showOnList: true,
    });

    // Run the command and wait for completion
    const { runId } = await runCommandButton(session.id, button.id);
    await waitForCommandRunComplete(session.id, runId);

    // Navigate to session detail
    await navigateAndWait(page, `/sessions/${session.id}`);

    // Click the status indicator to open modal
    await page.locator('[data-testid="button-status-indicator"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.click('[data-testid="button-status-indicator"]');

    // Wait for modal to appear
    await expect(page.locator('[data-testid="button-status-modal"]')).toBeVisible({ timeout: 5000 });

    // Verify both Started and Failed times are shown
    const modalText = await page.textContent('[data-testid="button-status-modal"]');
    expect(modalText).toContain('Started');
    expect(modalText).toContain('Failed');
    expect(modalText).toContain('Error');
  });

  test('shows collapsible output section for commands with output', async ({ page }) => {
    // Create a command button with output
    const button = await seedCommandButton(project.id, {
      label: 'Output Test',
      command: 'echo "Line 1" && echo "Line 2" && echo "Line 3"',
      showOnList: true,
    });

    // Run the command and wait for completion
    const { runId } = await runCommandButton(session.id, button.id);
    await waitForCommandRunComplete(session.id, runId);

    // Navigate to session detail
    await navigateAndWait(page, `/sessions/${session.id}`);

    // Open status modal
    await page.locator('[data-testid="button-status-indicator"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.click('[data-testid="button-status-indicator"]');
    await expect(page.locator('[data-testid="button-status-modal"]')).toBeVisible({ timeout: 5000 });

    // Output header should be visible (collapsed by default)
    await expect(page.locator('[data-testid="output-header"]')).toBeVisible();

    // Output content should NOT be visible (collapsed)
    await expect(page.locator('[data-testid="output-content"]')).not.toBeVisible();

    // Click to expand
    await page.click('[data-testid="output-header"]');

    // Output content should now be visible
    await expect(page.locator('[data-testid="output-content"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="output-text"]')).toBeVisible();

    // Verify output contains expected text
    const outputText = await page.textContent('[data-testid="output-text"]');
    expect(outputText).toBeTruthy();
  });

  test('collapses output section when clicked again', async ({ page }) => {
    // Create a command button with output
    const button = await seedCommandButton(project.id, {
      label: 'Toggle Test',
      command: 'echo "toggle output"',
      showOnList: true,
    });

    // Run the command and wait for completion
    const { runId } = await runCommandButton(session.id, button.id);
    await waitForCommandRunComplete(session.id, runId);

    // Navigate to session detail
    await navigateAndWait(page, `/sessions/${session.id}`);

    // Open status modal
    await page.locator('[data-testid="button-status-indicator"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.click('[data-testid="button-status-indicator"]');
    await expect(page.locator('[data-testid="button-status-modal"]')).toBeVisible({ timeout: 5000 });

    // Expand output
    await page.click('[data-testid="output-header"]');
    await expect(page.locator('[data-testid="output-content"]')).toBeVisible({ timeout: 5000 });

    // Collapse output
    await page.click('[data-testid="output-header"]');
    await expect(page.locator('[data-testid="output-content"]')).not.toBeVisible();
  });

  test('closes modal when close button is clicked', async ({ page }) => {
    // Create a command button
    const button = await seedCommandButton(project.id, {
      label: 'Close Test',
      command: 'echo "test"',
      showOnList: true,
    });

    // Run the command and wait for completion
    const { runId } = await runCommandButton(session.id, button.id);
    await waitForCommandRunComplete(session.id, runId);

    // Navigate to session detail
    await navigateAndWait(page, `/sessions/${session.id}`);

    // Open status modal
    await page.locator('[data-testid="button-status-indicator"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.click('[data-testid="button-status-indicator"]');
    await expect(page.locator('[data-testid="button-status-modal"]')).toBeVisible({ timeout: 5000 });

    // Click close button in footer (use btn-primary to avoid hitting "Remove Run" button)
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('[data-testid="button-status-modal"]')).not.toBeVisible();
  });

  test('closes modal when clicking overlay', async ({ page }) => {
    // Create a command button
    const button = await seedCommandButton(project.id, {
      label: 'Overlay Close Test',
      command: 'echo "test"',
      showOnList: true,
    });

    // Run the command and wait for completion
    const { runId } = await runCommandButton(session.id, button.id);
    await waitForCommandRunComplete(session.id, runId);

    // Navigate to session detail
    await navigateAndWait(page, `/sessions/${session.id}`);

    // Open status modal
    await page.locator('[data-testid="button-status-indicator"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.click('[data-testid="button-status-indicator"]');
    await expect(page.locator('[data-testid="button-status-modal"]')).toBeVisible({ timeout: 5000 });

    // Click the overlay (outside the dialog) - use coordinates far from center
    await page.locator('.modal-overlay').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('[data-testid="button-status-modal"]')).not.toBeVisible();
  });
});
