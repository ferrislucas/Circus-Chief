import { test, expect, Page } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedCommandButton,
  cleanupAll,
  navigateAndWait,
  waitForSessionToExist,
} from './helpers';
import { OUTPUT_BOTTOM_TOLERANCE_PX } from '../../packages/web/src/composables/useOutputAutoTail.js';

/**
 * E2E coverage for the Circus Command output auto-tail behavior described in
 * circus-command-output-auto-tail-frd.md: output panes must follow newest
 * output by default, pause when the user scrolls away from the bottom, and
 * resume when the user scrolls back within tolerance - for both the inline
 * Commands-tab pane and the command-status modal.
 *
 * Fixture: a small Node script that prints numbered lines on a short
 * interval and exits normally. Node is already a repository requirement,
 * so this avoids relying on platform-specific `seq`/`sleep` behavior.
 */
const LINE_COUNT = 80;
const INTERVAL_MS = 40;
const FIXTURE_COMMAND =
  `node -e "let i=1;const id=setInterval(()=>{console.log('LINE ' + i);` +
  `if(i>=${LINE_COUNT}){clearInterval(id);}i++;},${INTERVAL_MS});"`;

/** Distance (in px) from the bottom of a scroll container. */
async function distanceFromBottom(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((el) => {
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance < 0 ? 0 : distance;
  });
}

async function isAtBottom(page: Page, selector: string): Promise<boolean> {
  return (await distanceFromBottom(page, selector)) <= OUTPUT_BOTTOM_TOLERANCE_PX;
}

/** Highest "LINE N" marker currently rendered in the given container. */
async function latestLineMarker(page: Page, selector: string): Promise<number> {
  const text = (await page.locator(selector).innerText()) || '';
  const matches = [...text.matchAll(/LINE (\d+)/g)].map((m) => parseInt(m[1], 10));
  return matches.length ? Math.max(...matches) : 0;
}

