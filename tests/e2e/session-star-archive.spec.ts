import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  cleanupCreatedResources,
  getSession,
  navigateAndWait,
  toggleSessionStar,
  archiveSession,
  unarchiveSession,
  getArchivedSessions,
} from './helpers';

test.describe('Star / Favorite Sessions', () => {
  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('can star a session from session list', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Test session', name: 'Test Session' });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Click star button (use first() to avoid strict mode violation with mobile duplicate)
    await page.locator('button[title="Star session"]').first().click();

    // Verify button changes to unstar (use first() again)
    await expect(page.locator('button[title="Unstar session"]').first()).toBeVisible();

    // Verify API returns starred: true
    const updatedSession = await getSession(session.id);
    expect(updatedSession.starred).toBe(true);
  });

  test('can unstar a session from session list', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Test session', name: 'Test Session' });

    // Star via API first
    await toggleSessionStar(session.id);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Click unstar button (use first() to avoid strict mode violation)
    await page.locator('button[title="Unstar session"]').first().click();

    // Verify API returns starred: false
    const updatedSession = await getSession(session.id);
    expect(updatedSession.starred).toBe(false);
  });

  test('star persists after page reload', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Test session', name: 'Test Session' });

    // Star via API
    await toggleSessionStar(session.id);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Reload page
    await page.reload();
    await waitForPageReady(page);

    // Verify star button shows "Unstar session" (use first() to avoid strict mode)
    await expect(page.locator('button[title="Unstar session"]').first()).toBeVisible();
  });

  test('star button not shown on child sessions', async ({ page }) => {
    const parentSession = await seedSession(project.id, {
      prompt: 'Parent session',
      name: 'Parent Session',
    });
    const childSession = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child session',
      name: 'Child Session',
    });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Verify parent has star button
    await expect(page.locator(`button[title="Star session"]`).first()).toBeVisible();

    // Child sessions are shown as part of parent card, not separate cards
    // The parent card should be expanded to show children
    // Look for the parent card and verify it has the child session name
    const parentCard = page.locator(`.session-card`).filter({ hasText: parentSession.name });
    await expect(parentCard).toBeVisible();

    // Expand the parent card to see children
    const expandBtn = parentCard.locator('.expand-toggle-btn');
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
    }

    // Now verify that within this card, there's only one star button (the parent's)
    // Child sessions don't have star buttons - they're part of the parent's workflow view
    const starButtons = parentCard.locator('.star-btn');
    const count = await starButtons.count();
    // Should have 2 star buttons (desktop + mobile), not more
    expect(count).toBe(2);
  });
});

test.describe('Star Filter (3-state)', () => {
  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('shows all sessions by default', async ({ page }) => {
    const session1 = await seedSession(project.id, {
      prompt: 'Session 1',
      name: 'Session 1',
    });
    const session2 = await seedSession(project.id, {
      prompt: 'Session 2',
      name: 'Session 2',
    });

    // Star one session
    await toggleSessionStar(session1.id);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Both sessions should be visible (check for session names in .session-name elements)
    await expect(page.locator('.session-name').filter({ hasText: session1.name })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: session2.name })).toBeVisible();
  });

  test('filters to starred only on first click', async ({ page }) => {
    const session1 = await seedSession(project.id, {
      prompt: 'Session 1',
      name: 'Session 1',
    });
    const session2 = await seedSession(project.id, {
      prompt: 'Session 2',
      name: 'Session 2',
    });

    // Star one session
    await toggleSessionStar(session1.id);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Click star filter button (the button with star icon)
    const starFilterBtn = page.locator('.filter-btn.star-btn').first();
    await starFilterBtn.click();

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // Only starred session should be visible
    await expect(page.locator('.session-name').filter({ hasText: session1.name })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: session2.name })).not.toBeVisible();
  });

  test('filters to unstarred only on second click', async ({ page }) => {
    const session1 = await seedSession(project.id, {
      prompt: 'Session 1',
      name: 'Session 1',
    });
    const session2 = await seedSession(project.id, {
      prompt: 'Session 2',
      name: 'Session 2',
    });

    // Star one session
    await toggleSessionStar(session1.id);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Click star filter button twice
    const starFilterBtn = page.locator('.filter-btn.star-btn').first();
    await starFilterBtn.click();
    await page.waitForTimeout(500);
    await starFilterBtn.click();
    await page.waitForTimeout(500);

    // Only unstarred session should be visible
    await expect(page.locator('.session-name').filter({ hasText: session1.name })).not.toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: session2.name })).toBeVisible();
  });

  test('resets to all on third click', async ({ page }) => {
    const session1 = await seedSession(project.id, {
      prompt: 'Session 1',
      name: 'Session 1',
    });
    const session2 = await seedSession(project.id, {
      prompt: 'Session 2',
      name: 'Session 2',
    });

    // Star one session
    await toggleSessionStar(session1.id);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Click star filter button three times
    const starFilterBtn = page.locator('.filter-btn.star-btn').first();
    await starFilterBtn.click();
    await page.waitForTimeout(500);
    await starFilterBtn.click();
    await page.waitForTimeout(500);
    await starFilterBtn.click();
    await page.waitForTimeout(500);

    // Both sessions should be visible again
    await expect(page.locator('.session-name').filter({ hasText: session1.name })).toBeVisible();
    await expect(page.locator('.session-name').filter({ hasText: session2.name })).toBeVisible();
  });
});

