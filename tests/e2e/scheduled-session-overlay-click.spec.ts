import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  updateSessionScheduling,
  waitForSessionToExist,
  waitForSessionScheduled,
  navigateAndWait,
  cleanupAll,
  getSession,
} from './helpers';

test.describe('Scheduled Session Name Click Opens Overlay', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Scheduled Overlay Test', '/tmp/scheduled-overlay-test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('clicking a scheduled child session name opens overlay with that session selected', async ({ page }) => {
    // Create a parent session (not scheduled, so it doesn't appear in its own scheduled list)
    const parent = await seedSession(project.id, {
      prompt: 'Parent prompt',
      name: 'Parent Session',
      startImmediately: false,
    });

    // Create a child session and mark it as scheduled
    const child = await seedChildSession(project.id, parent.id, {
      prompt: 'Child prompt',
      name: 'Child Scheduled',
    });
    await waitForSessionToExist(child.id);
    await updateSessionScheduling(child.id, {
      status: 'scheduled',
      scheduledAt: Date.now() + 3600000,
    });
    await waitForSessionScheduled(child.id);

    // Navigate to parent's summary tab
    await navigateAndWait(page, `/sessions/${parent.id}/summary`);

    // Wait for the scheduled session card to render
    const nameButton = page.locator('[data-testid="scheduled-session-name-btn"]');
    await expect(nameButton).toBeVisible();
    await expect(nameButton).toContainText('Child Scheduled');

    // Record URL before click
    const urlBefore = page.url();

    // Click the child's name button
    await nameButton.click();

    // Verify overlay opens
    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible();

    // Open the picker dropdown
    const pickerDropdown = page.locator('[data-testid="overlay-picker-trigger"]');
    await expect(pickerDropdown).toBeVisible();
    await pickerDropdown.click();

    // Wait for the picker to open
    const picker = page.locator('[data-testid="session-chat-picker"]');
    await expect(picker).toBeVisible();

    // Verify the child session is selected in the picker
    const activePickerItem = page.locator('.picker-item--active .picker-item-name');
    await expect(activePickerItem).toContainText('Child Scheduled');

    // Verify URL did not change (no navigation)
    expect(page.url()).toBe(urlBefore);
  });

  test('clicking a scheduled root session name opens overlay on that session', async ({ page }) => {
    // Create a scheduled root session (it appears in its own scheduled list)
    const session = await seedSession(project.id, {
      prompt: 'Root scheduled prompt',
      name: 'Root Scheduled',
      startImmediately: false,
    });
    await waitForSessionToExist(session.id);
    await updateSessionScheduling(session.id, {
      status: 'scheduled',
      scheduledAt: Date.now() + 3600000,
    });
    await waitForSessionScheduled(session.id);

    // Navigate to its own summary tab
    await navigateAndWait(page, `/sessions/${session.id}/summary`);

    // Wait for the scheduled session card to render
    const nameButton = page.locator('[data-testid="scheduled-session-name-btn"]');
    await expect(nameButton).toBeVisible();
    await expect(nameButton).toContainText('Root Scheduled');

    // Record URL before click
    const urlBefore = page.url();

    // Click the session's own name button
    await nameButton.click();

    // Verify overlay opens
    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible();

    // Verify URL did not change (no navigation)
    expect(page.url()).toBe(urlBefore);
  });
});
