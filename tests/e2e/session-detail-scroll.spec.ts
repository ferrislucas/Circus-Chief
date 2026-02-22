import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupAll,
  navigateAndWait,
} from './helpers';

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

  test('sticky tab navigation top offset matches header height on tablet viewport', async ({ page }) => {
    // Simulate iPad-like viewport (768px+ triggers the @media breakpoint that sets top: 80px)
    await page.setViewportSize({ width: 810, height: 1080 });

    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await expect(page.locator('.tabs')).toBeVisible({ timeout: 10000 });

    // Read the CSS `top` value of the sticky .tabs element and the actual header height
    const layout = await page.evaluate(() => {
      const tabs = document.querySelector('.tabs');
      const header = document.querySelector('.app-header');
      if (!tabs || !header) return null;

      const tabsStyle = window.getComputedStyle(tabs);
      const headerHeight = header.getBoundingClientRect().height;
      const tabsTopValue = parseFloat(tabsStyle.top); // The CSS sticky `top` value

      return { headerHeight, tabsTopValue };
    });

    expect(layout).not.toBeNull();

    // The sticky `top` value should be close to the actual header height.
    // Bug: At >=768px, the CSS hardcodes top: 80px, but the header is only ~51px.
    // The difference should be less than 10px (allowing for borders/padding).
    const offset = Math.abs(layout!.tabsTopValue - layout!.headerHeight);
    expect(offset).toBeLessThan(10);
  });

  test('sticky tab navigation top offset matches header height on mobile viewport', async ({ page }) => {
    // Mobile viewport (below 768px, uses top: 51px)
    await page.setViewportSize({ width: 375, height: 812 });

    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
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

  test('message content is not clipped by a fixed-height container', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await expect(page.locator('[data-testid="message-user"]')).toBeVisible({ timeout: 10000 });

    // The .messages container should NOT have a small fixed max-height that clips content.
    const messagesInfo = await page.evaluate(() => {
      const el = document.querySelector('.messages');
      if (!el) return null;
      const style = window.getComputedStyle(el);
      return {
        maxHeight: style.maxHeight,
        overflowY: style.overflowY,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
    });

    expect(messagesInfo).not.toBeNull();

    // If there IS a max-height with overflow creating a nested scroll container,
    // the content should not overflow it by more than 3x.
    // A ratio of 12x (currently) means the container is way too small.
    if (messagesInfo!.maxHeight !== 'none' && messagesInfo!.overflowY !== 'visible') {
      const scrollRatio = messagesInfo!.scrollHeight / messagesInfo!.clientHeight;
      expect(scrollRatio).toBeLessThan(3);
    }
  });

  test('page-level scroll reaches bottom of conversation', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await expect(page.locator('[data-testid="message-user"]')).toBeVisible({ timeout: 10000 });

    // The page itself should be scrollable (not just an inner container)
    const pageInfo = await page.evaluate(() => {
      const docEl = document.documentElement;
      return {
        scrollHeight: docEl.scrollHeight,
        clientHeight: docEl.clientHeight,
        isScrollable: docEl.scrollHeight > docEl.clientHeight + 100,
      };
    });

    // With 80 paragraphs of content, the page should be well scrollable.
    // If the messages are trapped in a 500px container, the page won't be very scrollable.
    expect(pageInfo.isScrollable).toBe(true);

    // Scroll to the very bottom of the page
    await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    });
    await page.waitForTimeout(300);

    // Verify we reached the bottom
    const afterScroll = await page.evaluate(() => {
      const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
      return { distanceFromBottom: scrollHeight - scrollTop - clientHeight };
    });
    expect(afterScroll.distanceFromBottom).toBeLessThan(5);

    // Wait and verify no bounce-back
    await page.waitForTimeout(500);
    const afterWait = await page.evaluate(() => {
      const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
      return { distanceFromBottom: scrollHeight - scrollTop - clientHeight };
    });
    expect(afterWait.distanceFromBottom).toBeLessThan(5);
  });
});
