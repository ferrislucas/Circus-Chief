import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedConversationHistory,
  cleanupCreatedResources,
  navigateAndWait,
  navigateAndOpenOverlay,
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
    // Seed enough messages to force scrolling in the overlay.
    seedConversationHistory(session.id, 30);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  // Note: The non-overlay SessionDetailView no longer renders the conversation —
  // conversation only appears inside the SessionChatOverlay. Scroll-to-bottom
  // behavior for the conversation is exercised by the ConversationTab unit tests
  // in `packages/web/src/components/ConversationTab.test.js`.

  test('overlay session view: button appears after scrolling up and hides after clicking', async ({ page }) => {
    // navigateAndOpenOverlay waits for [data-ready="true"] and .overlay-header
    // visibility — no arbitrary sleeps needed for the slide-in animation.
    const overlay = await navigateAndOpenOverlay(page, `/sessions/${session.id}`);

    const body = overlay.locator('.overlay-body');
    const btn = overlay.locator('[data-testid="scroll-to-bottom-btn"]');

    // Wait for the overlay's initial latest-agent-turn scroll to settle.
    await expect
      .poll(
        async () =>
          body.evaluate((el) => {
            const h = el as HTMLElement;
            return h.scrollTop;
          }),
        { timeout: 10000 },
      )
      .toBeGreaterThan(100);

    // Scroll the overlay body to the top.
    await body.evaluate((el) => {
      (el as HTMLElement).scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });

    await expect(btn).toBeVisible({ timeout: 5000 });

    const stickyOffset = await body.evaluate((el) => {
      const h = el as HTMLElement;
      const controls = h.querySelector('.conversation-controls-row');
      if (!controls) return null;
      const bodyRect = h.getBoundingClientRect();
      const controlsRect = controls.getBoundingClientRect();
      return Math.abs(controlsRect.bottom - bodyRect.bottom);
    });
    expect(stickyOffset).not.toBeNull();
    expect(stickyOffset!).toBeLessThanOrEqual(2);

    // Click and confirm the overlay scrolls down far enough that the button
    // disappears again.
    await btn.click();
    await expect(btn).toHaveCount(0, { timeout: 5000 });

    // Poll using the same "distance from target bottom" logic the composable uses:
    // - if a .btn-send-full is present, the scroll target is the send button's bottom
    //   edge aligned with the container bottom (distance ≈ 0)
    // - if no send button exists (e.g. 'starting' status), scroll target is the
    //   absolute bottom of the container (scrollHeight - scrollTop - clientHeight ≈ 0)
    // This covers both code paths regardless of what session status the E2E
    // environment resolves to by the time the button is clicked.
    await expect
      .poll(
        async () =>
          body.evaluate((el) => {
            const h = el as HTMLElement;
            const sendButton = h.querySelector('.btn-send-full') as HTMLElement | null;
            if (sendButton) {
              const containerRect = h.getBoundingClientRect();
              const buttonRect = sendButton.getBoundingClientRect();
              return Math.abs(buttonRect.bottom - containerRect.bottom);
            }
            return h.scrollHeight - h.scrollTop - h.clientHeight;
          }),
        { timeout: 5000 },
      )
      .toBeLessThan(100);
  });

  test('both scroll-to-bottom and scroll-to-claude buttons can render together in the overlay', async ({ page }) => {
    // Make it the user's turn so scroll-to-claude is eligible.
    await updateSessionStatus(session.id, 'waiting');
    await waitForSessionStatus(session.id, 'waiting', API_READY);

    const overlay = await navigateAndOpenOverlay(page, `/sessions/${session.id}`);

    const body = overlay.locator('.overlay-body');

    // Wait for the overlay's initial latest-agent-turn scroll to settle before
    // forcing our own scroll, otherwise our scrollTop=0 could race the
    // composable's scrollTo.
    await expect
      .poll(
        async () =>
          body.evaluate((el) => {
            const h = el as HTMLElement;
            return h.scrollTop;
          }),
        { timeout: 10000 },
      )
      .toBeGreaterThan(100);

    // Scroll up so the scroll-to-bottom button appears.
    await body.evaluate((el) => {
      (el as HTMLElement).scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });

    const toBottomBtn = overlay.locator('[data-testid="scroll-to-bottom-btn"]');
    const toClaudeBtn = overlay.locator('.scroll-to-claude-btn');

    await expect(toBottomBtn).toBeVisible({ timeout: 5000 });
    await expect(toClaudeBtn).toBeVisible({ timeout: 5000 });

    const controlsOffset = await body.evaluate((el) => {
      const h = el as HTMLElement;
      const controls = h.querySelector('.conversation-controls-row');
      if (!controls) return null;
      const bodyRect = h.getBoundingClientRect();
      const controlsRect = controls.getBoundingClientRect();
      return Math.abs(controlsRect.bottom - bodyRect.bottom);
    });
    expect(controlsOffset).not.toBeNull();
    expect(controlsOffset!).toBeLessThanOrEqual(2);

    // Both buttons should live in the .conversation-scroll-actions wrapper.
    const wrapperCount = await overlay.locator('.conversation-scroll-actions').count();
    expect(wrapperCount).toBeGreaterThanOrEqual(1);

    // The scroll-to-bottom button should remain clickable even with both rendered.
    await toBottomBtn.click();
    await expect(toBottomBtn).toHaveCount(0, { timeout: 5000 });
  });

  test('chat tab keeps scroll action buttons fixed while the page scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await updateSessionStatus(session.id, 'waiting');
    await waitForSessionStatus(session.id, 'waiting', API_READY);

    await navigateAndWait(page, `/sessions/${session.id}/chat`, {
      waitFor: '[data-testid="session-detail"][data-ready="true"]',
      timeout: 15000,
    });

    const actions = page.locator('.session-chat-content--embedded .conversation-scroll-actions');
    const toClaudeBtn = actions.locator('.scroll-to-claude-btn');
    await expect(toClaudeBtn).toBeVisible({ timeout: 5000 });

    await page.evaluate(() => {
      window.scrollTo(0, 0);
      window.dispatchEvent(new Event('scroll'));
    });

    const toBottomBtn = actions.locator('[data-testid="scroll-to-bottom-btn"]');
    await expect(toBottomBtn).toBeVisible({ timeout: 5000 });

    const before = await actions.boundingBox();
    expect(before).not.toBeNull();
    const position = await actions.evaluate((el) => window.getComputedStyle(el).position);
    expect(position).toBe('fixed');

    await page.evaluate(() => {
      window.scrollTo(0, Math.min(500, document.documentElement.scrollHeight));
      window.dispatchEvent(new Event('scroll'));
    });

    const after = await actions.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
  });
});
