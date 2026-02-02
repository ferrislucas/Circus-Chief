import { test, expect } from '@playwright/test';
import { cleanupAll, getProject } from './helpers';

test.describe('Project Management', () => {
  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
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
});
