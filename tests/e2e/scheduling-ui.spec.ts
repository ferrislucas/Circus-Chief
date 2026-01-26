import { test, expect } from '@playwright/test';
import { seedProject, seedSession, cleanupAll, navigateAndWait } from './helpers';

test.describe('Scheduling UI', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Scheduling Test Project', '/tmp/scheduling-test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test.describe('Clock Icon Visibility', () => {

    test('clock icon appears next to Start Session button for draft sessions', async ({ page }) => {
      // Create a draft session (startImmediately: false keeps it in waiting status)
      const session = await seedSession(project.id, { prompt: 'Test prompt for scheduling', startImmediately: false });

      // Navigate to the session
      await navigateAndWait(page, `/sessions/${session.id}`);

      // Expand the Orchestration panel (it starts collapsed)
      const orchestrationPanel = page.locator('.orchestration-panel .panel-header');
      await orchestrationPanel.click();

      // Verify clock icon button exists next to Start Session
      const clockButton = page.locator('.btn-schedule');
      await expect(clockButton).toBeVisible();

      // Verify Start Session button also exists
      const startButton = page.locator('button:has-text("Start Session")');
      await expect(startButton).toBeVisible();
    });

    test('clock icon is disabled when no content in textarea for draft', async ({ page }) => {
      // Create a draft session with content (API requires non-empty prompt)
      const session = await seedSession(project.id, { prompt: 'Initial content', startImmediately: false });

      // Navigate to the session
      await navigateAndWait(page, `/sessions/${session.id}`);

      // Expand the Orchestration panel
      const orchestrationPanel = page.locator('.orchestration-panel .panel-header');
      await orchestrationPanel.click();

      // Clear the textarea content
      const textarea = page.locator('textarea');
      await textarea.clear();

      // Clock button should now be disabled (no content)
      const clockButton = page.locator('.btn-schedule');
      await expect(clockButton).toBeDisabled();
    });

  });

  test.describe('Scheduling Modal', () => {

    test('clicking clock icon opens scheduling modal for draft session', async ({ page }) => {
      // Create a draft session
      const session = await seedSession(project.id, { prompt: 'Test prompt', startImmediately: false });

      // Navigate to the session
      await navigateAndWait(page, `/sessions/${session.id}`);

      // Expand the Orchestration panel
      const orchestrationPanel = page.locator('.orchestration-panel .panel-header');
      await orchestrationPanel.click();

      // Click clock icon
      await page.click('.btn-schedule');

      // Verify modal opens
      const modal = page.locator('.modal-backdrop');
      await expect(modal).toBeVisible();

      // Verify datetime picker exists
      const datetimePicker = page.locator('input[type="datetime-local"]');
      await expect(datetimePicker).toBeVisible();
    });

    test('scheduling modal shows auto-reschedule toggle directly (no container)', async ({ page }) => {
      // Create a draft session
      const session = await seedSession(project.id, { prompt: 'Test prompt', startImmediately: false });

      // Navigate to the session
      await navigateAndWait(page, `/sessions/${session.id}`);

      // Expand the Orchestration panel
      const orchestrationPanel = page.locator('.orchestration-panel .panel-header');
      await orchestrationPanel.click();

      // Click clock icon
      await page.click('.btn-schedule');

      // Wait for modal to open
      const modal = page.locator('.modal-backdrop');
      await expect(modal).toBeVisible();

      // Verify auto-reschedule toggle is visible within the modal
      const toggle = modal.locator('.toggle-switch').first();
      await expect(toggle).toBeVisible();

      // Verify NO "Scheduling Options" header exists
      const header = modal.locator('h3:has-text("Scheduling Options")');
      await expect(header).not.toBeVisible();
    });
  });

  test.describe('Full Scheduling Flow', () => {

    // Issue #432: Modal doesn't close after clicking Schedule button
    // This test verifies the bug exists and will pass once the issue is fixed
    test('can schedule a draft session for future execution', async ({ page }) => {
      // Create a draft session
      const session = await seedSession(project.id, { prompt: 'Scheduled task: do something', startImmediately: false });

      // Navigate to the session
      await navigateAndWait(page, `/sessions/${session.id}`);

      // Expand the Orchestration panel
      const orchestrationPanel = page.locator('.orchestration-panel .panel-header');
      await orchestrationPanel.click();

      // Click clock icon
      await page.click('.btn-schedule');

      // Set a time in the future (1 hour from now)
      const futureTime = new Date(Date.now() + 3600000);
      const timeString = futureTime.toISOString().slice(0, 16);
      await page.fill('input[type="datetime-local"]', timeString);

      // Wait for Schedule button to be enabled
      const scheduleButton = page.locator('button:has-text("Schedule")');
      await expect(scheduleButton).toBeEnabled({ timeout: 3000 });

      // Click Schedule button
      const modal = page.locator('.modal-backdrop');
      await scheduleButton.click();

      // Wait for modal to close (API call completes successfully)
      await expect(modal).not.toBeVisible({ timeout: 10000 });
    });

    // Issue #434: Scheduled time displays incorrectly until page refresh
    // This test reproduces the bug where the UI shows "56 years ago" instead of correct future time
    test('displays correct scheduled time without page refresh', async ({ page }) => {
      // Create a draft session
      const session = await seedSession(project.id, { prompt: 'Test scheduled time display', startImmediately: false });

      // Navigate to the session
      await navigateAndWait(page, `/sessions/${session.id}`);

      // Expand the Orchestration panel
      const orchestrationPanel = page.locator('.orchestration-panel .panel-header');
      await orchestrationPanel.click();

      // Click clock icon to open scheduling modal
      await page.click('.btn-schedule');

      // Set a time in the future (1 hour from now)
      const futureTime = new Date(Date.now() + 3600000); // 1 hour from now
      const timeString = futureTime.toISOString().slice(0, 16);
      await page.fill('input[type="datetime-local"]', timeString);

      // Wait for Schedule button to be enabled
      const scheduleButton = page.locator('button:has-text("Schedule")');
      await expect(scheduleButton).toBeEnabled({ timeout: 3000 });

      // Click Schedule button
      const modal = page.locator('.modal-backdrop');
      await scheduleButton.click();

      // Wait for modal to close (API call completes successfully)
      await expect(modal).not.toBeVisible({ timeout: 10000 });

      // BUG VERIFICATION: Check the displayed scheduled time
      // Expected: Should show "in about 1 hour" or similar future time
      // Actual (bug): Shows "56 years ago" or other incorrect past time

      // Wait for the scheduling info panel to appear
      const schedulingPanel = page.locator('.scheduling-info.scheduled-panel');
      await expect(schedulingPanel).toBeVisible({ timeout: 5000 });

      // Get the countdown text element
      const countdownText = page.locator('.countdown-text strong');
      await expect(countdownText).toBeVisible({ timeout: 3000 });

      // Get the text content
      const timeText = await countdownText.textContent();

      // The time should NOT contain "ago" (which would indicate a past time)
      // It should contain "in" or similar future indicator
      expect(timeText).not.toMatch(/\d+\s+years?\s+ago/i);
      expect(timeText).not.toMatch(/ago/i);

      // It should indicate a future time (contains "in" or "hour" or similar)
      expect(timeText).toMatch(/in/i);

      // Verify via page reload that the time is still correct
      await page.reload();
      await page.waitForLoadState('networkidle');

      const countdownTextAfterReload = page.locator('.countdown-text strong');
      await expect(countdownTextAfterReload).toBeVisible({ timeout: 5000 });

      const timeTextAfterReload = await countdownTextAfterReload.textContent();
      expect(timeTextAfterReload).not.toMatch(/\d+\s+years?\s+ago/i);
      expect(timeTextAfterReload).toMatch(/in/i);
    });
  });
});
