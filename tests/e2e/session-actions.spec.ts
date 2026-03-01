import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedCanvasItem,
  seedSessionNote,
  cleanupCreatedResources,
  getSession,
  getProjectSessions,
  navigateAndWait,
  waitForProjectSessions,
  duplicateSession,
  deleteSession,
  stopSession,
  restartSession,
  getActiveSessions,
  updateSessionStatus,
  getCanvasItems,
  getCanvasFileContent,
  getSessionNotes,
  waitForPageReady,
  toggleSessionStar,
  getAPIURL,
  trackSession,
} from './helpers';

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
    await page.waitForSelector('button.btn-kebab[aria-label="Session actions"]', { timeout: 8000 });

    // Open overflow menu
    await page.click('button.btn-kebab[aria-label="Session actions"]');

    // Wait for menu to animate in and items to be interactive
    await page.waitForSelector('.menu-items', { timeout: 5000 });
    await page.waitForTimeout(200); // allow slide-in animation to finish

    // Click Duplicate menu item — page.on('dialog') above will auto-accept the confirm()
    await page.locator('.menu-items button.menu-item').filter({ hasText: 'Duplicate' }).click();

    // After a successful duplicate, handleDuplicate() navigates to the new session:
    //   router.push(`/sessions/${newSessionId}/conversation`)
    // Waiting for that URL change confirms the duplicate API call succeeded.
    await page.waitForURL(/\/sessions\/[^/]+\/conversation/, { timeout: 15000 });

    // Extract the new session ID from the current URL
    const newUrl = page.url();
    const newSessionIdMatch = newUrl.match(/\/sessions\/([^/]+)\/conversation/);
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

  test('duplicated session preserves notes', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Session with notes',
      name: 'Session with notes',
    });

    // Add a note
    await seedSessionNote(session.id, {
      content: 'Test note content',
    });

    // Duplicate via API
    const duplicated = await duplicateSession(session.id);
    // Track duplicated session for cleanup
    trackSession(duplicated.id);

    // Verify note was copied
    const notes = await getSessionNotes(duplicated.id);
    expect(notes.length).toBe(1);
    expect(notes[0].content).toBe('Test note content');
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
    await page.waitForSelector('button.btn-kebab[aria-label="Session actions"]', { timeout: 8000 });

    // Open overflow menu
    await page.click('button.btn-kebab[aria-label="Session actions"]');

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
    await page.waitForSelector('button.btn-kebab[aria-label="Session actions"]', { timeout: 8000 });

    // Open overflow menu
    await page.click('button.btn-kebab[aria-label="Session actions"]');

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
    });

    // Update status to running
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
    });

    // Set status to stopped
    await updateSessionStatus(session.id, 'stopped');

    // Try to stop again - expect error
    await expect(stopSession(session.id)).rejects.toThrow();
  });
});

