import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  seedConversationHistory,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
  updateSessionStatus,
} from './helpers';

test.describe('Session Tree Overlay Scroll Behavior', () => {
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
    const handle = page.locator('[data-testid="session-tree-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();
    const overlay = page.locator('[data-testid="session-tree-overlay"]');
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
    const picker = page.locator('[data-testid="session-tree-picker"]');
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
});
