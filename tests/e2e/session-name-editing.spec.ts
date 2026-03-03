import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  getSession,
  navigateAndWait,
  waitForPageReady,
  getAPIURL,
  trackSession,
} from './helpers';

const API_URL = getAPIURL();

test.describe('Session Name Editing', () => {
  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('can edit session name via inline editing', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Original Name',
      startImmediately: false, // Keep it as a draft to prevent summary service from renaming
    });
    trackSession(session.id);

    // Navigate to session detail page
    await page.goto(`/projects/${project.id}/sessions/${session.id}`);
    await waitForPageReady(page);

    // Click the edit pencil icon
    await page.click('button.name-edit-trigger');

    // Edit input should appear
    const nameInput = page.locator('input.name-edit-input');
    await expect(nameInput).toBeVisible();

    // Clear and enter new name
    await nameInput.fill('');
    await nameInput.fill('Updated Session Name');

    // Click save button
    await page.click('button.pr-save-btn');

    // Verify the name was updated in the UI
    await expect(page.locator('.session-name')).toHaveText('Updated Session Name');

    // Verify via API that the name was updated
    const updatedSession = await getSession(session.id);
    expect(updatedSession.name).toBe('Updated Session Name');
    expect(updatedSession.manuallyNamed).toBe(true);
  });

  test('sets manuallyNamed flag when editing name', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Original Name',
      startImmediately: false,
    });
    trackSession(session.id);

    // Verify manuallyNamed is false initially
    const initialSession = await getSession(session.id);
    expect(initialSession.manuallyNamed).toBe(false);

    // Navigate to session detail page
    await page.goto(`/projects/${project.id}/sessions/${session.id}`);
    await waitForPageReady(page);

    // Click the edit pencil icon and update name
    await page.click('button.name-edit-trigger');
    await page.fill('input.name-edit-input', 'Custom Name');
    await page.click('button.pr-save-btn');

    // Verify manuallyNamed is now true
    const updatedSession = await getSession(session.id);
    expect(updatedSession.manuallyNamed).toBe(true);
    expect(updatedSession.name).toBe('Custom Name');
  });

  test('can cancel name editing by pressing Escape', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Original Name',
      startImmediately: false,
    });
    trackSession(session.id);

    // Navigate to session detail page
    await page.goto(`/projects/${project.id}/sessions/${session.id}`);
    await waitForPageReady(page);

    // Click the edit pencil icon
    await page.click('button.name-edit-trigger');

    // Enter a new name
    await page.fill('input.name-edit-input', 'This Should Not Save');

    // Press Escape to cancel
    await page.keyboard.press('Escape');

    // Verify the name was NOT changed
    await expect(page.locator('.session-name')).toHaveText('Original Name');

    // Verify via API that the name was not updated
    const unchangedSession = await getSession(session.id);
    expect(unchangedSession.name).toBe('Original Name');
    expect(unchangedSession.manuallyNamed).toBe(false);
  });

  test('can cancel name editing by clicking cancel button', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Original Name',
      startImmediately: false,
    });
    trackSession(session.id);

    // Navigate to session detail page
    await page.goto(`/projects/${project.id}/sessions/${session.id}`);
    await waitForPageReady(page);

    // Click the edit pencil icon
    await page.click('button.name-edit-trigger');

    // Enter a new name
    await page.fill('input.name-edit-input', 'This Should Not Save');

    // Click cancel button
    await page.click('button.pr-cancel-btn');

    // Verify the name was NOT changed
    await expect(page.locator('.session-name')).toHaveText('Original Name');

    // Verify via API that the name was not updated
    const unchangedSession = await getSession(session.id);
    expect(unchangedSession.name).toBe('Original Name');
  });

  test('can save name by pressing Enter', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Original Name',
      startImmediately: false,
    });
    trackSession(session.id);

    // Navigate to session detail page
    await page.goto(`/projects/${project.id}/sessions/${session.id}`);
    await waitForPageReady(page);

    // Click the edit pencil icon
    await page.click('button.name-edit-trigger');

    // Enter a new name and press Enter
    await page.fill('input.name-edit-input', 'Name Saved Via Enter');
    await page.keyboard.press('Enter');

    // Verify the name was changed
    await expect(page.locator('.session-name')).toHaveText('Name Saved Via Enter');

    // Verify via API
    const updatedSession = await getSession(session.id);
    expect(updatedSession.name).toBe('Name Saved Via Enter');
  });

  test('shows pencil icon for name editing', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Test Session',
      startImmediately: false,
    });
    trackSession(session.id);

    // Navigate to session detail page
    await page.goto(`/projects/${project.id}/sessions/${session.id}`);
    await waitForPageReady(page);

    // Verify the pencil icon is visible
    const editTrigger = page.locator('button.name-edit-trigger');
    await expect(editTrigger).toBeVisible();
    await expect(editTrigger).toHaveAttribute('title', 'Edit session name');
  });
});