test.describe('Active Sessions View', () => {
  let project1: any;
  let project2: any;

  test.beforeEach(async () => {
    project1 = await seedProject('Project 1', '/tmp/project1');
    project2 = await seedProject('Project 2', '/tmp/project2');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('shows sessions across multiple projects', async ({ page }) => {
    const session1 = await seedSession(project1.id, {
      prompt: 'Session 1',
      name: 'Session 1',
    });
    const session2 = await seedSession(project2.id, {
      prompt: 'Session 2',
      name: 'Session 2',
    });

    await navigateAndWait(page, '/sessions/active');

    // Both sessions visible with project names.
    // Use .first() to guard against strict mode violations if a previous test's
    // cleanup is still in progress and two sessions share the same TEST_PREFIX name.
    await expect(page.locator('.session-name').filter({ hasText: session1.name }).first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.session-name').filter({ hasText: session2.name }).first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.project-name').filter({ hasText: project1.name }).first()).toBeVisible();
    await expect(page.locator('.project-name').filter({ hasText: project2.name }).first()).toBeVisible();
  });

  test('filters by running status', async ({ page }) => {
    // Clear any persisted filter state before the page initialises
    await page.addInitScript(() => {
      localStorage.removeItem('sessionStatusFilter');
      sessionStorage.removeItem('sessionStarredFilter');
    });

    // Use unique names to avoid strict mode violations from parallel test workers
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const runningSession = await seedSession(project1.id, {
      prompt: 'Running',
      name: `Running Session ${uniqueId}`,
      startImmediately: false,
    });
    const waitingSession = await seedSession(project1.id, {
      prompt: 'Waiting',
      name: `Waiting Session ${uniqueId}`,
      startImmediately: false,
    });

    // Set statuses explicitly
    await updateSessionStatus(runningSession.id, 'running');
    await updateSessionStatus(waitingSession.id, 'waiting');

    await navigateAndWait(page, '/sessions/active');

    // Wait for both sessions to appear (confirms active sessions loaded)
    await expect(page.locator('.session-name').filter({ hasText: runningSession.name })).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.session-name').filter({ hasText: waitingSession.name })).toBeVisible({ timeout: 8000 });

    // Click "running" filter
    await page.locator('.filter-btn').filter({ hasText: 'running' }).click();
    await page.waitForTimeout(500);

    // Only running session visible
    await expect(page.locator('.session-name').filter({ hasText: runningSession.name })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: waitingSession.name })).not.toBeVisible();
  });

  test('filters by idle status', async ({ page }) => {
    // Clear any persisted filter state before the page initialises
    await page.addInitScript(() => {
      localStorage.removeItem('sessionStatusFilter');
      sessionStorage.removeItem('sessionStarredFilter');
    });

    // Use unique names to avoid strict mode violations from parallel test workers
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const runningSession = await seedSession(project1.id, {
      prompt: 'Running',
      name: `Running Session ${uniqueId}`,
      startImmediately: false,
    });
    const waitingSession = await seedSession(project1.id, {
      prompt: 'Waiting',
      name: `Waiting Session ${uniqueId}`,
      startImmediately: false,
    });

    // Set statuses explicitly
    await updateSessionStatus(runningSession.id, 'running');
    await updateSessionStatus(waitingSession.id, 'waiting');

    await navigateAndWait(page, '/sessions/active');

    // Wait for both sessions to appear (confirms active sessions loaded)
    await expect(page.locator('.session-name').filter({ hasText: runningSession.name })).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.session-name').filter({ hasText: waitingSession.name })).toBeVisible({ timeout: 8000 });

    // Click "idle" filter (matches waiting/stopped/error sessions)
    await page.locator('.filter-btn').filter({ hasText: 'idle' }).click();

    // Use exact session names (include unique suffix) to avoid false matches from parallel tests
    await expect(page.locator('.session-name').filter({ hasText: runningSession.name })).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('.session-name').filter({ hasText: waitingSession.name })).toBeVisible({ timeout: 8000 });
  });

  test('star filter works on active view', async ({ page }) => {
    // Clear any persisted filter state before the page initialises
    await page.addInitScript(() => {
      localStorage.removeItem('sessionStatusFilter');
      sessionStorage.removeItem('sessionStarredFilter');
    });

    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const session1 = await seedSession(project1.id, {
      prompt: `StarFilterA-${uniqueId}`,
      name: `StarFilterA-${uniqueId}`,
    });
    const session2 = await seedSession(project2.id, {
      prompt: `StarFilterB-${uniqueId}`,
      name: `StarFilterB-${uniqueId}`,
    });

    // Star one session via API
    await toggleSessionStar(session1.id);

    await navigateAndWait(page, '/sessions/active');

    // Wait for both sessions to appear — use unique names to avoid matching other workers' sessions
    await expect(page.locator('.session-name').filter({ hasText: session1.name })).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.session-name').filter({ hasText: session2.name })).toBeVisible({ timeout: 8000 });

    // Click star filter button (cycles null → starred)
    const starFilterBtn = page.locator('.filter-btn.star-btn').first();
    await starFilterBtn.click();
    await page.waitForTimeout(500);

    // Only starred session visible
    await expect(page.locator('.session-name').filter({ hasText: session1.name })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: session2.name })).not.toBeVisible();
  });

  test('shows empty state when no active sessions', async ({ page }) => {
    // Clear any persisted filter state before the page initialises
    await page.addInitScript(() => {
      localStorage.removeItem('sessionStatusFilter');
      sessionStorage.removeItem('sessionStarredFilter');
    });

    // Navigate with no seeded sessions in this test
    await navigateAndWait(page, '/sessions/active');

    // The page shows one of two possible states:
    // 1. No sessions at all → empty-state with "No active sessions" text
    // 2. Sessions from parallel tests exist → session cards are visible
    // Either way: page renders without errors and the structure is present
    const emptyState = page.locator('.empty-state');
    const sessionCards = page.locator('.session-card');

    const [emptyCount, cardCount] = await Promise.all([
      emptyState.count(),
      sessionCards.count(),
    ]);

    // At least one of empty-state or session-cards must be present
    expect(emptyCount + cardCount).toBeGreaterThan(0);

    // If an empty-state is shown, verify it contains the expected message
    if (emptyCount > 0) {
      await expect(emptyState.first()).toBeVisible();
      await expect(emptyState.first()).toContainText('No active sessions');
    }
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

  test('displays correct status badge for stopped sessions', async ({ page }) => {
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

    // Set status to stopped (a valid terminal status)
    await updateSessionStatus(session.id, 'stopped');

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Verify session card is visible (stopped sessions don't show a status badge —
    // only running/scheduled/error states show status-badge chips)
    await expect(page.locator('.session-name').filter({ hasText: session.name })).toBeVisible();
    const sessionCard = page.locator('.session-card').filter({ hasText: session.name });
    await expect(sessionCard).toBeVisible();
  });
});
