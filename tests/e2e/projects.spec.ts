import { test, expect } from '@playwright/test';
import { seedProject, cleanupAll, getProject, getProjects } from './helpers';

test.describe('Project Management', () => {
  // Run tests serially to avoid race conditions with shared database
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('displays empty state when no projects exist', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('No projects yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create Project' })).toBeVisible();
  });

  test('can create a new project', async ({ page }) => {
    await page.goto('/');
    await page.click('text=New Project');

    await expect(page).toHaveURL('/projects/new');

    // Verify form elements are present
    await expect(page.locator('input[id="name"]')).toBeVisible();
    await expect(page.locator('.path-chooser input')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Project' })).toBeVisible();

    await page.fill('input[id="name"]', 'Test Project');
    await page.fill('.path-chooser input', '/tmp/test-project');
    await page.click('button:has-text("Create Project")');

    // Should redirect to sessions page with project ID in URL
    await expect(page).toHaveURL(/\/projects\/[\w-]+\/sessions/);

    // Extract project ID from URL and verify via API
    const url = page.url();
    const projectId = url.match(/\/projects\/([\w-]+)\/sessions/)?.[1];
    expect(projectId).toBeTruthy();

    const project = await getProject(projectId!);
    expect(project).not.toBeNull();
    expect(project.name).toBe('Test Project');
    expect(project.workingDirectory).toBe('/tmp/test-project');

    // Verify project name is visible on the sessions page header
    await expect(page.getByText('Test Project')).toBeVisible();

    // Verify toast notification for success
    await expect(page.locator('.toast-success, .toast')).toBeVisible({ timeout: 3000 });
  });

  test('displays project list', async ({ page }) => {
    // Seed some projects
    const projectAlpha = await seedProject('Project Alpha', '/path/to/alpha');
    const projectBeta = await seedProject('Project Beta', '/path/to/beta');

    await page.goto('/');

    // Verify project cards exist with correct structure
    const projectCards = page.locator('.card, .project-card');
    await expect(projectCards).toHaveCount(2);

    // Verify Project Alpha card content
    const alphaCard = page.locator('.card, .project-card').filter({ hasText: 'Project Alpha' });
    await expect(alphaCard).toBeVisible();
    await expect(alphaCard.getByText('/path/to/alpha')).toBeVisible();
    await expect(alphaCard.getByRole('link', { name: 'Sessions' })).toBeVisible();
    await expect(alphaCard.getByRole('link', { name: 'Edit' })).toBeVisible();

    // Verify Project Beta card content
    const betaCard = page.locator('.card, .project-card').filter({ hasText: 'Project Beta' });
    await expect(betaCard).toBeVisible();
    await expect(betaCard.getByText('/path/to/beta')).toBeVisible();

    // Verify Sessions links have correct hrefs
    await expect(alphaCard.getByRole('link', { name: 'Sessions' })).toHaveAttribute(
      'href',
      `/projects/${projectAlpha.id}/sessions`
    );
    await expect(betaCard.getByRole('link', { name: 'Sessions' })).toHaveAttribute(
      'href',
      `/projects/${projectBeta.id}/sessions`
    );

    // Verify via API that projects exist
    const projects = await getProjects();
    expect(projects.length).toBe(2);
    expect(projects.find((p: any) => p.name === 'Project Alpha')).toBeTruthy();
    expect(projects.find((p: any) => p.name === 'Project Beta')).toBeTruthy();
  });

  test('can navigate to project sessions', async ({ page }) => {
    const project = await seedProject('Test Project', '/tmp/test');

    await page.goto('/');
    // Click on the project row (which is now fully clickable)
    await page.click('.project-card');

    await expect(page).toHaveURL(`/projects/${project.id}/sessions`);

    // Verify project name is visible on sessions page
    await expect(page.getByText('Test Project')).toBeVisible();

    // Verify empty sessions state is shown
    await expect(page.getByText('No sessions yet')).toBeVisible();
  });

  test('can edit a project', async ({ page }) => {
    const project = await seedProject('Original Name', '/original/path');

    await page.goto('/');
    await page.click('text=Edit');

    await expect(page).toHaveURL(`/projects/${project.id}/edit`);

    // Verify form is pre-filled with current values
    await expect(page.locator('input[id="name"]')).toHaveValue('Original Name');
    await expect(page.locator('.path-chooser input')).toHaveValue('/original/path');

    await page.fill('input[id="name"]', 'Updated Name');
    await page.click('button:has-text("Save")');

    await expect(page).toHaveURL(`/projects/${project.id}/sessions`);

    // Verify updated name is visible on page
    await expect(page.getByText('Updated Name')).toBeVisible();

    // Verify toast notification for success
    await expect(page.locator('.toast-success, .toast')).toBeVisible({ timeout: 3000 });

    // Verify via API that the change persisted
    const updated = await getProject(project.id);
    expect(updated).not.toBeNull();
    expect(updated.name).toBe('Updated Name');
    expect(updated.workingDirectory).toBe('/original/path'); // unchanged
  });

  test('can delete a project', async ({ page }) => {
    const project = await seedProject('To Delete', '/tmp/delete');

    await page.goto('/');
    await expect(page.getByText('To Delete')).toBeVisible();

    await page.click('text=Edit');

    // Handle confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());
    await page.click('button:has-text("Delete")');

    await expect(page).toHaveURL('/');
    await expect(page.getByText('To Delete')).not.toBeVisible();

    // Verify toast notification for success
    await expect(page.locator('.toast-success, .toast')).toBeVisible({ timeout: 3000 });

    // Verify via API that the project was actually deleted
    const deleted = await getProject(project.id);
    expect(deleted).toBeNull();

    // Verify project list is empty (shows empty state)
    const projects = await getProjects();
    expect(projects.length).toBe(0);
    await expect(page.getByText('No projects yet')).toBeVisible();
  });

  test('can cancel project deletion', async ({ page }) => {
    const project = await seedProject('Keep Me', '/tmp/keep');

    await page.goto('/');
    await page.click('text=Edit');

    // Handle confirmation dialog - dismiss it
    page.on('dialog', (dialog) => dialog.dismiss());
    await page.click('button:has-text("Delete")');

    // Should still be on edit page
    await expect(page).toHaveURL(`/projects/${project.id}/edit`);

    // Verify via API that project still exists
    const existing = await getProject(project.id);
    expect(existing).not.toBeNull();
    expect(existing.name).toBe('Keep Me');
  });

  test('cancel button on new project form navigates back', async ({ page }) => {
    await page.goto('/projects/new');

    // Click cancel
    await page.click('button:has-text("Cancel"), a:has-text("Cancel")');

    // Should navigate back to projects list
    await expect(page).toHaveURL('/');
  });

  test('cancel button on edit project form navigates back', async ({ page }) => {
    const project = await seedProject('Edit Cancel Test', '/tmp/cancel');

    await page.goto(`/projects/${project.id}/edit`);

    // Click cancel
    await page.click('button:has-text("Cancel"), a:has-text("Cancel")');

    // Should navigate back to sessions list
    await expect(page).toHaveURL(`/projects/${project.id}/sessions`);
  });

  test('displays loading state while fetching projects', async ({ page }) => {
    // Navigate to page
    await page.goto('/');

    // Loading state should resolve quickly
    await expect(page.locator('.loading-skeleton, .loading-state')).not.toBeVisible({
      timeout: 5000,
    });

    // Should show empty state since no projects
    await expect(page.getByText('No projects yet')).toBeVisible();
  });
});
