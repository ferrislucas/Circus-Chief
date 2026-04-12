import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedConversationHistory,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
} from './helpers';

/**
 * Diagnostic test for the reported bug:
 *   "If the underlying view is scrolled down when the overlay opens,
 *    the overlay header gets scrolled above the viewport and can't be
 *    scrolled back."
 *
 * This test captures full geometry of the overlay ancestry so we can
 * identify exactly which element is positioned incorrectly (or has a
 * nonzero scrollTop) when the bug reproduces.
 */
test.describe('SessionChatOverlay header scroll bug diagnosis', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;

  test.beforeEach(async () => {
    project = await seedProject('Overlay Header Bug', '/tmp/overlay-header-bug');
    parentSession = await seedSession(project.id, {
      prompt: 'Parent prompt',
      name: 'Header Bug Parent',
    });
    await waitForSessionToExist(parentSession.id);
    // Seed a lot of messages so the underlying page is DEFINITELY scrollable
    // (conversation is tall enough that scrolling 300+px is possible)
    seedConversationHistory(parentSession.id, 200);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  // Dump everything interesting about the overlay DOM so we can diagnose
  async function captureOverlayState(page: any) {
    return await page.evaluate(() => {
      function rect(el: Element | null) {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom };
      }
      function scrollInfo(el: Element | null) {
        if (!el) return null;
        return {
          scrollTop: (el as HTMLElement).scrollTop,
          scrollHeight: (el as HTMLElement).scrollHeight,
          clientHeight: (el as HTMLElement).clientHeight,
        };
      }
      function containingBlockInfo(el: Element | null) {
        if (!el) return null;
        // Walk ancestors and flag anything that creates a containing block
        // for position:fixed descendants (transform, filter, perspective,
        // will-change, contain, backdrop-filter).
        const hits: any[] = [];
        let cur: Element | null = el.parentElement;
        while (cur && cur !== document.documentElement) {
          const cs = window.getComputedStyle(cur);
          const relevant = {
            transform: cs.transform,
            filter: cs.filter,
            perspective: cs.perspective,
            willChange: cs.willChange,
            contain: cs.contain,
            backdropFilter: cs.backdropFilter,
            position: cs.position,
            top: cs.top,
          };
          const createsContainingBlock =
            (relevant.transform && relevant.transform !== 'none') ||
            (relevant.filter && relevant.filter !== 'none') ||
            (relevant.perspective && relevant.perspective !== 'none') ||
            (relevant.willChange && /transform|filter|perspective/.test(relevant.willChange)) ||
            (relevant.contain && /paint|layout|strict|content/.test(relevant.contain)) ||
            (relevant.backdropFilter && relevant.backdropFilter !== 'none');
          if (createsContainingBlock) {
            hits.push({
              tag: cur.tagName.toLowerCase(),
              id: (cur as HTMLElement).id || null,
              className: (cur as HTMLElement).className || null,
              ...relevant,
            });
          }
          cur = cur.parentElement;
        }
        return hits;
      }

      const backdrop = document.querySelector('.overlay-dialog');
      const panelWrapper = document.querySelector('.overlay-panel-wrapper');
      const content = document.querySelector('.overlay-content');
      const header = document.querySelector('.overlay-header');
      const body = document.querySelector('.overlay-body');

      const bodyEl = document.body;
      const htmlEl = document.documentElement;

      return {
        window: {
          scrollY: window.scrollY,
          innerHeight: window.innerHeight,
          innerWidth: window.innerWidth,
        },
        bodyStyle: {
          position: bodyEl.style.position,
          top: bodyEl.style.top,
          overflow: bodyEl.style.overflow,
          width: bodyEl.style.width,
        },
        bodyComputed: {
          position: window.getComputedStyle(bodyEl).position,
          top: window.getComputedStyle(bodyEl).top,
        },
        htmlScrollTop: htmlEl.scrollTop,
        rects: {
          backdrop: rect(backdrop),
          panelWrapper: rect(panelWrapper),
          content: rect(content),
          header: rect(header),
          body: rect(body),
        },
        scrollInfo: {
          backdrop: scrollInfo(backdrop),
          panelWrapper: scrollInfo(panelWrapper),
          content: scrollInfo(content),
          body: scrollInfo(body),
        },
        backdropContainingBlockAncestors: containingBlockInfo(backdrop),
      };
    });
  }

  test('BASELINE: overlay opens correctly when page is NOT scrolled', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${parentSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    // Do NOT scroll the underlying view
    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();

    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(600); // let slide-in animation finish

    const state = await captureOverlayState(page);
    console.log('\n=== BASELINE (no scroll) ===');
    console.log(JSON.stringify(state, null, 2));

    // Header should be at viewport top
    expect(state.rects.header).not.toBeNull();
    expect(state.rects.header!.top).toBeGreaterThanOrEqual(-1);
    expect(state.rects.header!.top).toBeLessThan(5);
  });

  test('SANITY: forcing overlay-content.scrollTop SHOULD push header above viewport', async ({ page }) => {
    // This test verifies that our measurement technique works:
    // if overlay-content somehow gets scrolled, the header MUST go above the viewport.
    // If this test fails, our assertion is wrong. If it passes, our assertion is correct
    // and the bug repro must be causing overlay-content.scrollTop != 0 somehow.
    await navigateAndWait(page, `/sessions/${parentSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();
    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(600);

    const before = await page.evaluate(() => {
      const h = document.querySelector('.overlay-header') as HTMLElement | null;
      return h?.getBoundingClientRect().top ?? null;
    });
    console.log(`Header top BEFORE forced scroll: ${before}`);
    expect(before).toBeGreaterThanOrEqual(-1);
    expect(before).toBeLessThan(5);

    // Force the overlay-content to scroll (which overflow:hidden allows programmatically)
    const programmatic = await page.evaluate(() => {
      const content = document.querySelector('.overlay-content') as HTMLElement | null;
      if (!content) return { ok: false };
      content.scrollTop = 80;
      return {
        ok: true,
        scrollTop: content.scrollTop,
        scrollHeight: content.scrollHeight,
        clientHeight: content.clientHeight,
      };
    });
    console.log('Forced scroll result:', JSON.stringify(programmatic));

    const after = await page.evaluate(() => {
      const h = document.querySelector('.overlay-header') as HTMLElement | null;
      const c = document.querySelector('.overlay-content') as HTMLElement | null;
      return {
        headerTop: h?.getBoundingClientRect().top ?? null,
        contentScrollTop: c?.scrollTop ?? null,
      };
    });
    console.log('State after forced scroll:', JSON.stringify(after));

    // If overflow:hidden actually permits programmatic scroll, we should see the header
    // pushed above the viewport. This is the DIAGNOSTIC expectation.
    if (after.contentScrollTop && after.contentScrollTop > 0) {
      console.log(`✓ overflow:hidden permits programmatic scroll (scrollTop=${after.contentScrollTop})`);
      console.log(`✓ Header is now at y=${after.headerTop} (should be negative if bug exists)`);
    } else {
      console.log('✗ overflow:hidden BLOCKED programmatic scroll — content.scrollTop stayed at 0');
    }
  });

  test('INSTRUMENTED: capture scroll events during overlay open', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${parentSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    await page.waitForTimeout(2500);

    // Scroll the page
    await page.evaluate(() => {
      window.scrollTo(0, 300);
    });
    await page.waitForTimeout(200);

    // Install scroll event listeners BEFORE opening the overlay, on every
    // descendant that could possibly scroll. We record every event with
    // timestamp, target, and current scrollTop so we can see if anything
    // scrolls transiently during the open sequence.
    await page.evaluate(() => {
      (window as any).__scrollEvents = [];
      const targets = [
        document.documentElement,
        document.body,
      ];
      function onScroll(ev: Event) {
        const t = ev.target as HTMLElement;
        (window as any).__scrollEvents.push({
          time: performance.now(),
          tag: (t === document as any) ? 'document' : (t?.tagName?.toLowerCase() || 'unknown'),
          className: (t as any)?.className || null,
          scrollTop: (t as any)?.scrollTop ?? 0,
        });
      }
      // Capture-phase listener on window to catch scroll from every element
      window.addEventListener('scroll', onScroll, { capture: true, passive: true });
      // Poll for the overlay being inserted so we can attach listeners
      // on its descendants too.
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          m.addedNodes.forEach((n) => {
            if (!(n instanceof HTMLElement)) return;
            if (n.classList?.contains('overlay-dialog') || n.querySelector?.('.overlay-dialog')) {
              const backdrop = n.classList.contains('overlay-dialog')
                ? n
                : n.querySelector('.overlay-dialog') as HTMLElement;
              if (backdrop) {
                (window as any).__scrollEvents.push({
                  time: performance.now(),
                  tag: 'OVERLAY_INSERTED',
                  className: backdrop.className,
                  scrollTop: 0,
                });
                // Attach to each descendant of backdrop
                backdrop.querySelectorAll('*').forEach((el) => {
                  el.addEventListener('scroll', onScroll, { capture: false, passive: true });
                });
                backdrop.addEventListener('scroll', onScroll, { capture: false, passive: true });
              }
            }
          });
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      (window as any).__scrollObserver = observer;
    });

    const preOpen = await page.evaluate(() => ({
      windowScrollY: window.scrollY,
      bodyTop: document.body.style.top,
    }));
    console.log('\n=== INSTRUMENTED PRE-OPEN ===');
    console.log(JSON.stringify(preOpen, null, 2));

    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();

    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    // Take multiple snapshots: immediately, then at intervals
    const snapshots: any[] = [];
    for (const delay of [0, 50, 100, 200, 400, 700, 1000]) {
      await page.waitForTimeout(delay);
      const snap = await page.evaluate(() => {
        function rect(el: Element | null) {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: r.top, left: r.left, width: r.width, height: r.height };
        }
        function scroll(el: Element | null) {
          if (!el) return null;
          return {
            scrollTop: (el as HTMLElement).scrollTop,
            scrollHeight: (el as HTMLElement).scrollHeight,
            clientHeight: (el as HTMLElement).clientHeight,
          };
        }
        return {
          t: performance.now(),
          bodyTop: document.body.style.top,
          header: rect(document.querySelector('.overlay-header')),
          backdrop: rect(document.querySelector('.overlay-dialog')),
          content: {
            rect: rect(document.querySelector('.overlay-content')),
            scroll: scroll(document.querySelector('.overlay-content')),
          },
          overlayBody: {
            rect: rect(document.querySelector('.overlay-body')),
            scroll: scroll(document.querySelector('.overlay-body')),
          },
          htmlScroll: document.documentElement.scrollTop,
          docBodyScroll: document.body.scrollTop,
        };
      });
      snapshots.push({ at: delay, ...snap });
    }

    console.log('\n=== SNAPSHOTS OVER TIME ===');
    console.log(JSON.stringify(snapshots, null, 2));

    const scrollEvents = await page.evaluate(() => (window as any).__scrollEvents || []);
    console.log('\n=== SCROLL EVENTS DURING OPEN ===');
    console.log(JSON.stringify(scrollEvents, null, 2));

    // Check header position in every snapshot
    const badSnapshots = snapshots.filter((s) => s.header && s.header.top < -1);
    if (badSnapshots.length > 0) {
      console.log('\n!!! HEADER WAS SCROLLED ABOVE VIEWPORT IN SOME SNAPSHOTS !!!');
      console.log(JSON.stringify(badSnapshots, null, 2));
    }
  });

  test('BUG REPRO (mobile viewport): scroll underlying view then open overlay', async ({ page }) => {
    // Use a mobile-sized viewport. This is where sticky/fixed+scroll-lock
    // bugs typically manifest.
    await page.setViewportSize({ width: 390, height: 700 });

    await navigateAndWait(page, `/sessions/${parentSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    // Wait longer for messages/conversation to finish rendering so the page
    // is at full height before we try to scroll. Otherwise our scroll target
    // can be clamped by a not-yet-tall-enough document.
    await page.waitForTimeout(2000);

    // Scroll the page down meaningfully. Try multiple strategies so we
    // definitely hit whichever element is the real scroller.
    await page.evaluate(() => {
      window.scrollTo(0, 300);
      document.documentElement.scrollTop = 300;
      document.body.scrollTop = 300;
      document
        .querySelectorAll('.session-detail, .conversation-tab, .messages')
        .forEach((el) => {
          (el as HTMLElement).scrollTop = 300;
        });
    });
    // Also do a "realistic" wheel scroll in case pure scrollTop assignment
    // is intercepted by something.
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(300);

    // Capture the underlying scroll state before opening overlay
    const preOpen = await page.evaluate(() => {
      // Find all scrollable elements (to discover the real scroll container)
      const scrollables: any[] = [];
      document.querySelectorAll('*').forEach((el) => {
        const he = el as HTMLElement;
        if (he.scrollHeight > he.clientHeight + 1) {
          const cs = window.getComputedStyle(he);
          if (cs.overflowY === 'auto' || cs.overflowY === 'scroll' || he === document.documentElement || he === document.body) {
            scrollables.push({
              tag: he.tagName.toLowerCase(),
              className: he.className || null,
              scrollTop: he.scrollTop,
              scrollHeight: he.scrollHeight,
              clientHeight: he.clientHeight,
            });
          }
        }
      });
      return {
        windowScrollY: window.scrollY,
        documentScrollTop: document.documentElement.scrollTop,
        bodyScrollTop: document.body.scrollTop,
        detailScrollTop: (document.querySelector('.session-detail') as HTMLElement | null)?.scrollTop ?? null,
        messagesScrollTop: (document.querySelector('.messages') as HTMLElement | null)?.scrollTop ?? null,
        conversationScrollTop: (document.querySelector('.conversation-tab') as HTMLElement | null)?.scrollTop ?? null,
        scrollables,
      };
    });
    console.log('\n=== PRE-OPEN SCROLL STATE ===');
    console.log(JSON.stringify(preOpen, null, 2));

    // Open the overlay
    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();

    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(600); // let slide-in animation finish

    const state = await captureOverlayState(page);
    console.log('\n=== BUG REPRO (scrolled) ===');
    console.log(JSON.stringify(state, null, 2));

    // Report header position
    const headerTop = state.rects.header?.top ?? null;
    const backdropTop = state.rects.backdrop?.top ?? null;
    console.log(`\nHEADER top: ${headerTop}`);
    console.log(`BACKDROP top: ${backdropTop}`);
    console.log(`BODY style top: ${state.bodyStyle.top}`);
    console.log(`window.scrollY: ${state.window.scrollY}`);

    // Expectation that SHOULD hold (and that we suspect fails):
    // The header must be at or near viewport top (y = 0).
    expect(state.rects.header).not.toBeNull();
    expect(state.rects.header!.top).toBeGreaterThanOrEqual(-1);
    expect(state.rects.header!.top).toBeLessThan(5);
  });

  test('REGRESSION: scroll lock must not put document.body in position:fixed with negative top', async ({ page }) => {
    // Root cause of the header-above-viewport bug:
    // The previous scroll lock set `document.body.style.position = 'fixed'`
    // and `document.body.style.top = '-${savedScrollY}px'`. On Safari/WebKit,
    // `position: fixed` descendants of a `position: fixed` ancestor get
    // shifted by the ancestor's `top` value, so the overlay dialog — which
    // is supposed to be pinned to the viewport — ends up offset upward by the
    // amount the underlying page was scrolled. The sticky header rides along
    // with it, ending up above the viewport.
    //
    // The overlay now uses a native <dialog> element with showModal(), which
    // eliminates this entire class of bugs. The browser handles scroll locking
    // natively, and no manual position:fixed hacks are needed.
    //
    // This test encodes that contract: after opening the overlay with the
    // underlying view scrolled, document.body must NOT be in position:fixed
    // with a negative top.
    await navigateAndWait(page, `/sessions/${parentSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });
    await page.waitForTimeout(2000);

    // Scroll the underlying page a bit, as reported: "scroll down an inch or so"
    await page.evaluate(() => {
      window.scrollTo(0, 200);
    });
    await page.waitForTimeout(200);

    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();

    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(600);

    const lockState = await page.evaluate(() => ({
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyOverflow: document.body.style.overflow,
      appPosition: (document.getElementById('app') as HTMLElement | null)?.style.position ?? null,
      appTop: (document.getElementById('app') as HTMLElement | null)?.style.top ?? null,
      headerTop: document.querySelector('.overlay-header')?.getBoundingClientRect().top ?? null,
    }));
    console.log('\n=== REGRESSION LOCK STATE ===');
    console.log(JSON.stringify(lockState, null, 2));

    // Body must NOT be in position:fixed — that's the buggy pattern.
    expect(lockState.bodyPosition).not.toBe('fixed');
    // Body top must NOT be a negative pixel value like "-200px".
    expect(lockState.bodyTop || '').not.toMatch(/^-\d+px$/);
    // And the header must still be anchored at the viewport top.
    expect(lockState.headerTop).not.toBeNull();
    expect(lockState.headerTop!).toBeGreaterThanOrEqual(-1);
    expect(lockState.headerTop!).toBeLessThan(5);
  });

  test('BUG REPRO (desktop, large scroll): scroll underlying view then open overlay', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${parentSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    await page.waitForTimeout(2500);

    // Scroll hard — hundreds of px
    await page.evaluate(() => {
      window.scrollTo(0, 800);
      document.documentElement.scrollTop = 800;
    });
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(300);

    const preOpen = await page.evaluate(() => ({
      windowScrollY: window.scrollY,
      documentScrollTop: document.documentElement.scrollTop,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
    }));
    console.log('\n=== PRE-OPEN SCROLL STATE (desktop large) ===');
    console.log(JSON.stringify(preOpen, null, 2));

    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();

    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(600);

    const state = await captureOverlayState(page);
    console.log('\n=== BUG REPRO (desktop large) ===');
    console.log(JSON.stringify(state, null, 2));

    console.log(`\nHEADER top: ${state.rects.header?.top}`);
    console.log(`BACKDROP top: ${state.rects.backdrop?.top}`);
    console.log(`BODY style top: ${state.bodyStyle.top}`);

    expect(state.rects.header).not.toBeNull();
    expect(state.rects.header!.top).toBeGreaterThanOrEqual(-1);
    expect(state.rects.header!.top).toBeLessThan(5);
  });
});
