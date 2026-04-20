import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedConversationHistory,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
  waitForSessionStatus,
  updateSessionStatus,
} from './helpers';
import { API_READY } from './timeouts';

test.describe('scroll-to-bottom button', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    project = await seedProject('Scroll Bottom Test', '/tmp/scroll-bottom');
    session = await seedSession(project.id, {
      prompt: 'Scroll-bottom prompt',
      name: 'Scroll Bottom Session',
    });
    await waitForSessionToExist(session.id);
    // Seed enough messages to force scrolling in both overlay and non-overlay.
    seedConversationHistory(session.id, 30);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  // Note: The non-overlay SessionDetailView no longer renders the conversation —
  // conversation only appears inside the SessionChatOverlay. Scroll-to-bottom
  // behavior in the standard (non-overlay) session view is covered by the
  // ConversationTab unit tests in `packages/web/src/components/ConversationTab.test.js`.

  test('overlay session view: button appears after scrolling up and hides after clicking', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();

    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    // Wait for slide-in animation to complete and auto-scroll to settle.
    await page.waitForTimeout(1000);

    const body = overlay.locator('.overlay-body');
    const btn = overlay.locator('[data-testid="scroll-to-bottom-btn"]');

    // Near bottom → button hidden.
    await expect(btn).toHaveCount(0);

    // Scroll the overlay body to the top.
    await body.evaluate((el) => {
      (el as HTMLElement).scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });

    await expect(btn).toBeVisible({ timeout: 5000 });

    // Click and confirm we're back at the bottom and the button hides.
    await btn.click();
    await expect(btn).toHaveCount(0, { timeout: 5000 });

    const distanceFromBottom = await body.evaluate((el) => {
      const h = el as HTMLElement;
      return h.scrollHeight - h.scrollTop - h.clientHeight;
    });
    expect(distanceFromBottom).toBeLessThan(100);
  });

  test('both scroll-to-bottom and scroll-to-claude buttons can render together in the overlay', async ({ page }) => {
    // Make it the user's turn so scroll-to-claude is eligible.
    await updateSessionStatus(session.id, 'waiting');
    await waitForSessionStatus(session.id, 'waiting', API_READY);

    await navigateAndWait(page, `/sessions/${session.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();

    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000);

    const body = overlay.locator('.overlay-body');

    // Scroll up so the scroll-to-bottom button appears.
    await body.evaluate((el) => {
      (el as HTMLElement).scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });

    const toBottomBtn = overlay.locator('[data-testid="scroll-to-bottom-btn"]');
    const toClaudeBtn = overlay.locator('.scroll-to-claude-btn');

    await expect(toBottomBtn).toBeVisible({ timeout: 5000 });
    await expect(toClaudeBtn).toBeVisible({ timeout: 5000 });

    // Both buttons should live in the .conversation-scroll-actions wrapper.
    const wrapperCount = await overlay.locator('.conversation-scroll-actions').count();
    expect(wrapperCount).toBeGreaterThanOrEqual(1);

    // The scroll-to-bottom button should remain clickable even with both rendered.
    await toBottomBtn.click();
    await expect(toBottomBtn).toHaveCount(0, { timeout: 5000 });
  });
});
