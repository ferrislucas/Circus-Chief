import { test, expect } from '@playwright/test';
import {
  seedProject,
  cleanupAll,
  navigateAndWait,
  getAPIURL,
} from './helpers';

test.describe('Session Navigation - Parent/Child Links', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let rootSession: any;
  let childSession: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Test Project', '/tmp/test');

    // Create a root session
    const API_URL = getAPIURL();
    const rootResponse = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Root session for testing',
        name: 'Root Session',
        startImmediately: false,
      }),
    });
    rootSession = await rootResponse.json();

    // Create a child session
    const childResponse = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Child session for testing',
        name: 'Child Session',
        parentSessionId: rootSession.id,
        startImmediately: false,
      }),
    });
    childSession = await childResponse.json();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('breadcrumb link navigates from child to parent session', async ({ page }) => {
    // Navigate to child session (no specific tab - let route handle default)
    await navigateAndWait(page, `/sessions/${childSession.id}`);

    // Wait for page to load (URL may change to include tab)
    await page.waitForLoadState('networkidle');

    // Wait for breadcrumb to be visible (with timeout for async data loading)
    const breadcrumb = page.locator('.session-breadcrumb');
    await expect(breadcrumb).toBeVisible({ timeout: 10000 });

    // Verify breadcrumb shows both root and child
    await expect(breadcrumb.getByText('Root Session')).toBeVisible();
    await expect(breadcrumb.getByText('Child Session')).toBeVisible();

    // Click the root session link in the breadcrumb
    const rootLink = breadcrumb.locator('a.breadcrumb-link', { hasText: 'Root Session' });
    await expect(rootLink).toBeVisible();
    await rootLink.click();

    // Verify navigation to parent session
    await expect(page).toHaveURL(new RegExp(`/sessions/${rootSession.id}`), { timeout: 10000 });

    // Verify the session name is displayed on the page
    await expect(page.locator('.session-name')).toContainText('Root Session');
  });

  test('child session link navigates from parent to child session', async ({ page }) => {
    // Navigate to root session
    await navigateAndWait(page, `/sessions/${rootSession.id}`);

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Wait for child sessions panel to be visible
    const childPanel = page.locator('.child-sessions-panel');
    await expect(childPanel).toBeVisible();

    // Verify panel shows correct count
    await expect(childPanel.getByText('Child Sessions (1)')).toBeVisible();

    // Click the child session link (use locator instead of getByText to avoid strict mode violation)
    const childLink = childPanel.locator('a.child-session-item');
    await expect(childLink).toBeVisible();
    await childLink.click();

    // Verify navigation to child session
    await expect(page).toHaveURL(new RegExp(`/sessions/${childSession.id}`), { timeout: 10000 });

    // Verify the session name is displayed on the page
    await expect(page.locator('.session-name')).toContainText('Child Session');
  });


  test('tabs work correctly after navigation via breadcrumb', async ({ page }) => {
    // Navigate to child session
    await navigateAndWait(page, `/sessions/${childSession.id}`);

    // Click breadcrumb to navigate to parent
    const breadcrumb = page.locator('.session-breadcrumb');
    const rootLink = breadcrumb.locator('a.breadcrumb-link', { hasText: 'Root Session' });
    await rootLink.click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${rootSession.id}`), { timeout: 10000 });

    // Click on the Changes tab
    const changesTab = page.locator('.tab', { hasText: 'Changes' });
    await changesTab.click();

    // Verify the Changes tab is active
    await expect(page).toHaveURL(new RegExp(`/sessions/${rootSession.id}/changes`));

    // Verify we're still on the root session (not the child)
    await expect(page.locator('.session-name')).toContainText('Root Session');
  });

  test('nested navigation works with multiple levels', async ({ page }) => {
    // Create a grandchild session
    const API_URL = getAPIURL();
    const grandchildResponse = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Grandchild session for testing',
        name: 'Grandchild Session',
        parentSessionId: childSession.id,
        startImmediately: false,
      }),
    });
    const grandchildSession = await grandchildResponse.json();

    // Navigate to grandchild session
    await navigateAndWait(page, `/sessions/${grandchildSession.id}`);

    // Verify breadcrumb shows all three levels
    const breadcrumb = page.locator('.session-breadcrumb');
    await expect(breadcrumb.getByText('Root Session', { exact: true })).toBeVisible();
    await expect(breadcrumb.getByText('Child Session', { exact: true })).toBeVisible();
    await expect(breadcrumb.getByText('Grandchild Session', { exact: true })).toBeVisible();

    // Click middle level (child) in breadcrumb
    const childLink = breadcrumb.locator('a.breadcrumb-link', { hasText: 'Child Session' });
    await childLink.click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${childSession.id}`), { timeout: 10000 });

    // Verify breadcrumb now shows two levels
    await expect(breadcrumb.getByText('Root Session')).toBeVisible();
    await expect(breadcrumb.getByText('Child Session')).toBeVisible();
  });
});
