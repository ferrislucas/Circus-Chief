import { test, expect } from '@playwright/test';
import {
  seedProject,
  cleanupCreatedResources,
  getSession,
  getProjectSessions,
  BASE_URL,
} from './helpers';

test.describe('New workspace form: auto-reschedule default', () => {
  // Keep tests serial — they share project state and git worktree operations
  // should not race.
  test.describe.configure({ mode: 'serial', timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    // Use process.cwd() (a real git repo/worktree) so the form's git panel
    // loads and the submit button is enabled — mirrors git-session-creation.spec.ts.
    project = await seedProject('AutoReschedule Default Test', process.cwd());
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('auto-reschedule toggle defaults ON when Start Immediately is turned off', async ({ page }) => {
    // Navigate to the new session form
    await page.goto(`${BASE_URL}/projects/${project.id}/sessions/new`);

    // Wait for the git options panel — confirms the form has fully loaded
    await page.waitForSelector(
      '[data-testid="git-status-panel"], .git-status, .git-mode-select, select[name="gitMode"], [class*="git"]',
      { timeout: 15000, state: 'visible' },
    ).catch(() => {
      // If no explicit git panel, the form may still be usable
    });

    // Turn OFF Start Immediately by clicking the toggle label inside .field-with-badge
    const startImmediatelyToggle = page
      .locator('.field-with-badge')
      .filter({ hasText: 'Start Immediately' })
      .locator('label.toggle-switch');
    await startImmediatelyToggle.click();

    // Assert the Start Immediately input is now unchecked
    const startImmediatelyInput = page
      .locator('.field-with-badge')
      .filter({ hasText: 'Start Immediately' })
      .locator('input[type="checkbox"]');
    await expect(startImmediatelyInput).not.toBeChecked();

    // The scheduling section should now be visible
    await expect(page.locator('.scheduling-options')).toBeVisible();

    // Locate the auto-reschedule checkbox via its label text
    const autoRescheduleCheckbox = page.locator(
      'label.toggle-switch:has-text("Auto-reschedule on errors") input[type="checkbox"]',
    );

    // Assert auto-reschedule is checked by default (the core assertion)
    await expect(autoRescheduleCheckbox).toBeChecked();

    // Assert the dependent reschedule-settings block is visible — confirms
    // the default-on state cascades properly to the UI.
    await expect(
      page.locator('.scheduling-options .reschedule-settings'),
    ).toBeVisible();
  });

  test('auto-reschedule default ON persists into the created workspace', async ({ page }) => {
    // Navigate to the new session form
    await page.goto(`${BASE_URL}/projects/${project.id}/sessions/new`);

    // Wait for the git panel to confirm the form is fully loaded
    await page.waitForSelector(
      '[data-testid="git-status-panel"], .git-status, .git-mode-select, select[name="gitMode"], [class*="git"]',
      { timeout: 15000, state: 'visible' },
    ).catch(() => {});

    // Turn off Start Immediately
    const startImmediatelyToggle = page
      .locator('.field-with-badge')
      .filter({ hasText: 'Start Immediately' })
      .locator('label.toggle-switch');
    await startImmediatelyToggle.click();

    // Wait for the scheduling options to appear
    await expect(page.locator('.scheduling-options')).toBeVisible();

    // Set a scheduled time at least 1 hour in the future so the workspace
    // stays dormant and does not attempt to spawn an agent.
    const futureTime = new Date(Date.now() + 3600000);
    const timeString = futureTime.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
    const scheduledInput = page.locator('.scheduling-options input[type="datetime-local"]');
    await scheduledInput.fill(timeString);

    // Fill the prompt textarea (submit requires non-empty content)
    await page.fill('textarea[id="prompt"]', 'Auto-reschedule default test prompt');

    // Submit the form
    await page.click('button:has-text("Create Workspace")');

    // Wait for navigation to the created session URL
    await expect(page).toHaveURL(
      /\/sessions\/(?!new(?:$|[/?#]))[0-9a-f-]+/,
      { timeout: 30000 },
    );

    // Extract the session ID from the URL
    const url = page.url();
    const sessionIdMatch = url.match(/\/sessions\/([0-9a-f-]+)/);
    expect(sessionIdMatch).toBeTruthy();
    const sessionId = sessionIdMatch![1];

    // Give the server a moment to persist the session
    await page.waitForTimeout(500);

    // Fetch the created session and assert autoRescheduleEnabled is true
    const session = await getSession(sessionId);
    expect(session).toBeTruthy();
    expect(session.autoRescheduleEnabled).toBe(true);
  });

  test('explicit opt-out of auto-reschedule flows through to created workspace', async ({ page }) => {
    // Navigate to the new session form
    await page.goto(`${BASE_URL}/projects/${project.id}/sessions/new`);

    // Wait for the git panel
    await page.waitForSelector(
      '[data-testid="git-status-panel"], .git-status, .git-mode-select, select[name="gitMode"], [class*="git"]',
      { timeout: 15000, state: 'visible' },
    ).catch(() => {});

    // Turn off Start Immediately
    const startImmediatelyToggle = page
      .locator('.field-with-badge')
      .filter({ hasText: 'Start Immediately' })
      .locator('label.toggle-switch');
    await startImmediatelyToggle.click();

    // Wait for the scheduling options to appear
    await expect(page.locator('.scheduling-options')).toBeVisible();

    // Set a future scheduled time so the workspace stays dormant
    const futureTime = new Date(Date.now() + 3600000);
    const timeString = futureTime.toISOString().slice(0, 16);
    const scheduledInput = page.locator('.scheduling-options input[type="datetime-local"]');
    await scheduledInput.fill(timeString);

    // The auto-reschedule toggle should be ON by default — turn it OFF
    const autoRescheduleLabel = page.locator(
      'label.toggle-switch:has-text("Auto-reschedule on errors")',
    );
    await autoRescheduleLabel.click();

    // Assert it is now unchecked
    const autoRescheduleCheckbox = page.locator(
      'label.toggle-switch:has-text("Auto-reschedule on errors") input[type="checkbox"]',
    );
    await expect(autoRescheduleCheckbox).not.toBeChecked();

    // Assert the reschedule-settings block is now hidden (v-if="autoRescheduleEnabled")
    await expect(
      page.locator('.scheduling-options .reschedule-settings'),
    ).not.toBeVisible();

    // Fill the prompt and submit
    await page.fill('textarea[id="prompt"]', 'Auto-reschedule opt-out test prompt');
    await page.click('button:has-text("Create Workspace")');

    // Wait for navigation to the created session URL
    await expect(page).toHaveURL(
      /\/sessions\/(?!new(?:$|[/?#]))[0-9a-f-]+/,
      { timeout: 30000 },
    );

    // Extract the session ID
    const url = page.url();
    const sessionIdMatch = url.match(/\/sessions\/([0-9a-f-]+)/);
    expect(sessionIdMatch).toBeTruthy();
    const sessionId = sessionIdMatch![1];

    await page.waitForTimeout(500);

    // Fetch the created session and assert autoRescheduleEnabled is false
    const session = await getSession(sessionId);
    expect(session).toBeTruthy();
    expect(session.autoRescheduleEnabled).toBe(false);
  });
});
