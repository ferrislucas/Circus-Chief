/**
 * SessionChatOverlay layout regression coverage.
 *
 * The overlay is teleported to body but must be independent of document scroll
 * and SessionDetailView sticky state. Opening the overlay must not pin #app,
 * reset window scroll, mutate body inline scroll-lock styles, or write inline
 * geometry to the fixed backdrop. The fixed shell owns the viewport, and
 * .overlay-body is the only internal scroll container.
 *
 * Playwright's mobile projects are Chromium viewports, not real iOS Safari.
 * They verify layout contracts but do not replace manual WebKit QA.
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
    });
  }

  async function installScrollToSpy(page: Page) {
    await page.evaluate(() => {
      const win = window as any;
      if (win.__overlayOriginalScrollTo) return;
      win.__overlayOriginalScrollTo = window.scrollTo.bind(window);
      win.__overlayScrollToCalls = [];
      window.scrollTo = (...args: any[]) => {
        win.__overlayScrollToCalls.push(args);
        return win.__overlayOriginalScrollTo(...args);
      };
    });
  }

  async function clearScrollToSpy(page: Page) {
    await page.evaluate(() => {
      (window as any).__overlayScrollToCalls = [];
    });
  }

  async function readScrollToCalls(page: Page) {
    return page.evaluate(() => (window as any).__overlayScrollToCalls || []);
  }

  async function scrollUntilSessionTabsStuck(page: Page) {
    await page.evaluate(() => {
      if (document.querySelector('[data-testid="sticky-tabs-scroll-spacer"]')) return;
      const tabContent = document.querySelector('.tab-content') as HTMLElement | null;
      if (!tabContent) return;
      const spacer = document.createElement('div');
      spacer.dataset.testid = 'sticky-tabs-scroll-spacer';
      spacer.style.height = '1600px';
      spacer.style.pointerEvents = 'none';
      tabContent.appendChild(spacer);
    });

    await page.evaluate(() => {
      const tabs = document.querySelector('.tabs') as HTMLElement | null;
      if (!tabs) return;
      const stickyTop = Number.parseFloat(getComputedStyle(tabs).top) || 0;
      const naturalTop = tabs.getBoundingClientRect().top + window.scrollY;
      const targetScrollY = Math.max(0, Math.ceil(naturalTop - stickyTop + 24));
      window.scrollTo(0, targetScrollY);
    });
    await page.waitForTimeout(100);

    return page.evaluate(() => {
      const tabs = document.querySelector('.tabs') as HTMLElement | null;
      if (!tabs) return null;
      const rect = tabs.getBoundingClientRect();
      const stickyTop = Number.parseFloat(getComputedStyle(tabs).top) || 0;
      return {
        scrollY: window.scrollY,
        tabsTop: rect.top,
        stickyTop,
        stuck: Math.abs(rect.top - stickyTop) <= 2,
      };
    });
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
      const app = document.getElementById('app') as HTMLElement | null;
      const body = document.body;
      const html = document.documentElement;
      const content = document.querySelector('.overlay-content') as HTMLElement;
      const header = document.querySelector('.overlay-header') as HTMLElement;
      const overlayBody = document.querySelector('.overlay-body') as HTMLElement;
      const s = shell.style;

      return {
        backdrop: rectFor('[data-testid="session-chat-overlay"]'),
        panel: rectFor('.overlay-panel-wrapper'),
        content: rectFor('.overlay-content'),
        header: rectFor('.overlay-header'),
        headerRow: rectFor('.overlay-header-row'),
        appInline: {
          position: app?.style.position || '',
          top: app?.style.top || '',
          left: app?.style.left || '',
          right: app?.style.right || '',
          width: app?.style.width || '',
        },
        bodyInline: {
          position: body.style.position || '',
          top: body.style.top || '',
          overflow: body.style.overflow || '',
        },
        classes: {
          htmlLocked: html.classList.contains('session-overlay-open'),
          bodyLocked: body.classList.contains('session-overlay-open'),
        },
        computed: {
          contentPaddingTop: getComputedStyle(content).paddingTop,
          headerPaddingTop: getComputedStyle(header).paddingTop,
          headerPosition: getComputedStyle(header).position,
          contentDisplay: getComputedStyle(content).display,
          bodyOverflowY: getComputedStyle(overlayBody).overflowY,
        },
        scrollTop: {
          content: content.scrollTop,
          body: overlayBody?.scrollTop ?? 0,
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

  function expectHeaderFullyVisible(result: Awaited<ReturnType<typeof readOverlayLayout>>) {
    expect(result.header.top).toBeGreaterThanOrEqual(result.backdrop.top - 1);
    if (result.header.height <= result.backdrop.height) {
      expect(result.header.bottom).toBeLessThanOrEqual(result.backdrop.bottom + 1);
    }
    expect(result.scrollTop.content).toBe(0);
  }

  function expectPageWasNotPinned(result: Awaited<ReturnType<typeof readOverlayLayout>>) {
    expect(result.appInline).toEqual({
      position: '',
      top: '',
      left: '',
      right: '',
      width: '',
    });
    expect(result.bodyInline).toEqual({
      position: '',
      top: '',
      overflow: '',
    });
  }

  function expectOverlayArchitecture(result: Awaited<ReturnType<typeof readOverlayLayout>>) {
    expect(result.classes.htmlLocked).toBe(true);
    expect(result.classes.bodyLocked).toBe(true);
    expect(result.computed.headerPosition).not.toBe('sticky');
    expect(result.computed.contentDisplay).toBe('grid');
    expect(result.computed.bodyOverflowY).toMatch(/auto|scroll/);
    expect(result.scrollTop.content).toBe(0);
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

  test('opens from sticky SessionDetailView tabs without moving the page or hiding the header', async ({ page }) => {
    await navigateToSession(page);
    const stickyState = await scrollUntilSessionTabsStuck(page);
    expect(stickyState).not.toBeNull();
    expect(stickyState!.scrollY).toBeGreaterThan(0);
    expect(stickyState!.stuck).toBe(true);
    const beforeOpenScrollY = stickyState!.scrollY;

    await installScrollToSpy(page);
    await clearScrollToSpy(page);

    await openOverlay(page);

    expect(await readScrollToCalls(page)).toEqual([]);
    const afterOpenScrollY = await page.evaluate(() => window.scrollY);
    expect(Math.abs(afterOpenScrollY - beforeOpenScrollY)).toBeLessThanOrEqual(1);

    const result = await readOverlayLayout(page);
    expectBackdropCoversViewport(result);
    expectContentCoversViewport(result);
    expectHeaderAtViewportTop(result);
    expectHeaderFullyVisible(result);
    expectPageWasNotPinned(result);
    expectOverlayArchitecture(result);
    expect(result.headerRow.top).toBeLessThan(80);
    expect(result.computed.contentPaddingTop).toBe('0px');
  });

  test('closing overlay returns to the same SessionDetailView scroll position', async ({ page }) => {
    await navigateToSession(page);
    const stickyState = await scrollUntilSessionTabsStuck(page);
    expect(stickyState).not.toBeNull();
    const beforeScrollY = stickyState!.scrollY;

    await openOverlay(page);
    await page.locator('[data-testid="session-chat-overlay-close-handle"]').click();
    await expect(page.locator('[data-testid="session-chat-overlay"]')).toBeHidden();

    const afterScrollY = await page.evaluate(() => window.scrollY);
    expect(Math.abs(afterScrollY - beforeScrollY)).toBeLessThanOrEqual(1);
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
    expectHeaderFullyVisible(result);
    expect(result.headerRow.top).toBeLessThan(80);
    expect(result.computed.contentPaddingTop).toBe('0px');
  });

  test('keeps the full header visible after switching to a child session', async ({ page }) => {
    const child = await seedSession(project.id, {
      prompt: 'Child layout regression',
      name: 'Layout Child',
      parentSessionId: session.id,
    });
    await waitForSessionToExist(child.id);
    seedConversationHistory(child.id, 20);

    await navigateToSession(page);
    await openOverlay(page);

    const dropdown = page.locator('[data-testid="session-tree-dropdown"]');
    await expect(dropdown).toBeVisible({ timeout: 10000 });
    await dropdown.locator('.dropdown-trigger').click();
    const picker = page.locator('[data-testid="session-chat-picker"]');
    await expect(picker).toBeVisible({ timeout: 5000 });
    await picker.locator('[role="option"]').filter({ hasText: 'Layout Child' }).click();
    await expect(picker).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="session-chat-overlay"] .conversation-tab')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(400);

    const result = await readOverlayLayout(page);
    expectBackdropCoversViewport(result);
    expectContentCoversViewport(result);
    expectHeaderFullyVisible(result);
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
