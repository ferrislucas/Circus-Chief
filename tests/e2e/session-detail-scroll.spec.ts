import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedConversationHistory,
  cleanupAll,
  navigateAndWait,
  openSessionOverlay,
  waitForSessionStatus,
  updateSessionStatus,
} from './helpers';
import { API_READY } from './timeouts';

/**
 * Tests for session detail view scrolling behavior.
 *
 * Bug 1: Sticky tab navigation uses wrong offset on tablet-width viewports.
 *   The .tabs element uses a hardcoded `top: 80px` at >=768px width via media query,
 *   but the actual header is only ~51px tall. This causes the tabs to stick 29px
 *   too low, leaving a gap or causing partial overlap with content.
 *
 * Bug 2: Message content is clipped inside a fixed 500px scroll container.
 *   The .messages container uses max-height: 500px with overflow-y: auto,
 *   creating a nested scroll container. This causes scroll-fighting on iPad
 *   (bounce-back when scrolling quickly) and clips long conversations.
 */
test.describe('Session Detail Scroll Behavior', () => {
  let project: any;
  let session: any;

  // Generate a long message to ensure the content overflows any container
  const longContent = Array.from({ length: 80 }, (_, i) =>
    `Paragraph ${i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. ` +
    `Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ` +
    `Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.`
  ).join('\n\n');

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Scroll Test Project', '/tmp/test');
    session = await seedSession(project.id, {
      prompt: longContent,
      name: 'Long Conversation Session',
    });
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('sticky tab navigation top offset matches header height on mobile viewport', async ({ page }) => {
    // Mobile viewport (below 768px, uses top: 51px)
    await page.setViewportSize({ width: 375, height: 812 });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await expect(page.locator('.tabs')).toBeVisible({ timeout: 10000 });

    const layout = await page.evaluate(() => {
      const tabs = document.querySelector('.tabs');
      const header = document.querySelector('.app-header');
      if (!tabs || !header) return null;

      const tabsStyle = window.getComputedStyle(tabs);
      const headerHeight = header.getBoundingClientRect().height;
      const tabsTopValue = parseFloat(tabsStyle.top);

      return { headerHeight, tabsTopValue };
    });

    expect(layout).not.toBeNull();

    // On mobile, the hardcoded top: 51px should also match the actual header height
    const offset = Math.abs(layout!.tabsTopValue - layout!.headerHeight);
    expect(offset).toBeLessThan(10);
  });

  test('page-level scroll reaches bottom of conversation', async ({ page }) => {
    // Use a mobile viewport so openSessionOverlay takes the mobile path (chat handle)
    // rather than the desktop Chat tab. In mobile/overlay mode the .overlay-body element
    // has overflow-y:auto and acts as the scroll container; in embedded/desktop mode it
    // has overflow-y:visible and is NOT scrollable. The scroll assertions below only
    // apply to the overlay scroll container.
    await page.setViewportSize({ width: 390, height: 812 });
    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);
    await expect(page.locator('[data-testid="message-user"]')).toBeVisible({ timeout: 10000 });

    // In the overlay, .overlay-body is the scroll container (ConversationTab passes
    // overlayBodyRef as scrollContainerRef). The .messages div still has max-height
    // but the effective scrollable area is the overlay-body.
    // The key check is that the scroll container is tall enough and scrollable,
    // not trapped in a tiny fixed-pixel container.
    const containerInfo = await page.evaluate(() => {
      // Check overlay-body (the actual scroll container in overlay context)
      const overlayBody = document.querySelector('.overlay-body');
      if (!overlayBody) return null;
      const style = window.getComputedStyle(overlayBody);
      return {
        scrollHeight: overlayBody.scrollHeight,
        clientHeight: overlayBody.clientHeight,
        isScrollable: overlayBody.scrollHeight > overlayBody.clientHeight + 100,
        overflowY: style.overflowY,
        // Verify it's not a tiny fixed-pixel container (old bug was 500px)
        clientHeightPx: overlayBody.clientHeight,
      };
    });

    expect(containerInfo).not.toBeNull();
    // With 80 paragraphs, the scroll container should be scrollable
    expect(containerInfo!.isScrollable).toBe(true);
    // Container should be at least 300px tall (not trapped in a tiny box)
    expect(containerInfo!.clientHeightPx).toBeGreaterThan(300);

    // Scroll to the very bottom of the overlay-body scroll container.
    // Override scroll-behavior to 'auto' so scrollTo lands instantly.
    await page.evaluate(() => {
      const container = document.querySelector('.overlay-body') as HTMLElement | null;
      if (container) {
        container.style.scrollBehavior = 'auto';
        container.scrollTop = container.scrollHeight;
      }
    });
    await page.waitForTimeout(300);

    // Verify we reached the bottom (allow small tolerance for sub-pixel rounding)
    const afterScroll = await page.evaluate(() => {
      const container = document.querySelector('.overlay-body');
      if (!container) return { distanceFromBottom: 999 };
      return { distanceFromBottom: container.scrollHeight - container.scrollTop - container.clientHeight };
    });
    expect(afterScroll.distanceFromBottom).toBeLessThan(50);

    // Wait and verify no bounce-back
    await page.waitForTimeout(500);
    const afterWait = await page.evaluate(() => {
      const container = document.querySelector('.overlay-body');
      if (!container) return { distanceFromBottom: 999 };
      return { distanceFromBottom: container.scrollHeight - container.scrollTop - container.clientHeight };
    });
    expect(afterWait.distanceFromBottom).toBeLessThan(50);
  });

  test('embedded chat grows the document and uses page-level scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });

    await navigateAndWait(page, `/sessions/${session.id}/chat`, {
      waitFor: '[data-testid="session-detail"][data-ready="true"]',
      timeout: 15000,
    });
    await expect(page.locator('.session-chat-content--embedded')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="message-user"]')).toBeVisible({ timeout: 10000 });

    const beforeScroll = await page.evaluate(() => {
      const embedded = document.querySelector('.session-chat-content--embedded') as HTMLElement | null;
      const overlayBody = embedded?.querySelector('.overlay-body') as HTMLElement | null;
      const messages = embedded?.querySelector('.messages') as HTMLElement | null;
      if (!embedded || !overlayBody || !messages) return null;

      const embeddedStyle = window.getComputedStyle(embedded);

      return {
        documentScrollHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        embeddedHeight: embedded.getBoundingClientRect().height,
        bodyClientHeight: overlayBody.clientHeight,
        bodyScrollHeight: overlayBody.scrollHeight,
        embeddedHeightStyle: embeddedStyle.height,
        lastMessageBottom: messages.lastElementChild?.getBoundingClientRect().bottom ?? 0,
        embeddedBottom: embedded.getBoundingClientRect().bottom,
      };
    });

    expect(beforeScroll).not.toBeNull();
    expect(beforeScroll!.documentScrollHeight).toBeGreaterThan(beforeScroll!.viewportHeight + 300);
    expect(beforeScroll!.bodyScrollHeight).toBeLessThanOrEqual(beforeScroll!.bodyClientHeight + 2);
    expect(beforeScroll!.bodyClientHeight).toBeGreaterThan(500);
    expect(beforeScroll!.embeddedHeight).toBeGreaterThan(700);
    expect(beforeScroll!.embeddedHeightStyle).not.toBe('500px');
    expect(beforeScroll!.lastMessageBottom).toBeLessThanOrEqual(beforeScroll!.embeddedBottom + 2);

    await page.evaluate(() => {
      const body = document.querySelector('.session-chat-content--embedded .overlay-body') as HTMLElement | null;
      if (body) {
        body.scrollTop = body.scrollHeight;
        body.dispatchEvent(new Event('scroll'));
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
      window.dispatchEvent(new Event('scroll'));
    });

    const afterScroll = await page.evaluate(() => {
      const overlayBody = document.querySelector('.session-chat-content--embedded .overlay-body') as HTMLElement | null;
      return {
        windowScrollY: window.scrollY,
        documentDistanceFromBottom:
          document.documentElement.scrollHeight - window.scrollY - window.innerHeight,
        overlayBodyScrollTop: overlayBody?.scrollTop ?? -1,
      };
    });

    expect(afterScroll.windowScrollY).toBeGreaterThan(100);
    expect(afterScroll.documentDistanceFromBottom).toBeLessThan(80);
    expect(afterScroll.overlayBodyScrollTop).toBe(0);
  });

  test('embedded chat keeps scroll action buttons fixed while the page scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await updateSessionStatus(session.id, 'waiting');
    await waitForSessionStatus(session.id, 'waiting', API_READY);
    seedConversationHistory(session.id, 30);

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
