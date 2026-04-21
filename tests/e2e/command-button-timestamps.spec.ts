import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedCommandButton,
  runCommandButtonAndWait,
  navigateAndWait,
  waitForSessionToExist,
  cleanupCreatedResources,
} from './helpers';

/**
 * E2E tests for the new Start/End timestamp display in the command button UI.
 *
 * These tests cover both surfaces introduced by the plan:
 *   1. The per-row <RunTimestamps> block inside <CommandButtonItem>
 *      on the session Commands tab.
 *   2. The Last Started / Last Ended columns in <CommandButtonsPanel>
 *      at `/projects/:id/commands`.
 *
 * We seed + execute command buttons via the API so the assertions focus on
 * DOM output rather than on the run lifecycle.
 */

test.describe('Command Button Timestamps', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Timestamps Test', '/tmp');
    session = await seedSession(project.id, {
      prompt: 'Timestamps test prompt',
      name: 'Timestamps Session',
      startImmediately: false,
    });
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('session Commands tab: completed run shows Started and Ended timestamps + duration', async ({ page }) => {
    const button = await seedCommandButton(project.id, {
      label: 'Echo Hello',
      command: 'echo hello',
    });

    // Execute a short command via API and wait for completion.
    const completed = await runCommandButtonAndWait(session.id, button.id);
    expect(completed.status).toBe('success');

    // Navigate AFTER the run has settled so the snapshot-on-mount logic
    // populates the Pinia store with the latest run for this button.
    await navigateAndWait(page, `/sessions/${session.id}/commands`, {
      waitFor: `[data-testid="command-button-item-${button.id}"]`,
      timeout: 15000,
    });

    const row = page.locator(`[data-testid="command-button-item-${button.id}"]`);

    // The new <RunTimestamps> block is always mounted for every button.
    const timestamps = row.locator('[data-testid="run-timestamps"]');
    await expect(timestamps).toBeVisible({ timeout: 10000 });

    const text = await timestamps.innerText();
    // "Started HH:MM(:SS)?"
    expect(text).toMatch(/Started\s+\d{1,2}:\d{2}(:\d{2})?/i);
    // "Ended HH:MM(:SS)?"
    expect(text).toMatch(/Ended\s+\d{1,2}:\d{2}(:\d{2})?/i);
    // Duration — either ".Xs" or "Ns" or "Nm Ns"
    expect(text).toMatch(/(?:\d+\.\d+s|\d+s|\d+m\s+\d+s|\d+h\s+\d+m|\d+d\s+\d+h)/);

    // Each <time> element must carry the a11y triplet.
    const timeEls = timestamps.locator('time');
    const timeCount = await timeEls.count();
    expect(timeCount).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < timeCount; i++) {
      const el = timeEls.nth(i);
      await expect(el).toHaveAttribute('datetime', /.+/);
      await expect(el).toHaveAttribute('title', /.+/);
      await expect(el).toHaveAttribute('aria-label', /.+/);
    }
  });

  test('session Commands tab: button with no run renders "Not yet run"', async ({ page }) => {
    const button = await seedCommandButton(project.id, {
      label: 'Never Run',
      command: 'true',
    });

    await navigateAndWait(page, `/sessions/${session.id}/commands`, {
      waitFor: `[data-testid="command-button-item-${button.id}"]`,
      timeout: 15000,
    });

    const row = page.locator(`[data-testid="command-button-item-${button.id}"]`);
    const timestamps = row.locator('[data-testid="run-timestamps"]');
    await expect(timestamps).toBeVisible();
    await expect(timestamps).toContainText(/Not yet run/i);
  });

  test('admin Commands page: Last Started / Last Ended columns exist with data', async ({ page }) => {
    const button = await seedCommandButton(project.id, {
      label: 'Admin Test',
      command: 'echo admin',
    });

    // Run the command first so the snapshot endpoint returns a row for it.
    const completed = await runCommandButtonAndWait(session.id, button.id);
    expect(completed.status).toBe('success');

    await navigateAndWait(page, `/projects/${project.id}/commands`, {
      waitFor: '.table-header',
      timeout: 15000,
    });

    // Header labels
    const header = page.locator('.table-header');
    await expect(header).toContainText('Last Started');
    await expect(header).toContainText('Last Ended');

    // At least one body row references our seeded button label.
    const bodyRow = page.locator('.table-row', { hasText: 'Admin Test' });
    await expect(bodyRow).toBeVisible();

    // Started + Ended cells should render HH:MM(:SS) values, not em-dash.
    const startedCell = bodyRow.locator('.col-started');
    const endedCell = bodyRow.locator('.col-ended');
    await expect(startedCell).toBeVisible();
    await expect(endedCell).toBeVisible();

    const startedText = (await startedCell.innerText()).trim();
    const endedText = (await endedCell.innerText()).trim();

    // Tolerate minor label prefixes emitted by the responsive ::before on narrow viewports.
    expect(startedText).toMatch(/\d{1,2}:\d{2}(:\d{2})?/);
    expect(endedText).toMatch(/\d{1,2}:\d{2}(:\d{2})?/);
  });

  test('admin Commands page: button with no runs renders em-dash in both columns', async ({ page }) => {
    await seedCommandButton(project.id, {
      label: 'Unrun Admin Button',
      command: 'echo unrun',
    });

    await navigateAndWait(page, `/projects/${project.id}/commands`, {
      waitFor: '.table-header',
      timeout: 15000,
    });

    const bodyRow = page.locator('.table-row', { hasText: 'Unrun Admin Button' });
    await expect(bodyRow).toBeVisible();

    const startedCell = bodyRow.locator('.col-started');
    const endedCell = bodyRow.locator('.col-ended');

    // Em-dash is \u2014 (—). innerText collapses whitespace so compare trimmed.
    const startedText = (await startedCell.innerText()).trim();
    const endedText = (await endedCell.innerText()).trim();
    expect(startedText).toContain('\u2014');
    expect(endedText).toContain('\u2014');
  });
});
