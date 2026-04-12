import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  seedCommandButton,
  navigateAndWait,
  waitForSessionToExist,
  runCommandButton,
  runCommandButtonAndWait,
  waitForCommandRunComplete,
  getCommandRun,
  getCanvasItems,
  getCanvasFileContent,
  killCommandRun,
} from './helpers';

/**
 * Extended Command Buttons E2E Tests
 *
 * Covers:
 * - Category 1: Kill Running Commands (API + UI)
 * - Category 2: "Send to Canvas" Button
 * - Category 3: Status Bar on Session Detail
 * - Category 4: Command Status Indicators — Extended Scenarios
 *
 * IMPORTANT implementation notes:
 *
 * 1. UI tests that need to see run status changes (kill button, output, etc.)
 *    MUST either:
 *    a) Click the ▶ Run button in the UI (which calls commandButtonsStore.runButton()
 *       and properly registers the run in the Pinia store), OR
 *    b) Start the command via API BEFORE navigating (so fetchActiveRuns() picks it up)
 *
 *    Running via API AFTER page mount won't work because the store's appendOutput()
 *    silently ignores WebSocket messages for runs it doesn't know about.
 *
 * 2. The CommandButtonStatusBar on session detail filters by showOnList,
 *    so all command buttons used in status bar tests need showOnList: true.
 */

// ============================================================
// Category 1: Kill Running Commands
// ============================================================
test.describe('Kill Running Commands', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Kill Commands Test', '/tmp');
    session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Kill Test Session',
      startImmediately: false,
    });
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('kills a running command via API', async () => {
    // Pure API test — no UI needed
    const button = await seedCommandButton(project.id, {
      label: 'Long Sleep',
      command: 'sleep 30',
    });

    // Start the command
    const { runId } = await runCommandButton(session.id, button.id);

    // Verify it's running
    const runBefore = await getCommandRun(session.id, runId);
    expect(runBefore.status).toBe('running');

    // Kill it
    const killResponse = await killCommandRun(session.id, runId);
    expect(killResponse.ok).toBe(true);

    // Wait for completion and verify killed/error status
    const completedRun = await waitForCommandRunComplete(session.id, runId, 15000);
    expect(['killed', 'error']).toContain(completedRun.status);
    expect(completedRun.exitCode).not.toBe(0);
  });

  test('kill button appears while command is running', async ({ page }) => {
    await seedCommandButton(project.id, {
      label: 'Sleep Button',
      command: 'sleep 30',
    });

    // Navigate to Commands tab; waitFor ensures async command-button fetch completes
    await navigateAndWait(page, `/sessions/${session.id}/commands`, {
      waitFor: '[data-testid="run-button"]',
      timeout: 15000,
    });

    // Click Run button in UI (this registers the run in the Pinia store)
    await page.locator('[data-testid="run-button"]').click();

    // Kill button should appear (within timeout, waiting for WebSocket)
    await expect(page.locator('[data-testid="kill-button"]')).toBeVisible({ timeout: 10000 });

    // Run button should NOT be visible while running
    await expect(page.locator('[data-testid="run-button"]')).not.toBeVisible();
  });

  test('clicking kill button stops the command', async ({ page }) => {
    await seedCommandButton(project.id, {
      label: 'Kill Click Test',
      command: 'sleep 30',
    });

    // Navigate to Commands tab; waitFor ensures async command-button fetch completes
    await navigateAndWait(page, `/sessions/${session.id}/commands`, {
      waitFor: '[data-testid="run-button"]',
      timeout: 15000,
    });

    // Click Run button in UI
    await page.locator('[data-testid="run-button"]').click();

    // Wait for kill button to appear
    await expect(page.locator('[data-testid="kill-button"]')).toBeVisible({ timeout: 10000 });

    // Click kill button
    await page.locator('[data-testid="kill-button"]').click();

    // Run button should reappear after kill completes
    await expect(page.locator('[data-testid="run-button"]')).toBeVisible({ timeout: 15000 });

    // Should show non-zero exit code in output section
    await expect(page.locator('.status-error, .status-killed')).toBeVisible({ timeout: 5000 });
  });

  test('run button reappears after kill completes', async ({ page }) => {
    await seedCommandButton(project.id, {
      label: 'Run Reappear Test',
      command: 'sleep 30',
    });

    // Navigate to Commands tab; waitFor ensures async command-button fetch completes
    await navigateAndWait(page, `/sessions/${session.id}/commands`, {
      waitFor: '[data-testid="run-button"]',
      timeout: 15000,
    });

    // Click Run in UI (properly registers in Pinia store)
    await page.locator('[data-testid="run-button"]').click();

    // Kill button should appear
    await expect(page.locator('[data-testid="kill-button"]')).toBeVisible({ timeout: 10000 });

    // Click Kill button
    await page.locator('[data-testid="kill-button"]').click();

    // Run button should reappear after kill completes
    await expect(page.locator('[data-testid="run-button"]')).toBeVisible({ timeout: 15000 });

    // Kill button should disappear
    await expect(page.locator('[data-testid="kill-button"]')).not.toBeVisible();
  });

  test('killing already-completed command returns 404', async () => {
    // Pure API test — no UI needed
    const button = await seedCommandButton(project.id, {
      label: 'Already Done',
      command: 'echo done',
    });

    // Run and wait for completion
    const completedRun = await runCommandButtonAndWait(session.id, button.id);
    expect(completedRun.status).toBe('success');

    // Try to kill the completed command — should return 404
    const killResponse = await killCommandRun(session.id, completedRun.runId);
    expect(killResponse.status).toBe(404);

    const body = await killResponse.json();
    expect(body.error).toBeTruthy();
  });
});

