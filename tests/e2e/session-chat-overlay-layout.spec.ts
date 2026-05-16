/**
 * SessionChatOverlay layout regression coverage.
 *
 * The overlay is teleported to body and scroll locking is applied to #app,
 * while the backdrop shell remains fixed to the full layout viewport. Stale
 * visual viewport CSS variables must not move or resize that shell.
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

  test.afterEach(async ({ page }) => {
    await clearStaleVisualViewportVariables(page).catch(() => {});
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

  async function injectStaleVisualViewportVariables(page: Page) {
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--viewport-offset-top', '260px');
      document.documentElement.style.setProperty('--visual-viewport-height', '420px');
    });
    await page.waitForTimeout(50);
  }

  async function clearStaleVisualViewportVariables(page: Page) {
    await page.evaluate(() => {
      document.documentElement.style.removeProperty('--viewport-offset-top');
      document.documentElement.style.removeProperty('--visual-viewport-height');
      document.documentElement.style.removeProperty('--session-overlay-top-chrome-inset');
    });
  }

  async function injectSessionOverlayTopChromeInset(page: Page, insetPx: number) {
    await page.evaluate((inset) => {
      document.documentElement.style.setProperty(
        '--session-overlay-top-chrome-inset',
        `${inset}px`
      );
    }, insetPx);
    await page.waitForTimeout(50);
  }

  async function readOverlayLayout(page: Page) {
    return page.evaluate(() => {
      const rectFor = (selector: string) => {
        const el = document.querySelector(selector) as HTMLElement;
        const r = el.getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          width: r.width,
          height: r.height,
        };
      };

      const shell = document.querySelector(
        '[data-testid="session-chat-overlay"]'
      ) as HTMLElement;
      const content = document.querySelector('.overlay-content') as HTMLElement;
      const header = document.querySelector('.overlay-header') as HTMLElement;
      const s = shell.style;

      return {
        backdrop: rectFor('[data-testid="session-chat-overlay"]'),
        panel: rectFor('.overlay-panel-wrapper'),
        content: rectFor('.overlay-content'),
        header: rectFor('.overlay-header'),
        headerRow: rectFor('.overlay-header-row'),
        computed: {
          contentPaddingTop: getComputedStyle(content).paddingTop,
          headerPaddingTop: getComputedStyle(header).paddingTop,
        },
        inner: { w: window.innerWidth, h: window.innerHeight },
        inline: {
          top: s.top,
          right: s.right,
          bottom: s.bottom,
          left: s.left,
          width: s.width,
          height: s.height,
        },
      };
    });
  }

  function expectBackdropCoversViewport(result: Awaited<ReturnType<typeof readOverlayLayout>>) {
    expect(result.backdrop.top).toBeLessThanOrEqual(1);
    expect(result.backdrop.bottom).toBeGreaterThanOrEqual(result.inner.h - 1);
    expect(result.backdrop.left).toBeLessThanOrEqual(1);
    expect(result.backdrop.right).toBeGreaterThanOrEqual(result.inner.w - 1);
    expect(result.inline).toEqual({
      top: '',
      right: '',
      bottom: '',
      left: '',
      width: '',
      height: '',
    });
  }

  function expectContentCoversViewport(result: Awaited<ReturnType<typeof readOverlayLayout>>) {
    expect(result.content.top).toBeLessThanOrEqual(1);
    expect(result.content.bottom).toBeGreaterThanOrEqual(result.inner.h - 1);
  }

  function expectHeaderAtViewportTop(result: Awaited<ReturnType<typeof readOverlayLayout>>) {
    expect(result.header.top).toBeGreaterThanOrEqual(-1);
    expect(result.header.top).toBeLessThanOrEqual(1);
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
          right: s.right,
          bottom: s.bottom,
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
    expect(result.inline).toEqual({ top: '', right: '', bottom: '', left: '', width: '', height: '' });
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

  test('narrow phone-sized shell geometry ignores stale visual viewport CSS variables', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await navigateToSession(page);
    await openOverlay(page);

    await injectStaleVisualViewportVariables(page);

    try {
      const result = await readOverlayLayout(page);
      expectBackdropCoversViewport(result);
      expectContentCoversViewport(result);
      expect(result.computed.contentPaddingTop).toBe('0px');
    } finally {
      await clearStaleVisualViewportVariables(page);
    }
  });

  test('iPhone 12 mini stale visual viewport variables do not create a blank top band', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await navigateToSession(page);
    await openOverlay(page);

    await injectStaleVisualViewportVariables(page);

    try {
      const result = await readOverlayLayout(page);
      expectBackdropCoversViewport(result);
      expectContentCoversViewport(result);
      expect(result.computed.contentPaddingTop).toBe('0px');
      expectHeaderAtViewportTop(result);
      expect(result.headerRow.top).toBeLessThan(80);

      const hit = await page.evaluate(() => {
        const el = document.elementFromPoint(20, 40) as HTMLElement | null;
        return {
          inOverlay: Boolean(el?.closest('[data-testid="session-chat-overlay"]')),
          inHeader: Boolean(el?.closest('.overlay-header')),
          isContentPaddingBand: Boolean(el?.classList.contains('overlay-content')),
        };
      });

      expect(hit.inOverlay).toBe(true);
      expect(hit.inHeader).toBe(true);
      expect(hit.isContentPaddingBand).toBe(false);
    } finally {
      await clearStaleVisualViewportVariables(page);
    }
  });

  test('744px tablet-sized shell geometry ignores stale visual viewport CSS variables', async ({ page }) => {
    await page.setViewportSize({ width: 744, height: 1000 });
    await navigateToSession(page);
    await openOverlay(page);

    await injectStaleVisualViewportVariables(page);

    try {
      const result = await readOverlayLayout(page);
      expectBackdropCoversViewport(result);
      expect(result.panel.top).toBeLessThanOrEqual(1);
      expect(result.panel.bottom).toBeGreaterThanOrEqual(result.inner.h - 1);
      expect(result.panel.left).toBeLessThanOrEqual(1);
      expect(result.panel.right).toBeGreaterThanOrEqual(result.inner.w - 1);
      expect(result.panel.width).toBeGreaterThanOrEqual(result.inner.w - 1);
      expectContentCoversViewport(result);
      expect(result.computed.contentPaddingTop).toBe('0px');
    } finally {
      await clearStaleVisualViewportVariables(page);
    }
  });

  test('800px tablet-sized layouts keep a right-aligned capped panel inside the full shell', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 1000 });
    await navigateToSession(page);
    await openOverlay(page);

    await injectStaleVisualViewportVariables(page);

    try {
      const result = await readOverlayLayout(page);
      expectBackdropCoversViewport(result);
      expect(result.panel.top).toBeLessThanOrEqual(1);
      expect(result.panel.bottom).toBeGreaterThanOrEqual(result.inner.h - 1);
      expect(result.panel.right).toBeGreaterThanOrEqual(result.inner.w - 1);
      expect(result.panel.right).toBeLessThanOrEqual(result.inner.w + 1);
      expect(result.panel.width).toBeLessThanOrEqual(701);
      expect(result.panel.width).toBeGreaterThan(0);
      expectContentCoversViewport(result);
      expect(result.computed.contentPaddingTop).toBe('0px');
    } finally {
      await clearStaleVisualViewportVariables(page);
    }
  });

  test('stale visual viewport top offset does not move the overlay header or shell', async ({ page }) => {
    await page.setViewportSize({ width: 744, height: 1000 });
    await navigateToSession(page);
    await openOverlay(page);

    await injectStaleVisualViewportVariables(page);

    try {
      const result = await readOverlayLayout(page);
      expectBackdropCoversViewport(result);
      expect(result.panel.top).toBeLessThanOrEqual(1);
      expect(result.panel.bottom).toBeGreaterThanOrEqual(result.inner.h - 1);
      expectContentCoversViewport(result);
      expect(result.computed.contentPaddingTop).toBe('0px');
      expectHeaderAtViewportTop(result);
      expect(result.headerRow.top).toBeLessThan(80);
    } finally {
      await clearStaleVisualViewportVariables(page);
    }
  });

  test('sanitized tablet top chrome inset pads header content without moving the shell', async ({ page }) => {
    await page.setViewportSize({ width: 744, height: 1000 });
    await navigateToSession(page);
    await openOverlay(page);

    const before = await readOverlayLayout(page);
    await injectSessionOverlayTopChromeInset(page, 32);

    try {
      const after = await readOverlayLayout(page);
      expectBackdropCoversViewport(after);
      expectContentCoversViewport(after);
      expectHeaderAtViewportTop(after);
      expect(after.computed.contentPaddingTop).toBe('0px');
      expect(after.headerRow.top - before.headerRow.top).toBeGreaterThanOrEqual(31);
      expect(after.headerRow.top - before.headerRow.top).toBeLessThanOrEqual(34);
    } finally {
      await clearStaleVisualViewportVariables(page);
    }
  });

  test('covers viewport after SessionDetailView scroll', async ({ page }) => {
    await navigateToSession(page);
    // Scroll SessionDetailView before opening the overlay. The app scroll
    // lock is applied to #app, while the teleported backdrop remains fixed
    // against the viewport.
    await page.evaluate(() => window.scrollTo(0, 400));
    await openOverlay(page);

    const result = await readOverlayLayout(page);
    expectBackdropCoversViewport(result);
    expectContentCoversViewport(result);
    expectHeaderAtViewportTop(result);
    expect(result.headerRow.top).toBeLessThan(80);
    expect(result.computed.contentPaddingTop).toBe('0px');
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

    const result = await readOverlayLayout(page);
    expectBackdropCoversViewport(result);
    expectContentCoversViewport(result);
    expectHeaderAtViewportTop(result);
    expect(result.headerRow.top).toBeLessThan(80);
    expect(result.computed.contentPaddingTop).toBe('0px');
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
        inline: { top: s.top, right: s.right, bottom: s.bottom, left: s.left, width: s.width, height: s.height },
      };
    });

    expect(result.rect.top).toBeLessThanOrEqual(0);
    expect(result.rect.bottom).toBeGreaterThanOrEqual(result.inner.h);
    expect(result.rect.left).toBeLessThanOrEqual(0);
    expect(result.rect.right).toBeGreaterThanOrEqual(result.inner.w);
    expect(result.inline).toEqual({ top: '', right: '', bottom: '', left: '', width: '', height: '' });
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
        inline: { top: s.top, right: s.right, bottom: s.bottom, left: s.left, width: s.width, height: s.height },
      };
    });

    expect(result.rect.top).toBeLessThanOrEqual(0);
    expect(result.rect.bottom).toBeGreaterThanOrEqual(result.inner.h);
    expect(result.inline).toEqual({ top: '', right: '', bottom: '', left: '', width: '', height: '' });
  });

});
