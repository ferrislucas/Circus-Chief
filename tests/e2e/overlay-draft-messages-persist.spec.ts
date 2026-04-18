import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
  updateSessionStatus,
  seedUserMessage,
  seedAssistantMessage,
  getConversations,
  API_URL,
} from './helpers';

/**
 * Regression test for: conversation disappears in overlay after draft session
 * completes its first turn.
 *
 * Scenario:
 * 1. Create a draft child session (startImmediately: false, no assistant messages).
 * 2. Open the session tree overlay on the parent session.
 * 3. Switch to the draft child session in the overlay.
 * 4. Simulate starting the draft (transition to running, add messages, transition to waiting).
 * 5. Verify messages remain visible after the session finishes its turn.
 *
 * The bug: after the session transitions running → waiting, the ConversationMessages
 * component re-evaluates `isDraft` and hides messages because it still thinks the
 * session is a draft (hasResponses not updated or currentSession stale).
 */
test.describe('Overlay: draft session messages persist after completion', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;
  let draftChild: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Overlay Draft Persist', '/tmp/overlay-draft-persist');

    // Create a parent session (non-draft, already has responses)
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parentSession.id);
    // Force parent to waiting so it's idle
    await updateSessionStatus(parentSession.id, 'waiting');

    // Create a draft child session (startImmediately: false → status=waiting, no responses)
    draftChild = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Draft child task',
      name: 'Draft Child',
    });
    await waitForSessionToExist(draftChild.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  async function openOverlay(page: any, sessionId: string) {
    await navigateAndWait(page, `/sessions/${sessionId}`, {
      waitFor: '.session-detail',
      timeout: 20000,
    });
    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();
    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    // Wait for slide-in animation to complete (300ms + buffer)
    await page.waitForTimeout(400);
    return overlay;
  }

  async function switchToChildInOverlay(page: any, overlay: any) {
    const dropdown = overlay.locator('[data-testid="session-tree-dropdown"]');
    await expect(dropdown).toBeVisible({ timeout: 10000 });
    await dropdown.locator('.dropdown-trigger').click();

    const picker = page.locator('[data-testid="session-chat-picker"]');
    await expect(picker).toBeVisible({ timeout: 5000 });

    // Click the child session (second item in the picker)
    const items = picker.locator('[role="option"]');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(2);
    // Find the item containing the child session name
    const childItem = items.filter({ hasText: 'Draft Child' });
    await childItem.click();

    // Picker should close after selection
    await expect(picker).not.toBeVisible({ timeout: 5000 });
  }

  test('messages remain visible after draft session completes first turn in overlay', async ({ page }) => {
    // Step 1: Open overlay on parent session
    const overlay = await openOverlay(page, parentSession.id);

    // Step 2: Switch to the draft child session in the overlay
    await switchToChildInOverlay(page, overlay);

    // Allow the overlay to load the child session data
    await page.waitForTimeout(1000);

    // Step 3: Get the child's conversation ID for seeding messages
    const conversations = await getConversations(draftChild.id);
    expect(conversations.length).toBeGreaterThanOrEqual(1);
    const conversationId = conversations[0].id;

    // Step 4: Simulate the draft being started → running
    // First seed a user message (as the draft start would create one)
    seedUserMessage(draftChild.id, 'Draft child task', conversationId);

    // Transition to running
    await updateSessionStatus(draftChild.id, 'running');

    // Wait for the UI to pick up the running status
    await page.waitForTimeout(500);

    // Step 5: Simulate the agent completing - add an assistant message
    seedAssistantMessage(
      draftChild.id,
      'I have completed the draft child task. Here are the results of my work.',
      'claude-sonnet-4-20250514',
      conversationId
    );

    // Step 6: Transition from running → waiting (agent turn complete)
    await updateSessionStatus(draftChild.id, 'waiting');

    // Wait for the UI to process the status change and re-fetch messages
    await page.waitForTimeout(2000);

    // Step 7: Verify that messages are visible in the overlay
    // The bug: messages disappear because the session is still seen as a "draft"
    // after returning to waiting status.
    const assistantMessages = overlay.locator('[data-testid="message-assistant"]');
    const userMessages = overlay.locator('[data-testid="message-user"]');

    // At minimum, the assistant response should be visible
    await expect(assistantMessages.first()).toBeVisible({ timeout: 10000 });

    // The user message should also be visible
    await expect(userMessages.first()).toBeVisible({ timeout: 5000 });

    // Verify the actual content is there
    await expect(overlay.locator('.message-content').filter({ hasText: 'completed the draft child task' })).toBeVisible({ timeout: 5000 });
  });

  test('messages visible after draft started from overlay input form and session completes', async ({ page }) => {
    // Step 1: Open overlay on parent session
    const overlay = await openOverlay(page, parentSession.id);

    // Step 2: Switch to draft child in overlay
    await switchToChildInOverlay(page, overlay);

    // Allow the overlay to load
    await page.waitForTimeout(1000);

    // Step 3: Verify the draft child session shows the input form
    // (Draft sessions show the prompt in the input field)
    const textarea = overlay.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Step 4: Get conversation for seeding
    const conversations = await getConversations(draftChild.id);
    const conversationId = conversations[0].id;

    // Step 5: Simulate the full lifecycle:
    // a) User message created, session transitions to running
    seedUserMessage(draftChild.id, 'Draft child task', conversationId);
    await updateSessionStatus(draftChild.id, 'running');
    await page.waitForTimeout(500);

    // b) Assistant responds
    seedAssistantMessage(
      draftChild.id,
      'Task completed successfully with all changes applied.',
      'claude-sonnet-4-20250514',
      conversationId
    );

    // c) Session returns to waiting
    await updateSessionStatus(draftChild.id, 'waiting');

    // Wait for UI to update
    await page.waitForTimeout(2000);

    // Step 6: Verify messages are still shown (not hidden by isDraft check)
    const messageItems = overlay.locator('[data-testid="message-user"], [data-testid="message-assistant"]');
    const messageCount = await messageItems.count();

    // Should have at least 2 messages (user + assistant)
    expect(messageCount).toBeGreaterThanOrEqual(2);

    // Verify assistant message content is readable
    await expect(
      overlay.locator('.message-content').filter({ hasText: 'Task completed successfully' })
    ).toBeVisible({ timeout: 5000 });
  });
});
