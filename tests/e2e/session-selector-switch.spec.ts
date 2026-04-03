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
} from './helpers';

/**
 * Regression tests for the session selector in the SessionTreeOverlay.
 *
 * Bug: When switching sessions via the overlay picker, the UI showed a spinner
 * and then re-displayed the previous session's messages. The root cause was that
 * loadSessionData() did not fetch messages or work logs for the new session, and
 * switchToSession() did not clear stale messages from the store.
 *
 * These tests verify that selecting a different session in the picker causes the
 * correct conversation messages to appear in the overlay.
 */
test.describe('Session selector switches conversation content', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;
  let childA: any;
  let childB: any;

  // Conversation IDs populated in beforeEach after seeding messages
  let parentConvId: string;
  let childAConvId: string;
  let childBConvId: string;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Session Selector Test', '/tmp/session-selector-test');

    // Create parent with messages
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parentSession.id);
    await updateSessionStatus(parentSession.id, 'waiting');

    // Create child A with distinct messages
    childA = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child A prompt',
      name: 'Child A',
    });
    await waitForSessionToExist(childA.id);
    await updateSessionStatus(childA.id, 'waiting');

    // Create child B with distinct messages
    childB = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child B prompt',
      name: 'Child B',
    });
    await waitForSessionToExist(childB.id);
    await updateSessionStatus(childB.id, 'waiting');

    // Seed unique messages for each session so we can tell them apart
    const parentConvs = await getConversations(parentSession.id);
    parentConvId = parentConvs[0].id;
    seedUserMessage(parentSession.id, 'PARENT_USER_MSG_UNIQUE', parentConvId);
    seedAssistantMessage(parentSession.id, 'PARENT_ASSISTANT_MSG_UNIQUE', 'claude-sonnet-4-20250514', parentConvId);

    const childAConvs = await getConversations(childA.id);
    childAConvId = childAConvs[0].id;
    seedUserMessage(childA.id, 'CHILD_A_USER_MSG_UNIQUE', childAConvId);
    seedAssistantMessage(childA.id, 'CHILD_A_ASSISTANT_MSG_UNIQUE', 'claude-sonnet-4-20250514', childAConvId);

    const childBConvs = await getConversations(childB.id);
    childBConvId = childBConvs[0].id;
    seedUserMessage(childB.id, 'CHILD_B_USER_MSG_UNIQUE', childBConvId);
    seedAssistantMessage(childB.id, 'CHILD_B_ASSISTANT_MSG_UNIQUE', 'claude-sonnet-4-20250514', childBConvId);

    // Mark parent session as having responses so it doesn't show as draft
    await updateSessionStatus(parentSession.id, 'waiting');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  async function openOverlay(page: any, sessionId: string) {
    await navigateAndWait(page, `/sessions/${sessionId}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });
    const handle = page.locator('[data-testid="session-tree-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();
    const overlay = page.locator('[data-testid="session-tree-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    // Wait for slide-in animation to complete (300ms + buffer)
    await page.waitForTimeout(400);
    return overlay;
  }

  async function switchToSessionInOverlay(page: any, overlay: any, sessionName: string) {
    const dropdown = overlay.locator('[data-testid="session-tree-dropdown"]');
    await expect(dropdown).toBeVisible({ timeout: 10000 });
    await dropdown.locator('.dropdown-trigger').click();

    const picker = page.locator('[data-testid="session-tree-picker"]');
    await expect(picker).toBeVisible({ timeout: 5000 });

    const targetItem = picker.locator('[role="option"]').filter({ hasText: sessionName });
    await targetItem.click();

    // Picker should close after selection
    await expect(picker).not.toBeVisible({ timeout: 5000 });

    // Wait for session data to load (messages, conversations, etc.)
    await page.waitForTimeout(1500);
  }

  test('switching to a child session shows that child\'s messages', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    // Initially the overlay should show the parent session's auto-selected content
    // (it may auto-select a child, so let's switch explicitly to parent first)
    await switchToSessionInOverlay(page, overlay, 'Parent Session');

    // Verify parent messages are visible
    await expect(overlay.locator('.message-content').filter({ hasText: 'PARENT_ASSISTANT_MSG_UNIQUE' }))
      .toBeVisible({ timeout: 10000 });

    // Now switch to Child A
    await switchToSessionInOverlay(page, overlay, 'Child A');

    // Child A messages should now be visible
    await expect(overlay.locator('.message-content').filter({ hasText: 'CHILD_A_ASSISTANT_MSG_UNIQUE' }))
      .toBeVisible({ timeout: 10000 });

    // Parent messages should NOT be visible
    await expect(overlay.locator('.message-content').filter({ hasText: 'PARENT_ASSISTANT_MSG_UNIQUE' }))
      .not.toBeVisible({ timeout: 3000 });
  });

  test('switching between sibling sessions shows correct messages for each', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    // Switch to Child A
    await switchToSessionInOverlay(page, overlay, 'Child A');

    // Verify Child A content
    await expect(overlay.locator('.message-content').filter({ hasText: 'CHILD_A_ASSISTANT_MSG_UNIQUE' }))
      .toBeVisible({ timeout: 10000 });
    await expect(overlay.locator('.message-content').filter({ hasText: 'CHILD_B_ASSISTANT_MSG_UNIQUE' }))
      .not.toBeVisible({ timeout: 3000 });

    // Switch to Child B
    await switchToSessionInOverlay(page, overlay, 'Child B');

    // Verify Child B content now visible
    await expect(overlay.locator('.message-content').filter({ hasText: 'CHILD_B_ASSISTANT_MSG_UNIQUE' }))
      .toBeVisible({ timeout: 10000 });
    // Child A messages should no longer be visible
    await expect(overlay.locator('.message-content').filter({ hasText: 'CHILD_A_ASSISTANT_MSG_UNIQUE' }))
      .not.toBeVisible({ timeout: 3000 });
  });

  test('switching back to parent session restores parent messages', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    // Switch to Child A first
    await switchToSessionInOverlay(page, overlay, 'Child A');
    await expect(overlay.locator('.message-content').filter({ hasText: 'CHILD_A_ASSISTANT_MSG_UNIQUE' }))
      .toBeVisible({ timeout: 10000 });

    // Switch back to Parent
    await switchToSessionInOverlay(page, overlay, 'Parent Session');

    // Parent messages should be restored
    await expect(overlay.locator('.message-content').filter({ hasText: 'PARENT_ASSISTANT_MSG_UNIQUE' }))
      .toBeVisible({ timeout: 10000 });
    // Child A messages should be gone
    await expect(overlay.locator('.message-content').filter({ hasText: 'CHILD_A_ASSISTANT_MSG_UNIQUE' }))
      .not.toBeVisible({ timeout: 3000 });
  });

  test('dropdown shows correct session name after switching', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    // Switch to Child B
    await switchToSessionInOverlay(page, overlay, 'Child B');

    // The dropdown trigger should display the selected child's name
    const dropdownName = overlay.locator('.dropdown-name');
    await expect(dropdownName).toContainText('Child B', { timeout: 5000 });

    // The root name should still be the parent
    const rootName = overlay.locator('.overlay-root-name');
    await expect(rootName).toContainText('Parent Session', { timeout: 5000 });
  });

  test('rapid session switching settles on the last selected session', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    // Rapidly switch: Parent → Child A → Child B
    await switchToSessionInOverlay(page, overlay, 'Child A');
    // Don't wait long before switching again
    await switchToSessionInOverlay(page, overlay, 'Child B');

    // Final state should show Child B's content
    await expect(overlay.locator('.message-content').filter({ hasText: 'CHILD_B_ASSISTANT_MSG_UNIQUE' }))
      .toBeVisible({ timeout: 10000 });

    // Neither Parent nor Child A messages should be visible
    await expect(overlay.locator('.message-content').filter({ hasText: 'PARENT_ASSISTANT_MSG_UNIQUE' }))
      .not.toBeVisible({ timeout: 3000 });
    await expect(overlay.locator('.message-content').filter({ hasText: 'CHILD_A_ASSISTANT_MSG_UNIQUE' }))
      .not.toBeVisible({ timeout: 3000 });
  });
});
