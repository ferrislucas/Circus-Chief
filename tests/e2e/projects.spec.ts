import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { cleanupAll, getProject, seedProject, API_URL } from './helpers';

test.describe('Project Management', () => {
  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('can create a new project', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Add Repository');

    await expect(page).toHaveURL('/projects/new');

    await page.fill('.path-chooser input', '/tmp/test-project');
    await page.click('button:has-text("Add Repository")');

    // Should redirect to sessions page with project ID in URL
    await expect(page).toHaveURL(/\/projects\/[\w-]+\/sessions/);

    // Extract project ID from URL and verify via API
    const url = page.url();
    const projectId = url.match(/\/projects\/([\w-]+)\/sessions/)?.[1];
    expect(projectId).toBeTruthy();

    const project = await getProject(projectId!);
    expect(project).not.toBeNull();
    expect(project.name).toBe('test-project');
    expect(project.workingDirectory).toBe('/tmp/test-project');

    // Verify project name is visible on the sessions page header
    await expect(page.getByText('test-project')).toBeVisible();
  });

  test('can edit project name', async ({ page }) => {
    const project = await seedProject('Original Name', '/tmp');

    await page.goto(`/projects/${project.id}/edit`);

    // Clear and update the name field
    await page.fill('input[id="name"]', 'Updated Name');
    await page.click('button.btn-primary:has-text("Save")');

    // Should redirect to session list
    await expect(page).toHaveURL(`/projects/${project.id}/sessions`);

    // Verify the name was updated via API
    const updatedProject = await getProject(project.id);
    expect(updatedProject.name).toBe('Updated Name');
  });

  test('can edit project working directory', async ({ page }) => {
    const project = await seedProject('Test Project', '/tmp');
    const tmpDir = mkdtempSync('/tmp/e2e-project-edit-');

    await page.goto(`/projects/${project.id}/edit`);

    // Update the working directory field
    await page.fill('.path-chooser input', tmpDir);
    await page.click('button.btn-primary:has-text("Save")');

    // Should redirect to session list
    await expect(page).toHaveURL(`/projects/${project.id}/sessions`);

    // Verify the working directory was updated via API
    const updatedProject = await getProject(project.id);
    expect(updatedProject.workingDirectory).toBe(tmpDir);
  });

  test('can edit custom system prompt', async ({ page }) => {
    const project = await seedProject('Test Project', '/tmp');

    await page.goto(`/projects/${project.id}/edit`);

    // System prompt field is visible by default in edit view
    const customPrompt = 'You are a helpful test assistant.';
    await page.fill('textarea[id="systemPrompt"]', customPrompt);
    await page.click('button.btn-primary:has-text("Save")');

    // Should redirect to session list
    await expect(page).toHaveURL(`/projects/${project.id}/sessions`);

    // Verify the system prompt was updated via API
    const updatedProject = await getProject(project.id);
    expect(updatedProject.systemPrompt).toBe(customPrompt);
  });

  test('can reset system prompt to default', async ({ page }) => {
    // Create a project with a custom system prompt
    const response = await fetch(`${API_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Project',
        workingDirectory: '/tmp',
        systemPrompt: 'Custom system prompt for testing',
      }),
    });
    const project = await response.json();

    await page.goto(`/projects/${project.id}/edit`);

    // Click "Reset to Default" button next to system prompt
    await page.click('button.btn-link:has-text("Reset to Default")');

    // Verify the textarea is reset to the default system prompt
    const textareaValue = await page.inputValue('textarea[id="systemPrompt"]');
    expect(textareaValue).not.toBe('Custom system prompt for testing');
    // The default prompt should contain the standard Claude Code introduction
    expect(textareaValue).toContain('You are Claude Code');

    await page.click('button.btn-primary:has-text("Save")');

    // Should redirect to session list
    await expect(page).toHaveURL(`/projects/${project.id}/sessions`);

    // Verify the system prompt is null (uses default) via API
    const updatedProject = await getProject(project.id);
    expect(updatedProject.systemPrompt).toBeNull();
  });

  test('can delete project', async ({ page }) => {
    const project = await seedProject('Test Project', '/tmp');

    // Set up dialog handler to accept the confirmation
    page.on('dialog', dialog => dialog.accept());

    await page.goto(`/projects/${project.id}/edit`);

    // Click the Delete button
    await page.click('button.btn-danger:has-text("Delete")');

    // Should redirect to home page
    await expect(page).toHaveURL('/');

    // Verify the project was deleted via API (should return 404)
    const deletedProject = await getProject(project.id);
    expect(deletedProject).toBeNull();
  });

  test('can create project with custom system prompt', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Add Repository');

    await expect(page).toHaveURL('/projects/new');

    await page.fill('.path-chooser input', '/tmp/test-project');

    // Expand Advanced Settings to access system prompt
    await page.click('details.advanced-settings summary');

    const customPrompt = 'You are a specialized coding assistant.';
    await page.fill('textarea[id="systemPrompt"]', customPrompt);

    await page.click('button:has-text("Add Repository")');

    // Should redirect to sessions page with project ID in URL
    await expect(page).toHaveURL(/\/projects\/[\w-]+\/sessions/);

    // Extract project ID from URL and verify via API
    const url = page.url();
    const projectId = url.match(/\/projects\/([\w-]+)\/sessions/)?.[1];
    expect(projectId).toBeTruthy();

    const project = await getProject(projectId!);
    expect(project).not.toBeNull();
    expect(project.systemPrompt).toBe(customPrompt);
  });
});
