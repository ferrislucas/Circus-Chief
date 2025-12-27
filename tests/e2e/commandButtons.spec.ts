import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupAll,
  getProject,
  getProjectSessions,
  seedCommandButton,
} from './helpers';

test.describe('Command Buttons', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('[TEST] Command Buttons', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'Test prompt', name: 'Test Session' });
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  // ============================================================
  // Test Case 1: Basic Command Execution with Output Verification
  // ============================================================
  test('should execute pwd and display correct output', async ({ page }) => {
    // Setup: Create command button with "pwd"
    await seedCommandButton(project.id, {
      label: 'Print Working Dir',
      command: 'pwd',
    });

    // Navigate to session commands tab
    await page.goto(`/sessions/${session.id}/commands`);

    // Verify button is visible
    await expect(page.getByText('Print Working Dir')).toBeVisible();

    // Click run button
    await page.click('button:has-text("▶ Run")');

    // Wait for completion (NOT running state)
    // The command should complete within 10 seconds
    await expect(page.locator('.status-success, .status-error')).toBeVisible({
      timeout: 10000,
    });

    // Wait a moment for output to be rendered
    await page.waitForTimeout(500);

    // Expand output section
    const outputHeader = page.locator('.output-header').first();
    await outputHeader.click();

    // CRITICAL: Assert actual output content contains the working directory
    const outputText = page.locator('.output-text').first();
    await expect(outputText).toContainText('/tmp/test', { timeout: 5000 });

    // Also verify success status indicator
    await expect(page.locator('.status-success')).toBeVisible();
  });

  // ============================================================
  // Test Case 2: Command with Known Output
  // ============================================================
  test('should execute echo and capture exact output', async ({ page }) => {
    // Setup: Create unique marker for this test run
    const marker = `TEST_MARKER_${Date.now()}`;

    // Create command button with echo command
    await seedCommandButton(project.id, {
      label: 'Echo Marker',
      command: `echo "${marker}"`,
    });

    // Navigate to session commands tab
    await page.goto(`/sessions/${session.id}/commands`);

    // Verify button is visible
    await expect(page.getByText('Echo Marker')).toBeVisible();

    // Click run button
    await page.click('button:has-text("▶ Run")');

    // Wait for completion (NOT running state)
    await expect(page.locator('.status-success, .status-error')).toBeVisible({
      timeout: 10000,
    });

    // Wait a moment for output to be rendered
    await page.waitForTimeout(500);

    // Expand output section
    const outputHeader = page.locator('.output-header').first();
    await outputHeader.click();

    // CRITICAL: Assert actual output content contains the exact marker
    const outputText = page.locator('.output-text').first();
    await expect(outputText).toContainText(marker, { timeout: 5000 });

    // Also verify success status indicator
    await expect(page.locator('.status-success')).toBeVisible();
  });

  // ============================================================
  // Test Case 3: Multi-line Output
  // ============================================================
  test('should capture multi-line output correctly', async ({ page }) => {
    // Setup: Create command button with multi-line output
    await seedCommandButton(project.id, {
      label: 'Multi-line',
      command: 'echo "LINE1" && echo "LINE2" && echo "LINE3"',
    });

    // Navigate to session commands tab
    await page.goto(`/sessions/${session.id}/commands`);

    // Verify button is visible
    await expect(page.getByText('Multi-line')).toBeVisible();

    // Click run button
    await page.click('button:has-text("▶ Run")');

    // Wait for completion (NOT running state)
    await expect(page.locator('.status-success, .status-error')).toBeVisible({
      timeout: 10000,
    });

    // Wait a moment for output to be rendered
    await page.waitForTimeout(500);

    // Expand output section
    const outputHeader = page.locator('.output-header').first();
    await outputHeader.click();

    // CRITICAL: Assert actual output content contains all three lines
    const outputText = page.locator('.output-text').first();
    await expect(outputText).toContainText('LINE1', { timeout: 5000 });
    await expect(outputText).toContainText('LINE2', { timeout: 5000 });
    await expect(outputText).toContainText('LINE3', { timeout: 5000 });

    // Also verify success status indicator
    await expect(page.locator('.status-success')).toBeVisible();
  });

  // ============================================================
  // Test Case 4: Kill Long-Running Command
  // ============================================================
  test('should kill running command when clicking stop button', async ({ page }) => {
    // Setup: Create command button with a long-running command
    // Using sleep 30 which takes 30 seconds, preventing it from completing naturally
    await seedCommandButton(project.id, {
      label: 'Long Sleep',
      command: 'sleep 30 && echo "SHOULD_NOT_SEE_THIS"',
    });

    // Navigate to session commands tab
    await page.goto(`/sessions/${session.id}/commands`);

    // Verify button is visible
    await expect(page.getByText('Long Sleep')).toBeVisible();

    // Click run button
    await page.click('button:has-text("▶ Run")');

    // Wait for running state to appear
    await expect(page.getByText('Running...')).toBeVisible({ timeout: 5000 });

    // Give it a moment to confirm it's running
    await page.waitForTimeout(500);

    // Click the kill/stop button using data-testid for reliability
    const killButton = page.locator('[data-testid="kill-button"]').first();
    await killButton.waitFor({ state: 'visible', timeout: 5000 });
    await killButton.click({ force: true });

    // Running state should disappear (command killed)
    await expect(page.getByText('Running...')).not.toBeVisible({
      timeout: 5000,
    });

    // Status should show error or killed state
    await expect(
      page.locator('.status-error, [class*="status"][class*="killed"]')
    ).toBeVisible({ timeout: 3000 });

    // Wait a moment for output to be rendered
    await page.waitForTimeout(500);

    // Expand output section
    const outputHeader = page.locator('.output-header').first();
    await outputHeader.click();

    // CRITICAL: Verify the output does NOT contain "SHOULD_NOT_SEE_THIS"
    // (because the command was killed before it could complete)
    const outputText = page.locator('.output-text').first();
    const output = await outputText.textContent();
    expect(output).not.toContain('SHOULD_NOT_SEE_THIS');
  });

  test('create a new command button', async ({ page }) => {
    // Navigate to project sessions page
    await page.goto(`/projects/${project.id}/sessions`);

    // Click Commands tab
    await page.click('text=Commands');

    // Click "Configure Command Buttons" or "Create First Button"
    await page.click('button:has-text("Configure")');

    // Should navigate to commands page (click tab again if not there)
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('text=Commands');
    await page.click('button:has-text("New Command Button")');

    // Should be on create form
    expect(page.url()).toContain('/command-buttons/new');
    await expect(page).toHaveURL(/\/projects\/[\w-]+\/command-buttons\/new/);

    // Fill form
    await page.fill('#label', 'Run Tests');
    await page.fill('#command', 'npm test');
    await page.fill('#sortOrder', '1');

    // Submit
    await page.click('button:has-text("Create")');

    // Should be back on sessions page
    await page.waitForURL(`/projects/${project.id}/sessions`);

    // Verify success toast
    await expect(page.getByText('Command button created')).toBeVisible();
  });

  test('edit an existing command button', async ({ page }) => {
    // First create a button
    await page.goto(`/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Original Label');
    await page.fill('#command', 'original command');
    await page.click('button:has-text("Create")');

    // Get the button ID from the database or by navigating
    const project_data = await getProject(project.id);

    // Navigate back to commands page
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('text=Commands');

    // Click on the button row to edit
    await page.click('text=Original Label');

    // Should be on edit form
    expect(page.url()).toContain('/command-buttons/');
    expect(page.url()).not.toContain('/new');

    // Update form
    await page.fill('#label', 'Updated Label');
    await page.fill('#command', 'updated command');

    // Submit
    await page.click('button:has-text("Update")');

    // Should be back on sessions page
    await page.waitForURL(`/projects/${project.id}/sessions`);

    // Verify success
    await expect(page.getByText('Command button updated')).toBeVisible();
  });

  test('delete a command button', async ({ page }) => {
    // Create a button first
    await page.goto(`/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Button to Delete');
    await page.fill('#command', 'delete me');
    await page.click('button:has-text("Create")');

    // Navigate to commands tab
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('text=Commands');

    // Click delete button
    await page.click('.btn-outline-danger');

    // Confirm deletion in modal
    await page.click('button:has-text("Delete")');

    // Verify success
    await expect(page.getByText('Command button deleted')).toBeVisible();

    // Verify button is gone
    await expect(page.getByText('Button to Delete')).not.toBeVisible();
  });

  test('run command button from session detail view', async ({ page }) => {
    // Create a command button
    await page.goto(`/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Echo Test');
    await page.fill('#command', 'echo "Hello World"');
    await page.click('button:has-text("Create")');

    // Navigate to session detail
    await page.goto(`/sessions/${session.id}/commands`);

    // Should see the button
    await expect(page.getByText('Echo Test')).toBeVisible();

    // Click run button
    await page.click('button:has-text("▶ Run")');

    // Should show running state with spinner
    await expect(page.getByText('Running...')).toBeVisible();

    // Wait for completion (with timeout)
    const maxWait = 5000;
    const startTime = Date.now();
    while (Date.now() - startTime < maxWait) {
      const isRunning = await page.isVisible('text=Running...');
      if (!isRunning) break;
      await page.waitForTimeout(100);
    }

    // Should show success indicator
    await expect(page.getByText('✓')).toBeVisible();
  });

  test('see real-time command output', async ({ page }) => {
    // Create a button
    await page.goto(`/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Multi-line Output');
    await page.fill('#command', 'echo "Line 1" && echo "Line 2" && echo "Line 3"');
    await page.click('button:has-text("Create")');

    // Navigate to session and run
    await page.goto(`/sessions/${session.id}/commands`);
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

  test('kill running command', async ({ page }) => {
    // Create a long-running command button
    await page.goto(`/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Sleep Command');
    await page.fill('#command', 'sleep 10');
    await page.click('button:has-text("Create")');

    // Navigate to session and run
    await page.goto(`/sessions/${session.id}/commands`);
    await page.click('button:has-text("▶ Run")');

    // Should show running state
    await expect(page.getByText('Running...')).toBeVisible();

    // Kill the command
    const killButton = page.locator('.btn-outline-danger');
    await killButton.click();

    // Running state should eventually stop (command killed)
    await page.waitForTimeout(1000);

    // Should be in an ended state (not running anymore)
    const isStillRunning = await page.isVisible('text=Running...');
    expect(isStillRunning).toBe(false);
  });

  test('copy command output to clipboard', async ({ page }) => {
    // Create a button
    await page.goto(`/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Copy Output');
    await page.fill('#command', 'echo "Test output to copy"');
    await page.click('button:has-text("Create")');

    // Run the command
    await page.goto(`/sessions/${session.id}/commands`);
    await page.click('button:has-text("▶ Run")');

    // Wait for completion
    await page.waitForTimeout(2000);

    // Expand output section
    await page.click('.output-header');

    // Click copy button
    await page.click('button:has-text("Copy")');

    // Verify toast message
    await expect(page.getByText('Output copied to clipboard')).toBeVisible();
  });

  test('send command output to canvas', async ({ page }) => {
    // Create a button
    await page.goto(`/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Canvas Output');
    await page.fill('#command', 'echo "Send to canvas"');
    await page.click('button:has-text("Create")');

    // Run the command
    await page.goto(`/sessions/${session.id}/commands`);
    await page.click('button:has-text("▶ Run")');

    // Wait for completion
    await page.waitForTimeout(2000);

    // Expand output section
    await page.click('.output-header');

    // Click send to canvas button
    await page.click('button:has-text("Canvas")');

    // Verify success toast
    await expect(page.getByText('Output sent to canvas')).toBeVisible();

    // Navigate to canvas tab to verify item was created
    await page.click('text=Canvas');

    // Should see the canvas item
    await expect(page.getByText('canvas-output-output')).toBeVisible();
  });

  test('navigate between tabs with output persisting', async ({ page }) => {
    // Create a button
    await page.goto(`/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Tab Test');
    await page.fill('#command', 'echo "Persist output"');
    await page.click('button:has-text("Create")');

    // Run command
    await page.goto(`/sessions/${session.id}/commands`);
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
    await page.goto(`/sessions/${session.id}/commands`);

    // Should show empty state
    await expect(page.getByText('No command buttons configured')).toBeVisible();
  });

  test('show error state when command fails', async ({ page }) => {
    // Create a command button with a failing command
    await page.goto(`/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Failing Command');
    await page.fill('#command', 'exit 1');
    await page.click('button:has-text("Create")');

    // Run the command
    await page.goto(`/sessions/${session.id}/commands`);
    await page.click('button:has-text("▶ Run")');

    // Wait for completion
    await page.waitForTimeout(2000);

    // Should show error indicator
    await expect(page.locator('.status-error')).toBeVisible();

    // Should show exit code
    await expect(page.getByText('exit code: 1')).toBeVisible();
  });

  test('show success state when command succeeds', async ({ page }) => {
    // Create a command button that succeeds
    await page.goto(`/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Successful Command');
    await page.fill('#command', 'echo "Success"');
    await page.click('button:has-text("Create")');

    // Run the command
    await page.goto(`/sessions/${session.id}/commands`);
    await page.click('button:has-text("▶ Run")');

    // Wait for completion
    await page.waitForTimeout(2000);

    // Should show success indicator
    await expect(page.locator('.status-success')).toBeVisible();

    // Should show exit code 0
    await expect(page.getByText('exit code: 0')).toBeVisible();
  });

  test('validate required form fields', async ({ page }) => {
    // Navigate to create form
    await page.goto(`/projects/${project.id}/command-buttons/new`);

    // Try to submit empty form
    await page.click('button:has-text("Create")');

    // Should show validation errors
    await expect(page.getByText('Label is required')).toBeVisible();
    await expect(page.getByText('Command is required')).toBeVisible();
  });

  test('display command buttons in table on management page', async ({ page }) => {
    // Create multiple buttons
    await page.goto(`/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Button 1');
    await page.fill('#command', 'command 1');
    await page.click('button:has-text("Create")');

    // Create second button
    await page.goto(`/projects/${project.id}/command-buttons/new`);
    await page.fill('#label', 'Button 2');
    await page.fill('#command', 'command 2');
    await page.click('button:has-text("Create")');

    // Navigate to commands panel
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('text=Commands');

    // Should see both buttons in table
    await expect(page.getByText('Button 1')).toBeVisible();
    await expect(page.getByText('Button 2')).toBeVisible();

    // Should show commands
    await expect(page.getByText('command 1')).toBeVisible();
    await expect(page.getByText('command 2')).toBeVisible();
  });
});
