/**
 * SessionChatOverlay layout regression coverage.
 *
 * The overlay component does not read `window.visualViewport` or write inline
 * geometry. Global viewport tracking owns `--viewport-offset-top` and
 * `--visual-viewport-height`; the overlay shell consumes those CSS variables
 * consistently across the backdrop, panel wrapper, and sticky header.
 *
 * HONEST SCOPE of the mobile projects (iphone-14, ipad-pro):
 * Playwright's mobile devices run chromium with only viewport size + UA
 * changes. They do NOT emulate Safari WebKit, iOS URL-bar retraction, or
 * the visual-viewport / layout-viewport divergence that the JS sync was
 * fighting. These cases are smoke tests against narrow-viewport CSS
 * layout; real iOS validation is manual QA (see the plan's Phase 6).
 */
import { test, expect, Page } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedConversationHistory,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
} from './helpers';

test.describe('SessionChatOverlay layout', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    project = await seedProject('Overlay Layout', '/tmp/overlay-layout');
    session = await seedSession(project.id, {
      prompt: 'Layout regression',
      name: 'Layout Test',
    });
    await waitForSessionToExist(session.id);
    seedConversationHistory(session.id, 20);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  async function openOverlay(page: Page) {
    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();
    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    // Allow slide-in animation to settle.
    await page.waitForTimeout(400);
    return overlay;
  }

  async function navigateToSession(page: Page) {
    await navigateAndWait(page, `/sessions/${session.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });
  }

  test('backdrop covers viewport and writes no inline geometry', async ({ page }) => {
    await navigateToSession(page);
    await openOverlay(page);

    const result = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="session-chat-overlay"]'
      ) as HTMLElement;
      const r = el.getBoundingClientRect();
      const s = el.style;
      return {
        rect: {
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
        },
        inner: { w: window.innerWidth, h: window.innerHeight },
        inline: {
          top: s.top,
          left: s.left,
          width: s.width,
          height: s.height,
        },
      };
    });

    expect(result.rect.top).toBeLessThanOrEqual(0);
    expect(result.rect.bottom).toBeGreaterThanOrEqual(result.inner.h);
    expect(result.rect.left).toBeLessThanOrEqual(0);
    expect(result.rect.right).toBeGreaterThanOrEqual(result.inner.w);
    expect(result.inline).toEqual({ top: '', left: '', width: '', height: '' });
  });

  test('backdrop uses position: fixed and the current viewport-offset top', async ({ page }) => {
    await navigateToSession(page);
    await openOverlay(page);

    const computed = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="session-chat-overlay"]'
      ) as HTMLElement;
      const c = getComputedStyle(el);
      return {
        position: c.position,
        top: c.top,
        left: c.left,
      };
    });

    expect(computed.position).toBe('fixed');
    expect(computed.top).toBe('0px');
    expect(computed.left).toBe('0px');
  });

  test('overlay shell honors visual viewport top offset consistently', async ({ page }) => {
    await navigateToSession(page);
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--viewport-offset-top', '48px');
    });
    await openOverlay(page);

    const result = await page.evaluate(() => {
      const backdrop = document.querySelector(
        '[data-testid="session-chat-overlay"]'
      ) as HTMLElement;
      const panel = document.querySelector('.overlay-panel-wrapper') as HTMLElement;
      const header = document.querySelector('.overlay-header') as HTMLElement;
      return {
        backdropTop: backdrop.getBoundingClientRect().top,
        panelTop: panel.getBoundingClientRect().top,
        headerTop: header.getBoundingClientRect().top,
      };
    });

    expect(result.backdropTop).toBeGreaterThanOrEqual(47);
    expect(result.backdropTop).toBeLessThanOrEqual(49);
    expect(result.panelTop).toBeGreaterThanOrEqual(47);
    expect(result.panelTop).toBeLessThanOrEqual(49);
    expect(result.headerTop).toBeGreaterThanOrEqual(47);
    expect(result.headerTop).toBeLessThanOrEqual(49);

    await page.evaluate(() => {
      document.documentElement.style.setProperty('--viewport-offset-top', '0px');
    });
  });

  test('overlay shell recovers when stale keyboard CSS variables restore', async ({ page }) => {
    await navigateToSession(page);
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--viewport-offset-top', '52px');
      document.documentElement.style.setProperty('--visual-viewport-height', '420px');
    });
    await openOverlay(page);

    const stale = await page.evaluate(() => {
      const backdrop = document.querySelector(
        '[data-testid="session-chat-overlay"]'
      ) as HTMLElement;
      const panel = document.querySelector('.overlay-panel-wrapper') as HTMLElement;
      const header = document.querySelector('.overlay-header') as HTMLElement;
      return {
        backdropTop: backdrop.getBoundingClientRect().top,
        backdropBottom: backdrop.getBoundingClientRect().bottom,
        panelTop: panel.getBoundingClientRect().top,
        headerTop: header.getBoundingClientRect().top,
        innerHeight: window.innerHeight,
      };
    });

    expect(stale.backdropTop).toBeGreaterThanOrEqual(51);
    expect(stale.backdropTop).toBeLessThanOrEqual(53);
    expect(stale.panelTop).toBeGreaterThanOrEqual(51);
    expect(stale.panelTop).toBeLessThanOrEqual(53);
    expect(stale.headerTop).toBeGreaterThanOrEqual(51);
    expect(stale.headerTop).toBeLessThanOrEqual(53);
    expect(stale.backdropBottom).toBeLessThan(stale.innerHeight);

    const restored = await page.evaluate(() => {
      document.documentElement.style.setProperty('--viewport-offset-top', '0px');
      document.documentElement.style.setProperty('--visual-viewport-height', `${window.innerHeight}px`);

      const backdrop = document.querySelector(
        '[data-testid="session-chat-overlay"]'
      ) as HTMLElement;
      const panel = document.querySelector('.overlay-panel-wrapper') as HTMLElement;
      const header = document.querySelector('.overlay-header') as HTMLElement;
      return {
        backdropTop: backdrop.getBoundingClientRect().top,
        backdropBottom: backdrop.getBoundingClientRect().bottom,
        panelTop: panel.getBoundingClientRect().top,
        panelBottom: panel.getBoundingClientRect().bottom,
        headerTop: header.getBoundingClientRect().top,
        innerHeight: window.innerHeight,
      };
    });

    expect(restored.backdropTop).toBeLessThanOrEqual(0);
    expect(restored.backdropBottom).toBeGreaterThanOrEqual(restored.innerHeight);
    expect(restored.panelTop).toBeLessThanOrEqual(0);
    expect(restored.panelBottom).toBeGreaterThanOrEqual(restored.innerHeight);
    expect(restored.headerTop).toBeLessThanOrEqual(0);
  });

  test('covers viewport after SessionDetailView scroll', async ({ page }) => {
    await navigateToSession(page);
    // Scroll SessionDetailView before opening the overlay. Previously the
    // JS sync relied on visualViewport events to anchor the backdrop; now
    // `position: fixed` + the scroll-lock on #app handles this.
    await page.evaluate(() => window.scrollTo(0, 400));
    await openOverlay(page);

    const result = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="session-chat-overlay"]'
      ) as HTMLElement;
      const r = el.getBoundingClientRect();
      const s = el.style;
      return {
        rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        inner: { w: window.innerWidth, h: window.innerHeight },
        inline: { top: s.top, left: s.left, width: s.width, height: s.height },
      };
    });

    expect(result.rect.top).toBeLessThanOrEqual(0);
    expect(result.rect.bottom).toBeGreaterThanOrEqual(result.inner.h);
    expect(result.inline).toEqual({ top: '', left: '', width: '', height: '' });
  });

  test('covers viewport after focus/blur cycle on textarea', async ({ page }) => {
    await navigateToSession(page);
    await openOverlay(page);

    const textarea = page
      .locator('[data-testid="session-chat-overlay"] textarea')
      .first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.focus();
    await page.waitForTimeout(100);
    await textarea.blur();
    // Covers the focusout rAF debounce and the longer iOS keyboard-dismiss
    // viewport settle window. Chromium mobile projects do not emulate the
    // real Safari visual viewport bug; this remains smoke coverage.
    await page.waitForTimeout(900);

    const result = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="session-chat-overlay"]'
      ) as HTMLElement;
      const r = el.getBoundingClientRect();
      const s = el.style;
      return {
        rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        inner: { w: window.innerWidth, h: window.innerHeight },
        inline: { top: s.top, left: s.left, width: s.width, height: s.height },
      };
    });

    expect(result.rect.top).toBeLessThanOrEqual(0);
    expect(result.rect.bottom).toBeGreaterThanOrEqual(result.inner.h);
    expect(result.inline).toEqual({ top: '', left: '', width: '', height: '' });
  });

  test('covers viewport after simulated orientation change', async ({ page }) => {
    await navigateToSession(page);
    await openOverlay(page);

    const size = page.viewportSize() || { width: 1280, height: 720 };
    // Playwright-level approximation only — real device rotation is
    // validated by manual iPhone Safari QA.
    await page.setViewportSize({ width: size.height, height: size.width });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(200);

    const result = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="session-chat-overlay"]'
      ) as HTMLElement;
      const r = el.getBoundingClientRect();
      const s = el.style;
      return {
        rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        inner: { w: window.innerWidth, h: window.innerHeight },
        inline: { top: s.top, left: s.left, width: s.width, height: s.height },
      };
    });

    expect(result.rect.top).toBeLessThanOrEqual(0);
    expect(result.rect.bottom).toBeGreaterThanOrEqual(result.inner.h);
    expect(result.rect.left).toBeLessThanOrEqual(0);
    expect(result.rect.right).toBeGreaterThanOrEqual(result.inner.w);
    expect(result.inline).toEqual({ top: '', left: '', width: '', height: '' });
  });

  test('covers viewport after simulated URL-bar retraction', async ({ page }) => {
    await navigateToSession(page);
    await openOverlay(page);

    const size = page.viewportSize() || { width: 1280, height: 720 };
    // Approximates an 80 px URL-bar retraction by shortening the
    // chromium viewport. Safari's actual visual/layout viewport
    // divergence is not exercised; that is validated by manual iPhone Safari QA.
    await page.setViewportSize({ width: size.width, height: Math.max(200, size.height - 80) });
    await page.waitForTimeout(200);

    const result = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="session-chat-overlay"]'
      ) as HTMLElement;
      const r = el.getBoundingClientRect();
      const s = el.style;
      return {
        rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        inner: { w: window.innerWidth, h: window.innerHeight },
        inline: { top: s.top, left: s.left, width: s.width, height: s.height },
      };
    });

    expect(result.rect.top).toBeLessThanOrEqual(0);
    expect(result.rect.bottom).toBeGreaterThanOrEqual(result.inner.h);
    expect(result.inline).toEqual({ top: '', left: '', width: '', height: '' });
  });

});
