import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
  updateSessionStatus,
  getChildSessions,
  getAPIURL,
} from './helpers';

/**
 * E2E Tests for Parent/Child Session Hierarchy
 *
 * Covers:
 * - ChildSessionsPanel on Session Detail (Summary tab)
 * - SessionCard workflow expansion on Session List
 * - Workflow navigation
 * - Complex hierarchy scenarios (grandchildren, status aggregation)
 */

test.describe('ChildSessionsPanel on Session Detail', () => {
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

  test('shows child sessions panel on parent session detail', async ({ page }) => {
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
    await navigateAndWait(page, `/sessions/${parentSession.id}/summary`);

    // Verify child sessions panel is visible
    const panel = page.locator('.child-sessions-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });

    // Verify panel title shows correct count
    const panelTitle = panel.locator('.panel-title');
    await expect(panelTitle).toContainText('Child Sessions (2)');
  });

  test('child sessions panel is expandable and collapsible', async ({ page }) => {
    // Seed 1 child
    const child = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child prompt',
      name: 'Child Session',
    });
    await waitForSessionToExist(child.id);

    // Navigate to parent session detail (Summary tab)
    await navigateAndWait(page, `/sessions/${parentSession.id}/summary`);

    const panel = page.locator('.child-sessions-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });

    // Panel should start expanded (isExpanded defaults to true in ChildSessionsPanel)
    const panelContent = panel.locator('.panel-content');
    await expect(panelContent).toBeVisible();

    // Click panel header to collapse
    const panelHeader = panel.locator('.panel-header');
    await panelHeader.click();
    await page.waitForTimeout(300);

    // Verify collapsed
    await expect(panelContent).not.toBeVisible();

    // Click again to re-expand
    await panelHeader.click();
    await page.waitForTimeout(300);

    // Verify re-expanded
    await expect(panelContent).toBeVisible();
  });

  test('clicking child session navigates to child detail', async ({ page }) => {
    const child = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child prompt',
      name: 'Child Session Nav',
    });
    await waitForSessionToExist(child.id);

    // Navigate to parent session detail
    await navigateAndWait(page, `/sessions/${parentSession.id}/summary`);

    const panel = page.locator('.child-sessions-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });

    // Click the child session item link
    const childItem = panel.locator('.child-session-item').first();
    await expect(childItem).toBeVisible();
    await childItem.click();

    // Verify URL changes to child session
    await expect(page).toHaveURL(new RegExp(`/sessions/${child.id}`), { timeout: 10000 });

    // Verify child session name is displayed
    await expect(page.locator('.session-name')).toContainText('Child Session Nav');
  });

  test('child sessions show correct status badges', async ({ page }) => {
    // Seed 2 children with different statuses
    const child1 = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child 1 prompt',
      name: 'Waiting Child',
    });
    const child2 = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child 2 prompt',
      name: 'Stopped Child',
    });
    await waitForSessionToExist(child1.id);
    await waitForSessionToExist(child2.id);

    // Update child2 to stopped (valid status; 'completed' is not a valid PATCH status)
    await updateSessionStatus(child2.id, 'stopped');

    // Navigate to parent session detail
    await navigateAndWait(page, `/sessions/${parentSession.id}/summary`);

    const panel = page.locator('.child-sessions-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });

    // Verify status badges exist
    const statusBadges = panel.locator('.status-badge');
    await expect(statusBadges).toHaveCount(2, { timeout: 10000 });

    // Verify one has status-waiting and one has status-stopped
    await expect(panel.locator('.status-waiting')).toBeVisible();
    await expect(panel.locator('.status-stopped')).toBeVisible();
  });

  test('child sessions panel hidden when no children', async ({ page }) => {
    // Navigate to parent session detail (which has no children yet)
    await navigateAndWait(page, `/sessions/${parentSession.id}/summary`);

    // Verify child sessions panel is NOT visible
    const panel = page.locator('.child-sessions-panel');
    await expect(panel).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe('SessionCard Workflow Expansion', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;
  let standaloneSession: any;
  let childSession: any;

  test.beforeEach(async () => {
    project = await seedProject('Workflow Expand Test', '/tmp/test');
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent With Children',
      startImmediately: false,
    });
    await waitForSessionToExist(parentSession.id);

    childSession = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child prompt',
      name: 'Child Session',
    });
    await waitForSessionToExist(childSession.id);

    standaloneSession = await seedSession(project.id, {
      prompt: 'Standalone session prompt',
      name: 'Standalone Session',
      startImmediately: false,
    });
    await waitForSessionToExist(standaloneSession.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('expand button shown only for sessions with children', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Parent card should have expand button
    const parentCard = page.locator('.session-card').filter({ hasText: 'Parent With Children' });
    await expect(parentCard).toBeVisible({ timeout: 10000 });
    await expect(parentCard.locator('.expand-toggle-btn')).toBeVisible();

    // Standalone card should NOT have expand button
    const standaloneCard = page.locator('.session-card').filter({ hasText: 'Standalone Session' });
    await expect(standaloneCard).toBeVisible();
    await expect(standaloneCard.locator('.expand-toggle-btn')).not.toBeVisible();
  });

  test('expand button hidden on child session cards', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Expand the parent to make workflow items visible
    const parentCard = page.locator('.session-card').filter({ hasText: 'Parent With Children' });
    const expandButton = parentCard.locator('.expand-toggle-btn');
    await expect(expandButton).toBeVisible({ timeout: 10000 });
    await expandButton.click();
    await page.waitForTimeout(500);

    // Workflow items should not have expand buttons
    const workflowItems = page.locator('.workflow-session-item');
    await expect(workflowItems.first()).toBeVisible({ timeout: 10000 });
    const count = await workflowItems.count();
    expect(count).toBeGreaterThan(0);

    // None of the workflow items should contain an expand-toggle-btn
    for (let i = 0; i < count; i++) {
      await expect(workflowItems.nth(i).locator('.expand-toggle-btn')).not.toBeVisible();
    }
  });

  test('clicking expand button reveals workflow panel', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const parentCard = page.locator('.session-card').filter({ hasText: 'Parent With Children' });
    const expandButton = parentCard.locator('.expand-toggle-btn');
    await expect(expandButton).toBeVisible({ timeout: 10000 });

    // Verify button text contains "Show" before expanding
    await expect(expandButton).toContainText('Show');

    // Click expand
    await expandButton.click();
    await page.waitForTimeout(500);

    // Verify workflow panel becomes visible
    const workflowPanel = page.locator('.workflow-sessions-panel');
    await expect(workflowPanel).toBeVisible({ timeout: 5000 });

    // Verify button text now contains "Hide"
    await expect(expandButton).toContainText('Hide');
  });

  test('clicking collapse button hides workflow panel', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const parentCard = page.locator('.session-card').filter({ hasText: 'Parent With Children' });
    const expandButton = parentCard.locator('.expand-toggle-btn');
    await expect(expandButton).toBeVisible({ timeout: 10000 });

    // Expand first
    await expandButton.click();
    await page.waitForTimeout(500);

    const workflowPanel = page.locator('.workflow-sessions-panel');
    await expect(workflowPanel).toBeVisible();

    // Click again to collapse
    await expandButton.click();
    await page.waitForTimeout(500);

    // Verify workflow panel is hidden
    await expect(workflowPanel).not.toBeVisible();

    // Verify button text returns to "Show"
    await expect(expandButton).toContainText('Show');
  });

  test('workflow panel shows root session with ROOT label', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const parentCard = page.locator('.session-card').filter({ hasText: 'Parent With Children' });
    const expandButton = parentCard.locator('.expand-toggle-btn');
    await expect(expandButton).toBeVisible({ timeout: 10000 });
    await expandButton.click();
    await page.waitForTimeout(500);

    // Verify root session item exists
    const rootItem = page.locator('.workflow-session-item.root-session');
    await expect(rootItem).toBeVisible({ timeout: 5000 });

    // Verify it contains "ROOT" in the role label
    const roleLabel = rootItem.locator('.workflow-session-role');
    await expect(roleLabel).toContainText('ROOT');
  });

  test('workflow panel shows all child sessions', async ({ page }) => {
    // Add 2 more children (total 3)
    const child2 = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child 2 prompt',
      name: 'Child Session 2',
    });
    const child3 = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child 3 prompt',
      name: 'Child Session 3',
    });
    await waitForSessionToExist(child2.id);
    await waitForSessionToExist(child3.id);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    const parentCard = page.locator('.session-card').filter({ hasText: 'Parent With Children' });
    const expandButton = parentCard.locator('.expand-toggle-btn');
    await expect(expandButton).toBeVisible({ timeout: 10000 });
    await expandButton.click();
    await page.waitForTimeout(500);

    // Verify 4 workflow items total (1 root + 3 children)
    const workflowItems = page.locator('.workflow-session-item');
    await expect(workflowItems).toHaveCount(4, { timeout: 10000 });
  });
});

