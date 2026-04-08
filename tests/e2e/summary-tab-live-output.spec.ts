import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedWorkLog,
  seedPartialText,
  seedThinking,
  cleanupCreatedResources,
  navigateAndWait,
  updateSessionStatus,
  getAPIURL,
} from './helpers';

const API_URL = getAPIURL();

/**
 * E2E Tests for Session Live Output on Summary Tab
 *
 * Verifies that SessionLogStream appears and works correctly
 * when viewing the summary tab of a running session.
 */

test.describe('Summary Tab Live Output', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Summary Live Output Test', process.cwd());
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('displays live output on summary tab when session is running', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test summary live output',
      name: 'Summary Live Output Test',
      model: 'claude-sonnet-4-20250514',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');

    // Navigate directly to the summary tab
    await navigateAndWait(page, `/sessions/${session.id}/summary`, {
      waitFor: '.summary-tab',
    });

    // Seed a work log to trigger live output
    await seedWorkLog(session.id, {
      type: 'tool_input',
      content: JSON.stringify({ command: 'echo "test"' }),
      toolName: 'Bash',
    });

    // Wait for the session log stream to appear
    const logStream = page.locator('.session-log-stream');
    await expect(logStream).toBeVisible({ timeout: 15000 });

    // Verify the "Live Output" header is shown
    const headerLabel = page.locator('.log-header-label');
    await expect(headerLabel).toHaveText('Live Output');

    // Verify the model badge is visible and shows the model name
    const modelBadge = logStream.locator('[data-testid="live-output-model"]');
    await expect(modelBadge).toBeVisible();
    await expect(modelBadge).toHaveText(session.model);
  });

  test('does not display live output when session is completed', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test completed session',
      name: 'Completed Session Test',
      startImmediately: false,
    });
    // Keep status as completed/default (not running)

    // Navigate to the summary tab
    await navigateAndWait(page, `/sessions/${session.id}/summary`, {
      waitFor: '.summary-tab',
    });

    // SessionLogStream should NOT be visible
    const logStream = page.locator('.session-log-stream');
    await expect(logStream).toHaveCount(0);
  });

  test('does not display live output for other non-running statuses', async ({ page }) => {
    const nonRunningStatuses = ['waiting', 'stopped', 'error', 'scheduled'];

    for (const status of nonRunningStatuses) {
      const session = await seedSession(project.id, {
        prompt: `Test ${status} session`,
        name: `${status} Session Test`,
        startImmediately: false,
      });
      await updateSessionStatus(session.id, status);

      await navigateAndWait(page, `/sessions/${session.id}/summary`, {
        waitFor: '.summary-tab',
      });

      const logStream = page.locator('.session-log-stream');
      await expect(logStream).toHaveCount(0);
    }
  });

  test('collapse/expand toggle works on summary tab', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test collapse on summary',
      name: 'Summary Collapse Test',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');

    await navigateAndWait(page, `/sessions/${session.id}/summary`, {
      waitFor: '.summary-tab',
    });

    // Seed a work log to make the log stream visible
    await seedWorkLog(session.id, {
      type: 'tool_input',
      content: JSON.stringify({ command: 'test' }),
      toolName: 'Bash',
    });

    // Wait for the expanded log stream
    await page.waitForSelector('.session-log-stream', { timeout: 15000 });

    // Click to collapse
    const logHeader = page.locator('.log-header');
    await logHeader.click();

    // After collapse, .log-collapsed should appear
    const logCollapsed = page.locator('.log-collapsed');
    await expect(logCollapsed).toBeVisible({ timeout: 5000 });
    await expect(logCollapsed).toContainText('Show live output');

    // Click collapsed bar to expand
    await logCollapsed.click();

    // Verify expanded again
    await expect(page.locator('.session-log-stream')).toBeVisible({ timeout: 5000 });
  });

  test('displays partial text in live output', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test partial text display',
      name: 'Partial Text Display Test',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');

    await navigateAndWait(page, `/sessions/${session.id}/summary`, {
      waitFor: '.summary-tab',
    });

    // Seed partial text
    await seedPartialText(session.id, 'I am currently working on your request...');

    // Wait for the session log stream to appear
    const logStream = page.locator('.session-log-stream');
    await expect(logStream).toBeVisible({ timeout: 15000 });

    // Verify the partial text is displayed
    const logPartial = page.locator('.log-partial');
    await expect(logPartial).toContainText('I am currently working on your request...');
  });

  test('displays thinking in live output', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test thinking display',
      name: 'Thinking Display Test',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');

    await navigateAndWait(page, `/sessions/${session.id}/summary`, {
      waitFor: '.summary-tab',
    });

    // Seed thinking
    await seedThinking(session.id, 'Let me analyze the requirements...');

    // Wait for the session log stream to appear
    const logStream = page.locator('.session-log-stream');
    await expect(logStream).toBeVisible({ timeout: 15000 });

    // Verify the thinking is displayed
    const logThinking = page.locator('.log-thinking');
    await expect(logThinking).toContainText('Let me analyze the requirements...');
  });

  test('live output appears at top of summary tab before other content', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test live output position',
      name: 'Live Output Position Test',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');

    await navigateAndWait(page, `/sessions/${session.id}/summary`, {
      waitFor: '.summary-tab',
    });

    // Seed a work log
    await seedWorkLog(session.id, {
      type: 'tool_input',
      content: JSON.stringify({ command: 'pwd' }),
      toolName: 'Bash',
    });

    // Wait for live output
    await page.waitForSelector('.session-log-stream', { timeout: 15000 });

    // Verify DOM order: SessionLogStream should be the first child of the summary tab
    const summaryTab = page.locator('.summary-tab');
    const children = await summaryTab.locator('> *').all();

    // First child should be the session log stream
    await expect(children[0]).toHaveClass(/session-log-stream/);
  });
});
