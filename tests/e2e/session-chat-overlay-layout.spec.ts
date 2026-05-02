/**
 * SessionChatOverlay layout regression coverage.
 *
 * The overlay is teleported to body and scroll locking is applied to #app,
 * while tablet-sized layouts align the fixed backdrop to the visual viewport CSS variables.
 * This keeps the overlay out of the fixed app wrapper without losing the
 * iPadOS browser-chrome offset and height corrections.
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

  test('backdrop uses position: fixed at the viewport origin by default', async ({ page }) => {
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

  test('narrow phone-sized layouts ignore stale visual viewport CSS variables', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await navigateToSession(page);
    await openOverlay(page);

    await page.evaluate(() => {
      document.documentElement.style.setProperty('--viewport-offset-top', '260px');
      document.documentElement.style.setProperty('--visual-viewport-height', '420px');
    });
    await page.waitForTimeout(50);

    try {
      const result = await page.evaluate(() => {
        const el = document.querySelector(
          '[data-testid="session-chat-overlay"]'
        ) as HTMLElement;
        const r = el.getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          inner: { w: window.innerWidth, h: window.innerHeight },
        };
      });

      expect(result.top).toBeLessThanOrEqual(1);
      expect(result.bottom).toBeGreaterThanOrEqual(result.inner.h - 1);
      expect(result.left).toBeLessThanOrEqual(1);
      expect(result.right).toBeGreaterThanOrEqual(result.inner.w - 1);
    } finally {
      await page.evaluate(() => {
        document.documentElement.style.removeProperty('--viewport-offset-top');
        document.documentElement.style.removeProperty('--visual-viewport-height');
      });
    }
  });

  test('tablet-sized layouts let visual viewport CSS variables move and size the shell', async ({ page }) => {
    await page.setViewportSize({ width: 744, height: 1000 });
    await navigateToSession(page);
    await openOverlay(page);

    await page.evaluate(() => {
      document.documentElement.style.setProperty('--viewport-offset-top', '260px');
      document.documentElement.style.setProperty('--visual-viewport-height', '420px');
    });
    await page.waitForTimeout(50);

    try {
      const result = await page.evaluate(() => {
        const rectFor = (selector: string) => {
          const el = document.querySelector(selector) as HTMLElement;
          const r = el.getBoundingClientRect();
          return {
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            width: r.width,
          };
        };

        return {
          backdrop: rectFor('[data-testid="session-chat-overlay"]'),
          panel: rectFor('.overlay-panel-wrapper'),
          header: rectFor('.overlay-header'),
          inner: { w: window.innerWidth, h: window.innerHeight },
        };
      });

      expect(result.backdrop.top).toBeGreaterThanOrEqual(259);
      expect(result.backdrop.top).toBeLessThanOrEqual(261);
      expect(result.backdrop.bottom).toBeGreaterThanOrEqual(679);
      expect(result.backdrop.bottom).toBeLessThanOrEqual(681);
      expect(result.backdrop.left).toBeLessThanOrEqual(1);
      expect(result.backdrop.right).toBeGreaterThanOrEqual(result.inner.w - 1);

      expect(result.panel.top).toBeGreaterThanOrEqual(259);
      expect(result.panel.top).toBeLessThanOrEqual(261);
      expect(result.panel.bottom).toBeGreaterThanOrEqual(679);
      expect(result.panel.bottom).toBeLessThanOrEqual(681);
      expect(result.panel.right).toBeGreaterThanOrEqual(result.inner.w - 1);
      expect(result.panel.right).toBeLessThanOrEqual(result.inner.w + 1);
      expect(result.panel.width).toBeLessThanOrEqual(Math.min(result.inner.w, 900) + 1);

      expect(result.header.top).toBeGreaterThanOrEqual(259);
      expect(result.header.top).toBeLessThanOrEqual(261);
    } finally {
      await page.evaluate(() => {
        document.documentElement.style.removeProperty('--viewport-offset-top');
        document.documentElement.style.removeProperty('--visual-viewport-height');
      });
    }
  });

  test('covers viewport after SessionDetailView scroll', async ({ page }) => {
    await navigateToSession(page);
    // Scroll SessionDetailView before opening the overlay. The app scroll
    // lock is applied to #app, while the teleported backdrop remains fixed
    // against the viewport.
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
    // Enough time for any previously-scheduled recovery timers (now
    // deleted) to have run; also covers the focusout rAF debounce.
    await page.waitForTimeout(400);

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
    // validated in Phase 6 manual QA.
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
    // divergence is not exercised; that is validated in Phase 6.
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
