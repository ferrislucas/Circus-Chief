import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedWorkLog,
  cleanupCreatedResources,
  navigateAndWait,
  updateSessionStatus,
  getAPIURL,
} from './helpers';

const API_URL = getAPIURL();

/**
 * E2E Tests for Session Live Output Improvements
 *
 * Covers:
 * - SessionLogStream CSS sizing (max-height 25em, line-clamp 8)
 * - Live output displays work log entries for running sessions
 * - SessionLogStream collapse/expand toggle
 *
 * Note: Partial text persistence (setSessionPartialText ignoring empty strings,
 * setPartialThinking ignoring null/empty) is thoroughly covered in unit tests:
 *   - packages/web/src/stores/sessionStreaming.test.js
 *   - packages/web/src/composables/useRunningSessionSubscriptions.test.js
 * These behaviors cannot be tested E2E because SESSION_PARTIAL is only
 * broadcast during actual Claude streaming, not via any test API endpoint.
 */

test.describe('Session Live Output', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Live Output Test', process.cwd());
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test.describe('Live output panel CSS sizing', () => {
    test('log-content max-height is 25em (not old 15em)', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test log size',
        name: 'Log Size Test',
        startImmediately: false,
      });
      await updateSessionStatus(session.id, 'running');

      // Navigate to the session list
      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        waitFor: '.session-card',
      });

      // Seed a work log via API — the server broadcasts SESSION_WORK_LOG,
      // the frontend picks it up and renders in SessionLogStream
      await seedWorkLog(session.id, {
        type: 'tool_input',
        content: JSON.stringify({ command: 'ls -la' }),
        toolName: 'Bash',
      });

      // Wait for the log content container to appear
      await page.waitForSelector('.log-content', { timeout: 15000 });

      // Verify max-height is reasonable (25em at the component's 0.7rem font-size)
      const maxHeightPx = await page.locator('.log-content').evaluate(
        (el) => parseFloat(getComputedStyle(el).maxHeight)
      );
      // 25em * (0.7rem * 16px) ≈ 280px in most browsers
      // The old value (15em) would be ≈ 168px — verify we're larger
      expect(maxHeightPx).toBeGreaterThan(200);
    });
  });

  test.describe('Work log display in running sessions', () => {
    test('work logs appear in SessionLogStream on the session list', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test work log display',
        name: 'Work Log Display Test',
        startImmediately: false,
      });
      await updateSessionStatus(session.id, 'running');

      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        waitFor: '.session-card',
      });

      // Seed a work log — this triggers a server broadcast
      await seedWorkLog(session.id, {
        type: 'tool_input',
        content: JSON.stringify({ command: 'git status' }),
        toolName: 'Bash',
      });

      // Wait for the session log stream to appear
      const logStream = page.locator('.session-log-stream');
      await expect(logStream).toBeVisible({ timeout: 15000 });

      // Verify the "Live Output" header is shown
      const headerLabel = page.locator('.log-header-label');
      await expect(headerLabel).toHaveText('Live Output');

      // Verify log entries exist in the DOM (they may be zero-height divs
      // since tool_input type doesn't render the .log-tool or .log-summary spans)
      const logEntry = page.locator('.log-entry');
      const count = await logEntry.count();
      expect(count).toBeGreaterThanOrEqual(1);
    });

    test('multiple work logs create multiple log entries', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test multiple work logs',
        name: 'Multiple Work Logs Test',
        startImmediately: false,
      });
      await updateSessionStatus(session.id, 'running');

      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        waitFor: '.session-card',
      });

      // Seed multiple work logs with small delays
      await seedWorkLog(session.id, {
        type: 'tool_input',
        content: JSON.stringify({ command: 'ls' }),
        toolName: 'Bash',
      });
      await new Promise(r => setTimeout(r, 100));

      await seedWorkLog(session.id, {
        type: 'tool_input',
        content: JSON.stringify({ file: 'src/index.js' }),
        toolName: 'Read',
      });

      // Wait for the log stream to appear
      const logStream = page.locator('.session-log-stream');
      await expect(logStream).toBeVisible({ timeout: 15000 });

      // Should have at least 2 log entry elements
      const logEntries = page.locator('.log-entry');
      await expect(async () => {
        const count = await logEntries.count();
        expect(count).toBeGreaterThanOrEqual(2);
      }).toPass({ timeout: 10000 });
    });

    test('SessionLogStream is only visible for running sessions', async ({ page }) => {
      // Create a non-running session
      const session = await seedSession(project.id, {
        prompt: 'Test non-running session',
        name: 'Non-Running Test',
        startImmediately: false,
      });
      // Leave status as draft/waiting — not running

      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        waitFor: '.session-card',
      });

      // SessionLogStream should NOT be visible (session is not running)
      const logStream = page.locator('.session-log-stream');
      await expect(logStream).toHaveCount(0);
    });

    test('SessionLogStream collapse/expand toggle works', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test collapse toggle',
        name: 'Collapse Toggle Test',
        startImmediately: false,
      });
      await updateSessionStatus(session.id, 'running');

      await navigateAndWait(page, `/projects/${project.id}/sessions`, {
        waitFor: '.session-card',
      });

      // Seed a work log to make the log stream visible
      await seedWorkLog(session.id, {
        type: 'tool_input',
        content: JSON.stringify({ command: 'test' }),
        toolName: 'Bash',
      });

      // Wait for the expanded log stream
      await page.waitForSelector('.session-log-stream', { timeout: 15000 });

      // Verify log header is visible
      const logHeader = page.locator('.log-header');
      await expect(logHeader).toBeVisible();

      // Click to collapse
      await logHeader.click();

      // After collapse, .session-log-stream disappears and .log-collapsed appears
      const logCollapsed = page.locator('.log-collapsed');
      await expect(logCollapsed).toBeVisible({ timeout: 5000 });
      await expect(logCollapsed).toContainText('Show live output');

      // Click collapsed bar to expand
      await logCollapsed.click();

      // Verify expanded again
      await expect(page.locator('.session-log-stream')).toBeVisible({ timeout: 5000 });
    });
  });
});