test.describe('Workflow Navigation', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;
  let childSession: any;

  test.beforeEach(async () => {
    project = await seedProject('Workflow Nav Test', '/tmp/test');
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent Session',
      startImmediately: false,
    });
    await waitForSessionToExist(parentSession.id);

    childSession = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child session prompt',
      name: 'Child Session',
    });
    await waitForSessionToExist(childSession.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('clicking workflow child item navigates to child session', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Expand parent card
    const parentCard = page.locator('.session-card').filter({ hasText: 'Parent Session' });
    const expandButton = parentCard.locator('.expand-toggle-btn');
    await expect(expandButton).toBeVisible({ timeout: 10000 });
    await expandButton.click();
    await page.waitForTimeout(500);

    // Click the child session's workflow link (not the root)
    const childWorkflowItem = page.locator('.workflow-session-item').filter({ hasText: 'Child Session' }).first();
    await expect(childWorkflowItem).toBeVisible({ timeout: 10000 });
    const childLink = childWorkflowItem.locator('.workflow-session-link');
    await childLink.click();

    // Verify navigation to child session detail
    await expect(page).toHaveURL(new RegExp(`/sessions/${childSession.id}`), { timeout: 10000 });

    // Verify breadcrumb shows parent → child path
    const breadcrumb = page.locator('.session-breadcrumb');
    await expect(breadcrumb).toBeVisible({ timeout: 10000 });
    await expect(breadcrumb.getByText('Parent Session')).toBeVisible();
    await expect(breadcrumb.getByText('Child Session')).toBeVisible();
  });

  test('clicking workflow root item navigates to root session', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Expand parent card
    const parentCard = page.locator('.session-card').filter({ hasText: 'Parent Session' });
    const expandButton = parentCard.locator('.expand-toggle-btn');
    await expect(expandButton).toBeVisible({ timeout: 10000 });
    await expandButton.click();
    await page.waitForTimeout(500);

    // Click the root session's workflow link
    const rootItem = page.locator('.workflow-session-item.root-session');
    await expect(rootItem).toBeVisible({ timeout: 5000 });
    const rootLink = rootItem.locator('.workflow-session-link');
    await rootLink.click();

    // Verify navigation to root session detail
    await expect(page).toHaveURL(new RegExp(`/sessions/${parentSession.id}`), { timeout: 10000 });
  });
});

