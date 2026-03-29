import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  seedScheduledSession,
  seedCanvasItem,
  cleanupCreatedResources,
  navigateAndWait,
  toggleSessionStar,
  archiveSession,
  updateSessionScheduling,
  BASE_URL,
} from './helpers';

// ============================================================
// Category 1: Status Filter (5 tests)
// ============================================================

test.describe('Status Filter', () => {
  test.describe.configure({ timeout: 15000 });

  let project: any;

  test.beforeEach(async ({ page }) => {
    project = await seedProject('StatusFilter Project', '/tmp/test');
    await page.addInitScript(() => {
      sessionStorage.removeItem('sessionStarredFilter');
      sessionStorage.removeItem('sessionScheduledFilter');
      localStorage.removeItem('sessionStatusFilter');
    });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('status filter buttons are visible on session list', async ({ page }) => {
    await seedSession(project.id, { prompt: 'Session', name: 'Session One', startImmediately: false });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const statusFilters = page.locator('.status-filters');
    await statusFilters.waitFor({ state: 'visible', timeout: 10000 });
    await expect(statusFilters).toBeVisible();

    // Check for running and idle filter buttons
    const runningBtn = statusFilters.locator('.filter-btn', { hasText: /running/i });
    const idleBtn = statusFilters.locator('.filter-btn', { hasText: /idle/i });
    await expect(runningBtn).toBeVisible();
    await expect(idleBtn).toBeVisible();
  });

  test('clicking Running filter with no running sessions shows empty state', async ({ page }) => {
    await seedSession(project.id, { prompt: 'Idle 1', name: 'Idle One', startImmediately: false });
    await seedSession(project.id, { prompt: 'Idle 2', name: 'Idle Two', startImmediately: false });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Wait for status filters to be rendered
    await page.locator('.status-filters').waitFor({ state: 'visible', timeout: 10000 });

    // Click the running filter button
    const runningBtn = page.locator('.status-filters .filter-btn', { hasText: /running/i });
    await runningBtn.click();
    await page.waitForTimeout(500);

    // Should show empty state
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.empty-state')).toContainText('No sessions match the current filter');

    // No session cards visible
    await expect(page.locator('.session-card')).not.toBeVisible();

    // Running filter button should have active class
    await expect(runningBtn).toHaveClass(/active/);
  });

  test('clicking Idle filter shows only idle sessions', async ({ page }) => {
    await seedSession(project.id, { prompt: 'Idle 1', name: 'Idle One', startImmediately: false });
    await seedSession(project.id, { prompt: 'Idle 2', name: 'Idle Two', startImmediately: false });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const idleBtn = page.locator('.status-filters .filter-btn', { hasText: /idle/i });
    await idleBtn.click();
    await page.waitForTimeout(500);

    // Both idle sessions should be visible
    await expect(page.locator('.session-name').filter({ hasText: 'Idle One' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Idle Two' })).toBeVisible();

    // Idle filter button should have active class
    await expect(idleBtn).toHaveClass(/active/);
  });

  test('clicking active filter again clears it (shows all)', async ({ page }) => {
    await seedSession(project.id, { prompt: 'Idle 1', name: 'Idle One', startImmediately: false });
    await seedSession(project.id, { prompt: 'Idle 2', name: 'Idle Two', startImmediately: false });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const idleBtn = page.locator('.status-filters .filter-btn', { hasText: /idle/i });

    // Click to activate
    await idleBtn.click();
    await page.waitForTimeout(500);
    await expect(idleBtn).toHaveClass(/active/);

    // Click again to deactivate
    await idleBtn.click();
    await page.waitForTimeout(500);

    // All sessions should be visible
    await expect(page.locator('.session-name').filter({ hasText: 'Idle One' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Idle Two' })).toBeVisible();

    // No filter button should be active
    await expect(idleBtn).not.toHaveClass(/active/);
  });

  test('status filter persists across page navigation', async ({ page }) => {
    await seedSession(project.id, { prompt: 'Idle 1', name: 'Idle One', startImmediately: false });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Set idle filter
    const idleBtn = page.locator('.status-filters .filter-btn', { hasText: /idle/i });
    await idleBtn.click();
    await page.waitForTimeout(500);
    await expect(idleBtn).toHaveClass(/active/);

    // Remove the init script that clears storage by replacing it with a no-op
    // (addInitScript cannot be removed, so we verify persistence via API instead)
    // Verify the filter was saved to localStorage
    const savedFilter = await page.evaluate(() => localStorage.getItem('sessionStatusFilter'));
    expect(savedFilter).toBe('idle');

    // Navigate to project list (Vue SPA navigation, not full page load)
    await page.locator('.tab-back, a[href="/"]').first().click();
    await page.waitForLoadState('networkidle');

    // Navigate back via clicking the project
    await page.locator('.project-card, a[href*="/projects/"]').first().click();
    await page.waitForLoadState('networkidle');

    // Verify localStorage still has the value
    const savedFilterAfter = await page.evaluate(() => localStorage.getItem('sessionStatusFilter'));
    expect(savedFilterAfter).toBe('idle');
  });
});

// ============================================================
// Category 2: Star Filter (6 tests)
// ============================================================

test.describe('Star Filter', () => {
  test.describe.configure({ timeout: 15000 });

  let project: any;

  test.beforeEach(async ({ page }) => {
    project = await seedProject('StarFilter Project', '/tmp/test');
    await page.addInitScript(() => {
      sessionStorage.removeItem('sessionStarredFilter');
      sessionStorage.removeItem('sessionScheduledFilter');
      localStorage.removeItem('sessionStatusFilter');
    });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('star filter button is visible and defaults to all', async ({ page }) => {
    await seedSession(project.id, { prompt: 'Session', name: 'Session One', startImmediately: false });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const starBtn = page.locator('.status-filters .star-btn');
    await expect(starBtn).toBeVisible();
    await expect(starBtn).toHaveClass(/star-filter-all/);
  });

  test('clicking star filter once shows only starred sessions', async ({ page }) => {
    // Use distinct names that won't substring-match each other
    const starredSession = await seedSession(project.id, { prompt: 'Fav', name: 'Favorite Alpha', startImmediately: false });
    await seedSession(project.id, { prompt: 'Plain', name: 'Plain Beta', startImmediately: false });
    await toggleSessionStar(starredSession.id);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const starBtn = page.locator('.status-filters .star-btn');
    await starBtn.click();
    await page.waitForTimeout(500);

    // Button should have star-filter-active class
    await expect(starBtn).toHaveClass(/star-filter-active/);

    // Only starred session visible
    await expect(page.locator('.session-name').filter({ hasText: 'Favorite Alpha' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Plain Beta' })).not.toBeVisible();
  });

  test('clicking star filter twice shows only unstarred sessions', async ({ page }) => {
    // Use distinct names that won't substring-match each other
    const starredSession = await seedSession(project.id, { prompt: 'Fav', name: 'Favorite Alpha', startImmediately: false });
    await seedSession(project.id, { prompt: 'Plain', name: 'Plain Beta', startImmediately: false });
    await toggleSessionStar(starredSession.id);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const starBtn = page.locator('.status-filters .star-btn');
    await starBtn.click();
    await page.waitForTimeout(500);
    await starBtn.click();
    await page.waitForTimeout(500);

    // Button should have star-filter-unstarred class
    await expect(starBtn).toHaveClass(/star-filter-unstarred/);

    // Only unstarred session visible
    await expect(page.locator('.session-name').filter({ hasText: 'Favorite Alpha' })).not.toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Plain Beta' })).toBeVisible();
  });

  test('clicking star filter three times resets to all', async ({ page }) => {
    // Use distinct names that won't substring-match each other
    const starredSession = await seedSession(project.id, { prompt: 'Fav', name: 'Favorite Alpha', startImmediately: false });
    await seedSession(project.id, { prompt: 'Plain', name: 'Plain Beta', startImmediately: false });
    await toggleSessionStar(starredSession.id);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const starBtn = page.locator('.status-filters .star-btn');
    await starBtn.click();
    await page.waitForTimeout(500);
    await starBtn.click();
    await page.waitForTimeout(500);
    await starBtn.click();
    await page.waitForTimeout(500);

    // Button should be back to star-filter-all
    await expect(starBtn).toHaveClass(/star-filter-all/);

    // Both sessions visible
    await expect(page.locator('.session-name').filter({ hasText: 'Favorite Alpha' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Plain Beta' })).toBeVisible();
  });

  test('star filter works on archived tab', async ({ page }) => {
    // Use distinct names that won't substring-match each other
    const starredSession = await seedSession(project.id, { prompt: 'Fav', name: 'Favorite Archived', startImmediately: false });
    const unstarredSession = await seedSession(project.id, { prompt: 'Plain', name: 'Plain Archived', startImmediately: false });
    await toggleSessionStar(starredSession.id);
    await archiveSession(starredSession.id);
    await archiveSession(unstarredSession.id);

    await navigateAndWait(page, `/projects/${project.id}/archived`);

    // Both archived sessions should be visible initially
    await expect(page.locator('.session-name').filter({ hasText: 'Favorite Archived' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Plain Archived' })).toBeVisible();

    // Click star filter on archived tab (archived tab has its own .star-btn)
    const starBtn = page.locator('.filters-container .star-btn');
    await starBtn.click();
    await page.waitForTimeout(1000);

    // Only starred archived session should be visible
    await expect(starBtn).toHaveClass(/star-filter-active/);
    await expect(page.locator('.session-name').filter({ hasText: 'Favorite Archived' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Plain Archived' })).not.toBeVisible();
  });

  test('star filter state persists within tab session', async ({ page }) => {
    // Use distinct names that won't substring-match each other
    const starredSession = await seedSession(project.id, { prompt: 'Fav', name: 'Favorite Alpha', startImmediately: false });
    await seedSession(project.id, { prompt: 'Plain', name: 'Plain Beta', startImmediately: false });
    await toggleSessionStar(starredSession.id);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Set star filter to starred
    const starBtn = page.locator('.status-filters .star-btn');
    await starBtn.click();
    await page.waitForTimeout(500);
    await expect(starBtn).toHaveClass(/star-filter-active/);

    // Verify filter was saved to sessionStorage
    const savedFilter = await page.evaluate(() => sessionStorage.getItem('sessionStarredFilter'));
    expect(savedFilter).toBe('starred');

    // Navigate away using SPA navigation (doesn't trigger addInitScript)
    await page.locator('.tab-back, a[href="/"]').first().click();
    await page.waitForLoadState('networkidle');

    // Verify sessionStorage still has the value
    const savedFilterAfter = await page.evaluate(() => sessionStorage.getItem('sessionStarredFilter'));
    expect(savedFilterAfter).toBe('starred');
  });
});

// ============================================================
// Category 3: Schedule Filter (5 tests)
// ============================================================

test.describe('Schedule Filter', () => {
  test.describe.configure({ timeout: 15000 });

  let project: any;

  test.beforeEach(async ({ page }) => {
    project = await seedProject('ScheduleFilter Project', '/tmp/test');
    await page.addInitScript(() => {
      sessionStorage.removeItem('sessionStarredFilter');
      sessionStorage.removeItem('sessionScheduledFilter');
      localStorage.removeItem('sessionStatusFilter');
    });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('schedule filter button is visible and defaults to all', async ({ page }) => {
    await seedSession(project.id, { prompt: 'Session', name: 'Session One', startImmediately: false });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const scheduleBtn = page.locator('.status-filters .schedule-btn');
    await expect(scheduleBtn).toBeVisible();
    await expect(scheduleBtn).toHaveClass(/schedule-filter-all/);
  });

  test('clicking schedule filter once shows only scheduled sessions', async ({ page }) => {
    await seedScheduledSession(project.id, {
      prompt: 'Sched',
      name: 'Planned Task',
    });
    await seedSession(project.id, { prompt: 'Regular', name: 'Regular Task', startImmediately: false });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const scheduleBtn = page.locator('.status-filters .schedule-btn');
    await scheduleBtn.click();
    await page.waitForTimeout(500);

    // Button should have schedule-filter-active class
    await expect(scheduleBtn).toHaveClass(/schedule-filter-active/);

    // Only scheduled session visible
    await expect(page.locator('.session-name').filter({ hasText: 'Planned Task' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Regular Task' })).not.toBeVisible();
  });

  test('clicking schedule filter twice shows only non-scheduled sessions', async ({ page }) => {
    await seedScheduledSession(project.id, {
      prompt: 'Sched',
      name: 'Planned Task',
    });
    await seedSession(project.id, { prompt: 'Regular', name: 'Regular Task', startImmediately: false });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const scheduleBtn = page.locator('.status-filters .schedule-btn');
    await scheduleBtn.click();
    await page.waitForTimeout(500);
    await scheduleBtn.click();
    await page.waitForTimeout(500);

    // Button should have schedule-filter-not-scheduled class
    await expect(scheduleBtn).toHaveClass(/schedule-filter-not-scheduled/);

    // Only non-scheduled session visible
    await expect(page.locator('.session-name').filter({ hasText: 'Planned Task' })).not.toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Regular Task' })).toBeVisible();
  });

  test('clicking schedule filter three times resets to all', async ({ page }) => {
    await seedScheduledSession(project.id, {
      prompt: 'Sched',
      name: 'Planned Task',
    });
    await seedSession(project.id, { prompt: 'Regular', name: 'Regular Task', startImmediately: false });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const scheduleBtn = page.locator('.status-filters .schedule-btn');
    await scheduleBtn.click();
    await page.waitForTimeout(500);
    await scheduleBtn.click();
    await page.waitForTimeout(500);
    await scheduleBtn.click();
    await page.waitForTimeout(500);

    // Button should be back to schedule-filter-all
    await expect(scheduleBtn).toHaveClass(/schedule-filter-all/);

    // Both sessions visible
    await expect(page.locator('.session-name').filter({ hasText: 'Planned Task' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Regular Task' })).toBeVisible();
  });

  test('schedule filter correctly identifies workflow-level scheduling', async ({ page }) => {
    // Create parent session (not scheduled)
    const parentSession = await seedSession(project.id, {
      prompt: 'Parent',
      name: 'Parent Session',
      startImmediately: false,
    });

    // Create child session and make it scheduled
    const childSession = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child',
      name: 'Child Session',
    });
    await updateSessionScheduling(childSession.id, {
      scheduledAt: Date.now() + 3600000,
      status: 'scheduled',
    });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Click schedule filter to show scheduled
    const scheduleBtn = page.locator('.status-filters .schedule-btn');
    await scheduleBtn.click();
    await page.waitForTimeout(500);

    // Parent session should show because its workflow contains a scheduled descendant
    await expect(page.locator('.session-name').filter({ hasText: 'Parent Session' })).toBeVisible();
  });
});

// ============================================================
// Category 4: Archived Sessions Tab (6 tests)
// ============================================================

test.describe('Archived Sessions Tab', () => {
  test.describe.configure({ timeout: 15000 });

  let project: any;

  test.beforeEach(async ({ page }) => {
    project = await seedProject('Archived Project', '/tmp/test');
    await page.addInitScript(() => {
      sessionStorage.removeItem('sessionStarredFilter');
      sessionStorage.removeItem('sessionScheduledFilter');
      localStorage.removeItem('sessionStatusFilter');
    });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('archived tab is accessible from session list', async ({ page }) => {
    await seedSession(project.id, { prompt: 'Session', name: 'Session One', startImmediately: false });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const archivedTab = page.locator('.tabs-desktop .tabs-left button.tab').filter({ hasText: 'Archived' });
    await expect(archivedTab).toBeVisible();
  });

  test('clicking archived tab navigates to archived route', async ({ page }) => {
    await seedSession(project.id, { prompt: 'Session', name: 'Session One', startImmediately: false });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    await page.locator('button.tab').filter({ hasText: 'Archived' }).click();
    await page.waitForLoadState('networkidle');

    // URL should change to archived route
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/archived`));

    // Archived tab button should have active class
    const archivedTab = page.locator('button.tab').filter({ hasText: 'Archived' });
    await expect(archivedTab).toHaveClass(/active/);
  });

  test('archived tab shows empty state when no archived sessions', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/archived`);

    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.empty-state')).toContainText('No archived sessions');
  });

  test('archived tab shows archived sessions', async ({ page }) => {
    const session1 = await seedSession(project.id, { prompt: 'S1', name: 'Archived One', startImmediately: false });
    const session2 = await seedSession(project.id, { prompt: 'S2', name: 'Archived Two', startImmediately: false });
    const session3 = await seedSession(project.id, { prompt: 'S3', name: 'Archived Three', startImmediately: false });
    await archiveSession(session1.id);
    await archiveSession(session2.id);
    await archiveSession(session3.id);

    await navigateAndWait(page, `/projects/${project.id}/archived`);

    // All 3 archived sessions should be visible
    await expect(page.locator('.session-name').filter({ hasText: 'Archived One' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Archived Two' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Archived Three' })).toBeVisible();
  });

  test('unarchiving a session removes it from archived tab', async ({ page }) => {
    const session1 = await seedSession(project.id, { prompt: 'S1', name: 'Removable Item', startImmediately: false });
    const session2 = await seedSession(project.id, { prompt: 'S2', name: 'Keeper Item', startImmediately: false });
    await archiveSession(session1.id);
    await archiveSession(session2.id);

    // Handle confirm dialog
    page.on('dialog', dialog => dialog.accept());

    await navigateAndWait(page, `/projects/${project.id}/archived`);

    // Both archived sessions visible
    await expect(page.locator('.session-name').filter({ hasText: 'Removable Item' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Keeper Item' })).toBeVisible();

    // Click unarchive button on first session card
    const firstCard = page.locator('.session-card').first();
    await firstCard.locator('.archive-btn[title="Unarchive session"]').click();

    // Wait for the session to be removed from the list
    await expect(page.locator('.session-card')).toHaveCount(1, { timeout: 5000 });
  });

  test('switching between Sessions and Archived tabs shows correct data', async ({ page }) => {
    await seedSession(project.id, { prompt: 'A1', name: 'Active One', startImmediately: false });
    await seedSession(project.id, { prompt: 'A2', name: 'Active Two', startImmediately: false });
    const archivedSession = await seedSession(project.id, { prompt: 'Arc', name: 'Archived Only', startImmediately: false });
    await archiveSession(archivedSession.id);

    // Start on Sessions tab
    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Should show 2 active sessions
    await expect(page.locator('.session-name').filter({ hasText: 'Active One' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Active Two' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Archived Only' })).not.toBeVisible();

    // Switch to Archived tab
    await page.locator('button.tab').filter({ hasText: 'Archived' }).click();
    await page.waitForLoadState('networkidle');

    // Should show 1 archived session
    await expect(page.locator('.session-name').filter({ hasText: 'Archived Only' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Active One' })).not.toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Active Two' })).not.toBeVisible();
  });
});

// ============================================================
// Category 5: Session Detail Tab Navigation (6 tests)
// ============================================================

test.describe('Session Detail Tab Navigation', () => {
  test.describe.configure({ timeout: 15000 });

  let project: any;
  let session: any;

  test.beforeEach(async ({ page }) => {
    project = await seedProject('DetailTabs Project', process.cwd());
    session = await seedSession(project.id, { prompt: 'Tab test', name: 'Tab Test Session', startImmediately: false });
    await page.addInitScript(() => {
      sessionStorage.removeItem('sessionStarredFilter');
      sessionStorage.removeItem('sessionScheduledFilter');
      localStorage.removeItem('sessionStatusFilter');
    });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('session detail defaults to summary tab', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}`);

    // The route uses optional :tab? param, so URL stays at /sessions/:id
    // but the Summary tab should be active by default
    const summaryTab = page.locator('.tabs-desktop .tab').filter({ hasText: 'Summary' });
    await expect(summaryTab).toHaveClass(/active/);
  });

  test('clicking each tab navigates and updates URL', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}`);

    // Click Summary tab
    await page.locator('.tabs-desktop .tab').filter({ hasText: 'Summary' }).click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}/summary`));
    await expect(page.locator('.tabs-desktop .tab').filter({ hasText: 'Summary' })).toHaveClass(/active/);

    // Click Changes tab
    await page.locator('.tabs-desktop .tab').filter({ hasText: 'Changes' }).click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}/changes`));
    await expect(page.locator('.tabs-desktop .tab').filter({ hasText: 'Changes' })).toHaveClass(/active/);

    // Click Canvas tab
    await page.locator('.tabs-desktop .tab').filter({ hasText: 'Canvas' }).click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}/canvas`));
    await expect(page.locator('.tabs-desktop .tab').filter({ hasText: 'Canvas' })).toHaveClass(/active/);

    // Click Commands tab
    await page.locator('.tabs-desktop .tab').filter({ hasText: 'Commands' }).click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}/commands`));
    await expect(page.locator('.tabs-desktop .tab').filter({ hasText: 'Commands' })).toHaveClass(/active/);
  });

  test('deep linking to a specific tab works', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Canvas tab should be active
    const canvasTab = page.locator('.tabs-desktop .tab').filter({ hasText: 'Canvas' });
    await expect(canvasTab).toHaveClass(/active/);

    // URL should stay at canvas
    await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}/canvas`));
  });

  test('back button navigates between tabs correctly', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}`);

    // Click Canvas tab
    await page.locator('.tabs-desktop .tab').filter({ hasText: 'Canvas' }).click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}/canvas`));

    // Click Summary tab
    await page.locator('.tabs-desktop .tab').filter({ hasText: 'Summary' }).click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}/summary`));

    // Go back
    await page.goBack();
    await page.waitForLoadState('networkidle');

    // Should be back on Canvas tab
    await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}/canvas`));
    const canvasTab = page.locator('.tabs-desktop .tab').filter({ hasText: 'Canvas' });
    await expect(canvasTab).toHaveClass(/active/);
  });

  test('tab indicators show counts when items exist', async ({ page }) => {
    // Seed 2 canvas items with unique filenames
    await seedCanvasItem(session.id, { type: 'markdown', content: '# Item 1', filename: 'item1.md' });
    await seedCanvasItem(session.id, { type: 'markdown', content: '# Item 2', filename: 'item2.md' });

    await navigateAndWait(page, `/sessions/${session.id}`);

    // Canvas tab should show count indicator
    const canvasTab = page.locator('.tabs-desktop .tab').filter({ hasText: 'Canvas' });
    await expect(canvasTab).toContainText('(2)');
  });

  test('session detail back link navigates to session list', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}`);

    // Click the back link (← Sessions)
    const backLink = page.locator('.tab-back');
    await expect(backLink).toBeVisible();
    await backLink.click();

    // Should navigate to project's session list
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/sessions`));
  });
});

// ============================================================
// Category 6: Filter Combinations & Edge Cases (4 tests)
// ============================================================

test.describe('Filter Combinations & Edge Cases', () => {
  test.describe.configure({ timeout: 15000 });

  let project: any;

  test.beforeEach(async ({ page }) => {
    project = await seedProject('FilterCombo Project', '/tmp/test');
    await page.addInitScript(() => {
      sessionStorage.removeItem('sessionStarredFilter');
      sessionStorage.removeItem('sessionScheduledFilter');
      localStorage.removeItem('sessionStatusFilter');
    });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('combining star and status filters narrows results correctly', async ({ page }) => {
    const session1 = await seedSession(project.id, { prompt: 'S1', name: 'Fav Idle One', startImmediately: false });
    const session2 = await seedSession(project.id, { prompt: 'S2', name: 'Fav Idle Two', startImmediately: false });
    await seedSession(project.id, { prompt: 'S3', name: 'Plain Idle Three', startImmediately: false });
    await seedSession(project.id, { prompt: 'S4', name: 'Plain Idle Four', startImmediately: false });
    await toggleSessionStar(session1.id);
    await toggleSessionStar(session2.id);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Apply star filter (starred only)
    const starBtn = page.locator('.status-filters .star-btn');
    await starBtn.click();
    await page.waitForTimeout(500);

    // Apply idle status filter
    const idleBtn = page.locator('.status-filters .filter-btn', { hasText: /idle/i });
    await idleBtn.click();
    await page.waitForTimeout(500);

    // Only the 2 starred idle sessions should be visible
    await expect(page.locator('.session-name').filter({ hasText: 'Fav Idle One' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Fav Idle Two' })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Plain Idle Three' })).not.toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: 'Plain Idle Four' })).not.toBeVisible();
  });

  test('filters show empty state when no sessions match', async ({ page }) => {
    await seedSession(project.id, { prompt: 'S1', name: 'Plain Session', startImmediately: false });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Apply star filter (starred only) - no starred sessions exist
    const starBtn = page.locator('.status-filters .star-btn');
    await starBtn.click();
    await page.waitForTimeout(500);

    // Should show empty state
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.empty-state')).toContainText('No sessions match the current filter');
  });

  test('all three filter controls are visible on session list', async ({ page }) => {
    await seedSession(project.id, { prompt: 'S1', name: 'Session One', startImmediately: false });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // All filter controls should be visible
    const statusFilters = page.locator('.status-filters');
    await expect(statusFilters).toBeVisible();

    // Running and idle filter buttons
    const runningBtn = statusFilters.locator('.filter-btn', { hasText: /running/i });
    const idleBtn = statusFilters.locator('.filter-btn', { hasText: /idle/i });
    await expect(runningBtn).toBeVisible();
    await expect(idleBtn).toBeVisible();

    // Star filter button
    const starBtn = statusFilters.locator('.star-btn');
    await expect(starBtn).toBeVisible();

    // Schedule filter button
    const scheduleBtn = statusFilters.locator('.schedule-btn');
    await expect(scheduleBtn).toBeVisible();
  });

  test('session count reflects active filters', async ({ page }) => {
    const session1 = await seedSession(project.id, { prompt: 'S1', name: 'Fav One', startImmediately: false });
    const session2 = await seedSession(project.id, { prompt: 'S2', name: 'Fav Two', startImmediately: false });
    await seedSession(project.id, { prompt: 'S3', name: 'Plain Three', startImmediately: false });
    await seedSession(project.id, { prompt: 'S4', name: 'Plain Four', startImmediately: false });
    await seedSession(project.id, { prompt: 'S5', name: 'Plain Five', startImmediately: false });
    await toggleSessionStar(session1.id);
    await toggleSessionStar(session2.id);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Apply star filter (starred only)
    const starBtn = page.locator('.status-filters .star-btn');
    await starBtn.click();
    await page.waitForTimeout(500);

    // Should only show 2 session cards
    const sessionCards = page.locator('.session-list .session-card');
    await expect(sessionCards).toHaveCount(2);
  });
});
