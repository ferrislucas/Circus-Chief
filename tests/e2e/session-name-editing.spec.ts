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
    await page.goto(`/sessions/${session.id}`);
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
    await page.goto(`/sessions/${session.id}`);
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
    await page.goto(`/sessions/${session.id}`);
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
    await page.goto(`/sessions/${session.id}`);
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
    await page.goto(`/sessions/${session.id}`);
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
    await page.goto(`/sessions/${session.id}`);
    await waitForPageReady(page);

    // Verify the pencil icon is visible
    const editTrigger = page.locator('button.name-edit-trigger');
    await expect(editTrigger).toBeVisible();
    await expect(editTrigger).toHaveAttribute('title', 'Edit session name');
  });

  test('clear button is not visible before entering edit mode', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Some Long Session Name',
      startImmediately: false,
    });
    trackSession(session.id);

    await page.goto(`/sessions/${session.id}`);
    await waitForPageReady(page);

    // Clear button should not exist when not editing
    await expect(page.locator('.name-edit-form button.pr-clear-btn')).toHaveCount(0);
  });

  test('clear button appears when editing a session with a name', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Some Long Session Name',
      startImmediately: false,
    });
    trackSession(session.id);

    await page.goto(`/sessions/${session.id}`);
    await waitForPageReady(page);

    // Enter edit mode
    await page.click('button.name-edit-trigger');

    // Clear button should be visible (input has text)
    const clearBtn = page.locator('.name-edit-form button.pr-clear-btn');
    await expect(clearBtn).toBeVisible();
    await expect(clearBtn).toHaveAttribute('title', 'Clear name');
  });

  test('clicking clear empties the input and keeps edit mode open', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Some Long Session Name',
      startImmediately: false,
    });
    trackSession(session.id);

    await page.goto(`/sessions/${session.id}`);
    await waitForPageReady(page);

    // Enter edit mode
    await page.click('button.name-edit-trigger');

    // Verify input has the original name
    const nameInput = page.locator('input.name-edit-input');
    await expect(nameInput).toHaveValue('Some Long Session Name');

    // Click clear
    await page.click('.name-edit-form button.pr-clear-btn');

    // Input should be empty
    await expect(nameInput).toHaveValue('');

    // Should still be in edit mode (input still visible)
    await expect(nameInput).toBeVisible();

    // Clear button should now be hidden (no text in input)
    await expect(page.locator('.name-edit-form button.pr-clear-btn')).toHaveCount(0);
  });

  test('can clear name, type a new name, and save', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Original Very Long Session Name That Is Annoying To Select',
      startImmediately: false,
    });
    trackSession(session.id);

    await page.goto(`/sessions/${session.id}`);
    await waitForPageReady(page);

    // Enter edit mode
    await page.click('button.name-edit-trigger');

    // Click clear to empty the field
    await page.click('.name-edit-form button.pr-clear-btn');

    // Type a new name
    const nameInput = page.locator('input.name-edit-input');
    await nameInput.fill('Short New Name');

    // Save
    await page.click('button.pr-save-btn');

    // Verify the name was updated in the UI
    await expect(page.locator('.session-name')).toHaveText('Short New Name');

    // Verify via API that the name was persisted
    const updatedSession = await getSession(session.id);
    expect(updatedSession.name).toBe('Short New Name');
    expect(updatedSession.manuallyNamed).toBe(true);
  });

  test('cancelling after clear restores the original name', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Original Name',
      startImmediately: false,
    });
    trackSession(session.id);

    await page.goto(`/sessions/${session.id}`);
    await waitForPageReady(page);

    // Enter edit mode
    await page.click('button.name-edit-trigger');

    // Click clear
    await page.click('.name-edit-form button.pr-clear-btn');

    // Cancel via Escape
    await page.keyboard.press('Escape');

    // Original name should still be displayed
    await expect(page.locator('.session-name')).toHaveText('Original Name');

    // Verify via API that nothing was saved
    const unchangedSession = await getSession(session.id);
    expect(unchangedSession.name).toBe('Original Name');
    expect(unchangedSession.manuallyNamed).toBe(false);
  });

  test('input is focused after clicking clear', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Some Name',
      startImmediately: false,
    });
    trackSession(session.id);

    await page.goto(`/sessions/${session.id}`);
    await waitForPageReady(page);

    // Enter edit mode
    await page.click('button.name-edit-trigger');

    // Click clear
    await page.click('.name-edit-form button.pr-clear-btn');

    // Input should be focused — typing should go into the input
    await page.keyboard.type('Typed After Clear');
    const nameInput = page.locator('input.name-edit-input');
    await expect(nameInput).toHaveValue('Typed After Clear');
  });
});