// ============================================================
// Category 2: "Send to Canvas" Button
// ============================================================
test.describe('Send to Canvas', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Canvas Test', '/tmp');
    session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Canvas Test Session',
      startImmediately: false,
    });
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('"Send to Canvas" creates canvas item with command output', async ({ page }) => {
    // Use sleep to avoid race condition where fast commands complete before
    // runButton() registers the run in the Pinia store (completion event is lost)
    await seedCommandButton(project.id, {
      label: 'Canvas Output',
      command: 'sleep 1 && echo "hello canvas"',
    });

    // Navigate to Commands tab; waitFor ensures async command-button fetch completes
    await navigateAndWait(page, `/sessions/${session.id}/commands`, {
      waitFor: '[data-testid="run-button"]',
      timeout: 15000,
    });

    // Click Run in UI, then wait for completion
    await page.locator('[data-testid="run-button"]').click();

    // Wait for the kebab menu to appear (indicates command completed with output)
    // ActionMenu only renders when: run?.output && run.status !== 'running'
    await expect(page.locator('button[aria-label="Command output actions"]')).toBeVisible({ timeout: 15000 });

    // Click the kebab menu (⋮)
    await page.locator('button[aria-label="Command output actions"]').click();

    // Click "Send to canvas"
    await expect(page.locator('[data-testid="send-to-canvas"]')).toBeVisible({ timeout: 3000 });
    await page.locator('[data-testid="send-to-canvas"]').click();

    // Wait for the API call to complete
    await page.waitForTimeout(1500);

    // Verify canvas item was created via API
    const canvasItems = await getCanvasItems(session.id);
    expect(canvasItems.length).toBeGreaterThanOrEqual(1);

    // Fetch content for each item and find the one with our output
    let foundCanvasItem = false;
    for (const item of canvasItems) {
      const itemContent = await getCanvasFileContent(session.id, item.filename);
      if (itemContent?.content?.includes('hello canvas')) {
        foundCanvasItem = true;
        break;
      }
    }
    expect(foundCanvasItem).toBeTruthy();
  });

  test('canvas item has correct filename from button label', async ({ page }) => {
    await seedCommandButton(project.id, {
      label: 'Build Report',
      command: 'sleep 1 && echo "report output"',
    });

    // Navigate to Commands tab; waitFor ensures async command-button fetch completes
    await navigateAndWait(page, `/sessions/${session.id}/commands`, {
      waitFor: '[data-testid="run-button"]',
      timeout: 15000,
    });

    // Click Run in UI
    await page.locator('[data-testid="run-button"]').click();

    // Wait for kebab menu (command completed with output)
    await expect(page.locator('button[aria-label="Command output actions"]')).toBeVisible({ timeout: 15000 });

    // Click kebab menu, then "Send to canvas"
    await page.locator('button[aria-label="Command output actions"]').click();
    await expect(page.locator('[data-testid="send-to-canvas"]')).toBeVisible({ timeout: 3000 });
    await page.locator('[data-testid="send-to-canvas"]').click();

    // Wait for API call
    await page.waitForTimeout(1500);

    // Verify canvas item filename contains button label (sanitized)
    const canvasItems = await getCanvasItems(session.id);
    const canvasItem = canvasItems.find((item: any) =>
      item.filename?.toLowerCase().includes('build-report')
    );
    expect(canvasItem).toBeTruthy();
  });

  test('"Send to Canvas" is available after command completes', async ({ page }) => {
    await seedCommandButton(project.id, {
      label: 'Menu Test',
      command: 'sleep 1 && echo ok',
    });

    // Navigate to Commands tab; waitFor ensures async command-button fetch completes
    await navigateAndWait(page, `/sessions/${session.id}/commands`, {
      waitFor: '[data-testid="run-button"]',
      timeout: 15000,
    });

    // Click Run in UI
    await page.locator('[data-testid="run-button"]').click();

    // Wait for kebab menu (command completed with output)
    await expect(page.locator('button[aria-label="Command output actions"]')).toBeVisible({ timeout: 15000 });

    // Click kebab menu
    await page.locator('button[aria-label="Command output actions"]').click();

    // "Send to canvas" menu item should be visible
    await expect(page.locator('[data-testid="send-to-canvas"]')).toBeVisible({ timeout: 3000 });
  });

  test('"Send to Canvas" is NOT available while command is running', async ({ page }) => {
    await seedCommandButton(project.id, {
      label: 'Running Menu Test',
      command: 'sleep 10',
    });

    // Navigate to Commands tab; waitFor ensures async command-button fetch completes
    await navigateAndWait(page, `/sessions/${session.id}/commands`, {
      waitFor: '[data-testid="run-button"]',
      timeout: 15000,
    });

    // Click Run in UI
    await page.locator('[data-testid="run-button"]').click();

    // Wait for kill button (confirms running state)
    await expect(page.locator('[data-testid="kill-button"]')).toBeVisible({ timeout: 10000 });

    // The kebab menu should NOT be visible while running
    // (ActionMenu condition: run?.output && run.status !== 'running')
    await expect(page.locator('button[aria-label="Command output actions"]')).not.toBeVisible();
  });
});

