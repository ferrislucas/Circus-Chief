import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  seedCommandButton,
  cleanupAll,
  navigateAndWait,
  waitForSessionToExist,
  runCommandButton,
  waitForCommandRunComplete,
  updateSessionWithPR,
} from './helpers';

/**
 * E2E Tests for Command Button & PR Indicators in Child Session Lists
 *
 * This test suite covers the feature that displays visual indicators for:
 * - Command button status (running, success, error)
 * - PR status (open, merged, closed, draft, conflicts, CI status)
 *
 * In two locations:
 * - ChildSessionsPanel (SessionDetailView)
 * - WorkflowSessionItem (SessionCard workflow view)
 */

test.describe('Child Session Indicators - Command Buttons in ChildSessionsPanel', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;
  let childSession: any;
  let commandButton: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Child Indicators Test', '/tmp/test');
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parentSession.id);

    childSession = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child session prompt',
      name: 'Child Session',
    });
    await waitForSessionToExist(childSession.id);

    // Create a command button with showOnList: true
    commandButton = await seedCommandButton(project.id, {
      label: 'Test Command',
      command: 'echo "test"',
      showOnList: true,
    });
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('should show running command indicator', async ({ page }) => {
    // Create a longer-running command
    const longButton = await seedCommandButton(project.id, {
      label: 'Long Command',
      command: 'sleep 3 && echo "done"',
      showOnList: true,
    });

    // Start the command
    const { runId } = await runCommandButton(childSession.id, longButton.id);

    // Navigate to parent session detail view
    await navigateAndWait(page, `/sessions/${parentSession.id}`);

    // Wait for ChildSessionsPanel to load
    await expect(page.getByText('Child Sessions')).toBeVisible({ timeout: 5000 });

    // Look for running indicator (⊙ with pulsing animation)
    const runningIndicator = page.locator('.child-sessions-panel .button-status-running');
    await expect(runningIndicator).toBeVisible({ timeout: 5000 });

    // Verify it shows the running icon
    await expect(runningIndicator).toContainText('⊙');

    // Verify it has the correct class
    await expect(runningIndicator).toHaveClass(/button-status-running/);

    // Wait for completion
    await waitForCommandRunComplete(childSession.id, runId, 10000);
  });

  test('should show success command indicator', async ({ page }) => {
    // Run the command and wait for success
    const { runId } = await runCommandButton(childSession.id, commandButton.id);
    await waitForCommandRunComplete(childSession.id, runId, 10000);

    // Navigate to parent session detail view
    await navigateAndWait(page, `/sessions/${parentSession.id}`);

    // Wait for ChildSessionsPanel to load
    await expect(page.getByText('Child Sessions')).toBeVisible({ timeout: 5000 });

    // Look for success indicator (✓)
    const successIndicator = page.locator('.child-sessions-panel .button-status-success');
    await expect(successIndicator).toBeVisible({ timeout: 5000 });

    // Verify it shows the success icon
    await expect(successIndicator).toContainText('✓');

    // Verify it has the correct class
    await expect(successIndicator).toHaveClass(/button-status-success/);
  });

  test('should show error command indicator', async ({ page }) => {
    // Create a failing command
    const failButton = await seedCommandButton(project.id, {
      label: 'Fail Command',
      command: 'exit 1',
      showOnList: true,
    });

    // Run the command and wait for error
    const { runId } = await runCommandButton(childSession.id, failButton.id);
    await waitForCommandRunComplete(childSession.id, runId, 10000);

    // Navigate to parent session detail view
    await navigateAndWait(page, `/sessions/${parentSession.id}`);

    // Wait for ChildSessionsPanel to load
    await expect(page.getByText('Child Sessions')).toBeVisible({ timeout: 5000 });

    // Look for error indicator (✕)
    const errorIndicator = page.locator('.child-sessions-panel .button-status-error');
    await expect(errorIndicator).toBeVisible({ timeout: 5000 });

    // Verify it shows the error icon
    await expect(errorIndicator).toContainText('✕');

    // Verify it has the correct class
    await expect(errorIndicator).toHaveClass(/button-status-error/);
  });

  test('should show no indicator when no commands executed', async ({ page }) => {
    // Navigate to parent session detail view (no commands run)
    await navigateAndWait(page, `/sessions/${parentSession.id}`);

    // Wait for ChildSessionsPanel to load
    await expect(page.getByText('Child Sessions')).toBeVisible({ timeout: 5000 });

    // Should not show any command button indicators
    const indicators = page.locator('.child-sessions-panel .button-status-indicator');
    await expect(indicators).not.toBeVisible({ timeout: 2000 });
  });

  test('should show multiple command indicators', async ({ page }) => {
    // Create multiple command buttons
    const button1 = await seedCommandButton(project.id, {
      label: 'Command 1',
      command: 'echo "1"',
      showOnList: true,
    });
    const button2 = await seedCommandButton(project.id, {
      label: 'Command 2',
      command: 'echo "2"',
      showOnList: true,
    });

    // Run both commands
    const { runId: runId1 } = await runCommandButton(childSession.id, button1.id);
    const { runId: runId2 } = await runCommandButton(childSession.id, button2.id);

    await waitForCommandRunComplete(childSession.id, runId1, 10000);
    await waitForCommandRunComplete(childSession.id, runId2, 10000);

    // Navigate to parent session detail view
    await navigateAndWait(page, `/sessions/${parentSession.id}`);

    // Wait for ChildSessionsPanel to load
    await expect(page.getByText('Child Sessions')).toBeVisible({ timeout: 5000 });

    // Should show both indicators
    const indicators = page.locator('.child-sessions-panel .button-status-indicator');
    await expect(indicators).toHaveCount(2, { timeout: 5000 });
  });
});

