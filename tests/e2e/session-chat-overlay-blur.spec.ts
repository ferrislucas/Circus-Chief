import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedConversationHistory,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
} from './helpers';

test.describe('SessionChatOverlay blur recovery', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async ({ page }) => {
    project = await seedProject('Overlay Blur', '/tmp/overlay-blur');
    session = await seedSession(project.id, {
      prompt: 'Blur recovery',
      name: 'Blur Test',
    });
    await waitForSessionToExist(session.id);
    seedConversationHistory(session.id, 20);

    // Install the mock visualViewport BEFORE the page loads. The guard lets
    // the test skip (not fail) on engines that expose a non-configurable
    // native visualViewport; unit tests remain the primary coverage.
    await page.addInitScript(() => {
      const desc = Object.getOwnPropertyDescriptor(window, 'visualViewport');
      if (desc && desc.configurable === false) {
        (window as any).__vvMockInstalled = false;
        return;
      }
      const vv: any = {
        offsetTop: 0,
        offsetLeft: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        _listeners: { resize: [] as Function[], scroll: [] as Function[] },
      };
      vv.addEventListener = (t: string, fn: Function) => vv._listeners[t]?.push(fn);
      vv.removeEventListener = (t: string, fn: Function) => {
        const arr = vv._listeners[t];
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      };
      try {
        Object.defineProperty(window, 'visualViewport', {
          configurable: true,
          value: vv,
        });
        (window as any).__vvMockInstalled = true;
      } catch {
        (window as any).__vvMockInstalled = false;
        return;
      }
      (window as any).__setVV = (patch: any, events: string[] = ['resize']) => {
        Object.assign(vv, patch);
        events.forEach((t) =>
          vv._listeners[t]?.forEach((fn: Function) => fn())
        );
      };
    });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  async function openOverlay(page: any) {
    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();
    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    // Allow slide-in animation to settle.
    await page.waitForTimeout(400);
    return overlay;
  }

  async function skipIfNoVVMock(page: any) {
    const installed = await page.evaluate(() => (window as any).__vvMockInstalled);
    test.skip(
      !installed,
      'visualViewport is non-configurable in this browser; covered by unit tests'
    );
  }

  test('recovers from stale terminal resize after blur', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });
    await skipIfNoVVMock(page);

    await openOverlay(page);

    const textarea = page
      .locator('[data-testid="session-chat-overlay"] textarea')
      .first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.focus();

    // Simulate keyboard open.
    await page.evaluate(() =>
      (window as any).__setVV({ height: 300, offsetTop: 0 })
    );

    // Blur, then fire the STALE final event (height still small, offsetTop large).
    await textarea.blur();
    await page.evaluate(() =>
      (window as any).__setVV({ height: 300, offsetTop: 180 })
    );

    // Allow blur-recovery timers (350 ms, 700 ms) + slack.
    await page.waitForTimeout(900);

    const backdrop = page.locator('[data-testid="session-chat-overlay"]');
    const { top, height, width, innerHeight, innerWidth } = await backdrop.evaluate(
      (el) => ({
        top: (el as HTMLElement).style.top,
        height: (el as HTMLElement).style.height,
        width: (el as HTMLElement).style.width,
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
      })
    );
    expect(top).toBe('0px');
    expect(height).toBe(`${innerHeight}px`);
    expect(width).toBe(`${innerWidth}px`);
  });

  test('does not clamp when no recent blur (iPad URL-bar case)', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });
    await skipIfNoVVMock(page);

    // Simulate URL-bar retraction before any blur occurs. No events dispatched
    // so the overlay hasn't synced yet — we'll check after open.
    await page.evaluate(() =>
      (window as any).__setVV(
        { offsetTop: 50, height: window.innerHeight - 50 },
        []
      )
    );

    await openOverlay(page);

    // Nudge a single resize so syncToVisualViewport runs with the URL-bar
    // offsets (this is the behavior guarded by commit 6d61f905).
    await page.evaluate(() =>
      (window as any).__setVV(
        { offsetTop: 50, height: window.innerHeight - 50 },
        ['resize']
      )
    );
    await page.waitForTimeout(50);

    const geometry = await page
      .locator('[data-testid="session-chat-overlay"]')
      .evaluate((el) => ({
        top: (el as HTMLElement).style.top,
        height: (el as HTMLElement).style.height,
      }));
    // Commit 6d61f905's fix must be preserved: vv values are honored when no
    // blur has recently occurred.
    expect(geometry.top).toBe('50px');
    expect(parseInt(geometry.height, 10)).toBeLessThan(1000);
    expect(parseInt(geometry.height, 10)).toBeGreaterThan(0);
  });

  test('SessionDetailView content is not visible behind overlay after blur', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });
    await skipIfNoVVMock(page);

    await openOverlay(page);

    // Reproduce stale-blur sequence.
    const textarea = page
      .locator('[data-testid="session-chat-overlay"] textarea')
      .first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.focus();
    await page.evaluate(() =>
      (window as any).__setVV({ height: 300, offsetTop: 0 })
    );
    await textarea.blur();
    await page.evaluate(() =>
      (window as any).__setVV({ height: 300, offsetTop: 180 })
    );
    await page.waitForTimeout(900);

    // The marker on SessionDetailView root must exist — confirming the
    // component that would bleed through is present in the DOM.
    const background = page.locator('[data-testid="session-detail-view-marker"]');
    await expect(background).toBeAttached();

    // Bleed-through is only possible when the overlay is SMALLER than the
    // visible viewport. After the blur-recovery clamp fires, the overlay
    // must cover [0, innerHeight]. If these invariants hold, no background
    // can show through above or below the overlay band in the viewport.
    const viewport = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    }));
    const overlayGeom = await page
      .locator('[data-testid="session-chat-overlay"]')
      .evaluate((el) => {
        const s = (el as HTMLElement).style;
        const rect = (el as HTMLElement).getBoundingClientRect();
        return {
          styleTop: s.top,
          styleHeight: s.height,
          styleWidth: s.width,
          rectTop: rect.top,
          rectBottom: rect.bottom,
          rectLeft: rect.left,
          rectRight: rect.right,
        };
      });

    // The clamp must have written full-viewport geometry to the backdrop.
    expect(overlayGeom.styleTop).toBe('0px');
    expect(overlayGeom.styleHeight).toBe(`${viewport.innerHeight}px`);
    expect(overlayGeom.styleWidth).toBe(`${viewport.innerWidth}px`);

    // And the rendered rect must actually cover the viewport.
    expect(overlayGeom.rectTop).toBeLessThanOrEqual(0);
    expect(overlayGeom.rectBottom).toBeGreaterThanOrEqual(viewport.innerHeight);
    expect(overlayGeom.rectLeft).toBeLessThanOrEqual(0);
    expect(overlayGeom.rectRight).toBeGreaterThanOrEqual(viewport.innerWidth);
  });
});
