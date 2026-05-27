import { test, expect } from '@playwright/test';
import {
  seedProject,
  cleanupAll,
  navigateAndWait,
  getAPIURL,
  expectHitTestable,
} from './helpers';

test.describe('Session List Icon Navigation', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Test Project', '/tmp/test');

    // Create a session
    const API_URL = getAPIURL();
    const response = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Test session',
        name: 'Test Session',
        startImmediately: false,
      }),
    });
    session = await response.json();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('session detail back icon navigates to sessions list', async ({ page }) => {
    // Navigate to session detail
    await navigateAndWait(page, `/sessions/${session.id}`);

    // Find and verify back icon link
    const backLink = page.locator('.tab-back');
    await expect(backLink).toBeVisible();
    await expectHitTestable(backLink);
    await expect(backLink.locator('.back-icon')).toBeVisible();
    await expect(backLink.locator('svg')).toHaveCount(2);

    // Click and verify navigation
    await backLink.click();
    await expect(page).toHaveURL(/\/projects\/.*\/sessions/);
  });

  test('back icon has correct title attribute for accessibility', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}`);

    const backLink = page.locator('.tab-back');
    await expect(backLink).toHaveAttribute('title', 'Back to Sessions');
  });
});
