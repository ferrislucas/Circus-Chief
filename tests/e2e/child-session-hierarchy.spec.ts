import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
} from './helpers';

/**
 * E2E Tests for Parent/Child Session Hierarchy
 *
 * Covers:
 * - SessionCardWorkflowPanel on Session Detail (Summary tab)
 */

test.describe('SessionCardWorkflowPanel on Session Detail', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;

  test.beforeEach(async () => {
    project = await seedProject('Hierarchy Test', '/tmp/test');
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parentSession.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('shows workflow panel on parent session detail with children', async ({ page }) => {
    // Seed 2 children
    const child1 = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child 1 prompt',
      name: 'Child Session 1',
    });
    const child2 = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child 2 prompt',
      name: 'Child Session 2',
    });
    await waitForSessionToExist(child1.id);
    await waitForSessionToExist(child2.id);

    // Navigate to parent session detail (Summary tab)
    // The new component uses SessionCardWorkflowPanel with variant="detail"
    await navigateAndWait(page, `/sessions/${parentSession.id}/summary`, {
      waitFor: '.workflow-sessions-panel--detail',
      timeout: 15000,
    });

    // Verify workflow sessions panel is visible
    const panel = page.locator('.workflow-sessions-panel--detail');
    await expect(panel).toBeVisible();

    // Verify it shows root + 2 children = 3 workflow items
    const workflowItems = panel.locator('.workflow-session-item');
    await expect(workflowItems).toHaveCount(3, { timeout: 10000 });
  });

  test('clicking child session in workflow panel navigates to child detail', async ({ page }) => {
    const child = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child prompt',
      name: 'Child Session Nav',
    });
    await waitForSessionToExist(child.id);

    // Navigate to parent session detail
    await navigateAndWait(page, `/sessions/${parentSession.id}/summary`, {
      waitFor: '.workflow-sessions-panel--detail',
      timeout: 15000,
    });

    const panel = page.locator('.workflow-sessions-panel--detail');
    await expect(panel).toBeVisible();

    // Click the child session's workflow link (not the root)
    const childWorkflowItem = panel.locator('.workflow-session-item').filter({ hasText: 'Child Session Nav' });
    await expect(childWorkflowItem).toBeVisible();
    const childLink = childWorkflowItem.locator('.workflow-session-link');
    await childLink.click();

    // Verify URL changes to child session
    await expect(page).toHaveURL(new RegExp(`/sessions/${child.id}`), { timeout: 10000 });

    // Verify child session name is displayed
    await expect(page.locator('.session-name')).toContainText('Child Session Nav');
  });

  test('child sessions are listed with their names in workflow panel', async ({ page }) => {
    // Seed 2 children
    const child1 = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child 1 prompt',
      name: 'First Child',
    });
    const child2 = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child 2 prompt',
      name: 'Second Child',
    });
    await waitForSessionToExist(child1.id);
    await waitForSessionToExist(child2.id);

    // Navigate to parent session detail
    await navigateAndWait(page, `/sessions/${parentSession.id}/summary`, {
      waitFor: '.workflow-sessions-panel--detail',
      timeout: 15000,
    });

    const panel = page.locator('.workflow-sessions-panel--detail');
    await expect(panel).toBeVisible();

    // Verify both child session names are visible in the workflow panel
    await expect(panel.locator('.workflow-session-name').filter({ hasText: 'First Child' })).toBeVisible();
    await expect(panel.locator('.workflow-session-name').filter({ hasText: 'Second Child' })).toBeVisible();

    // Verify the root session is also shown
    await expect(panel.locator('.root-session')).toBeVisible();
  });

  test('workflow panel hidden when no children', async ({ page }) => {
    // Navigate to parent session detail (which has no children yet)
    await navigateAndWait(page, `/sessions/${parentSession.id}/summary`);

    // Verify workflow sessions panel is NOT visible
    const panel = page.locator('.workflow-sessions-panel--detail');
    await expect(panel).not.toBeVisible({ timeout: 5000 });
  });
});

// Note: The SessionCard Workflow Expansion, Workflow Navigation, and Complex Hierarchy Scenarios
// test suites were removed as part of removing the child session list display from SessionListView.
// The SessionCardWorkflowPanel on Session Detail tests above still test the workflow panel
// which remains visible in the SessionDetailView (SummaryTab).
