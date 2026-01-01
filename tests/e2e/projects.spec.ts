import { test, expect } from '@playwright/test';
import { seedProject, cleanupAll, getProject, getProjects } from './helpers';

test.describe('Project Management', () => {
  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  // Note: This test requires no non-test projects in the database
  // It verifies the empty state UI when cleanupAll() removes all [TEST] projects
  test.skip('displays empty state when no projects exist', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('No projects yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create Project' })).toBeVisible();
  });

  test('can create a new project', async ({ page }) => {
    await page.goto('/');
    await page.click('text=New Project');

    await expect(page).toHaveURL('/projects/new');

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
  });

  test('displays project list', async ({ page }) => {
    // Seed some projects (names will be prefixed with [TEST])
    await seedProject('Project Alpha', '/path/to/alpha');
    await seedProject('Project Beta', '/path/to/beta');

    await page.goto('/');

    await expect(page.getByText('[TEST] Project Alpha')).toBeVisible();
    await expect(page.getByText('[TEST] Project Beta')).toBeVisible();
    await expect(page.getByText('/path/to/alpha')).toBeVisible();
  });

  test('can navigate to project sessions', async ({ page }) => {
    const project = await seedProject('Test Project', '/tmp/test');

    await page.goto('/');
    // Click on the project card with [TEST] prefix
    await page.click('text=[TEST] Test Project');

    await expect(page).toHaveURL(`/projects/${project.id}/sessions`);

    // Verify project name is visible on sessions page (with [TEST] prefix)
    await expect(page.getByText('[TEST] Test Project')).toBeVisible();

    // Verify empty sessions state is shown
    await expect(page.getByText('No sessions yet')).toBeVisible();
  });

  test('can edit a project', async ({ page }) => {
    const project = await seedProject('Original Name', '/original/path');

    await page.goto('/');
    // Click Edit on the test project row
    await page.locator('.project-card', { hasText: '[TEST] Original Name' }).getByText('Edit').click();

    await expect(page).toHaveURL(`/projects/${project.id}/edit`);

    await page.fill('input[id="name"]', 'Updated Name');
    await page.click('button:has-text("Save")');

    await expect(page).toHaveURL(`/projects/${project.id}/sessions`);

    // Verify updated name is visible on page
    await expect(page.getByText('Updated Name')).toBeVisible();

    // Verify via API that the change persisted
    const updated = await getProject(project.id);
    expect(updated).not.toBeNull();
    expect(updated.name).toBe('Updated Name');
    expect(updated.workingDirectory).toBe('/original/path'); // unchanged
  });

  test('can delete a project', async ({ page }) => {
    const project = await seedProject('To Delete', '/tmp/delete');

    await page.goto('/');
    await expect(page.getByText('[TEST] To Delete')).toBeVisible();

    // Click Edit on the specific test project
    await page.locator('.project-card', { hasText: '[TEST] To Delete' }).getByText('Edit').click();

    // Handle confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());
    await page.click('button:has-text("Delete")');

    await expect(page).toHaveURL('/');
    await expect(page.getByText('[TEST] To Delete')).not.toBeVisible();

    // Verify via API that the project was actually deleted
    const deleted = await getProject(project.id);
    expect(deleted).toBeNull();

    // Verify the deleted project is no longer in the list
    const projects = await getProjects();
    const deletedProjectStillExists = projects.some((p: any) => p.id === project.id);
    expect(deletedProjectStillExists).toBe(false);
  });
});