test.describe('Complex Hierarchy Scenarios', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Complex Hierarchy Test', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('grandchildren shown in workflow view with correct depth', async ({ page }) => {
    // Seed root → child → grandchild
    const root = await seedSession(project.id, {
      prompt: 'Root prompt',
      name: 'Root Session',
      startImmediately: false,
    });
    await waitForSessionToExist(root.id);

    const child = await seedChildSession(project.id, root.id, {
      prompt: 'Child prompt',
      name: 'Child Session',
    });
    await waitForSessionToExist(child.id);

    const grandchild = await seedChildSession(project.id, child.id, {
      prompt: 'Grandchild prompt',
      name: 'Grandchild Session',
    });
    await waitForSessionToExist(grandchild.id);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Expand root session
    const rootCard = page.locator('.session-card').filter({ hasText: 'Root Session' });
    const expandButton = rootCard.locator('.expand-toggle-btn');
    await expect(expandButton).toBeVisible({ timeout: 10000 });
    await expandButton.click();
    await page.waitForTimeout(500);

    // Verify 3 workflow items (1 root + 1 child + 1 grandchild)
    const workflowItems = page.locator('.workflow-session-item');
    await expect(workflowItems).toHaveCount(3, { timeout: 10000 });

    // Verify grandchild has deeper indentation (paddingLeft style)
    // The WorkflowSessionItem uses :style="{ paddingLeft: `${depth * 1.5 + 0.5}rem` }"
    // Child (depth=1) -> paddingLeft = 2rem, Grandchild (depth=2) -> paddingLeft = 3.5rem
    const grandchildItem = page.locator('.workflow-session-item').filter({ hasText: 'Grandchild Session' });
    await expect(grandchildItem).toBeVisible();
    const paddingLeft = await grandchildItem.evaluate(el => el.style.paddingLeft);
    // Grandchild depth should be 2 -> 2 * 1.5 + 0.5 = 3.5rem
    expect(paddingLeft).toBe('3.5rem');
  });

  test('workflow shows aggregated status counts', async ({ page }) => {
    // Seed root + 2 children with different statuses
    const root = await seedSession(project.id, {
      prompt: 'Root prompt',
      name: 'Status Root',
      startImmediately: false,
    });
    await waitForSessionToExist(root.id);

    const child1 = await seedChildSession(project.id, root.id, {
      prompt: 'Child 1 prompt',
      name: 'Running Child',
    });
    const child2 = await seedChildSession(project.id, root.id, {
      prompt: 'Child 2 prompt',
      name: 'Error Child',
    });
    await waitForSessionToExist(child1.id);
    await waitForSessionToExist(child2.id);

    // Set one child to running and one to error
    await updateSessionStatus(child1.id, 'running');
    await updateSessionStatus(child2.id, 'error');

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Find the root session card
    const rootCard = page.locator('.session-card').filter({ hasText: 'Status Root' });
    await expect(rootCard).toBeVisible({ timeout: 10000 });

    // Verify the session meta shows aggregated status badges
    const sessionMeta = rootCard.locator('.session-meta');
    await expect(sessionMeta.locator('.status-running')).toBeVisible({ timeout: 10000 });
    await expect(sessionMeta.locator('.status-error')).toBeVisible({ timeout: 10000 });
  });

  test('session count badge shows total descendant count', async ({ page }) => {
    // Seed root + 3 children
    const root = await seedSession(project.id, {
      prompt: 'Root prompt',
      name: 'Count Root',
      startImmediately: false,
    });
    await waitForSessionToExist(root.id);

    for (let i = 1; i <= 3; i++) {
      const child = await seedChildSession(project.id, root.id, {
        prompt: `Child ${i} prompt`,
        name: `Count Child ${i}`,
      });
      await waitForSessionToExist(child.id);
    }

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    // Find root card
    const rootCard = page.locator('.session-card').filter({ hasText: 'Count Root' });
    await expect(rootCard).toBeVisible({ timeout: 10000 });

    // Verify the expand button text shows the total count
    // The button text shows "Show N sessions" when collapsed
    const expandButton = rootCard.locator('.expand-toggle-btn');
    await expect(expandButton).toBeVisible();
    // Total count includes root + 3 children = 4 sessions
    await expect(expandButton).toContainText('4 sessions');
  });
});
