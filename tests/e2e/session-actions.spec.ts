import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedCanvasItem,
  cleanupCreatedResources,
  getSession,
  getProjectSessions,
  navigateAndWait,
  waitForProjectSessions,
  duplicateSession,
  deleteSession,
  stopSession,
  restartSession,
  updateSessionStatus,
  getCanvasItems,
  getCanvasFileContent,
  waitForPageReady,
  toggleSessionStar,
  getAPIURL,
  trackSession,
  waitForSessionStatus,
  scopedSessionName,
} from './helpers';
import { PAGE_READY_TIMEOUT, LIST_HYDRATION, API_READY } from './timeouts';

test.describe('Duplicate Session', () => {
  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('can duplicate a session via overflow menu', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Original session prompt',
      name: 'Original Session',
      startImmediately: false, // Prevent Claude from running so the name isn't overwritten
    });

    // Register dialog handler BEFORE navigation so it fires as soon as the dialog appears.
    // Using page.on (persistent listener) instead of page.waitForEvent avoids the deadlock
    // where await click() hangs because confirm() blocks JS, preventing the dialog event
    // from being processed by the awaited waitForEvent promise.
    page.on('dialog', (dialog) => dialog.accept());

    await navigateAndWait(page, `/sessions/${session.id}`);

    // Wait explicitly for the kebab button to be rendered
    await page.waitForSelector('button.btn-kebab[aria-label="Workspace actions"]', { timeout: 8000 });

    // Open overflow menu
    await page.click('button.btn-kebab[aria-label="Workspace actions"]');

    // Wait for menu to animate in and items to be interactive
    await page.waitForSelector('.menu-items', { timeout: 5000 });
    await page.waitForTimeout(200); // allow slide-in animation to finish

    // Click Duplicate menu item — page.on('dialog') above will auto-accept the confirm()
    await page.locator('.menu-items button.menu-item').filter({ hasText: 'Duplicate' }).click();

    // After a successful duplicate, handleDuplicate() navigates to the new session:
    //   router.push(`/sessions/${newSessionId}/summary`)
    // Waiting for that URL change confirms the duplicate API call succeeded.
    await page.waitForURL(/\/sessions\/[^/]+\/summary/, { timeout: 15000 });

    // Extract the new session ID from the current URL
    const newUrl = page.url();
    const newSessionIdMatch = newUrl.match(/\/sessions\/([^/]+)\/summary/);
    expect(newSessionIdMatch).toBeTruthy();
    const newSessionId = newSessionIdMatch![1];

    // Verify the duplicated session is a different session from the original
    expect(newSessionId).not.toBe(session.id);

    // Fetch and verify the new session exists in the API with the expected name.
    // Note: session.prompt is NOT a session field — the prompt is stored as a
    // conversation message, not on the session record itself.
    const duplicatedSession = await getSession(newSessionId);
    expect(duplicatedSession).toBeTruthy();
    expect(duplicatedSession.name).toContain('Original Session');
    trackSession(newSessionId);
  });

  test('duplicated session preserves canvas items', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Session with canvas',
      name: 'Session with canvas',
    });

    // Add a canvas item (filename is required for inline content mode)
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Test Canvas Item',
      filename: 'test.md',
    });

    // Duplicate via API
    const duplicated = await duplicateSession(session.id);
    // Track duplicated session for cleanup
    trackSession(duplicated.id);

    // Verify new session has canvas items
    const canvasItems = await getCanvasItems(duplicated.id);
    expect(canvasItems.length).toBe(1);
    const itemContent = await getCanvasFileContent(duplicated.id, canvasItems[0].filename);
    expect(itemContent.content).toBe('# Test Canvas Item');
  });
});

