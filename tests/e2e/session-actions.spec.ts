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
    await page.waitForSelector('button.btn-kebab[aria-label="Session actions"]', { timeout: 8000 });

    // Open overflow menu
    await page.click('button.btn-kebab[aria-label="Session actions"]');

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
      startImmediately: false,
    });
    const session2 = await seedSession(project2.id, {
      prompt: 'Session 2',
      name: 'Session 2',
      startImmediately: false,
    });

    // Set sessions to waiting so they appear in the active view
    await updateSessionStatus(session1.id, 'waiting');
    await updateSessionStatus(session2.id, 'waiting');
    // Block navigation until the API confirms both are in the target status —
    // otherwise the active-sessions list may render before the transition is
    // visible and the test flakes under parallel load.
    await waitForSessionStatus(session1.id, 'waiting', API_READY);
    await waitForSessionStatus(session2.id, 'waiting', API_READY);

    await navigateAndWait(page, '/sessions/active', { loadState: 'domcontentloaded' });

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

    // Set statuses explicitly (API-confirmed before we navigate)
    await updateSessionStatus(runningSession.id, 'running');
    await updateSessionStatus(waitingSession.id, 'waiting');
    await waitForSessionStatus(runningSession.id, 'running', API_READY);
    await waitForSessionStatus(waitingSession.id, 'waiting', API_READY);

    await navigateAndWait(page, '/sessions/active', { loadState: 'domcontentloaded' });

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

    // Set statuses explicitly (API-confirmed before we navigate)
    await updateSessionStatus(runningSession.id, 'running');
    await updateSessionStatus(waitingSession.id, 'waiting');
    await waitForSessionStatus(runningSession.id, 'running', API_READY);
    await waitForSessionStatus(waitingSession.id, 'waiting', API_READY);

    await navigateAndWait(page, '/sessions/active', { loadState: 'domcontentloaded' });

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
      startImmediately: false,
    });
    const session2 = await seedSession(project2.id, {
      prompt: `StarFilterB-${uniqueId}`,
      name: `StarFilterB-${uniqueId}`,
      startImmediately: false,
    });

    // Set sessions to waiting so they appear in the active view.
    // waitForSessionStatus ensures the server has actually persisted the
    // transition before we navigate — without it, the page could render a
    // snapshot that does not yet contain either session.
    await updateSessionStatus(session1.id, 'waiting');
    await updateSessionStatus(session2.id, 'waiting');
    await waitForSessionStatus(session1.id, 'waiting', API_READY);
    await waitForSessionStatus(session2.id, 'waiting', API_READY);

    // Star one session via API (and verify via getSession — not asserted here,
    // but read-after-write is guaranteed by the API contract).
    await toggleSessionStar(session1.id);

    await navigateAndWait(page, '/sessions/active', { loadState: 'domcontentloaded' });

    // Wait for the view to leave "loading" before asserting anything.
    const view = page.locator('[data-testid="active-sessions-view"]');
    await expect(view).toBeVisible({ timeout: PAGE_READY_TIMEOUT });
    await expect(view).toHaveAttribute('data-state', /^(results|empty-filtered|empty-all)$/, {
      timeout: PAGE_READY_TIMEOUT,
    });

    // Wait for both sessions to appear — use unique names to avoid matching other workers' sessions.
    const nameA = scopedSessionName(page, session1.name);
    const nameB = scopedSessionName(page, session2.name);
    await expect(nameA).toHaveCount(1, { timeout: LIST_HYDRATION });
    await expect(nameB).toHaveCount(1, { timeout: LIST_HYDRATION });

    // Click star filter button (cycles null → starred).
    const starFilterBtn = page.locator('.filter-btn.star-btn').first();
    await starFilterBtn.click();

    // DOM-based wait: the button must reflect the active filter class before
    // we assert the filtered result. This is the actual state we depend on
    // (no network call to waitForResponse against — the filter is client-side).
    await expect(starFilterBtn).toHaveClass(/star-filter-active/, {
      timeout: API_READY,
    });

    // Only the starred session is visible. Use toHaveCount to assert the
    // absence of the non-starred one deterministically (not just "invisible").
    await expect(nameA).toHaveCount(1);
    await expect(nameB).toHaveCount(0);
  });

  test('star filter button reflects state immediately (no network)', async ({ page }) => {
    // Regression: the star filter is client-side only. If the test relies on
    // waitForTimeout or networkidle, it will flake under load. This test pins
    // the contract that the button class flips synchronously on click, and
    // that toggling cycles null → starred → unstarred → null.
    await page.addInitScript(() => {
      localStorage.removeItem('sessionStatusFilter');
      sessionStorage.removeItem('sessionStarredFilter');
    });

    await navigateAndWait(page, '/sessions/active', { loadState: 'domcontentloaded' });

    const view = page.locator('[data-testid="active-sessions-view"]');
    await expect(view).toBeVisible({ timeout: PAGE_READY_TIMEOUT });

    const starFilterBtn = page.locator('.filter-btn.star-btn').first();
    await expect(starFilterBtn).toBeVisible({ timeout: PAGE_READY_TIMEOUT });
    // Initial: no active class.
    await expect(starFilterBtn).not.toHaveClass(/star-filter-active/);

    // Click 1 → starred (active class present).
    await starFilterBtn.click();
    await expect(starFilterBtn).toHaveClass(/star-filter-active/, {
      timeout: API_READY,
    });

    // Click 2 → unstarred (no active class).
    await starFilterBtn.click();
    await expect(starFilterBtn).not.toHaveClass(/star-filter-active/, {
      timeout: API_READY,
    });

    // Click 3 → cycles back to null (still no active class).
    await starFilterBtn.click();
    await expect(starFilterBtn).not.toHaveClass(/star-filter-active/, {
      timeout: API_READY,
    });
  });

  test('shows empty state when no active sessions', async ({ page }) => {
    // Clear any persisted filter state before the page initialises
    await page.addInitScript(() => {
      localStorage.removeItem('sessionStatusFilter');
      sessionStorage.removeItem('sessionStarredFilter');
    });

    // Navigate with no seeded sessions in this test
    await navigateAndWait(page, '/sessions/active', { loadState: 'domcontentloaded' });

    // Step 1 of hardening plan: wait for the view to leave the loading state.
    // The ActiveSessionsView root exposes data-state ∈
    //   { loading, error, empty-all, empty-filtered, results }
    // Waiting for any *terminal* state guarantees the skeleton list has
    // detached and the store has settled before we assert anything else.
    const viewRoot = page.locator('[data-testid="active-sessions-view"]');
    await expect(viewRoot).toBeVisible({ timeout: PAGE_READY_TIMEOUT });
    await expect(viewRoot).toHaveAttribute(
      'data-state',
      /^(error|empty-all|empty-filtered|results)$/,
      { timeout: PAGE_READY_TIMEOUT },
    );

    // Step 2: fail fast if the backend surfaced an error — don't let it
    // masquerade as a timeout against missing cards.
    const errorMessage = page.locator('.error-message');
    const errorCount = await errorMessage.count();
    if (errorCount > 0) {
      const errorText = await errorMessage.first().innerText();
      throw new Error(`Active Sessions view rendered an error state: ${errorText}`);
    }

    // Step 3: assert the page is in one of its expected terminal states.
    // Under parallel execution other workers may have active sessions so
    // any of three outcomes is valid: empty-all, empty-filtered, results.
    const state = await viewRoot.getAttribute('data-state');
    expect(state).toMatch(/^(empty-all|empty-filtered|results)$/);

    if (state === 'empty-all') {
      const empty = page.locator('[data-testid="active-sessions-empty"]');
      await expect(empty).toBeVisible();
      await expect(empty).toContainText('No active sessions');
    } else if (state === 'empty-filtered') {
      const empty = page.locator('[data-testid="active-sessions-empty"]');
      await expect(empty).toBeVisible();
      await expect(empty).toContainText('No sessions match the current filter');
    } else {
      // "results" — other workers seeded sessions. At least one card.
      await expect(page.locator('.session-card').first()).toBeVisible();
    }
  });

  test('renders page chrome even when loading takes long', async ({ page }) => {
    // Regression guard for the hard failure we observed: if the underlying
    // sessions API is slow, the view used to stay in the loading (skeleton)
    // state past the previous 10s timeout. Here we intercept the request,
    // delay it long enough to be noticeable, and assert the root renders
    // and eventually transitions to a terminal state within PAGE_READY_TIMEOUT.
    const delayMs = 3000;
    await page.route('**/api/sessions/active**', async (route) => {
      await new Promise((r) => setTimeout(r, delayMs));
      await route.continue();
    });

    await page.addInitScript(() => {
      localStorage.removeItem('sessionStatusFilter');
      sessionStorage.removeItem('sessionStarredFilter');
    });

    await navigateAndWait(page, '/sessions/active', { loadState: 'domcontentloaded' });

    // The view root (page chrome + data-state contract) must be visible
    // immediately — even while the store is still fetching. This is the
    // core regression: previously the root wouldn't render until after
    // the response arrived, leaving tests stuck on pure skeleton selectors.
    const viewRoot = page.locator('[data-testid="active-sessions-view"]');
    await expect(viewRoot).toBeVisible({ timeout: PAGE_READY_TIMEOUT });
    await expect(viewRoot).toHaveAttribute('data-state', /.+/, {
      timeout: PAGE_READY_TIMEOUT,
    });

    // Eventually the request resolves and we reach a terminal state.
    // Budget: the route delay + the normal page-ready budget.
    await expect(viewRoot).toHaveAttribute(
      'data-state',
      /^(error|empty-all|empty-filtered|results)$/,
      { timeout: PAGE_READY_TIMEOUT + delayMs },
    );
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