test.describe('Archive / Unarchive Sessions', () => {
  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('can archive a waiting session from list', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Test Session',
      startImmediately: false,
    });

    // Handle the confirmation dialog
    page.on('dialog', dialog => dialog.accept());

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Click archive button (use first() to avoid multiple matches)
    await page.locator('button.archive-btn[title="Archive session"]').first().click();

    // Wait for the archive action to complete and UI to update
    await page.waitForTimeout(1500);

    // Session should disappear from active list
    await expect(page.locator('.session-name').filter({ hasText: session.name })).not.toBeVisible();

    // Navigate to Archived tab (tabs are buttons)
    await page.locator('button.tab').filter({ hasText: 'Archived' }).click();

    // Wait for tab content to load
    await page.waitForLoadState('networkidle');

    // Session should appear in archived tab
    await expect(page.locator('.session-name').filter({ hasText: session.name })).toBeVisible();
  });

  test('can unarchive from archived tab', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Test Session',
      startImmediately: false,
    });

    // Archive via API
    await archiveSession(session.id);

    // Handle the confirmation dialog
    page.on('dialog', dialog => dialog.accept());

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Navigate to Archived tab (tabs are buttons)
    await page.locator('button.tab').filter({ hasText: 'Archived' }).click();
    await page.waitForLoadState('networkidle');

    // Verify session is in archived tab
    await expect(page.locator('.session-name').filter({ hasText: session.name })).toBeVisible();

    // Click unarchive button
    await page.locator('button.archive-btn[title="Unarchive session"]').first().click();

    // Wait for unarchive action to complete
    await page.waitForTimeout(1500);

    // Navigate to Sessions tab (it's called "Sessions" not "Active")
    await page.locator('button.tab').filter({ hasText: 'Sessions' }).click();
    await page.waitForLoadState('networkidle');

    // Session should reappear in active list
    await expect(page.locator('.session-name').filter({ hasText: session.name })).toBeVisible();
  });

  test('archive button hidden for child sessions', async ({ page }) => {
    const parentSession = await seedSession(project.id, {
      prompt: 'Parent session',
      name: 'Parent Session',
      startImmediately: false, // Ensure it's not running so it can be archived
    });
    const childSession = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child session',
      name: 'Child Session',
    });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Wait for sessions to be visible
    await page.waitForTimeout(500);

    // Find parent card and expand it to see children
    const parentCard = page.locator(`.session-card`).filter({ hasText: parentSession.name });
    await expect(parentCard).toBeVisible();

    const expandBtn = parentCard.locator('.expand-toggle-btn');
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForTimeout(300); // Wait for expansion animation
    }

    // Verify parent has archive button in the header actions area
    // The button should be visible since parent session is 'waiting' status (not running/starting)
    const archiveBtn = parentCard.locator('button.archive-btn[title="Archive session"]');
    await expect(archiveBtn).toBeVisible();

    // Child sessions don't have separate cards or archive buttons
    // They're part of the parent's workflow view
    // We verify this by checking there's only one archive button in the parent card
    const archiveButtons = parentCard.locator('button.archive-btn[title="Archive session"]');
    const count = await archiveButtons.count();
    expect(count).toBe(1);
  });

  test('archive via overflow menu on session detail', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Test Session',
      startImmediately: false,
    });

    // Handle the confirmation dialog
    page.on('dialog', dialog => dialog.accept());

    await navigateAndWait(page, `/sessions/${session.id}`);

    // Open overflow menu (aria-label is "Session actions" on session detail page)
    await page.click('button[aria-label="Session actions"]');

    // Wait for menu items to be visible (the menu uses Vue <Transition>)
    await expect(page.locator('.menu-items')).toBeVisible({ timeout: 5000 });

    // Click Archive menu item (button.menu-item with Archive text)
    await page.locator('button.menu-item').filter({ hasText: 'Archive' }).click({ timeout: 10000 });

    // Wait for archive to complete
    await page.waitForTimeout(2000);

    // Verify session archived via API
    const archivedSessions = await getArchivedSessions(project.id);
    expect(archivedSessions.some((s: any) => s.id === session.id)).toBe(true);
  });

  test('unarchive via overflow menu on session detail', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Test Session',
      startImmediately: false,
    });

    // Archive the session first
    await archiveSession(session.id);

    // Handle the confirmation dialog
    page.on('dialog', dialog => dialog.accept());

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Navigate to Archived tab
    await page.locator('button.tab').filter({ hasText: 'Archived' }).click();
    await page.waitForLoadState('networkidle');

    // Navigate to session detail (click on the session card)
    await page.locator('.session-card').filter({ hasText: session.name }).first().click();

    // Wait for navigation
    await page.waitForLoadState('networkidle');

    // Open overflow menu
    await page.click('button[aria-label="Session actions"]');

    // Wait for menu items to be visible (the menu uses Vue <Transition>)
    await expect(page.locator('.menu-items')).toBeVisible({ timeout: 5000 });

    // Click Unarchive menu item (button.menu-item with Unarchive text)
    await page.locator('button.menu-item').filter({ hasText: 'Unarchive' }).click({ timeout: 10000 });

    // Wait for unarchive to complete
    await page.waitForTimeout(2000);

    // Verify unarchived via API
    const archivedSessions = await getArchivedSessions(project.id);
    expect(archivedSessions.some((s: any) => s.id === session.id)).toBe(false);
  });
});

// Helper function for page ready
async function waitForPageReady(page: any) {
  await page.waitForLoadState('networkidle');
  const loadingIndicators = page.locator('.loading, .spinner, [data-loading="true"]');
  const count = await loadingIndicators.count();
  if (count > 0) {
    await expect(loadingIndicators.first()).not.toBeVisible();
  }
}
