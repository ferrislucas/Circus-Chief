import { test, expect, Page } from '@playwright/test';
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
});
