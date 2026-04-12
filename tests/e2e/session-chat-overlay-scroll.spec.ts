import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  seedConversationHistory,
  seedConversationTokens,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
  updateSessionStatus,
} from './helpers';

test.describe('Session Chat Overlay Scroll Behavior', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;

  test.beforeEach(async () => {
    project = await seedProject('Overlay Scroll Test', '/tmp/overlay-scroll');
    parentSession = await seedSession(project.id, {
      prompt: 'Parent prompt',
      name: 'Scroll Parent',
    });
    await waitForSessionToExist(parentSession.id);
    // Seed enough messages to force scrolling
    seedConversationHistory(parentSession.id, 30);
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
    // Wait for slide-in animation to complete
    await page.waitForTimeout(400);
    return overlay;
  }

  test('overlay auto-scrolls near conversation bottom on open', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    // Wait for messages to render and auto-scroll to complete
    await page.waitForTimeout(1000);

    // Check that .overlay-body is scrolled near the bottom, not stuck at top
    const scrollInfo = await page.evaluate(() => {
      const body = document.querySelector('.overlay-body');
      if (!body) return null;
      return {
        scrollTop: body.scrollTop,
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
      };
    });

    expect(scrollInfo).not.toBeNull();
    // scrollTop should be significantly above 0 (not stuck at top)
    expect(scrollInfo!.scrollTop).toBeGreaterThan(100);
    // Should be near the bottom
    const distanceFromBottom = scrollInfo!.scrollHeight - scrollInfo!.scrollTop - scrollInfo!.clientHeight;
    expect(distanceFromBottom).toBeLessThan(200);
  });

  test('scroll-to-claude button is visible and functional in overlay', async ({ page }) => {
    // Set session to waiting so the scroll-to-claude button appears
    await updateSessionStatus(parentSession.id, 'waiting');

    const overlay = await openOverlay(page, parentSession.id);
    await page.waitForTimeout(1000);

    // The scroll-to-claude button shows when at bottom and it's user's turn
    const scrollBtn = overlay.locator('.scroll-to-claude-btn');
    await expect(scrollBtn).toBeVisible({ timeout: 5000 });

    // Click the scroll-to-claude button - it should execute without error
    // (The button scrolls to the last assistant message. Since we auto-scrolled
    // to the bottom on open, the position may not change much, but the button
    // must actually trigger a scroll action on the correct container)
    await scrollBtn.click();
    await page.waitForTimeout(500);

    // Verify the overlay-body scroll position is meaningful (not stuck at 0)
    const scrollInfo = await page.evaluate(() => {
      const body = document.querySelector('.overlay-body');
      if (!body) return null;
      return {
        scrollTop: body.scrollTop,
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
      };
    });

    expect(scrollInfo).not.toBeNull();
    // After scrollToClaudesTurn, scrollTop should be > 0 (not stuck at top)
    expect(scrollInfo!.scrollTop).toBeGreaterThan(0);
    // The scroll container should actually be scrollable
    expect(scrollInfo!.scrollHeight).toBeGreaterThan(scrollInfo!.clientHeight + 100);
  });

  test('overlay body is scrollable when content exceeds viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 800 });
    const overlay = await openOverlay(page, parentSession.id);
    await page.waitForTimeout(1000);

    // .overlay-body should be the scrollable container
    const scrollInfo = await page.evaluate(() => {
      const body = document.querySelector('.overlay-body');
      if (!body) return null;
      const style = window.getComputedStyle(body);
      return {
        overflowY: style.overflowY,
        isScrollable: body.scrollHeight > body.clientHeight + 100,
        clientHeight: body.clientHeight,
      };
    });

    expect(scrollInfo).not.toBeNull();
    expect(scrollInfo!.overflowY).toBe('auto');
    expect(scrollInfo!.isScrollable).toBe(true);
    expect(scrollInfo!.clientHeight).toBeGreaterThan(300);
  });

  test('overlay auto-scrolls after switching to child session', async ({ page }) => {
    // Create a child with its own conversation history
    const child = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child prompt',
      name: 'Scroll Child',
    });
    await waitForSessionToExist(child.id);
    seedConversationHistory(child.id, 20);

    const overlay = await openOverlay(page, parentSession.id);
    await page.waitForTimeout(1000);

    // Open picker and switch to child
    const dropdown = overlay.locator('[data-testid="session-tree-dropdown"]');
    await expect(dropdown).toBeVisible({ timeout: 10000 });
    await dropdown.locator('.dropdown-trigger').click();
    const picker = page.locator('[data-testid="session-chat-picker"]');
    await expect(picker).toBeVisible({ timeout: 5000 });
    const items = picker.locator('[role="option"]');
    await items.nth(1).click();
    await expect(picker).not.toBeVisible({ timeout: 5000 });

    // Wait for child session messages to render and scroll
    await page.waitForTimeout(1500);

    // Verify auto-scrolled near bottom for the child's conversation
    const scrollInfo = await page.evaluate(() => {
      const body = document.querySelector('.overlay-body');
      if (!body) return null;
      return {
        scrollTop: body.scrollTop,
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
      };
    });

    expect(scrollInfo).not.toBeNull();
    expect(scrollInfo!.scrollTop).toBeGreaterThan(100);
  });

  test('scroll-to-claude button is visible, tappable, and functional at mobile viewport (no cost panel)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
    await updateSessionStatus(parentSession.id, 'waiting');

    const overlay = await openOverlay(page, parentSession.id);

    const scrollBtn = overlay.locator('.scroll-to-claude-btn');
    await expect(scrollBtn).toBeVisible({ timeout: 5000 });

    // Wait for layout to settle by polling boundingBox until stable.
    await expect.poll(async () => (await scrollBtn.boundingBox())?.width || 0).toBeGreaterThanOrEqual(44);

    const btnBox = await scrollBtn.boundingBox();
    expect(btnBox).not.toBeNull();
    if (!btnBox) throw new Error('btnBox is null');

    // 1. Tap target ≥ 44×44 (Apple/WCAG mobile guideline).
    expect(btnBox.width).toBeGreaterThanOrEqual(44);
    expect(btnBox.height).toBeGreaterThanOrEqual(44);

    // 2. The button must lie inside the viewport.
    expect(btnBox.x).toBeGreaterThanOrEqual(0);
    expect(btnBox.y).toBeGreaterThanOrEqual(0);
    expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(375);
    expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(667);

    // 3. The button must lie inside .overlay-body bounds (not horizontally clipped).
    const bodyBox = await overlay.locator('.overlay-body').boundingBox();
    expect(bodyBox).not.toBeNull();
    if (!bodyBox) throw new Error('bodyBox is null');
    expect(btnBox.x).toBeGreaterThanOrEqual(bodyBox.x);
    expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(bodyBox.x + bodyBox.width);

    // 4. The button must NOT overlap .input-form.
    const inputBox = await overlay.locator('.input-form').boundingBox();
    if (inputBox) {
      const overlapsHoriz = btnBox.x < inputBox.x + inputBox.width && btnBox.x + btnBox.width > inputBox.x;
      const overlapsVert  = btnBox.y < inputBox.y + inputBox.height && btnBox.y + btnBox.height > inputBox.y;
      expect(overlapsHoriz && overlapsVert).toBe(false);
    }

    // 5. The button must be the topmost element at its centerpoint (z-index correctness).
    const topElementMatchesButton = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return !!(el && (el.classList.contains('scroll-to-claude-btn') || el.closest('.scroll-to-claude-btn')));
    }, { x: btnBox.x + btnBox.width / 2, y: btnBox.y + btnBox.height / 2 });
    expect(topElementMatchesButton).toBe(true);

    // 6. The button must remain visible after the user scrolls .overlay-body to the top.
    await overlay.locator('.overlay-body').evaluate((el) => { (el as HTMLElement).scrollTop = 0; });
    await expect(scrollBtn).toBeVisible();
    const btnBoxAfterScroll = await scrollBtn.boundingBox();
    expect(btnBoxAfterScroll).not.toBeNull();
    if (!btnBoxAfterScroll) throw new Error('btnBoxAfterScroll is null');
    expect(btnBoxAfterScroll.y + btnBoxAfterScroll.height).toBeLessThanOrEqual(667);

    // 7. Clicking the button actually scrolls .overlay-body (functional check).
    const beforeScroll = await overlay.locator('.overlay-body').evaluate((el) => (el as HTMLElement).scrollTop);
    await scrollBtn.click();
    await expect.poll(
      async () => overlay.locator('.overlay-body').evaluate((el) => (el as HTMLElement).scrollTop)
    ).not.toBe(beforeScroll);
  });

  test('scroll-to-claude button is visible and tappable at 320×568', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await updateSessionStatus(parentSession.id, 'waiting');
    const overlay = await openOverlay(page, parentSession.id);
    const scrollBtn = overlay.locator('.scroll-to-claude-btn');
    await expect(scrollBtn).toBeVisible({ timeout: 5000 });
    await expect.poll(async () => (await scrollBtn.boundingBox())?.width || 0).toBeGreaterThanOrEqual(44);
    const btnBox = await scrollBtn.boundingBox();
    expect(btnBox).not.toBeNull();
    if (!btnBox) throw new Error('btnBox is null');
    expect(btnBox.width).toBeGreaterThanOrEqual(44);
    expect(btnBox.height).toBeGreaterThanOrEqual(44);
    expect(btnBox.x).toBeGreaterThanOrEqual(0);
    expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(320);
    expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(568);
  });

  test('scroll-to-claude button is visible and tappable at iPad viewport (768×1024)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await updateSessionStatus(parentSession.id, 'waiting');
    const overlay = await openOverlay(page, parentSession.id);
    const scrollBtn = overlay.locator('.scroll-to-claude-btn');
    await expect(scrollBtn).toBeVisible({ timeout: 5000 });
    await expect.poll(async () => (await scrollBtn.boundingBox())?.width || 0).toBeGreaterThanOrEqual(44);
    const btnBox = await scrollBtn.boundingBox();
    expect(btnBox).not.toBeNull();
    if (!btnBox) throw new Error('btnBox is null');
    expect(btnBox.width).toBeGreaterThanOrEqual(44);
    expect(btnBox.height).toBeGreaterThanOrEqual(44);
    expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(768);
    expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(1024);
  });

  test('scroll-to-claude button is visible, tappable, and functional at mobile viewport (cost panel rendered)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await updateSessionStatus(parentSession.id, 'waiting');
    // Seed token usage on the active conversation so TokenCostPanel renders
    seedConversationTokens(parentSession.id, null, { inputTokens: 1000, outputTokens: 500 });

    const overlay = await openOverlay(page, parentSession.id);
    const tokenPanel = overlay.locator('.token-cost-panel');
    await expect(tokenPanel).toBeVisible({ timeout: 5000 });

    const scrollBtn = overlay.locator('.scroll-to-claude-btn');
    await expect(scrollBtn).toBeVisible({ timeout: 5000 });
    await expect.poll(async () => (await scrollBtn.boundingBox())?.width || 0).toBeGreaterThanOrEqual(44);

    const btnBox = await scrollBtn.boundingBox();
    expect(btnBox).not.toBeNull();
    if (!btnBox) throw new Error('btnBox is null');

    // Same assertions as the no-cost case: 44×44, in viewport, in .overlay-body, no .input-form overlap, topmost.
    expect(btnBox.width).toBeGreaterThanOrEqual(44);
    expect(btnBox.height).toBeGreaterThanOrEqual(44);
    expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(375);
    expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(667);
    const bodyBox = await overlay.locator('.overlay-body').boundingBox();
    expect(bodyBox).not.toBeNull();
    if (!bodyBox) throw new Error('bodyBox is null');
    expect(btnBox.x).toBeGreaterThanOrEqual(bodyBox.x);
    expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(bodyBox.x + bodyBox.width);
    const inputBox = await overlay.locator('.input-form').boundingBox();
    if (inputBox) {
      const overlapsHoriz = btnBox.x < inputBox.x + inputBox.width && btnBox.x + btnBox.width > inputBox.x;
      const overlapsVert  = btnBox.y < inputBox.y + inputBox.height && btnBox.y + btnBox.height > inputBox.y;
      expect(overlapsHoriz && overlapsVert).toBe(false);
    }

    // Functional click.
    const beforeScroll = await overlay.locator('.overlay-body').evaluate((el) => (el as HTMLElement).scrollTop);
    await scrollBtn.click();
    await expect.poll(
      async () => overlay.locator('.overlay-body').evaluate((el) => (el as HTMLElement).scrollTop)
    ).not.toBe(beforeScroll);
  });
});

