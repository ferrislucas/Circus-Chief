import { test, expect } from '@playwright/test';
import { seedProject, cleanupAll, getProject, API_URL } from './helpers';

test.describe('Worktree Path Editing in Project Settings', () => {
  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('worktree path input is not disabled or readonly', async ({ page }) => {
    const project = await seedProject('Worktree Attr Test', '/tmp');

    await page.goto(`/projects/${project.id}/edit`);

    const worktreeInput = page.locator('input#worktreePath');
    await expect(worktreeInput).toBeVisible();

    // The input should not have a disabled attribute
    await expect(worktreeInput).not.toBeDisabled();

    // The input should not have a readonly attribute
    const readonly = await worktreeInput.getAttribute('readonly');
    expect(readonly).toBeNull();

    // The input should not have a disabled attribute explicitly
    const disabled = await worktreeInput.getAttribute('disabled');
    expect(disabled).toBeNull();
  });

  test('worktree path input accepts keyboard input', async ({ page }) => {
    const project = await seedProject('Worktree Keyboard Test', '/tmp');

    await page.goto(`/projects/${project.id}/edit`);

    const worktreeInput = page.locator('input#worktreePath');
    await expect(worktreeInput).toBeVisible();

    // Verify the input starts empty (no worktree path set on seeded project)
    const initialValue = await worktreeInput.inputValue();
    expect(initialValue).toBe('');

    // Click to focus and type using pressSequentially (simulates real keystrokes)
    await worktreeInput.click();
    await worktreeInput.pressSequentially('/tmp/typed-worktrees');

    // Verify the typed value is reflected in the input
    const typedValue = await worktreeInput.inputValue();
    expect(typedValue).toBe('/tmp/typed-worktrees');
  });

  test('worktree path input accepts fill', async ({ page }) => {
    const project = await seedProject('Worktree Fill Test', '/tmp');

    await page.goto(`/projects/${project.id}/edit`);

    const worktreeInput = page.locator('input#worktreePath');
    await expect(worktreeInput).toBeVisible();

    // Clear and fill with a new value
    await worktreeInput.clear();
    await worktreeInput.fill('/tmp/custom-worktrees');

    // Verify the filled value is reflected in the input
    const inputValue = await worktreeInput.inputValue();
    expect(inputValue).toBe('/tmp/custom-worktrees');
  });

  test('worktree path value is populated when an existing value is present', async ({ page }) => {
    // Create a project, then set the worktree path via PUT API
    const project = await seedProject('Worktree Existing Test', '/tmp');
    const response = await fetch(`${API_URL}/api/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worktreePath: '/tmp/existing-worktrees' }),
    });
    expect(response.ok).toBe(true);

    // Verify the API actually stored the value
    const apiProject = await getProject(project.id);
    expect(apiProject.worktreePath).toBe('/tmp/existing-worktrees');

    // Now load the edit page
    await page.goto(`/projects/${project.id}/edit`);

    const worktreeInput = page.locator('input#worktreePath');
    await expect(worktreeInput).toBeVisible();

    // The input should show the existing worktree path value
    // This test surfaces a bug where the existing worktree path is not
    // populated into the input field when the edit form loads.
    await expect(async () => {
      const val = await worktreeInput.inputValue();
      expect(val).toBe('/tmp/existing-worktrees');
    }).toPass({ timeout: 5000 });
  });

  test('edited worktree path persists and is not immediately reset', async ({ page }) => {
    const project = await seedProject('Worktree Persist Test', '/tmp');

    await page.goto(`/projects/${project.id}/edit`);

    const worktreeInput = page.locator('input#worktreePath');
    await expect(worktreeInput).toBeVisible();

    // Fill with a new value
    await worktreeInput.fill('/tmp/persist-test');

    // Wait a moment and verify the value is still there (not reset by reactivity)
    await page.waitForTimeout(500);
    const valueAfterWait = await worktreeInput.inputValue();
    expect(valueAfterWait).toBe('/tmp/persist-test');

    // Also verify after interacting with another field (triggers potential blur events)
    await page.locator('input#name').click();
    await page.waitForTimeout(300);
    const valueAfterBlur = await worktreeInput.inputValue();
    expect(valueAfterBlur).toBe('/tmp/persist-test');
  });

  test('can save edited worktree path', async ({ page }) => {
    const project = await seedProject('Worktree Save Test', '/tmp');

    await page.goto(`/projects/${project.id}/edit`);

    const worktreeInput = page.locator('input#worktreePath');
    await expect(worktreeInput).toBeVisible();

    // Edit the worktree path
    await worktreeInput.fill('/tmp/saved-worktrees');

    // Verify the value was accepted by the input before saving
    const inputValue = await worktreeInput.inputValue();
    expect(inputValue).toBe('/tmp/saved-worktrees');

    // Save the form
    await page.click('button.btn-primary:has-text("Save")');

    // Should redirect to session list
    await expect(page).toHaveURL(`/projects/${project.id}/sessions`);

    // Verify the worktree path was persisted via API
    const updatedProject = await getProject(project.id);
    expect(updatedProject.worktreePath).toBe('/tmp/saved-worktrees');
  });
});
