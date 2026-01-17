import { test, expect, Page } from '@playwright/test';
import {
  seedProject,
  cleanupAll,
  getSession,
  getSessionMessages,
  waitForSessionToExist,
} from './helpers';

const API_URL = process.env.API_URL || 'http://localhost:5010';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Helper to create session with haiku model
async function createHaikuSession(projectId: string, prompt: string, name: string) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, name, model: HAIKU_MODEL }),
  });
  if (!response.ok) throw new Error('Failed to create session');
  return response.json();
}

// Helper to wait for session to reach a specific status (API-based polling)
async function waitForSessionStatusAPI(sessionId: string, targetStatus: string, timeoutMs = 120000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const session = await getSession(sessionId);
    if (session?.status === targetStatus) {
      return session;
    }
    // Also check for error status
    if (session?.status === 'error') {
      throw new Error(`Session entered error state: ${session.error}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Session did not reach status '${targetStatus}' within ${timeoutMs}ms`);
}

/**
 * This test suite specifically targets the "Disappearing Conversation Bug"
 *
 * Bug Description:
 * 1. Response streams correctly and appears in the conversation
 * 2. When response completes, the entire conversation disappears from the UI
 * 3. Page refresh brings the conversation back (data persists in database)
 *
 * Uses real Haiku model with minimal prompts for fast, realistic testing.
 */
test.describe('Conversation Persistence Bug', () => {
  // Allow extra time for real API calls
  test.describe.configure({ timeout: 180000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Persistence Test', '/tmp/test-persistence');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('CRITICAL: conversation messages should persist after session completes', async ({ page }) => {
    // Use a very short prompt for fast response
    const testPrompt = 'Say ok';

    // Create a session with haiku model
    const session = await createHaikuSession(project.id, testPrompt, 'Persistence Test');
    console.log(`[TEST] Created session ${session.id} with haiku model`);

    // Wait for session to exist in API
    await waitForSessionToExist(session.id);

    // Navigate to the session
    await page.goto(`/sessions/${session.id}/conversation`);
    await page.waitForLoadState('networkidle');

    // Verify initial user message is visible
    const userMessage = page.locator('.message-content').getByText(testPrompt, { exact: true });
    await expect(userMessage).toBeVisible({ timeout: 15000 });
    console.log('[TEST] Initial user message visible');

    // Wait for session to reach 'waiting' status (Claude has responded)
    await waitForSessionStatusAPI(session.id, 'waiting', 120000);
    console.log('[TEST] Session reached waiting status');

    // Small delay to let any race conditions trigger
    await page.waitForTimeout(3000);

    // CRITICAL CHECK: Verify messages are STILL visible after completion
    const visibleMessages = await page.locator('.message-content').count();
    console.log(`[TEST] Visible messages after completion: ${visibleMessages}`);

    // Verify the user message is STILL visible (this is the bug check)
    await expect(userMessage).toBeVisible({ timeout: 5000 });
    console.log('[TEST] User message still visible after completion - PASSED');

    // Verify via API that messages exist in database
    const messages = await getSessionMessages(session.id);
    console.log(`[TEST] API confirms ${messages.length} messages in database`);
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  test('CRITICAL: messages should persist through status transitions', async ({ page }) => {
    const testPrompt = 'Reply with just the word hello';

    // Create session with haiku
    const session = await createHaikuSession(project.id, testPrompt, 'Status Transition Test');
    console.log(`[TEST] Created session ${session.id}`);

    await waitForSessionToExist(session.id);
    await page.goto(`/sessions/${session.id}/conversation`);
    await page.waitForLoadState('networkidle');

    // Wait for initial message to appear
    const userMessage = page.locator('.message-content').getByText(testPrompt, { exact: true });
    await expect(userMessage).toBeVisible({ timeout: 15000 });

    // Track message count before completion
    let visibleMessagesBefore = await page.locator('.message-content').count();
    console.log(`[TEST] Messages before completion: ${visibleMessagesBefore}`);

    // Wait for session to complete
    await waitForSessionStatusAPI(session.id, 'waiting', 120000);
    console.log('[TEST] Session completed');

    // Add a delay to catch any delayed state clearing
    await page.waitForTimeout(3000);

    // Count messages after completion
    let visibleMessagesAfter = await page.locator('.message-content').count();
    console.log(`[TEST] Messages after completion: ${visibleMessagesAfter}`);

    // CRITICAL: Message count should NOT have decreased
    expect(visibleMessagesAfter).toBeGreaterThanOrEqual(visibleMessagesBefore);

    // Verify specific content is still there
    await expect(userMessage).toBeVisible({ timeout: 5000 });
  });

  test('VERIFY: page refresh should restore messages (proves data persists in DB)', async ({ page }) => {
    const testPrompt = 'Say yes';

    // Create session with haiku
    const session = await createHaikuSession(project.id, testPrompt, 'Refresh Test');
    console.log(`[TEST] Created session ${session.id}`);

    await waitForSessionToExist(session.id);
    await page.goto(`/sessions/${session.id}/conversation`);
    await page.waitForLoadState('networkidle');

    // Wait for session to complete
    await waitForSessionStatusAPI(session.id, 'waiting', 120000);
    console.log('[TEST] Session completed');

    // Get message count via API (ground truth)
    const apiMessages = await getSessionMessages(session.id);
    console.log(`[TEST] API reports ${apiMessages.length} messages`);

    // Count visible messages before refresh
    const messagesBefore = await page.locator('.message-content').count();
    console.log(`[TEST] Visible messages before refresh: ${messagesBefore}`);

    // Detect the bug
    if (messagesBefore === 0 && apiMessages.length > 0) {
      console.log('[TEST] BUG DETECTED: Messages disappeared but exist in DB');
    }

    // Refresh the page
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Count messages after refresh
    const messagesAfter = await page.locator('.message-content').count();
    console.log(`[TEST] Visible messages after refresh: ${messagesAfter}`);

    // Messages should be visible after refresh
    expect(messagesAfter).toBeGreaterThanOrEqual(1);

    // If messages appear after refresh but weren't visible before, bug is confirmed
    if (messagesBefore === 0 && messagesAfter > 0) {
      console.log('[TEST] BUG CONFIRMED: Messages only visible after refresh');
      expect(messagesBefore).toBeGreaterThan(0); // Fail the test
    }
  });

  test('DEBUG: log state transitions during session', async ({ page }) => {
    const testPrompt = 'Say hi';

    // Enable console logging from the browser
    page.on('console', (msg) => {
      const text = msg.text();
      // Filter for relevant logs
      if (text.includes('[STORE]') || text.includes('[STATE') || text.includes('WebSocket')) {
        console.log(`[BROWSER]`, text);
      }
    });

    // Create session with haiku
    const session = await createHaikuSession(project.id, testPrompt, 'Debug Test');
    console.log(`[TEST] Created session ${session.id}`);

    await waitForSessionToExist(session.id);
    await page.goto(`/sessions/${session.id}/conversation`);

    // Inject logging to track message array changes
    await page.evaluate(() => {
      let lastMessageCount = -1;
      setInterval(() => {
        // @ts-ignore
        const store = (window as any).__pinia?.state?.value?.sessions;
        if (store) {
          const currentCount = store.messages?.length ?? 0;
          if (currentCount !== lastMessageCount) {
            console.log(`[STATE CHANGE] Messages: ${lastMessageCount} -> ${currentCount}`);
            lastMessageCount = currentCount;
          }
        }
      }, 500);
    });

    // Wait for session to complete
    await waitForSessionStatusAPI(session.id, 'waiting', 120000);
    console.log('[TEST] Session completed');

    // Wait and observe for any delayed state changes
    await page.waitForTimeout(5000);

    // Final check
    const messageCount = await page.locator('.message-content').count();
    console.log(`[TEST] Final visible message count: ${messageCount}`);

    expect(messageCount).toBeGreaterThanOrEqual(1);
  });
});