test.describe('Session Chat Overlay Input Anchoring', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    project = await seedProject('Overlay Anchor Test', '/tmp/overlay-anchor');
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
    // Wait for slide-in animation to complete
    await page.waitForTimeout(400);
    return overlay;
  }

  test('input form is anchored near the bottom of overlay with few messages', async ({ page }) => {
    session = await seedSession(project.id, {
      prompt: 'Anchor test prompt',
      name: 'Anchor Test',
    });
    await waitForSessionToExist(session.id);
    // Only 3 messages — not enough to cause scrolling
    seedConversationHistory(session.id, 3);
    await updateSessionStatus(session.id, 'waiting');

    const overlay = await openOverlay(page, session.id);

    // Wait for input form to render (status is 'waiting' so canSendMessage is true)
    const inputForm = overlay.locator('.input-form');
    await expect(inputForm).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Measure the input-form position relative to overlay-body
    const positions = await page.evaluate(() => {
      const inputForm = document.querySelector('.input-form');
      const overlayBody = document.querySelector('.overlay-body');
      if (!inputForm || !overlayBody) return null;
      const inputRect = inputForm.getBoundingClientRect();
      const bodyRect = overlayBody.getBoundingClientRect();
      return {
        inputBottom: inputRect.bottom,
        bodyBottom: bodyRect.bottom,
        bodyHeight: bodyRect.height,
      };
    });

    expect(positions).not.toBeNull();
    // The input form's bottom should be within 100px of the overlay body's bottom
    // (anchored at bottom, not floating mid-screen)
    const gap = positions!.bodyBottom - positions!.inputBottom;
    expect(gap).toBeLessThan(100);
  });

  test('input form flows naturally after messages when many messages exist', async ({ page }) => {
    session = await seedSession(project.id, {
      prompt: 'Many messages prompt',
      name: 'Many Messages',
    });
    await waitForSessionToExist(session.id);
    seedConversationHistory(session.id, 50);
    await updateSessionStatus(session.id, 'waiting');

    const overlay = await openOverlay(page, session.id);

    // Wait for input form and messages to render
    const inputForm = overlay.locator('.input-form');
    await expect(inputForm).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Scroll to bottom of .overlay-body
    await page.evaluate(() => {
      const body = document.querySelector('.overlay-body');
      if (body) body.scrollTop = body.scrollHeight;
    });
    await page.waitForTimeout(500);

    // No excessive gap between last message and input form
    const gapInfo = await page.evaluate(() => {
      const messages = document.querySelectorAll('[data-testid="message-user"], [data-testid="message-assistant"]');
      const inputForm = document.querySelector('.input-form');
      if (!messages.length || !inputForm) return null;
      const lastMessage = messages[messages.length - 1];
      const lastMsgRect = lastMessage.getBoundingClientRect();
      const inputRect = inputForm.getBoundingClientRect();
      return {
        gap: inputRect.top - lastMsgRect.bottom,
        messageCount: messages.length,
      };
    });

    expect(gapInfo).not.toBeNull();
    // Gap between last message and input form should be reasonable (not hundreds of pixels)
    expect(gapInfo!.gap).toBeLessThan(150);
  });

  test('no double scrollbar in overlay with many messages', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 }); // Smaller height to ensure scrolling
    session = await seedSession(project.id, {
      prompt: 'Scrollbar test prompt',
      name: 'Scrollbar Test',
    });
    await waitForSessionToExist(session.id);
    seedConversationHistory(session.id, 50);
    await updateSessionStatus(session.id, 'waiting');

    const overlay = await openOverlay(page, session.id);

    // Wait for messages to render
    await expect(overlay.locator('[data-testid="message-user"]').first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    const scrollInfo = await page.evaluate(() => {
      const body = document.querySelector('.overlay-body');
      const messages = document.querySelector('.overlay-body .messages');
      if (!body || !messages) return null;
      const bodyStyle = window.getComputedStyle(body);
      const messagesStyle = window.getComputedStyle(messages);
      return {
        bodyOverflowY: bodyStyle.overflowY,
        messagesOverflowY: messagesStyle.overflowY,
        bodyScrollHeight: body.scrollHeight,
        bodyClientHeight: body.clientHeight,
        bodyScrollable: body.scrollHeight > body.clientHeight,
      };
    });

    expect(scrollInfo).not.toBeNull();
    // .overlay-body should be the scrollable container
    expect(scrollInfo!.bodyOverflowY).toBe('auto');
    // .messages should NOT be independently scrollable
    expect(scrollInfo!.messagesOverflowY).toBe('visible');
    // Content should overflow .overlay-body (proving single scroll container works)
    expect(scrollInfo!.bodyScrollable).toBe(true);
  });

  test('mobile viewport — input anchored at bottom with few messages', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
    session = await seedSession(project.id, {
      prompt: 'Mobile anchor test',
      name: 'Mobile Anchor',
    });
    await waitForSessionToExist(session.id);
    seedConversationHistory(session.id, 3);
    await updateSessionStatus(session.id, 'waiting');

    const overlay = await openOverlay(page, session.id);

    // Wait for input form to render
    const inputForm = overlay.locator('.input-form');
    await expect(inputForm).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    const positions = await page.evaluate(() => {
      const inputForm = document.querySelector('.input-form');
      const overlayBody = document.querySelector('.overlay-body');
      if (!inputForm || !overlayBody) return null;
      const inputRect = inputForm.getBoundingClientRect();
      const bodyRect = overlayBody.getBoundingClientRect();
      return {
        inputBottom: inputRect.bottom,
        bodyBottom: bodyRect.bottom,
      };
    });

    expect(positions).not.toBeNull();
    // Input form should be near the bottom of the overlay body
    const gap = positions!.bodyBottom - positions!.inputBottom;
    expect(gap).toBeLessThan(100);
  });
});