test.describe('Delete Session', () => {
  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('can delete session via overflow menu', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Session to delete',
      name: 'Delete Me',
    });

    // Handle the confirmation dialog before navigating
    page.on('dialog', dialog => dialog.accept());

    await navigateAndWait(page, `/sessions/${session.id}`);

    // Wait explicitly for the kebab button to be rendered
    await page.waitForSelector('button.btn-kebab[aria-label="Workspace actions"]', { timeout: 8000 });

    // Open overflow menu
    await page.click('button.btn-kebab[aria-label="Workspace actions"]');

    // Wait for menu to animate in
    await page.waitForSelector('.menu-items', { timeout: 5000 });
    await page.waitForTimeout(200);

    // Click Delete menu item (last button with is-danger class)
    await page.locator('.menu-items button.menu-item.is-danger').filter({ hasText: 'Delete' }).click();

    // Wait for delete to complete and navigation to project sessions list
    await page.waitForURL(/\/projects\/[\w-]+\/sessions/, { timeout: 8000 });

    // Verify session gone from API (returns null for 404)
    const deletedSession = await getSession(session.id);
    expect(deletedSession).toBeNull();
  });

  test('delete removes session from list', async ({ page }) => {
    const session1 = await seedSession(project.id, {
      prompt: 'Session 1',
      name: 'Session 1',
    });
    const session2 = await seedSession(project.id, {
      prompt: 'Session 2',
      name: 'Session 2',
    });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Both sessions visible
    await expect(page.locator('.session-name').filter({ hasText: session1.name })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: session2.name })).toBeVisible();

    // Delete one via API
    await deleteSession(session1.id);

    // Wait a moment for delete to propagate
    await page.waitForTimeout(500);

    // Reload page
    await page.reload();
    await waitForPageReady(page);

    // Wait a bit for session list to render
    await page.waitForTimeout(500);

    // Only one session visible
    await expect(page.locator('.session-name').filter({ hasText: session1.name })).not.toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: session2.name })).toBeVisible();
  });

  test('delete confirmation can be cancelled', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Session to keep',
      name: 'Keep Me',
    });

    // Dismiss the confirmation dialog
    page.on('dialog', dialog => dialog.dismiss());

    await navigateAndWait(page, `/sessions/${session.id}`);

    // Wait explicitly for the kebab button to be rendered
    await page.waitForSelector('button.btn-kebab[aria-label="Workspace actions"]', { timeout: 8000 });

    // Open overflow menu
    await page.click('button.btn-kebab[aria-label="Workspace actions"]');

    // Wait for menu to animate in
    await page.waitForSelector('.menu-items', { timeout: 5000 });
    await page.waitForTimeout(200);

    // Click Delete menu item (last button with is-danger class)
    await page.locator('.menu-items button.menu-item.is-danger').filter({ hasText: 'Delete' }).click();

    // Wait a bit for any async effects
    await page.waitForTimeout(1000);

    // Session should still exist (dialog was dismissed)
    const existingSession = await getSession(session.id);
    expect(existingSession).toBeTruthy();
    expect(existingSession.id).toBe(session.id);
  });
});

test.describe('Stop / Restart Sessions', () => {
  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('stop endpoint changes status to stopped', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Running session',
      name: 'Running Session',
      startImmediately: false,
    });

    // Update status to running (no actual agent process — avoids VCR race)
    await updateSessionStatus(session.id, 'running');

    // Call stop API
    await stopSession(session.id);

    // Verify status is stopped
    const stoppedSession = await getSession(session.id);
    expect(stoppedSession.status).toBe('stopped');
  });

  test('restart endpoint clears error state back to stopped', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Error session',
      name: 'Error Session',
      startImmediately: false,
    });

    // Set session to error state (the state restart is designed to recover from)
    await updateSessionStatus(session.id, 'error');

    // Call restart API
    const response = await fetch(`${getAPIURL()}/api/sessions/${session.id}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    // Verify restart was accepted (200 OK)
    expect(response.ok).toBe(true);

    // restartSession clears the error and sets status to 'stopped',
    // which allows the user to send new messages to the session
    const restartedSession = await getSession(session.id);
    expect(restartedSession).toBeTruthy();
    expect(restartedSession.status).toBe('stopped');
  });

  test('cannot stop already stopped session', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Stopped session',
      name: 'Stopped Session',
      startImmediately: false,
    });

    // Set status to stopped
    await updateSessionStatus(session.id, 'stopped');

    // Try to stop again - expect error
    await expect(stopSession(session.id)).rejects.toThrow();
  });
});


test.describe('Session Status Badges', () => {
  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('displays session card for stopped sessions without status badge', async ({ page }) => {
    // Clear any persisted status filter that would hide stopped sessions
    await page.addInitScript(() => {
      localStorage.removeItem('sessionStatusFilter');
      sessionStorage.removeItem('sessionStarredFilter');
    });

    const session = await seedSession(project.id, {
      prompt: 'Stopped session',
      name: 'Stopped Session',
      startImmediately: false,
    });

    // Set status to stopped (a valid terminal status) and block navigation
    // until the API confirms the transition.
    await updateSessionStatus(session.id, 'stopped');
    await waitForSessionStatus(session.id, 'stopped', API_READY);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Verify session card is visible (stopped sessions don't show a status badge —
    // only running/scheduled/error states show status-badge chips)
    await expect(page.locator('.session-name').filter({ hasText: session.name })).toBeVisible();
    const sessionCard = page.locator('.session-card').filter({ hasText: session.name });
    await expect(sessionCard).toBeVisible();

    // Verify no status badge is shown for stopped sessions
    await expect(sessionCard.locator('.status-badge')).not.toBeVisible();
  });
});
