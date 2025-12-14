import { test, expect } from '@playwright/test';
import { seedProject, cleanupAll } from './helpers';

test.describe('Project Management', () => {
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

    await page.fill('input[id="name"]', 'Test Project');
    await page.fill('.path-chooser input', '/tmp/test-project');
    await page.click('button:has-text("Create Project")');

    // Should redirect to sessions page
    await expect(page).toHaveURL(/\/projects\/.*\/sessions/);
  });

  test('displays project list', async ({ page }) => {
    // Seed some projects
    await seedProject('Project Alpha', '/path/to/alpha');
    await seedProject('Project Beta', '/path/to/beta');

    await page.goto('/');

    await expect(page.getByText('Project Alpha')).toBeVisible();
    await expect(page.getByText('Project Beta')).toBeVisible();
    await expect(page.getByText('/path/to/alpha')).toBeVisible();
  });

  test('can navigate to project sessions', async ({ page }) => {
    const project = await seedProject('Test Project', '/tmp/test');

    await page.goto('/');
    await page.click('text=Sessions');

    await expect(page).toHaveURL(`/projects/${project.id}/sessions`);
  });

  test('can edit a project', async ({ page }) => {
    const project = await seedProject('Original Name', '/original/path');

    await page.goto('/');
    await page.click('text=Edit');

    await expect(page).toHaveURL(`/projects/${project.id}/edit`);

    await page.fill('input[id="name"]', 'Updated Name');
    await page.click('button:has-text("Save")');

    await expect(page).toHaveURL(`/projects/${project.id}/sessions`);
  });

  test('can delete a project', async ({ page }) => {
    await seedProject('To Delete', '/tmp/delete');

    await page.goto('/');
    await expect(page.getByText('To Delete')).toBeVisible();

    await page.click('text=Edit');

    // Handle confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());
    await page.click('button:has-text("Delete")');

    await expect(page).toHaveURL('/');
    await expect(page.getByText('To Delete')).not.toBeVisible();
  });
});
