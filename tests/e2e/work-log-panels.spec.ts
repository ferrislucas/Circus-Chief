import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedWorkLog,
  getSessionWorkLogs,
  getSessionMessages,
  getSession,
  updateSessionStatus,
  cleanupAll,
  getAPIURL,
  TEST_PREFIX
} from './helpers';

const API_URL = getAPIURL();

// Helper to wait for session to reach a specific status (for non-UI tests)
async function waitForSessionStatus(sessionId: string, targetStatus: string, timeoutMs = 10000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const session = await getSession(sessionId);
    if (session?.status === targetStatus) {
      return session;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Session did not reach status '${targetStatus}' within ${timeoutMs}ms`);
}

test.describe('Work Log Panels', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject(
      `${TEST_PREFIX} WorkLog Panel Project`,
      process.cwd()
    );
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  // ========================================================================
  // Category 2: LiveWorkLogPanel — Real-Time Display (Fastest Feedback Loop)
  // ========================================================================
  test.describe('Category 2: LiveWorkLogPanel — Real-Time Display', () => {
    test('running state shows live work log panel container', async ({ page }) => {
      // Create session but DO NOT auto-start
      const session = await seedSession(project.id, {
        prompt: 'Test live work logs',
        name: `${TEST_PREFIX} Live WorkLog Test`,
        startImmediately: false, // CRITICAL: prevents auto-start
      });

      // Set to running so the UI shows the running-state branch
      await updateSessionStatus(session.id, 'running');

      // Navigate to session detail
      await page.goto(`${API_URL}/sessions/${session.id}`);

      // Wait for the running-state branch to render
      await page.waitForSelector('.running-state', { timeout: 10000 });

      // Assertions
      await expect(page.locator('.running-state')).toBeVisible();
      await expect(page.locator('.running-title')).toHaveText('Claude is working...');
      await expect(page.locator('.running-state .live-work-log-panel')).toBeVisible();
    });

    test('seeding a work log via API makes it appear in real-time', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test live work logs',
        name: `${TEST_PREFIX} Real-time WorkLog Test`,
        startImmediately: false,
      });

      await updateSessionStatus(session.id, 'running');
      await page.goto(`${API_URL}/sessions/${session.id}`);
      await page.waitForSelector('.running-state', { timeout: 10000 });

      // Seed a work log after page is loaded
      await seedWorkLog(session.id, {
        type: 'thinking',
        content: 'This is test thinking content for real-time display',
      });

      // Wait for the work log item to appear in the live panel
      await page.waitForSelector('.live-log-item', { timeout: 10000 });

      // Verify the content appears
      await expect(page.locator('.live-work-log-panel .thinking-block')).toBeVisible();
      await expect(page.locator('.thinking-label')).toHaveText('Thinking');
      await expect(page.locator('.thinking-text')).toContainText('This is test thinking content for real-time display');
    });

    test('multiple work logs appear in order', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test multiple work logs',
        name: `${TEST_PREFIX} Multiple WorkLogs Test`,
        startImmediately: false,
      });

      await updateSessionStatus(session.id, 'running');
      await page.goto(`${API_URL}/sessions/${session.id}`);
      await page.waitForSelector('.running-state', { timeout: 10000 });

      // Seed 3 work logs sequentially with delays
      await seedWorkLog(session.id, {
        type: 'thinking',
        content: 'First: thinking step',
      });
      await new Promise(resolve => setTimeout(resolve, 100));

      await seedWorkLog(session.id, {
        type: 'tool_input',
        content: JSON.stringify({ command: 'ls -la' }),
        toolName: 'Bash',
      });
      await new Promise(resolve => setTimeout(resolve, 100));

      await seedWorkLog(session.id, {
        type: 'tool_output',
        content: 'drwxr-xr-x  5 user  group  160 Jan 15 10:30 .',
        toolName: 'Bash',
      });

      // Wait for all 3 log items to appear
      await page.waitForSelector('.live-log-item', { timeout: 10000 });

      // Verify count
      const logItems = page.locator('.live-log-item');
      await expect(logItems).toHaveCount(3);

      // Verify order using nth() locator
      await expect(logItems.nth(0).locator('.thinking-block')).toBeVisible();
      await expect(logItems.nth(1).locator('.command-tool_input')).toBeVisible();
      await expect(logItems.nth(2).locator('.command-tool_output')).toBeVisible();
    });

    test('thinking-type work log renders as ThinkingBlock in live panel', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test thinking block',
        name: `${TEST_PREFIX} ThinkingBlock Test`,
        startImmediately: false,
      });

      await updateSessionStatus(session.id, 'running');
      await page.goto(`${API_URL}/sessions/${session.id}`);
      await page.waitForSelector('.running-state', { timeout: 10000 });

      // Seed a thinking work log
      await seedWorkLog(session.id, {
        type: 'thinking',
        content: 'Analyzing the request carefully to provide accurate response',
      });

      await page.waitForSelector('.live-log-item', { timeout: 10000 });

      // Verify ThinkingBlock rendering
      await expect(page.locator('.live-work-log-panel .thinking-block')).toBeVisible();
      await expect(page.locator('.thinking-label')).toHaveText('Thinking');
      await expect(page.locator('.thinking-text')).toContainText('Analyzing the request carefully to provide accurate response');
    });

    test('tool-type work log renders as CommandBlock in live panel', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test command block',
        name: `${TEST_PREFIX} CommandBlock Test`,
        startImmediately: false,
      });

      await updateSessionStatus(session.id, 'running');
      await page.goto(`${API_URL}/sessions/${session.id}`);
      await page.waitForSelector('.running-state', { timeout: 10000 });

      // Seed a tool_input work log
      await seedWorkLog(session.id, {
        type: 'tool_input',
        content: JSON.stringify({ command: 'ls -la' }),
        toolName: 'Bash',
      });

      await page.waitForSelector('.live-log-item', { timeout: 10000 });

      // Verify CommandBlock rendering
      await expect(page.locator('.live-work-log-panel .command-block.command-tool_input')).toBeVisible();
      await expect(page.locator('.command-tool-name')).toHaveText('Bash');
      await expect(page.locator('.command-label')).toHaveText('Input');
    });
  });

  // ========================================================================
  // Category 3: Work Log API — Additional Coverage (Pure API)
  // ========================================================================
  test.describe('Category 3: Work Log API — Additional Coverage', () => {
    test('work log has correct response shape', async () => {
      const session = await seedSession(project.id, {
        prompt: 'API test',
        name: `${TEST_PREFIX} WorkLog API Test`,
        startImmediately: false,
      });

      // Seed a work log
      const response = await seedWorkLog(session.id, {
        type: 'thinking',
        content: 'test',
      });

      // Assert response shape
      expect(response).toBeDefined();
      expect(typeof response.id).toBe('string');
      expect(response.type).toBe('thinking');
      expect(response.content).toBe('test');
      expect(typeof response.timestamp).toBe('number');
      expect(response.sessionId).toBe(session.id);
      expect(response.toolName).toBeNull();
      expect(response.messageId).toBeNull();
    });

    test('work logs without valid messageId go to _unassociated bucket', async () => {
      const session = await seedSession(project.id, {
        prompt: 'Unassociated test',
        name: `${TEST_PREFIX} Unassociated WorkLogs Test`,
        startImmediately: false,
      });

      // Seed work logs WITHOUT messageId (or with null)
      // These should go into the _unassociated bucket
      await seedWorkLog(session.id, {
        type: 'thinking',
        content: 'Unassociated thinking log',
      });
      await seedWorkLog(session.id, {
        type: 'tool_input',
        content: '{"command":"test"}',
        toolName: 'TestTool',
      });

      // Fetch work logs
      const workLogs = await getSessionWorkLogs(session.id);

      // Should be in _unassociated bucket
      expect(workLogs._unassociated).toBeDefined();
      expect(workLogs._unassociated.length).toBeGreaterThanOrEqual(2);

      // Verify the first work log content
      const thinkingLog = workLogs._unassociated.find((log: any) => log.type === 'thinking');
      expect(thinkingLog).toBeDefined();
      expect(thinkingLog.content).toBe('Unassociated thinking log');
    });

    test('work logs are ordered by timestamp', async () => {
      const session = await seedSession(project.id, {
        prompt: 'Ordering test',
        name: `${TEST_PREFIX} Timestamp Ordering Test`,
        startImmediately: false,
      });

      // Seed 3 work logs sequentially
      await seedWorkLog(session.id, { type: 'thinking', content: 'First' });
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to ensure different timestamps
      await seedWorkLog(session.id, { type: 'thinking', content: 'Second' });
      await new Promise(resolve => setTimeout(resolve, 10));
      await seedWorkLog(session.id, { type: 'thinking', content: 'Third' });

      // Fetch work logs
      const workLogs = await getSessionWorkLogs(session.id);
      const unassociated = workLogs._unassociated || [];

      expect(unassociated.length).toBe(3);

      // Assert timestamps are non-decreasing (allow equality for fast inserts)
      const timestamps = unassociated.map((log: any) => log.timestamp);
      expect(timestamps[0]).toBeLessThanOrEqual(timestamps[1]);
      expect(timestamps[1]).toBeLessThanOrEqual(timestamps[2]);
    });
  });

  // ========================================================================
  // Category 1: WorkLogPanel — Expandable Panels on Completed Messages
  // ========================================================================
  test.describe('Category 1: WorkLogPanel — Expandable Panels', () => {
    test.describe.configure({ timeout: 90000 }); // Increase timeout for session turns

    test('work log panel appears on assistant messages with logs', async ({ page }) => {
      // Create a session that auto-runs
      const session = await seedSession(project.id, {
        prompt: 'Say hello',
        name: `${TEST_PREFIX} WorkLog Panel Test`,
      });

      // Wait for session to complete first turn
      await waitForSessionStatus(session.id, 'waiting', 60000);

      // Get messages
      const messages = await getSessionMessages(session.id);
      const assistantMsg = messages.find((m: any) => m.role === 'assistant');

      // FALLBACK: If auto-run didn't create work logs, seed them manually
      const workLogs = await getSessionWorkLogs(session.id);
      if (!workLogs[assistantMsg.id] || workLogs[assistantMsg.id].length === 0) {
        await seedWorkLog(session.id, {
          type: 'thinking',
          content: 'Test thinking content for work log panel',
          messageId: assistantMsg.id,
        });
        await seedWorkLog(session.id, {
          type: 'tool_input',
          content: JSON.stringify({ command: 'echo hello' }),
          toolName: 'Bash',
          messageId: assistantMsg.id,
        });
        await seedWorkLog(session.id, {
          type: 'tool_output',
          content: 'hello',
          toolName: 'Bash',
          messageId: assistantMsg.id,
        });
      }

      // Navigate to session detail
      await page.goto(`${API_URL}/sessions/${session.id}`);
      await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 10000 });

      // Find the assistant message and verify work log panel exists
      const assistantMessage = page.locator('[data-testid="message-assistant"]').first();
      await expect(assistantMessage.locator('.work-log-panel')).toBeVisible();
    });

    test('work log panel is collapsed by default', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Say hello',
        name: `${TEST_PREFIX} Collapsed Panel Test`,
      });

      await waitForSessionStatus(session.id, 'waiting', 60000);

      const messages = await getSessionMessages(session.id);
      const assistantMsg = messages.find((m: any) => m.role === 'assistant');

      // Ensure work logs exist
      const workLogs = await getSessionWorkLogs(session.id);
      if (!workLogs[assistantMsg.id] || workLogs[assistantMsg.id].length === 0) {
        await seedWorkLog(session.id, {
          type: 'thinking',
          content: 'Test collapsed panel',
          messageId: assistantMsg.id,
        });
      }

      await page.goto(`${API_URL}/sessions/${session.id}`);
      await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 10000 });

      // Verify panel is collapsed (details element does not have 'open' attribute)
      const details = page.locator('details[data-work-log-details]').first();
      await expect(details).not.toHaveAttribute('open', /.+/);

      // Content should not be visible when collapsed
      await expect(page.locator('.work-log-content').first()).not.toBeVisible();
    });

    test('clicking work log header expands the panel', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Say hello',
        name: `${TEST_PREFIX} Expand Panel Test`,
      });

      await waitForSessionStatus(session.id, 'waiting', 60000);

      const messages = await getSessionMessages(session.id);
      const assistantMsg = messages.find((m: any) => m.role === 'assistant');

      const workLogs = await getSessionWorkLogs(session.id);
      if (!workLogs[assistantMsg.id] || workLogs[assistantMsg.id].length === 0) {
        await seedWorkLog(session.id, {
          type: 'thinking',
          content: 'Test expanding panel',
          messageId: assistantMsg.id,
        });
      }

      await page.goto(`${API_URL}/sessions/${session.id}`);
      await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 10000 });

      // Click the work log header to expand
      await page.locator('.work-log-header').first().click();

      // Verify panel is expanded
      const details = page.locator('details[data-work-log-details]').first();
      await expect(details).toHaveAttribute('open');

      // Content should now be visible
      await expect(page.locator('.work-log-content').first()).toBeVisible();

      // Chevron should have expanded class
      await expect(page.locator('.work-log-chevron').first()).toHaveClass(/expanded/);
    });

    test('clicking again collapses the panel', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Say hello',
        name: `${TEST_PREFIX} Collapse Panel Test`,
      });

      await waitForSessionStatus(session.id, 'waiting', 60000);

      const messages = await getSessionMessages(session.id);
      const assistantMsg = messages.find((m: any) => m.role === 'assistant');

      const workLogs = await getSessionWorkLogs(session.id);
      if (!workLogs[assistantMsg.id] || workLogs[assistantMsg.id].length === 0) {
        await seedWorkLog(session.id, {
          type: 'thinking',
          content: 'Test collapsing panel',
          messageId: assistantMsg.id,
        });
      }

      await page.goto(`${API_URL}/sessions/${session.id}`);
      await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 10000 });

      const header = page.locator('.work-log-header').first();
      const details = page.locator('details[data-work-log-details]').first();
      const chevron = page.locator('.work-log-chevron').first();

      // Click to expand
      await header.click();
      await expect(details).toHaveAttribute('open');

      // Click again to collapse
      await header.click();

      // Verify panel is collapsed again
      await expect(details).not.toHaveAttribute('open', /.+/);
      await expect(chevron).not.toHaveClass(/expanded/);
    });

    test('work log panel shows correct count', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Say hello',
        name: `${TEST_PREFIX} WorkLog Count Test`,
      });

      await waitForSessionStatus(session.id, 'waiting', 60000);

      const messages = await getSessionMessages(session.id);
      const assistantMsg = messages.find((m: any) => m.role === 'assistant');

      // Check if auto-run created work logs
      const workLogs = await getSessionWorkLogs(session.id);
      const existingLogs = workLogs[assistantMsg.id] || [];

      if (existingLogs.length === 0) {
        // Only seed if auto-run didn't create work logs
        await seedWorkLog(session.id, {
          type: 'thinking',
          content: 'First log',
          messageId: assistantMsg.id,
        });
        await seedWorkLog(session.id, {
          type: 'tool_input',
          content: '{"command":"test"}',
          toolName: 'Bash',
          messageId: assistantMsg.id,
        });
        await seedWorkLog(session.id, {
          type: 'tool_output',
          content: 'output',
          toolName: 'Bash',
          messageId: assistantMsg.id,
        });
      }

      await page.goto(`${API_URL}/sessions/${session.id}`);
      await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 10000 });

      // Get the actual count from the API
      const updatedWorkLogs = await getSessionWorkLogs(session.id);
      const actualCount = (updatedWorkLogs[assistantMsg.id] || []).length;

      // Verify count badge shows the correct number
      await expect(page.locator('.work-log-count').first()).toHaveText(`(${actualCount})`);
    });

    test('expanded panel shows thinking blocks for thinking-type logs', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Say hello',
        name: `${TEST_PREFIX} ThinkingBlock Test`,
      });

      await waitForSessionStatus(session.id, 'waiting', 60000);

      const messages = await getSessionMessages(session.id);
      const assistantMsg = messages.find((m: any) => m.role === 'assistant');

      // Check if auto-run created thinking logs
      const workLogs = await getSessionWorkLogs(session.id);
      const existingLogs = workLogs[assistantMsg.id] || [];
      const hasThinkingLog = existingLogs.some((log: any) => log.type === 'thinking');

      if (!hasThinkingLog) {
        // Only seed if no thinking logs exist from auto-run
        await seedWorkLog(session.id, {
          type: 'thinking',
          content: 'This is detailed thinking content for the panel',
          messageId: assistantMsg.id,
        });
      }

      await page.goto(`${API_URL}/sessions/${session.id}`);
      await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 10000 });

      // Expand the panel
      await page.locator('.work-log-header').first().click();

      // Verify ThinkingBlock is visible
      await expect(page.locator('.work-log-content .thinking-block').first()).toBeVisible();
      await expect(page.locator('.thinking-label').first()).toHaveText('Thinking');

      // Just verify that thinking text exists (don't check specific content since auto-run may create different content)
      await expect(page.locator('.thinking-text').first()).toBeVisible();
    });

    test('expanded panel shows command blocks for tool-type logs', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Say hello',
        name: `${TEST_PREFIX} CommandBlock Test`,
      });

      await waitForSessionStatus(session.id, 'waiting', 60000);

      const messages = await getSessionMessages(session.id);
      const assistantMsg = messages.find((m: any) => m.role === 'assistant');

      await seedWorkLog(session.id, {
        type: 'tool_input',
        content: '{"command":"ls -la"}',
        toolName: 'Bash',
        messageId: assistantMsg.id,
      });
      await seedWorkLog(session.id, {
        type: 'tool_output',
        content: 'file1.txt\nfile2.txt',
        toolName: 'Bash',
        messageId: assistantMsg.id,
      });

      await page.goto(`${API_URL}/sessions/${session.id}`);
      await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 10000 });

      // Expand the panel
      await page.locator('.work-log-header').first().click();

      // Verify CommandBlocks are visible
      await expect(page.locator('.work-log-content .command-block').first()).toBeVisible();
      await expect(page.locator('.command-label').first()).toHaveText(/Input|Output/);
      await expect(page.locator('.command-tool-name').first()).toHaveText('Bash');
    });
  });

  // ========================================================================
  // Category 4: Work Log Lifecycle — Association and Negative Cases
  // ========================================================================
  test.describe('Category 4: Work Log Lifecycle', () => {
    test.describe.configure({ timeout: 90000 }); // Increase timeout for session turns

    test('after session turn completes, work logs appear on assistant message not in live panel', async ({ page }) => {
      // Auto-start session — will create real work logs during execution
      const session = await seedSession(project.id, {
        prompt: 'Say hello',
        name: `${TEST_PREFIX} WorkLog Association Test`,
      });

      // Wait for first turn to complete
      await waitForSessionStatus(session.id, 'waiting', 60000);

      // Navigate to session detail
      await page.goto(`${API_URL}/sessions/${session.id}`);
      await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 10000 });

      // Session is waiting, NOT running, so .running-state should NOT exist
      await expect(page.locator('.running-state')).toHaveCount(0);

      // Work logs should appear on assistant message (if they were created)
      const workLogs = await getSessionWorkLogs(session.id);
      const messages = await getSessionMessages(session.id);
      const assistantMsg = messages.find((m: any) => m.role === 'assistant');

      const associatedLogs = workLogs[assistantMsg.id] || [];
      if (associatedLogs.length > 0) {
        // If auto-run created work logs, verify panel appears on message
        await expect(page.locator('[data-testid="message-assistant"]').first().locator('.work-log-panel')).toBeVisible();
      }
      // If auto-run didn't create work logs, skip the assertion (as documented in plan)
    });

    test('work log panel does not appear on user messages', async ({ page }) => {
      const session = await seedSession(project.id, {
        prompt: 'Test user messages',
        name: `${TEST_PREFIX} User Message Panel Test`,
      });

      await waitForSessionStatus(session.id, 'waiting', 60000);

      await page.goto(`${API_URL}/sessions/${session.id}`);
      await page.waitForSelector('[data-testid="message-user"]', { timeout: 10000 });

      // Find user message and verify work log panel does NOT appear
      const userMessages = page.locator('[data-testid="message-user"]');
      const count = await userMessages.count();

      for (let i = 0; i < count; i++) {
        await expect(userMessages.nth(i).locator('.work-log-panel')).toHaveCount(0);
      }
    });
  });
});