test.describe('Child Session Indicators - PR Indicators in ChildSessionsPanel', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;
  let childSession: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('PR Indicators Test', '/tmp/test');
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parentSession.id);

    childSession = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child session prompt',
      name: 'Child Session',
    });
    await waitForSessionToExist(childSession.id);
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('should show PR link indicator when child has PR URL', async ({ page }) => {
    // Update child session with PR URL
    await updateSessionWithPR(childSession.id, {
      prUrl: 'https://github.com/user/repo/pull/123',
    });

    // Navigate to parent session detail view
    await navigateAndWait(page, `/sessions/${parentSession.id}`);

    // Wait for ChildSessionsPanel to load
    await expect(page.getByText('Child Sessions')).toBeVisible({ timeout: 5000 });

    // Look for PR link - PrIndicators component should be visible
    const prLink = page.locator('.child-sessions-panel .pr-link');
    await expect(prLink).toBeVisible({ timeout: 5000 });
    await expect(prLink).toContainText('PR 123');
  });

  test('should show no PR indicators when session has no PR', async ({ page }) => {
    // No PR data set
    await navigateAndWait(page, `/sessions/${parentSession.id}`);
    await expect(page.getByText('Child Sessions')).toBeVisible({ timeout: 5000 });

    // Should not show any PR indicators
    const prLink = page.locator('.child-sessions-panel .pr-link');
    await expect(prLink).not.toBeVisible({ timeout: 2000 });
  });
});

test.describe('Child Session Indicators - Combined Command and PR', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;
  let childSession: any;
  let commandButton: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Combined Indicators Test', '/tmp/test');
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parentSession.id);

    childSession = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child session prompt',
      name: 'Child Session',
    });
    await waitForSessionToExist(childSession.id);

    commandButton = await seedCommandButton(project.id, {
      label: 'Combined Test',
      command: 'echo "combined"',
      showOnList: true,
    });
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('should show both command and PR indicators together', async ({ page }) => {
    // Run command
    const { runId } = await runCommandButton(childSession.id, commandButton.id);
    await waitForCommandRunComplete(childSession.id, runId, 10000);

    // Set PR data
    await updateSessionWithPR(childSession.id, {
      prUrl: 'https://github.com/user/repo/pull/999',
    });

    // Navigate to parent session
    await navigateAndWait(page, `/sessions/${parentSession.id}`);
    await expect(page.getByText('Child Sessions')).toBeVisible({ timeout: 5000 });

    // Should see both indicators
    const commandIndicator = page.locator('.child-sessions-panel .button-status-success');
    const prLink = page.locator('.child-sessions-panel .pr-link');

    await expect(commandIndicator).toBeVisible({ timeout: 5000 });
    await expect(prLink).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Child Session Indicators - Workflow View PR Indicators', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;
  let childSessions: any[];

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Workflow PR Test', '/tmp/test');
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parentSession.id);

    childSessions = [];
    for (let i = 1; i <= 3; i++) {
      const child = await seedChildSession(project.id, parentSession.id, {
        prompt: `Child ${i} prompt`,
        name: `Child Session ${i}`,
      });
      await waitForSessionToExist(child.id);
      childSessions.push(child);
    }
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('should show PR indicators in expanded workflow view', async ({ page }) => {
    // Set PR data for first child
    await updateSessionWithPR(childSessions[0].id, {
      prUrl: 'https://github.com/user/repo/pull/111',
    });

    // Navigate to session list view
    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Expand parent session
    const parentCard = page.locator('.session-card').filter({ hasText: 'Parent Session' });
    const expandButton = parentCard.locator('.expand-toggle-btn');
    await expect(expandButton).toBeVisible();
    await expandButton.click();
    await page.waitForTimeout(500);

    // Look for PR indicators in workflow items
    const prLink = page.locator('.workflow-session-item .pr-link');
    await expect(prLink).toBeVisible({ timeout: 5000 });
    await expect(prLink).toContainText('PR 111');
  });
});

test.describe('Child Session Indicators - Navigation and Accessibility', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;
  let childSession: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Navigation Test', '/tmp/test');
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parentSession.id);

    childSession = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child session prompt',
      name: 'Child Session',
    });
    await waitForSessionToExist(childSession.id);
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('should expand and collapse child sessions panel', async ({ page }) => {
    // Navigate to parent session
    await navigateAndWait(page, `/sessions/${parentSession.id}`);

    // Panel should be expanded by default
    await expect(page.getByText('Child Sessions (1)')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.child-sessions-panel')).toBeVisible();

    // Click header to collapse
    await page.click('.child-sessions-panel .panel-header');
    await page.waitForTimeout(300);

    // Panel content should be hidden (indicators not visible)
    const indicators = page.locator('.child-sessions-panel .child-sessions-list');
    await expect(indicators).not.toBeVisible();

    // Click header to expand
    await page.click('.child-sessions-panel .panel-header');
    await page.waitForTimeout(300);

    // Panel content should be visible again
    await expect(indicators).toBeVisible();
  });
});
