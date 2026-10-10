import { test, expect, Page, Locator } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedWorkLog,
  updateSessionStatus,
  cleanupAll,
  getAPIURL,
  openSessionOverlay,
} from './helpers';
import { WORK_LOG_SCROLL_THRESHOLD } from '../../packages/web/src/composables/useWorkLogFollow.js';

const API_URL = getAPIURL();

/**
 * E2E coverage for the agent output pane (LiveWorkLogPanel inside
 * RunningState): while the agent is working, the pane must always show the
 * newest thinking / intermediate output (tail) and keep the viewport pinned
 * to the bottom — unless the user has manually scrolled up, in which case
 * incoming output must not yank the viewport.
 *
 * Seeding work logs via the API exercises the real-time WebSocket path, the
 * same way `work-log-panels.spec.ts` does.
 */

/** Distance (in px) from the bottom of a scroll container. */
async function distanceFromBottom(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance < 0 ? 0 : distance;
  });
}

async function isAtBottom(page: Page, selector: string): Promise<boolean> {
  return (await distanceFromBottom(page, selector)) <= WORK_LOG_SCROLL_THRESHOLD;
}

async function openRunningPane(page: Page, sessionId: string) {
  await page.goto(`${API_URL}/sessions/${sessionId}/summary`);
  await openSessionOverlay(page);
  await page.waitForSelector('.running-state', { timeout: 10000 });
  await expect(page.locator('.running-state .live-work-log-panel')).toBeVisible();
}

/**
 * Regression helpers for Issue 1 (P2): the collapsed tail preview must keep
 * the newest tool-output line actually visible when its last ten logical
 * lines wrap beyond the 300px inner height cap. Text presence alone is
 * insufficient — the marker must be unclipped by every scrolling ancestor.
 */
const WRAP_SEGMENT = 'w'.repeat(280);

function buildWrappedThirtyLineOutput(headMarker: string, tailMarker: string): string {
  const head = [
    `${headMarker}-line-01`,
    ...Array.from({ length: 19 }, (_, i) => `head filler line ${String(i + 2).padStart(2, '0')}`),
  ];
  const tail = Array.from(
    { length: 9 },
    (_, i) => `tail wrap line ${i + 21} ${WRAP_SEGMENT}`
  );
  tail.push(`${WRAP_SEGMENT} ${tailMarker}`);
  return [...head, ...tail].join('\n');
}

interface WrappedMarkerVisibility {
  found: boolean;
  inViewport: boolean;
  clippedBy: string | null;
}

async function wrappedMarkerVisibility(
  pre: Locator,
  marker: string
): Promise<WrappedMarkerVisibility> {
  return pre.evaluate((el, markerText) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let target: Text | null = null;
    let offset = -1;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const at = node.data.indexOf(markerText);
      if (at >= 0) {
        target = node;
        offset = at;
        break;
      }
    }
    if (!target || offset < 0) {
      return { found: false, inViewport: false, clippedBy: 'missing' };
    }
    const range = document.createRange();
    range.setStart(target, offset);
    range.setEnd(target, offset + markerText.length);
    const rect = range.getBoundingClientRect();
    const inViewport =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight + 1 &&
      rect.right <= window.innerWidth + 1;
    // The marker must also be unclipped by the outer follow container and
    // any inner scrolling ancestor (e.g. a height-capped <pre>).
    const liveLogs = el.closest('.live-logs');
    let cursor: HTMLElement | null = el as HTMLElement;
    let clippedBy: string | null = null;
    while (cursor) {
      const style = getComputedStyle(cursor);
      const isScroller = style.overflowY === 'auto' || style.overflowY === 'scroll';
      if (isScroller && cursor.scrollHeight > cursor.clientHeight + 1) {
        const box = cursor.getBoundingClientRect();
        if (rect.top < box.top - 1 || rect.bottom > box.bottom + 1) {
          clippedBy = cursor.className?.toString?.() || cursor.tagName;
          break;
        }
      }
      if (cursor === liveLogs) break;
      cursor = cursor.parentElement;
    }
    return { found: true, inViewport, clippedBy };
  }, marker);
}

async function expectMarkerLaidOutVisible(pre: Locator, marker: string) {
  await expect
    .poll(
      async () => wrappedMarkerVisibility(pre, marker),
      { timeout: 10000 }
    )
    .toEqual({ found: true, inViewport: true, clippedBy: null });
}

