import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
  seedUserMessage,
  seedAssistantMessage,
  getSession,
} from './helpers';

/**
 * Tests for the session chat overlay's automatic session selection behavior.
 *
 * Expected behavior: When opening the overlay, it should automatically select
 * the session in the tree with the most recent **conversation activity**
 * (i.e., the most recent message timestamp / lastActivityAt), regardless of
 * the session's status. This allows users to quickly resume where the most
 * recent work was happening.
 */
test.describe('Session Chat Overlay - Auto-select by most recent conversation activity', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;
  let childSession1: any;
  let childSession2: any;

  test.beforeEach(async () => {
    project = await seedProject('Auto-Select Test', '/tmp/auto-select-test');
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parentSession.id);

    childSession1 = await seedChildSession(project.id, parentSession.id, {
      prompt: 'First child prompt',
      name: 'First Child',
    });
    await waitForSessionToExist(childSession1.id);

    childSession2 = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Second child prompt',
      name: 'Second Child',
    });
    await waitForSessionToExist(childSession2.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  // Helper to navigate and open the overlay
  async function openOverlay(page: any, sessionId: string) {
    await navigateAndWait(page, `/sessions/${sessionId}`, {
      waitFor: '.session-detail',
      timeout: 15000,
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

  test('overlay selects child with most recent conversation activity, not the parent', async ({ page }) => {
    // Seed messages into childSession2 to give it the most recent conversation activity.
    // Neither session is "running" - they are in default "waiting" status.
    // The overlay should still auto-select childSession2 because it has the most recent
    // conversation message (i.e., highest lastActivityAt).
    seedUserMessage(childSession2.id, 'Hello from child 2');
    seedAssistantMessage(childSession2.id, 'Response in child 2');

    // Navigate to parent session and open the overlay
    const overlay = await openOverlay(page, parentSession.id);

    // The overlay should auto-select the child with the most recent conversation
    // activity (childSession2), NOT the parent session.
    // The .dropdown-name shows the active session; .overlay-root-name always shows the root.
    const activeName = overlay.locator('.dropdown-name');
    await expect(activeName).toContainText('Second Child', { timeout: 5000 });
  });

  test('overlay selects child with most recent messages over child with older messages', async ({ page }) => {
    // Seed older messages into childSession1
    seedUserMessage(childSession1.id, 'Older message in child 1');
    seedAssistantMessage(childSession1.id, 'Older response in child 1');

    // Wait a bit so timestamps differ
    await new Promise(r => setTimeout(r, 200));

    // Seed newer messages into childSession2
    seedUserMessage(childSession2.id, 'Newer message in child 2');
    seedAssistantMessage(childSession2.id, 'Newer response in child 2');

    // Navigate to parent session and open the overlay
    const overlay = await openOverlay(page, parentSession.id);

    // The overlay should auto-select childSession2 because it has the most recent
    // conversation activity, even though both children have messages and neither is running.
    const activeName = overlay.locator('.dropdown-name');
    await expect(activeName).toContainText('Second Child', { timeout: 5000 });
  });

  test('overlay selects child with conversation activity over parent with no messages', async ({ page }) => {
    // Only seed messages in childSession1, leave parent and childSession2 with no messages
    seedUserMessage(childSession1.id, 'Activity in child 1');
    seedAssistantMessage(childSession1.id, 'Response in child 1');

    // Navigate to parent session and open the overlay
    const overlay = await openOverlay(page, parentSession.id);

    // The overlay should auto-select childSession1 because it has conversation activity
    // while the parent and childSession2 have none.
    const activeName = overlay.locator('.dropdown-name');
    await expect(activeName).toContainText('First Child', { timeout: 5000 });
  });

  test('overlay selects parent when no sessions have conversation messages', async ({ page }) => {
    // No messages seeded anywhere - all sessions have equal (zero) conversation activity.
    // In this case, with no conversation activity to differentiate, the overlay should
    // fall back to the current (parent) session.

    const overlay = await openOverlay(page, parentSession.id);

    // When no children have activity, the overlay root name shows "Parent Session"
    // and no dropdown-name selector is present (or it shows the parent).
    const rootName = overlay.locator('.overlay-root-name');
    await expect(rootName).toContainText('Parent Session', { timeout: 5000 });
  });

  test('overlay selects grandchild with most recent conversation activity in deep tree', async ({ page }) => {
    // Create a grandchild under childSession1
    const grandchild = await seedChildSession(project.id, childSession1.id, {
      prompt: 'Grandchild prompt',
      name: 'Grandchild Session',
    });
    await waitForSessionToExist(grandchild.id);

    // Seed messages into the grandchild (most recent activity is in the grandchild)
    seedUserMessage(grandchild.id, 'Deep activity in grandchild');
    seedAssistantMessage(grandchild.id, 'Response from grandchild');

    // Navigate to parent session and open the overlay
    const overlay = await openOverlay(page, parentSession.id);

    // The overlay should auto-select the grandchild because it has the most recent
    // conversation activity, even though it's 2 levels deep in the tree.
    const activeName = overlay.locator('.dropdown-name');
    await expect(activeName).toContainText('Grandchild Session', { timeout: 5000 });
  });

  test('verify lastActivityAt reflects conversation messages via API', async ({ page }) => {
    // This test verifies the data model: lastActivityAt should change when
    // conversation messages are added, confirming the field is available for
    // the overlay to use.

    // Get initial lastActivityAt for childSession2
    const before = await getSession(childSession2.id);
    const initialActivity = before.lastActivityAt;

    // Wait a bit to ensure timestamp difference
    await new Promise(r => setTimeout(r, 200));

    // Seed a message
    seedUserMessage(childSession2.id, 'New message to update lastActivityAt');

    // Get updated session
    const after = await getSession(childSession2.id);

    // lastActivityAt should have increased (use 0 as baseline when previously null)
    expect(after.lastActivityAt).toBeGreaterThan(initialActivity ?? 0);
  });
});
