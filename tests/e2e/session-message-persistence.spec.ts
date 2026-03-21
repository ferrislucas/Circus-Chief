/**
 * E2E Test: Session Message Persistence After Response Completes
 *
 * Regression test for a bug where:
 * - Starting a new session shows the response stream in the UI
 * - Once the response is complete, the messages disappear from the UI
 * - Refreshing the browser brings the messages back
 * - This happens reliably for new sessions but NOT for follow-up conversations
 *
 * Root cause: When the session transitions from 'running' to 'waiting',
 * ConversationTab refetches messages via fetchMessages() without passing
 * the active conversationId, causing the server to return messages for
 * the server-side active conversation (which may be misaligned with the
 * frontend's active conversation state).
 */

import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  navigateAndWait,
  waitForStatus,
  getSessionMessages,
  trackSession,
  getSession,
  BASE_URL,
  API_URL,
} from './helpers';

test.describe('Session Message Persistence After Response Completes', () => {
  // Real Claude API sessions need generous timeouts
  test.describe.configure({ timeout: 120000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Msg Persist Test', process.cwd());
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('new session messages remain visible after response completes', async ({ page }) => {
    // Step 1: Create a real session via API that starts immediately
    const session = await seedSession(project.id, {
      prompt: 'Reply with exactly: "Hello, persistence test complete." Nothing else.',
    });

    // Step 2: Navigate to the session page while it's running
    await page.goto(`${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForLoadState('networkidle');

    // Step 3: Wait for streaming content to appear in the UI
    // Either the streaming indicator or a committed assistant message should appear
    const streamingOrMessage = page.locator('.message-streaming, [data-testid="message-assistant"]');
    await expect(streamingOrMessage.first()).toBeVisible({ timeout: 60000 });

    // Step 4: Wait for the session to finish (reach 'waiting' status)
    await waitForStatus(session.id, 'waiting', 60000);

    // Step 5: Give the UI time to react to the status change
    // This is where the bug manifests — the running->waiting transition triggers
    // a message refetch that can clear the messages from the store
    await page.waitForTimeout(3000);

    // Step 6: THE CRITICAL ASSERTION — messages should still be visible
    const assistantMessages = page.locator('[data-testid="message-assistant"]');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 10000 });

    // Verify the assistant message has actual content (not empty)
    const messageContent = assistantMessages.first().locator('.message-content');
    await expect(messageContent).toBeVisible();
    const text = await messageContent.textContent();
    expect(text!.trim().length).toBeGreaterThan(0);

    // User message should also still be visible
    const userMessages = page.locator('[data-testid="message-user"]');
    await expect(userMessages.first()).toBeVisible({ timeout: 5000 });
  });

  test('new session created via UI retains messages after response completes', async ({ page }) => {
    // Step 1: Navigate to the new session form
    await page.goto(`${BASE_URL}/projects/${project.id}/sessions/new`);
    await page.waitForLoadState('networkidle');

    // Step 2: Fill in the prompt and submit
    const prompt = 'Reply with exactly: "UI creation persistence test." Nothing else.';
    await page.fill('textarea[id="prompt"]', prompt);
    await page.click('button:has-text("Start Session")');

    // Step 3: Wait for redirect to the actual session detail page (not /sessions/new)
    // Session IDs are UUIDs, so require at least one hyphen-separated hex group
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f]{8}-/, { timeout: 30000 });

    // Extract session ID from URL for cleanup tracking
    const url = page.url();
    const sessionId = url.match(/\/sessions\/([0-9a-f-]{36})/)?.[1];
    expect(sessionId).toBeTruthy();
    trackSession(sessionId!);

    // Navigate to conversation tab (default is now summary tab)
    await page.goto(`${BASE_URL}/sessions/${sessionId}/conversation`);
    await page.waitForLoadState('networkidle');

    // Step 4: Wait for the session to complete
    // The session runs via the real Claude API
    await waitForStatus(sessionId!, 'waiting', 60000);

    // Step 5: Give the UI time to process the status change
    // This is where the bug manifests — the running->waiting transition triggers
    // a message refetch that can cause messages to disappear
    await page.waitForTimeout(3000);

    // Step 6: Verify messages exist in the API (ground truth)
    const apiMessages = await getSessionMessages(sessionId!);
    const apiAssistant = apiMessages.filter((m: any) => m.role === 'assistant');
    expect(apiAssistant.length).toBeGreaterThan(0);

    // Step 7: THE CRITICAL ASSERTION — messages should be visible in the UI
    // The bug causes these to be missing even though the API has them
    const assistantMessages = page.locator('[data-testid="message-assistant"]');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 10000 });

    const messageContent = assistantMessages.first().locator('.message-content');
    await expect(messageContent).toBeVisible();
    const text = await messageContent.textContent();
    expect(text!.trim().length).toBeGreaterThan(0);

    // User message should also still be visible
    const userMessages = page.locator('[data-testid="message-user"]');
    await expect(userMessages.first()).toBeVisible({ timeout: 5000 });
  });

  test('message count before refresh matches after refresh', async ({ page }) => {
    // This test captures the exact symptom: messages disappear but reappear on refresh

    // Step 1: Create and start a real session
    const session = await seedSession(project.id, {
      prompt: 'Reply with exactly: "Refresh comparison test." Nothing else.',
    });

    // Step 2: Navigate to the session page
    await page.goto(`${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForLoadState('networkidle');

    // Step 3: Wait for the session to complete
    await waitForStatus(session.id, 'waiting', 60000);

    // Step 4: Wait for the UI to settle after the status transition
    await page.waitForTimeout(3000);

    // Step 5: Record message counts BEFORE refresh
    const assistantCountBefore = await page.locator('[data-testid="message-assistant"]').count();
    const userCountBefore = await page.locator('[data-testid="message-user"]').count();

    // Step 6: Refresh the page
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Step 7: Record message counts AFTER refresh
    const assistantCountAfter = await page.locator('[data-testid="message-assistant"]').count();
    const userCountAfter = await page.locator('[data-testid="message-user"]').count();

    // Step 8: Verify API has messages (ground truth)
    const apiMessages = await getSessionMessages(session.id);
    const apiAssistant = apiMessages.filter((m: any) => m.role === 'assistant');
    const apiUser = apiMessages.filter((m: any) => m.role === 'user');
    expect(apiAssistant.length).toBeGreaterThan(0);
    expect(apiUser.length).toBeGreaterThan(0);

    // After refresh should show all messages
    expect(assistantCountAfter).toBe(apiAssistant.length);
    expect(userCountAfter).toBe(apiUser.length);

    // THE KEY ASSERTION: Before refresh should match after refresh
    // If before=0 and after>0, the bug is confirmed
    expect(assistantCountBefore).toBe(assistantCountAfter);
    expect(userCountBefore).toBe(userCountAfter);
  });

  test('UI message count matches API after response completes', async ({ page }) => {
    // Cross-checks that the UI isn't silently dropping messages

    // Step 1: Create a real session
    const session = await seedSession(project.id, {
      prompt: 'Reply with exactly: "API cross-check test." Nothing else.',
    });

    // Step 2: Navigate and wait for completion
    await page.goto(`${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForLoadState('networkidle');
    await waitForStatus(session.id, 'waiting', 60000);

    // Step 3: Wait for UI to process the status change
    await page.waitForTimeout(3000);

    // Step 4: Count messages in the UI
    const uiAssistantCount = await page.locator('[data-testid="message-assistant"]').count();
    const uiUserCount = await page.locator('[data-testid="message-user"]').count();

    // Step 5: Get ground truth from API
    const apiMessages = await getSessionMessages(session.id);
    const apiAssistantCount = apiMessages.filter((m: any) => m.role === 'assistant').length;
    const apiUserCount = apiMessages.filter((m: any) => m.role === 'user').length;

    // API should have messages
    expect(apiAssistantCount).toBeGreaterThan(0);
    expect(apiUserCount).toBeGreaterThan(0);

    // UI should match API — no messages lost
    expect(uiAssistantCount).toBe(apiAssistantCount);
    expect(uiUserCount).toBe(apiUserCount);
  });
});
