import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  navigateAndWait,
  BASE_URL,
  trackSession,
} from './helpers';

test.describe('Session Overlay Auto-Open', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Overlay Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('overlay auto-opens after creating a new session from the form', async ({ page }) => {
    // Navigate to the new session form
    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/sessions/new`);

    // Fill in the prompt textarea
    await page.fill('textarea[id="prompt"]', 'Test overlay auto-open');

    // Submit the form (default is startImmediately=true → button text is "Start Session")
    await page.click('button:has-text("Start Session")');

    // Wait for redirect to the session detail page
    await page.waitForURL(/\/sessions\/[\w-]+/, { timeout: 30000 });
    await page.locator('.session-detail').waitFor({ state: 'visible', timeout: 15000 });

    // Track the newly created session for cleanup
    const url = page.url();
    const sessionId = url.match(/\/sessions\/([\w-]+)/)?.[1];
    if (sessionId) trackSession(sessionId);

    // Assert the chat overlay is visible
    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 10000 });

    // Assert the URL no longer contains ?overlay=open (query param was cleaned up)
    expect(page.url()).not.toContain('overlay=open');

    // Assert the overlay is STILL visible even after the query param was cleared.
    // This specifically catches the key-change remount bug where changing the key
    // from $route.fullPath to $route.path would destroy and remount the component,
    // losing the chatOverlayOpen state.
    await expect(overlay).toBeVisible();
  });

  test('overlay does not auto-open when navigating directly to a session', async ({ page }) => {
    // Seed a session via API (not through the form)
    const session = await seedSession(project.id, {
      prompt: 'Test no auto-open',
      startImmediately: false,
    });

    // Navigate directly to the session (no ?overlay=open query param)
    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}`, {
      waitFor: '.session-detail',
    });

    // Assert the chat overlay is NOT visible
    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).not.toBeVisible();

    // The chat handle should be visible instead (the button to open the overlay)
    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible();
  });

  test('navigating between different sessions still remounts the component', async ({ page }) => {
    // Seed two sessions via API
    const session1 = await seedSession(project.id, {
      prompt: 'Session 1 prompt',
      name: 'Session One',
      startImmediately: false,
    });
    const session2 = await seedSession(project.id, {
      prompt: 'Session 2 prompt',
      name: 'Session Two',
      startImmediately: false,
    });

    // Navigate to session 1
    await navigateAndWait(page, `${BASE_URL}/sessions/${session1.id}`, {
      waitFor: '.session-detail',
    });

    // Verify we're on session 1's page
    await expect(page.locator('.session-detail')).toBeVisible();

    // Navigate to session 2
    await navigateAndWait(page, `${BASE_URL}/sessions/${session2.id}`, {
      waitFor: '.session-detail',
    });

    // Verify the page has updated to show session 2's data (not stale data from session 1).
    // The URL should contain session 2's ID, confirming navigation occurred.
    expect(page.url()).toContain(session2.id);

    // Verify the session name shown is session 2's name, not session 1's
    await expect(page.locator('.session-name').first()).toHaveText('Session Two', { timeout: 10000 });
  });
});
