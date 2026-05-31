import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  seedConversationHistory,
  seedUserMessage,
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

  // Helper to navigate and open the overlay. Wider viewport cases open at a
  // mobile width first because the product intentionally routes >=641px to the
  // embedded Chat tab, then restore the requested viewport before assertions.
  async function openOverlay(page: any, sessionId: string) {
    const originalViewport = page.viewportSize();
    await navigateAndWait(page, `/sessions/${sessionId}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });
    const handle = page.locator('[data-testid="session-chat-handle"]');
    await handle.waitFor({ state: 'attached', timeout: 10000 });

    if (originalViewport && originalViewport.width >= 641) {
      await page.setViewportSize({ width: 390, height: originalViewport.height });
    }
    await handle.click();

    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await overlay.waitFor({ state: 'visible', timeout: 5000 });
    if (originalViewport && originalViewport.width >= 641) {
      await page.setViewportSize(originalViewport);
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    }
    // Wait for overlay header to confirm full render, then allow animation to settle.
    await overlay.locator('.overlay-header').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    return overlay;
  }

  async function getLatestAssistantAlignment(page: any) {
    return page.evaluate(() => {
      const body = document.querySelector('.overlay-body') as HTMLElement | null;
      if (!body) return null;

      const assistantMessages = body.querySelectorAll('[data-testid="message-assistant"]');
      if (assistantMessages.length === 0) return null;

      const lastAssistant = assistantMessages[assistantMessages.length - 1] as HTMLElement;
      const bodyRect = body.getBoundingClientRect();
      const msgRect = lastAssistant.getBoundingClientRect();
      const expectedTop = bodyRect.top + 16;

      return {
        bodyTop: bodyRect.top,
        bodyBottom: bodyRect.bottom,
        expectedTop,
        msgTop: msgRect.top,
        msgBottom: msgRect.bottom,
        topDelta: msgRect.top - expectedTop,
        absTopDelta: Math.abs(msgRect.top - expectedTop),
        scrollTop: body.scrollTop,
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
      };
    });
  }

  async function expectLatestAssistantAligned(page: any, tolerancePx = 4) {
    await expect.poll(async () => {
      const alignment = await getLatestAssistantAlignment(page);
      return alignment?.absTopDelta ?? Number.POSITIVE_INFINITY;
    }, {
      message: `latest assistant message should align to .overlay-body top + 16px within ${tolerancePx}px`,
    }).toBeLessThanOrEqual(tolerancePx);

    const alignment = await getLatestAssistantAlignment(page);
    expect(alignment).not.toBeNull();
    expect(alignment!.msgTop).toBeGreaterThanOrEqual(alignment!.bodyTop);
    expect(alignment!.msgTop).toBeLessThanOrEqual(alignment!.bodyBottom);
  }

  async function setOverlayBodyScroll(page: any, position: 'top' | 'bottom') {
    await page.evaluate((targetPosition) => {
      const body = document.querySelector('.overlay-body') as HTMLElement | null;
      if (!body) return;
      body.scrollTop = targetPosition === 'bottom' ? body.scrollHeight : 0;
      body.dispatchEvent(new Event('scroll', { bubbles: true }));
    }, position);
  }

  for (const viewport of [
    { label: 'small screen', width: 320, height: 568 },
    { label: 'tablet screen', width: 768, height: 1024 },
    { label: 'large screen', width: 1920, height: 800 },
  ]) {
    test(`overlay auto-scroll aligns to latest assistant message on open on ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openOverlay(page, parentSession.id);

      await expectLatestAssistantAligned(page);

      const alignment = await getLatestAssistantAlignment(page);
      expect(alignment!.scrollTop).toBeGreaterThan(100);
      expect(alignment!.scrollHeight).toBeGreaterThan(alignment!.clientHeight + 100);
    });
  }

  test('overlay auto-scroll aligns to latest assistant message when later user content exists on tablet screen', async ({ page }) => {
    const trailingSession = await seedSession(project.id, {
      prompt: 'Trailing user content prompt',
      name: 'Trailing User Content',
      status: 'waiting',
    });
    await waitForSessionToExist(trailingSession.id);
    seedConversationHistory(trailingSession.id, 30);
    seedUserMessage(
      trailingSession.id,
      'Follow-up draft after the latest assistant response. '.repeat(40)
    );

    await page.setViewportSize({ width: 768, height: 1024 });
    await openOverlay(page, trailingSession.id);

    await expectLatestAssistantAligned(page);
  });

  test('overlay auto-scroll aligns to final assistant message without composer runway on tablet screen', async ({ page }) => {
    const activeSessionWithoutComposer = await seedSession(project.id, {
      prompt: 'Active session prompt',
      name: 'Active Session Without Composer',
    });
    await waitForSessionToExist(activeSessionWithoutComposer.id);
    seedConversationHistory(activeSessionWithoutComposer.id, 30);
    await updateSessionStatus(activeSessionWithoutComposer.id, 'starting');

    await page.setViewportSize({ width: 768, height: 1024 });
    await openOverlay(page, activeSessionWithoutComposer.id);

    await expectLatestAssistantAligned(page);

    const runway = await page.evaluate(() => {
      const body = document.querySelector('.overlay-body') as HTMLElement | null;
      return body?.style.getPropertyValue('--session-chat-latest-turn-runway') || '';
    });
    expect(runway).toMatch(/px$/);
  });

  test('scroll-to-claude button aligns to latest assistant turn in overlay', async ({ page }) => {
    // Set session to waiting so the scroll-to-claude button appears
    await updateSessionStatus(parentSession.id, 'waiting');

    const overlay = await openOverlay(page, parentSession.id);
    await page.waitForTimeout(1000);

    // The scroll-to-claude button shows when at bottom and it's user's turn
    const scrollBtn = overlay.locator('.scroll-to-claude-btn');
    await expect(scrollBtn).toBeVisible({ timeout: 5000 });

    for (const startPosition of ['top', 'bottom'] as const) {
      await setOverlayBodyScroll(page, startPosition);
      await expect(scrollBtn).toBeVisible();
      await scrollBtn.click();
      await expectLatestAssistantAligned(page);
    }
  });

  for (const viewport of [
    { label: 'small screen', width: 320, height: 568 },
    { label: 'tablet screen', width: 768, height: 1024 },
    { label: 'large screen', width: 1920, height: 800 },
  ]) {
    test(`scroll-to-claude button aligns to latest assistant turn on ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await updateSessionStatus(parentSession.id, 'waiting');

      const overlay = await openOverlay(page, parentSession.id);
      const scrollBtn = overlay.locator('.scroll-to-claude-btn');
      await expect(scrollBtn).toBeVisible({ timeout: 5000 });
      await expect.poll(async () => {
        const info = await page.evaluate(() => {
          const body = document.querySelector('.overlay-body') as HTMLElement | null;
          return body ? { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight } : null;
        });
        return info ? info.scrollHeight - info.clientHeight : 0;
      }).toBeGreaterThan(100);

      for (const startPosition of ['top', 'bottom'] as const) {
        await setOverlayBodyScroll(page, startPosition);
        await expect(scrollBtn).toBeVisible();
        await scrollBtn.click();
        await expectLatestAssistantAligned(page);
      }
    });
  }

  test('scroll-to-claude button aligns after opening overlay from page top and bottom', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await updateSessionStatus(parentSession.id, 'waiting');

    for (const pageStart of ['top', 'bottom'] as const) {
      await navigateAndWait(page, `/sessions/${parentSession.id}`, {
        waitFor: '.session-detail',
        timeout: 15000,
      });
      await page.evaluate((targetPosition) => {
        window.scrollTo(0, targetPosition === 'bottom' ? document.documentElement.scrollHeight : 0);
      }, pageStart);

      const handle = page.locator('[data-testid="session-chat-handle"]');
      await handle.waitFor({ state: 'attached', timeout: 10000 });
      await handle.click();

      const overlay = page.locator('[data-testid="session-chat-overlay"]');
      await overlay.waitFor({ state: 'visible', timeout: 5000 });
      await overlay.locator('.overlay-header').waitFor({ state: 'visible', timeout: 5000 });

      const scrollBtn = overlay.locator('.scroll-to-claude-btn');
      await expect(scrollBtn).toBeVisible({ timeout: 5000 });
      await setOverlayBodyScroll(page, 'bottom');
      await scrollBtn.click();
      await expectLatestAssistantAligned(page);

      await overlay.locator('[data-testid="session-chat-overlay-close-handle"]').click();
      await expect(overlay).not.toBeVisible({ timeout: 5000 });
    }
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

  test('overlay auto-scrolls to last assistant message after switching to child session', async ({ page }) => {
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

    // Verify the last assistant message is visible within the overlay body
    const alignment = await page.evaluate(() => {
      const body = document.querySelector('.overlay-body') as HTMLElement | null;
      if (!body) return null;
      const assistantMessages = body.querySelectorAll('[data-testid="message-assistant"]');
      if (assistantMessages.length === 0) return null;
      const lastAssistant = assistantMessages[assistantMessages.length - 1] as HTMLElement;
      const bodyRect = body.getBoundingClientRect();
      const msgRect = lastAssistant.getBoundingClientRect();
      return {
        bodyTop: bodyRect.top,
        bodyBottom: bodyRect.bottom,
        msgTop: msgRect.top,
        msgBottom: msgRect.bottom,
        scrollTop: body.scrollTop,
      };
    });

    expect(alignment).not.toBeNull();
    // The last assistant message should be visible within the overlay body viewport
    expect(alignment!.msgTop).toBeGreaterThanOrEqual(alignment!.bodyTop - 10);
    expect(alignment!.msgBottom).toBeLessThanOrEqual(alignment!.bodyBottom + 10);
    // scrollTop should be well above 0 (not stuck at top)
    expect(alignment!.scrollTop).toBeGreaterThan(100);
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
    // Allow a 2px tolerance to avoid false positives from sub-pixel rounding when the
    // button and input form are adjacent (touching) but not actually overlapping.
    const inputBox = await overlay.locator('.input-form').boundingBox();
    if (inputBox) {
      const TOLERANCE = 2;
      const overlapsHoriz = btnBox.x + TOLERANCE < inputBox.x + inputBox.width && btnBox.x + btnBox.width - TOLERANCE > inputBox.x;
      const overlapsVert  = btnBox.y + TOLERANCE < inputBox.y + inputBox.height && btnBox.y + btnBox.height - TOLERANCE > inputBox.y;
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
    const tokenPanel = overlay.locator('.token-usage-panel');
    await expect(tokenPanel).toBeVisible({ timeout: 5000 });

    const scrollBtn = overlay.locator('.scroll-to-claude-btn');
    await expect(scrollBtn).toBeVisible({ timeout: 5000 });
    await expect.poll(async () => (await scrollBtn.boundingBox())?.width || 0).toBeGreaterThanOrEqual(44);

    const btnBox = await scrollBtn.boundingBox();
    expect(btnBox).not.toBeNull();
    if (!btnBox) throw new Error('btnBox is null');

    // Same assertions as the no-cost case: 44×44, in viewport, in .overlay-body, no .input-form overlap, topmost.
    const vp = page.viewportSize();
    const vpWidth = vp?.width ?? 375;
    const vpHeight = vp?.height ?? 667;
    expect(btnBox.width).toBeGreaterThanOrEqual(44);
    expect(btnBox.height).toBeGreaterThanOrEqual(44);
    expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(vpWidth);
    expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(vpHeight);
    const bodyBox = await overlay.locator('.overlay-body').boundingBox();
    expect(bodyBox).not.toBeNull();
    if (!bodyBox) throw new Error('bodyBox is null');
    expect(btnBox.x).toBeGreaterThanOrEqual(bodyBox.x);
    expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(bodyBox.x + bodyBox.width);
    const inputBox = await overlay.locator('.input-form').boundingBox();
    if (inputBox) {
      const TOLERANCE = 2;
      const overlapsHoriz = btnBox.x + TOLERANCE < inputBox.x + inputBox.width && btnBox.x + btnBox.width - TOLERANCE > inputBox.x;
      const overlapsVert  = btnBox.y + TOLERANCE < inputBox.y + inputBox.height && btnBox.y + btnBox.height - TOLERANCE > inputBox.y;
      expect(overlapsHoriz && overlapsVert).toBe(false);
    }

    // Functional click from a known non-target scroll position.
    await overlay.locator('.overlay-body').evaluate((el) => { (el as HTMLElement).scrollTop = 0; });
    await expect(scrollBtn).toBeVisible();
    const beforeScroll = await overlay.locator('.overlay-body').evaluate((el) => (el as HTMLElement).scrollTop);
    await scrollBtn.click();
    await expect.poll(
      async () => overlay.locator('.overlay-body').evaluate((el) => (el as HTMLElement).scrollTop)
    ).not.toBe(beforeScroll);
  });
});