async function settleOuterFollow(page: Page) {
  await expect
    .poll(async () => distanceFromBottom(page, '.live-work-log-panel .live-logs'), {
      timeout: 10000,
    })
    .toBeLessThanOrEqual(WORK_LOG_SCROLL_THRESHOLD);
}

test.describe('Agent Output Pane Auto-Tail', () => {
  test.describe.configure({ timeout: 90000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Agent Output Pane', process.cwd());
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('outer pane stays pinned to the bottom as new output streams in', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test output tail',
      name: 'Agent Output Tail Follow',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await openRunningPane(page, session.id);

    // Stream enough logs to overflow the 250px pane.
    for (let i = 1; i <= 25; i++) {
      await seedWorkLog(session.id, {
        type: 'tool_output',
        content: `output line ${i}`,
        toolName: 'Bash',
      });
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 100));
    }

    await expect
      .poll(
        async () =>
          page
            .locator('.live-work-log-panel .live-logs')
            .first()
            .evaluate((el) => el.scrollHeight > el.clientHeight),
        { timeout: 10000 }
      )
      .toBe(true);

    await expect
      .poll(async () => distanceFromBottom(page, '.live-work-log-panel .live-logs'), {
        timeout: 5000,
      })
      .toBeLessThanOrEqual(WORK_LOG_SCROLL_THRESHOLD);
    expect(await isAtBottom(page, '.live-work-log-panel .live-logs')).toBe(true);
  });

  test('long thinking shows its tail (newest), not its head', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test thinking tail',
      name: 'Agent Output Thinking Tail',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await openRunningPane(page, session.id);

    const HEAD_MARKER = 'HEAD-MARKER-THINKING-AAA';
    const TAIL_MARKER = 'TAIL-MARKER-THINKING-ZZZ';
    // Well over ThinkingBlock's 500-char truncation budget.
    const content = `${HEAD_MARKER}\n${'filler thinking line\n'.repeat(60)}${TAIL_MARKER}`;
    await seedWorkLog(session.id, { type: 'thinking', content });

    const thinkingText = page.locator('.live-work-log-panel .thinking-text').first();
    await expect(thinkingText).toBeVisible({ timeout: 10000 });
    // The pane must surface the newest output: the tail marker has to be
    // rendered without requiring a "Show more" click.
    await expect(thinkingText).toContainText(TAIL_MARKER, { timeout: 5000 });
  });

  test('long tool output shows its tail (newest lines), not its head', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test tool output tail',
      name: 'Agent Output Tool Tail',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await openRunningPane(page, session.id);

    // Well over CommandBlock's 10-line truncation budget.
    const lines = Array.from({ length: 30 }, (_, i) => `TOOL-LINE-${String(i + 1).padStart(2, '0')}`);
    await seedWorkLog(session.id, {
      type: 'tool_output',
      content: lines.join('\n'),
      toolName: 'Bash',
    });

    const commandPre = page.locator('.live-work-log-panel .command-pre').first();
    await expect(commandPre).toBeVisible({ timeout: 10000 });
    await expect(commandPre).toContainText('TOOL-LINE-30', { timeout: 5000 });
  });

  test('manually scrolling up pauses the tail; new output does not yank it back', async ({
    page,
  }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test pause on scroll up',
      name: 'Agent Output Pause',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await openRunningPane(page, session.id);

    for (let i = 1; i <= 25; i++) {
      await seedWorkLog(session.id, {
        type: 'tool_output',
        content: `pause-test line ${i}`,
        toolName: 'Bash',
      });
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 100));
    }

    const container = page.locator('.live-work-log-panel .live-logs').first();
    await expect
      .poll(async () => container.evaluate((el) => el.scrollHeight > el.clientHeight), {
        timeout: 10000,
      })
      .toBe(true);

    // Simulate the user scrolling to the top.
    await container.evaluate((el) => {
      el.scrollTop = 0;
    });
    await container.dispatchEvent('scroll');
    expect(await container.evaluate((el) => el.scrollTop)).toBe(0);

    // Stream more output; the viewport must stay where the user left it.
    for (let i = 26; i <= 30; i++) {
      await seedWorkLog(session.id, {
        type: 'tool_output',
        content: `pause-test line ${i}`,
        toolName: 'Bash',
      });
    }
    // Wait for the newest output to actually arrive before asserting position.
    await expect(page.locator('.live-work-log-panel')).toContainText('pause-test line 30', {
      timeout: 10000,
    });
    expect(await container.evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('wrapped tail keeps the newest line visible without interaction', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 });
    const session = await seedSession(project.id, {
      prompt: 'Test wrapped tail visibility',
      name: 'Agent Output Wrapped Tail',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await openRunningPane(page, session.id);

    const HEAD_MARKER = 'HEAD-WRAP-VIS-AAA';
    const TAIL_MARKER = 'TAIL-WRAP-VIS-ZZZ';
    await seedWorkLog(session.id, {
      type: 'tool_output',
      content: buildWrappedThirtyLineOutput(HEAD_MARKER, TAIL_MARKER),
      toolName: 'Bash',
    });

    const commandPre = page.locator('.live-work-log-panel .command-pre').first();
    await expect(commandPre).toBeVisible({ timeout: 10000 });
    // Tail preview contract: newest ten lines rendered, head omitted.
    await expect(commandPre).toContainText(TAIL_MARKER, { timeout: 5000 });
    await expect(commandPre).not.toContainText(HEAD_MARKER);
    // Fixture guard: the wrapped tail must genuinely exceed the old 300px cap.
    await expect
      .poll(
        async () => commandPre.evaluate((el) => el.scrollHeight),
        { timeout: 10000 }
      )
      .toBeGreaterThan(300);
    // Still collapsed: no expansion, no inner scrolling.
    await expect(page.locator('.live-work-log-panel .show-more-btn').first()).toBeVisible();
    await settleOuterFollow(page);
    await expectMarkerLaidOutVisible(commandPre, TAIL_MARKER);
  });

  test('short output with long wrapping lines keeps the newest line visible', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 480, height: 800 });
    const session = await seedSession(project.id, {
      prompt: 'Test short wrapped tail',
      name: 'Agent Output Short Wrapped Tail',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await openRunningPane(page, session.id);

    // Single long wrapping logical line (no truncation at all).
    const SINGLE_MARKER = 'TAIL-SINGLE-WRAP-ZZZ';
    await seedWorkLog(session.id, {
      type: 'tool_output',
      content: `${'y'.repeat(2000)} ${SINGLE_MARKER}`,
      toolName: 'Bash',
    });
    const singlePre = page.locator('.live-work-log-panel .command-pre').first();
    await expect(singlePre).toContainText(SINGLE_MARKER, { timeout: 10000 });
    await expect
      .poll(async () => singlePre.evaluate((el) => el.scrollHeight), { timeout: 10000 })
      .toBeGreaterThan(300);
    await settleOuterFollow(page);
    await expectMarkerLaidOutVisible(singlePre, SINGLE_MARKER);

    // Five long wrapping logical lines (under the ten-line budget).
    const FEW_MARKER = 'TAIL-FEW-WRAP-ZZZ';
    const fewLines = Array.from({ length: 4 }, (_, i) => `short tail line ${i + 1} ${WRAP_SEGMENT}`);
    fewLines.push(`${WRAP_SEGMENT} ${FEW_MARKER}`);
    await seedWorkLog(session.id, {
      type: 'tool_output',
      content: fewLines.join('\n'),
      toolName: 'Bash',
    });
    const fewPre = page.locator('.live-work-log-panel .command-pre').nth(1);
    await expect(fewPre).toContainText(FEW_MARKER, { timeout: 10000 });
    await expect
      .poll(async () => fewPre.evaluate((el) => el.scrollHeight), { timeout: 10000 })
      .toBeGreaterThan(300);
    await settleOuterFollow(page);
    await expectMarkerLaidOutVisible(fewPre, FEW_MARKER);
  });

  test('Show more reveals full wrapped output and Show less returns to visible tail', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 480, height: 800 });
    const session = await seedSession(project.id, {
      prompt: 'Test wrapped expand round-trip',
      name: 'Agent Output Wrapped Expand',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await openRunningPane(page, session.id);

    const HEAD_MARKER = 'HEAD-WRAP-EXPAND-AAA';
    const TAIL_MARKER = 'TAIL-WRAP-EXPAND-ZZZ';
    await seedWorkLog(session.id, {
      type: 'tool_output',
      content: buildWrappedThirtyLineOutput(HEAD_MARKER, TAIL_MARKER),
      toolName: 'Bash',
    });

    const commandPre = page.locator('.live-work-log-panel .command-pre').first();
    await expect(commandPre).toContainText(TAIL_MARKER, { timeout: 10000 });

    const toggle = page.locator('.live-work-log-panel .show-more-btn').first();
    await toggle.click();
    await expect(commandPre).toContainText(HEAD_MARKER, { timeout: 5000 });
    await expect(toggle).toHaveText('Show less');

    await toggle.click();
    await expect(commandPre).toContainText(TAIL_MARKER, { timeout: 5000 });
    await expect(commandPre).not.toContainText(HEAD_MARKER);
    // Collapsed again: newest line must be reachable at the bottom of the
    // outer follow container without inner scrolling.
    const container = page.locator('.live-work-log-panel .live-logs').first();
    await container.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await container.dispatchEvent('scroll');
    await settleOuterFollow(page);
    await expectMarkerLaidOutVisible(commandPre, TAIL_MARKER);
  });

  test('manual pause/resume works with wrapped content', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 });
    const session = await seedSession(project.id, {
      prompt: 'Test wrapped pause resume',
      name: 'Agent Output Wrapped Pause',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await openRunningPane(page, session.id);

    const FIRST_MARKER = 'TAIL-WRAP-PAUSE-111';
    await seedWorkLog(session.id, {
      type: 'tool_output',
      content: buildWrappedThirtyLineOutput('HEAD-WRAP-PAUSE-AAA', FIRST_MARKER),
      toolName: 'Bash',
    });
    const firstPre = page.locator('.live-work-log-panel .command-pre').first();
    await expect(firstPre).toContainText(FIRST_MARKER, { timeout: 10000 });
    await settleOuterFollow(page);
    await expectMarkerLaidOutVisible(firstPre, FIRST_MARKER);

    // User scrolls up: follow disengages.
    const container = page.locator('.live-work-log-panel .live-logs').first();
    await container.evaluate((el) => {
      el.scrollTop = 0;
    });
    await container.dispatchEvent('scroll');
    expect(await container.evaluate((el) => el.scrollTop)).toBe(0);

    // New wrapped output arrives while paused: viewport must not move.
    const SECOND_MARKER = 'TAIL-WRAP-PAUSE-222';
    await seedWorkLog(session.id, {
      type: 'tool_output',
      content: buildWrappedThirtyLineOutput('HEAD-WRAP-PAUSE-BBB', SECOND_MARKER),
      toolName: 'Bash',
    });
    const secondPre = page.locator('.live-work-log-panel .command-pre').nth(1);
    await expect(secondPre).toContainText(SECOND_MARKER, { timeout: 10000 });
    expect(await container.evaluate((el) => el.scrollTop)).toBe(0);

    // Scrolling back within the follow threshold resumes following and
    // exposes the newest marker.
    await container.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await container.dispatchEvent('scroll');
    await settleOuterFollow(page);
    await expectMarkerLaidOutVisible(secondPre, SECOND_MARKER);
  });

  test('tail override is scoped: raw JSON details keep the 300px cap', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 });
    const session = await seedSession(project.id, {
      prompt: 'Test tail scope',
      name: 'Agent Output Tail Scope',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await openRunningPane(page, session.id);

    const TAIL_MARKER = 'TAIL-WRAP-SCOPE-ZZZ';
    await seedWorkLog(session.id, {
      type: 'tool_output',
      content: buildWrappedThirtyLineOutput('HEAD-WRAP-SCOPE-AAA', TAIL_MARKER),
      toolName: 'Bash',
    });
    await seedWorkLog(session.id, {
      type: 'tool_input',
      content: JSON.stringify({ command: 'echo scoped', timeout: 30000 }),
      toolName: 'Bash',
    });

    const tailPre = page.locator('.live-work-log-panel .command-pre').first();
    await expect(tailPre).toContainText(TAIL_MARKER, { timeout: 10000 });
    // The collapsed tail preview no longer carries the inner 300px cap, so
    // the outer follow container owns scrolling to the newest line.
    await expect
      .poll(async () => tailPre.evaluate((el) => getComputedStyle(el).maxHeight), {
        timeout: 5000,
      })
      .not.toBe('300px');

    const rawJsonPre = page.locator('.live-work-log-panel .raw-json-details .command-pre').first();
    await expect(rawJsonPre).toBeAttached({ timeout: 10000 });
    expect(await rawJsonPre.evaluate((el) => getComputedStyle(el).maxHeight)).toBe('300px');
  });
});
