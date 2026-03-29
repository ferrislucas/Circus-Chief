import { test, expect, type Page } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  getSessionWorkLogs,
  getSessionMessages,
  getSession,
  openSessionOverlay,
} from './helpers';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const API_URL = process.env.API_URL || 'http://localhost:5000';

// Helper to wait for session to reach a specific status
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

test.describe('Work Log Deduplication', () => {
  test.describe.configure({ timeout: 90000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Dedup Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('thinking work logs are not duplicated in the store when addWorkLog receives the same log twice', async ({ page }) => {
    // Create a session and wait for it to complete its mock turn
    const session = await seedSession(project.id, {
      prompt: 'Test thinking dedup',
      name: 'Thinking Dedup Test',
    });

    await waitForSessionStatus(session.id, 'waiting', 60000);

    // Get the work logs from the API to know what was created
    const workLogsFromApi = await getSessionWorkLogs(session.id);
    const messages = await getSessionMessages(session.id);
    const assistantMessages = messages.filter((m: any) => m.role === 'assistant');
    expect(assistantMessages.length).toBeGreaterThan(0);

    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    const associatedLogs = workLogsFromApi[lastAssistant.id] || [];
    const thinkingLogs = associatedLogs.filter((l: any) => l.type === 'thinking');
    expect(thinkingLogs.length).toBeGreaterThan(0);

    // Navigate to the session detail page — this loads work logs into the Pinia store
    await page.goto(`${BASE_URL}/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Wait for the conversation tab to load and messages to appear
    await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 15000 });

    // Get the work log count from the first WorkLogPanel (shows count in parentheses)
    // The WorkLogPanel shows "(N)" where N is the number of associated work logs
    // Use .first() because multiple assistant messages may each have their own work log panel
    const workLogPanel = page.locator('[data-work-log-details]').first();
    await expect(workLogPanel).toBeVisible({ timeout: 10000 });

    // Get the initial count text, e.g. "(3)"
    const countText = await workLogPanel.locator('.work-log-count').textContent();
    const initialCount = parseInt(countText!.replace(/[()]/g, ''));
    expect(initialCount).toBeGreaterThan(0);

    // Now simulate the bug: call addWorkLog in the Pinia store with a log that already exists
    // This simulates what happens when a WebSocket delivers the same log after fetchWorkLogs
    const duplicateLog = thinkingLogs[0];
    const storeHadDuplicate = await page.evaluate((log) => {
      // Access the Pinia store via the global app instance
      const app = (window as any).__vue_app__ || document.querySelector('#app')?.__vue_app__;
      if (!app) return { error: 'No Vue app found' };

      // Get the Pinia instance from the app
      const pinia = app.config.globalProperties.$pinia;
      if (!pinia) return { error: 'No Pinia found' };

      // Access the sessions store
      const stores = pinia._s;
      const sessionsStore = stores.get('sessions');
      if (!sessionsStore) return { error: 'No sessions store found' };

      // Count work logs with this ID before
      const messageId = log.messageId || '_unassociated';
      const logsBefore = sessionsStore.workLogs[messageId] || [];
      const countBefore = logsBefore.filter((l: any) => l.id === log.id).length;

      // Call addWorkLog with the same log (simulating WebSocket re-delivery)
      sessionsStore.addWorkLog(log);

      // Count work logs with this ID after
      const logsAfter = sessionsStore.workLogs[messageId] || [];
      const countAfter = logsAfter.filter((l: any) => l.id === log.id).length;

      return {
        countBefore,
        countAfter,
        totalBefore: logsBefore.length,
        totalAfter: logsAfter.length,
        duplicated: countAfter > countBefore,
      };
    }, duplicateLog);

    // The bug: addWorkLog should NOT add a duplicate. If countAfter > countBefore, we have duplication.
    expect(storeHadDuplicate).not.toHaveProperty('error');
    expect(storeHadDuplicate.countBefore).toBe(1);
    // This assertion will FAIL before the fix (countAfter will be 2)
    // and PASS after the fix (countAfter will still be 1)
    expect(storeHadDuplicate.countAfter).toBe(1);
    expect(storeHadDuplicate.duplicated).toBe(false);

    // Also verify the UI count hasn't changed
    const countTextAfter = await workLogPanel.locator('.work-log-count').textContent();
    const countAfterUi = parseInt(countTextAfter!.replace(/[()]/g, ''));
    expect(countAfterUi).toBe(initialCount);
  });

  test('tool_input work logs are not duplicated in the store', async ({ page }) => {
    // Create a session and wait for it to complete its mock turn
    const session = await seedSession(project.id, {
      prompt: 'Test tool input dedup',
      name: 'Tool Input Dedup Test',
    });

    await waitForSessionStatus(session.id, 'waiting', 60000);

    // Navigate to the session detail page — loads work logs into Pinia store
    await page.goto(`${BASE_URL}/sessions/${session.id}/summary`);
    await openSessionOverlay(page);
    await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 15000 });

    // Test dedup by injecting a synthetic tool_input work log into the store,
    // then trying to add it again. This directly tests the addWorkLog dedup logic
    // without depending on the mock session producing tool_input logs (which is
    // race-condition dependent under parallel test execution).
    const messages = await getSessionMessages(session.id);
    const assistantMessages = messages.filter((m: any) => m.role === 'assistant');
    expect(assistantMessages.length).toBeGreaterThan(0);

    const targetMessageId = assistantMessages[0].id;
    const syntheticLog = {
      id: `synthetic-tool-input-${Date.now()}`,
      sessionId: session.id,
      messageId: targetMessageId,
      type: 'tool_input',
      content: '{"file_path": "/tmp/test.txt"}',
      toolName: 'Read',
      createdAt: new Date().toISOString(),
    };

    const storeHadDuplicate = await page.evaluate((log) => {
      const app = (window as any).__vue_app__ || document.querySelector('#app')?.__vue_app__;
      if (!app) return { error: 'No Vue app found' };

      const pinia = app.config.globalProperties.$pinia;
      if (!pinia) return { error: 'No Pinia found' };

      const stores = pinia._s;
      const sessionsStore = stores.get('sessions');
      if (!sessionsStore) return { error: 'No sessions store found' };

      const messageId = log.messageId || '_unassociated';

      // First: add the log for the first time
      sessionsStore.addWorkLog(log);
      const logsAfterFirst = sessionsStore.workLogs[messageId] || [];
      const countAfterFirst = logsAfterFirst.filter((l: any) => l.id === log.id).length;

      // Second: try to add the SAME log again (simulating WebSocket re-delivery)
      sessionsStore.addWorkLog(log);
      const logsAfterSecond = sessionsStore.workLogs[messageId] || [];
      const countAfterSecond = logsAfterSecond.filter((l: any) => l.id === log.id).length;

      return {
        countAfterFirst,
        countAfterSecond,
        totalAfterFirst: logsAfterFirst.length,
        totalAfterSecond: logsAfterSecond.length,
        duplicated: countAfterSecond > countAfterFirst,
      };
    }, syntheticLog);

    // The dedup logic should prevent the second addWorkLog from creating a duplicate
    expect(storeHadDuplicate).not.toHaveProperty('error');
    expect(storeHadDuplicate.countAfterFirst).toBe(1);
    expect(storeHadDuplicate.countAfterSecond).toBe(1);
    expect(storeHadDuplicate.duplicated).toBe(false);
  });

  test('work log count in API response has no duplicates from mock session', async () => {
    // Create a session and wait for completion
    const session = await seedSession(project.id, {
      prompt: 'Test API dedup',
      name: 'API Dedup Test',
    });

    await waitForSessionStatus(session.id, 'waiting', 60000);

    // Fetch work logs via API
    const workLogs = await getSessionWorkLogs(session.id);

    // Collect ALL work logs across all message groups
    const allLogs: any[] = [];
    for (const [key, logs] of Object.entries(workLogs)) {
      if (Array.isArray(logs)) {
        allLogs.push(...logs);
      }
    }

    // Verify no duplicate IDs in the database — this is the core dedup check
    const ids = allLogs.map((l: any) => l.id);
    const uniqueIds = [...new Set(ids)];
    expect(ids.length).toBe(uniqueIds.length);

    // Core dedup assertion: no duplicate IDs should exist in the database
    // (The mock session produces thinking, tool_input, and tool_output logs per turn,
    // but the session may have had multiple turns if continued.)
    expect(allLogs.length).toBeGreaterThan(0);

    // Verify at least thinking and tool_input logs exist (tool_output may be race-condition dependent)
    const thinkingLogs = allLogs.filter((l: any) => l.type === 'thinking');
    expect(thinkingLogs.length).toBeGreaterThan(0);

    const toolInputLogs = allLogs.filter((l: any) => l.type === 'tool_input');
    expect(toolInputLogs.length).toBeGreaterThan(0);
  });
});