test.describe('Circus Command Output Auto-Tail', () => {
  test.describe.configure({ timeout: 90000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Auto-Tail Test', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'Test prompt', name: 'Auto-Tail Session' });
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('inline pane follows output, pauses on manual scroll, and resumes at bottom', async ({ page }) => {
    await seedCommandButton(project.id, {
      label: 'Numbered Output',
      command: FIXTURE_COMMAND,
    });

    await navigateAndWait(page, `/sessions/${session.id}/commands`, {
      waitFor: '[data-testid="run-button"]',
      timeout: 15000,
    });

    // Start the command via the UI so the store registers the run before any
    // output arrives (WS output for unregistered runs is otherwise dropped).
    await page.locator('[data-testid="run-button"]').click();

    // Expand the output pane while output is still arriving.
    await expect(page.locator('[data-testid="kill-button"]')).toBeVisible({ timeout: 10000 });
    await page.click('.output-header');
    await expect(page.locator('.output-text')).toBeVisible({ timeout: 5000 });

    // Wait for enough output to overflow the pane.
    await expect
      .poll(
        async () => page.locator('.output-text').evaluate((el) => el.scrollHeight > el.clientHeight),
        { timeout: 10000 }
      )
      .toBe(true);

    // While tailing, the pane should already be following the bottom.
    await expect
      .poll(async () => distanceFromBottom(page, '.output-text'), { timeout: 5000 })
      .toBeLessThanOrEqual(OUTPUT_BOTTOM_TOLERANCE_PX);

    // Confirm it keeps following as more output streams in.
    const markerBeforeContinuedFollow = await latestLineMarker(page, '.output-text');
    await expect
      .poll(async () => latestLineMarker(page, '.output-text'), { timeout: 5000 })
      .toBeGreaterThan(markerBeforeContinuedFollow);
    expect(await isAtBottom(page, '.output-text')).toBe(true);

    // Manually scroll up (simulating direct user interaction) and confirm a
    // later emission does not pull the viewport back down.
    await page.locator('.output-text').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.locator('.output-text').dispatchEvent('scroll');
    const scrollTopAfterUserScroll = await page.locator('.output-text').evaluate((el) => el.scrollTop);
    expect(scrollTopAfterUserScroll).toBe(0);

    const markerAtPause = await latestLineMarker(page, '.output-text');
    await expect
      .poll(async () => latestLineMarker(page, '.output-text'), { timeout: 5000 })
      .toBeGreaterThan(markerAtPause);
    // The pane must not have jumped back to the bottom while paused.
    expect(await page.locator('.output-text').evaluate((el) => el.scrollTop)).toBe(0);

    // Scroll back to the bottom; later output should be followed again,
    // through command completion.
    await page.locator('.output-text').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.locator('.output-text').dispatchEvent('scroll');

    await expect(page.locator('.status-running')).toBeHidden({ timeout: 15000 });
    await expect
      .poll(async () => distanceFromBottom(page, '.output-text'), { timeout: 5000 })
      .toBeLessThanOrEqual(OUTPUT_BOTTOM_TOLERANCE_PX);
    const finalText = await page.locator('.output-text').innerText();
    expect(finalText).toContain(`LINE ${LINE_COUNT}`);
  });

  test('status-modal pane follows output, pauses on manual scroll, and resumes at bottom', async ({ page }) => {
    await seedCommandButton(project.id, {
      label: 'Numbered Modal Output',
      command: FIXTURE_COMMAND,
      showOnList: true,
    });

    // Stay on the Commands tab so its WebSocket handlers remain mounted and
    // keep streaming output into the shared store while the modal is open -
    // the persistent session header (with the status indicator) is visible
    // regardless of which tab is active.
    await navigateAndWait(page, `/sessions/${session.id}/commands`, {
      waitFor: '[data-testid="run-button"]',
      timeout: 15000,
    });
    await page.locator('[data-testid="run-button"]').click();
    await expect(page.locator('[data-testid="kill-button"]')).toBeVisible({ timeout: 10000 });

    // Open the status modal from the session header's status indicator.
    await page.locator('.command-status-bar').waitFor({ state: 'attached', timeout: 10000 });
    const statusIndicator = page
      .locator('.command-status-bar .button-status-indicator[title*="Numbered Modal Output"]')
      .first();
    await statusIndicator.waitFor({ state: 'visible', timeout: 15000 });
    await statusIndicator.click();
    await page.locator('[data-testid="button-status-modal"]').waitFor({ state: 'visible', timeout: 5000 });

    // Expand Process Output while the command is still running.
    await page.click('[data-testid="output-header"]');
    await expect(page.locator('[data-testid="output-content"]')).toBeVisible({ timeout: 5000 });

    const outputContent = '[data-testid="output-content"]';

    // Wait for enough output to overflow the pane, then confirm it is
    // already following the bottom (tail mode).
    await expect
      .poll(
        async () => page.locator(outputContent).evaluate((el) => el.scrollHeight > el.clientHeight),
        { timeout: 10000 }
      )
      .toBe(true);
    await expect
      .poll(async () => distanceFromBottom(page, outputContent), { timeout: 5000 })
      .toBeLessThanOrEqual(OUTPUT_BOTTOM_TOLERANCE_PX);

    const markerBeforeContinuedFollow = await latestLineMarker(page, outputContent);
    await expect
      .poll(async () => latestLineMarker(page, outputContent), { timeout: 5000 })
      .toBeGreaterThan(markerBeforeContinuedFollow);
    expect(await isAtBottom(page, outputContent)).toBe(true);

    // Manual upward scroll pauses tailing; later output must not move it.
    await page.locator(outputContent).evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.locator(outputContent).dispatchEvent('scroll');

    const markerAtPause = await latestLineMarker(page, outputContent);
    await expect
      .poll(async () => latestLineMarker(page, outputContent), { timeout: 5000 })
      .toBeGreaterThan(markerAtPause);
    expect(await page.locator(outputContent).evaluate((el) => el.scrollTop)).toBe(0);

    // Returning to the bottom resumes following through completion.
    await page.locator(outputContent).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.locator(outputContent).dispatchEvent('scroll');

    // Wait for the command to fully complete (final numbered line rendered).
    // Note: the modal's status badge itself is a known pre-existing snapshot
    // (it freezes to the status at the moment the indicator was clicked) and
    // is unrelated to auto-tail, so completion is verified via output content.
    await expect
      .poll(async () => latestLineMarker(page, outputContent), { timeout: 10000 })
      .toBe(LINE_COUNT);
    await expect
      .poll(async () => distanceFromBottom(page, outputContent), { timeout: 5000 })
      .toBeLessThanOrEqual(OUTPUT_BOTTOM_TOLERANCE_PX);
    const finalText = await page.locator(outputContent).innerText();
    expect(finalText).toContain(`LINE ${LINE_COUNT}`);
  });
});