// ============================================================
// Category 3: Status Bar on Session Detail
// ============================================================
test.describe('Status Bar on Session Detail', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Status Bar Test', '/tmp');
    session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Status Bar Session',
      startImmediately: false,
    });
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('status bar shows running indicator during execution', async ({ page }) => {
    // showOnList is REQUIRED — buttonStatusesToDisplay filters by it
    const button = await seedCommandButton(project.id, {
      label: 'Status Running',
      command: 'sleep 30',
      showOnList: true,
    });

    // Start command via API BEFORE navigating
    const { runId } = await runCommandButton(session.id, button.id);

    // Small wait to ensure the command is registered
    await new Promise((r) => setTimeout(r, 500));

    // Navigate to session detail — session fetch includes latestCommandRuns
    await navigateAndWait(page, `/sessions/${session.id}`, {
      waitFor: '[data-testid="button-status-bar"]',
      timeout: 15000,
    });

    // Status bar should show running indicator
    const runningIndicator = page.locator('[data-testid="button-status-bar"] .button-status-running');
    await expect(runningIndicator).toBeVisible({ timeout: 10000 });
    await expect(runningIndicator.locator('svg')).toBeVisible();

    // Cleanup: kill the command
    await killCommandRun(session.id, runId);
    await waitForCommandRunComplete(session.id, runId, 15000);
  });

  test('status bar shows success indicator after completion', async ({ page }) => {
    const button = await seedCommandButton(project.id, {
      label: 'Status Success',
      command: 'echo ok',
      showOnList: true,
    });

    // Run and wait for completion BEFORE navigating
    await runCommandButtonAndWait(session.id, button.id);

    // Navigate to session detail — session fetch includes latestCommandRuns
    await navigateAndWait(page, `/sessions/${session.id}`, {
      waitFor: '[data-testid="button-status-bar"]',
      timeout: 15000,
    });

    // Status bar should show success indicator
    const successIndicator = page.locator('[data-testid="button-status-bar"] .button-status-success');
    await expect(successIndicator).toBeVisible({ timeout: 10000 });
    await expect(successIndicator.locator('svg')).toBeVisible();
  });

  test('status bar shows error indicator on failure', async ({ page }) => {
    const button = await seedCommandButton(project.id, {
      label: 'Status Error',
      command: 'exit 1',
      showOnList: true,
    });

    // Run and wait for completion BEFORE navigating
    await runCommandButtonAndWait(session.id, button.id);

    // Navigate to session detail
    await navigateAndWait(page, `/sessions/${session.id}`, {
      waitFor: '[data-testid="button-status-bar"]',
      timeout: 15000,
    });

    // Status bar should show error indicator
    const errorIndicator = page.locator('[data-testid="button-status-bar"] .button-status-error');
    await expect(errorIndicator).toBeVisible({ timeout: 10000 });
    await expect(errorIndicator.locator('svg')).toBeVisible();
  });

  test('status bar shows multiple button statuses simultaneously', async ({ page }) => {
    const successButton = await seedCommandButton(project.id, {
      label: 'Multi Success',
      command: 'echo ok',
      showOnList: true,
    });
    const errorButton = await seedCommandButton(project.id, {
      label: 'Multi Error',
      command: 'exit 1',
      showOnList: true,
    });

    // Run both and wait BEFORE navigating
    await runCommandButtonAndWait(session.id, successButton.id);
    await runCommandButtonAndWait(session.id, errorButton.id);

    // Navigate to session detail
    await navigateAndWait(page, `/sessions/${session.id}`, {
      waitFor: '[data-testid="button-status-bar"]',
      timeout: 15000,
    });

    // Status bar should show both indicators
    const statusBar = page.locator('[data-testid="button-status-bar"]');

    const successIndicator = statusBar.locator('.button-status-success');
    const errorIndicator = statusBar.locator('.button-status-error');

    await expect(successIndicator).toBeVisible({ timeout: 5000 });
    await expect(errorIndicator).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================
// Category 4: Command Status Indicators — Extended Scenarios
// ============================================================
test.describe('Command Status Indicators — Extended', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Indicators Extended', '/tmp');
    session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Indicator Session',
      startImmediately: false,
    });
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('session card shows killed indicator after command kill', async ({ page }) => {
    // Clear any persisted filter state
    await page.addInitScript(() => {
      localStorage.removeItem('sessionStatusFilter');
      sessionStorage.removeItem('sessionStarredFilter');
    });

    const button = await seedCommandButton(project.id, {
      label: 'Kill Indicator',
      command: 'sleep 30',
      showOnList: true,
    });

    // Run the command, kill it, wait for completion — all before navigating
    const { runId } = await runCommandButton(session.id, button.id);
    await killCommandRun(session.id, runId);
    const completedRun = await waitForCommandRunComplete(session.id, runId, 15000);

    // Navigate to session list; wait for session card to render
    await navigateAndWait(page, `/projects/${project.id}/sessions`, {
      waitFor: '.session-card',
      timeout: 15000,
    });

    // Verify session card is visible
    await expect(page.getByText('Indicator Session')).toBeVisible();

    // Should show killed or error indicator
    if (completedRun.status === 'killed') {
      const killedIndicator = page.locator('.button-status-killed');
      await expect(killedIndicator).toBeVisible({ timeout: 5000 });
    } else {
      // Fallback: some kill scenarios produce 'error' status
      const errorIndicator = page.locator('.button-status-error');
      await expect(errorIndicator).toBeVisible({ timeout: 5000 });
    }
  });

  test('multiple buttons show independent status indicators', async ({ page }) => {
    // Clear any persisted filter state
    await page.addInitScript(() => {
      localStorage.removeItem('sessionStatusFilter');
      sessionStorage.removeItem('sessionStarredFilter');
    });

    const successButton = await seedCommandButton(project.id, {
      label: 'Success Indicator',
      command: 'echo ok',
      showOnList: true,
    });
    const failButton = await seedCommandButton(project.id, {
      label: 'Fail Indicator',
      command: 'exit 1',
      showOnList: true,
    });

    // Run both sequentially and wait — before navigating
    await runCommandButtonAndWait(session.id, successButton.id);
    await runCommandButtonAndWait(session.id, failButton.id);

    // Navigate to session list; wait for session card to render
    await navigateAndWait(page, `/projects/${project.id}/sessions`, {
      waitFor: '.session-card',
      timeout: 15000,
    });

    // Verify session card is visible
    await expect(page.getByText('Indicator Session')).toBeVisible();

    // Should show both success and error indicators
    const successIndicator = page.locator('.button-status-success');
    const errorIndicator = page.locator('.button-status-error');

    await expect(successIndicator).toBeVisible({ timeout: 5000 });
    await expect(errorIndicator).toBeVisible({ timeout: 5000 });
  });

  test('status indicator updates from running to success without refresh', async ({ page }) => {
    // Clear any persisted filter state
    await page.addInitScript(() => {
      localStorage.removeItem('sessionStatusFilter');
      sessionStorage.removeItem('sessionStarredFilter');
    });

    const button = await seedCommandButton(project.id, {
      label: 'Live Update',
      command: 'echo ok && sleep 3',
      showOnList: true,
    });

    // Navigate to session list FIRST; wait for session card to render
    await navigateAndWait(page, `/projects/${project.id}/sessions`, {
      waitFor: '.session-card',
      timeout: 15000,
    });

    // Verify session card is visible
    await expect(page.getByText('Indicator Session')).toBeVisible();

    // Run via API (while on list page — session list subscribes to project WebSocket)
    const { runId } = await runCommandButton(session.id, button.id);

    // Should show running indicator (via WebSocket, no refresh)
    const runningIndicator = page.locator('.button-status-running');
    await expect(runningIndicator).toBeVisible({ timeout: 10000 });

    // Wait for completion
    await waitForCommandRunComplete(session.id, runId, 15000);

    // Should transition to success (via WebSocket, no refresh)
    const successIndicator = page.locator('.button-status-success');
    await expect(successIndicator).toBeVisible({ timeout: 10000 });
  });

  test('buttons without showOnList do not appear on session card', async ({ page }) => {
    // Clear any persisted filter state
    await page.addInitScript(() => {
      localStorage.removeItem('sessionStatusFilter');
      sessionStorage.removeItem('sessionStarredFilter');
    });

    const visibleButton = await seedCommandButton(project.id, {
      label: 'Visible Button',
      command: 'echo visible',
      showOnList: true,
    });
    const hiddenButton = await seedCommandButton(project.id, {
      label: 'Hidden Button',
      command: 'echo hidden',
      showOnList: false,
    });

    // Run both and wait — before navigating
    await runCommandButtonAndWait(session.id, visibleButton.id);
    await runCommandButtonAndWait(session.id, hiddenButton.id);

    // Navigate to session list; wait for session card to render
    await navigateAndWait(page, `/projects/${project.id}/sessions`, {
      waitFor: '.session-card',
      timeout: 15000,
    });

    // Verify session card is visible
    await expect(page.getByText('Indicator Session')).toBeVisible();

    // Should show exactly 1 indicator (the visible one)
    const indicators = page.locator('.button-status-indicator');
    await expect(indicators).toHaveCount(1, { timeout: 5000 });

    // That indicator should be success
    await expect(indicators.first()).toHaveClass(/button-status-success/);
  });
});
