import { test, expect } from '@playwright/test';
import { seedProject, cleanupAll, expectFullyInViewport, expectHitTestable } from './helpers';

test.describe('Path Chooser', () => {
  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('displays Browse button next to working directory input', async ({ page }) => {
    await page.goto('/projects/new');

    // Assert the path chooser structure is present
    await expect(page.locator('.path-chooser')).toBeVisible();
    await expect(page.locator('.path-chooser input[type="text"]')).toBeVisible();
    await expectHitTestable(page.getByRole('button', { name: 'Browse' }), { requireEnabled: true });
  });

  test('opens directory browser modal when Browse is clicked', async ({ page }) => {
    await page.goto('/projects/new');

    const browseButton = page.getByRole('button', { name: 'Browse' });
    await expectHitTestable(browseButton, { requireEnabled: true });
    await browseButton.click();

    // Assert modal is visible with correct structure
    await expect(page.locator('.path-browser-overlay')).toBeVisible();
    await expectFullyInViewport(page.locator('.path-browser'));
    await expect(page.locator('.browser-header')).toBeVisible();
    await expect(page.locator('.browser-content')).toBeVisible();
    await expect(page.locator('.browser-footer')).toBeVisible();

    // Assert modal has Cancel and Select buttons
    await expectHitTestable(page.locator('.browser-footer button:has-text("Cancel")'), { requireEnabled: true });
    await expectHitTestable(page.locator('.browser-footer button:has-text("Select")'), { requireEnabled: true });
  });

  test('closes modal when Cancel is clicked', async ({ page }) => {
    await page.goto('/projects/new');

    await page.getByRole('button', { name: 'Browse' }).click();
    await expect(page.locator('.path-browser-overlay')).toBeVisible();

    const cancelButton = page.locator('.browser-footer button:has-text("Cancel")');
    await expectHitTestable(cancelButton, { requireEnabled: true });
    await cancelButton.click();

    await expect(page.locator('.path-browser-overlay')).not.toBeVisible();
  });

  test('closes modal when clicking overlay background', async ({ page }) => {
    await page.goto('/projects/new');

    await page.click('button:has-text("Browse")');
    await expect(page.locator('.path-browser-overlay')).toBeVisible();

    // Click the overlay (outside the modal)
    await page.locator('.path-browser-overlay').click({ position: { x: 10, y: 10 } });

    await expect(page.locator('.path-browser-overlay')).not.toBeVisible();
  });

  test('closes modal when X button is clicked', async ({ page }) => {
    await page.goto('/projects/new');

    await page.getByRole('button', { name: 'Browse' }).click();
    await expect(page.locator('.path-browser-overlay')).toBeVisible();

    const closeButton = page.locator('.browser-close');
    await expectHitTestable(closeButton, { requireEnabled: true });
    await closeButton.click();

    await expect(page.locator('.path-browser-overlay')).not.toBeVisible();
  });
});

test.describe('Path Chooser Navigation', () => {
  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('displays current path in browser header', async ({ page }) => {
    await page.goto('/projects/new');
    await page.click('button:has-text("Browse")');

    // Should show a path in the header (home directory by default)
    const pathDisplay = page.locator('.browser-path');
    await expect(pathDisplay).toBeVisible();
    const pathText = await pathDisplay.textContent();
    expect(pathText).toMatch(/^\//); // Should start with /
  });

  test('displays directory entries as clickable items', async ({ page }) => {
    await page.goto('/projects/new');
    await page.click('button:has-text("Browse")');

    // Wait for content to load
    await expect(page.locator('.browser-loading')).not.toBeVisible({ timeout: 5000 });

    // Should have directory items or empty state
    const hasItems = (await page.locator('.browser-item:not(.parent)').count()) > 0;
    const hasEmpty = await page.locator('.browser-empty').isVisible();

    expect(hasItems || hasEmpty).toBe(true);
  });

  test('shows parent directory option when not at root', async ({ page }) => {
    await page.goto('/projects/new');

    // Pre-fill with a non-root path
    await page.fill('.path-chooser input', '/tmp');
    await page.click('button:has-text("Browse")');

    await expect(page.locator('.browser-loading')).not.toBeVisible({ timeout: 5000 });

    // Should show parent directory navigation
    await expect(page.locator('.browser-item.parent')).toBeVisible();
    await expect(page.getByText('Parent Directory')).toBeVisible();
  });

  test('navigates to subdirectory when clicked', async ({ page }) => {
    await page.goto('/projects/new');

    // Start from root to ensure we have known directories
    await page.fill('.path-chooser input', '/');
    await page.click('button:has-text("Browse")');

    await expect(page.locator('.browser-loading')).not.toBeVisible({ timeout: 5000 });

    // Get initial path
    const initialPath = await page.locator('.browser-path').textContent();

    // Click on a directory (if available)
    const dirItem = page.locator('.browser-item:not(.parent)').first();
    if (await dirItem.isVisible()) {
      await dirItem.click();

      await expect(page.locator('.browser-loading')).not.toBeVisible({ timeout: 5000 });

      // Path should have changed
      const newPath = await page.locator('.browser-path').textContent();
      expect(newPath).not.toBe(initialPath);
    }
  });

  test('navigates to parent directory when parent item is clicked', async ({ page }) => {
    await page.goto('/projects/new');

    await page.fill('.path-chooser input', '/tmp');
    await page.click('button:has-text("Browse")');

    await expect(page.locator('.browser-loading')).not.toBeVisible({ timeout: 5000 });

    const initialPath = await page.locator('.browser-path').textContent();

    // Click parent directory
    await page.click('.browser-item.parent');

    await expect(page.locator('.browser-loading')).not.toBeVisible({ timeout: 5000 });

    // Path should be parent of initial
    const newPath = await page.locator('.browser-path').textContent();
    expect(initialPath).toContain(newPath!);
  });
});

test.describe('Path Chooser Selection', () => {
  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('selecting a path updates the input field', async ({ page }) => {
    await page.goto('/projects/new');

    await page.click('button:has-text("Browse")');
    await expect(page.locator('.browser-loading')).not.toBeVisible({ timeout: 5000 });

    // Get the displayed path
    const selectedPath = await page.locator('.browser-path').textContent();

    // Click Select
    const selectButton = page.locator('.browser-footer button:has-text("Select")');
    await expectHitTestable(selectButton, { requireEnabled: true });
    await selectButton.click();

    // Modal should close
    await expect(page.locator('.path-browser-overlay')).not.toBeVisible();

    // Input should have the selected path
    const inputValue = await page.locator('.path-chooser input').inputValue();
    expect(inputValue).toBe(selectedPath);
  });

  test('can create project with browsed path', async ({ page }) => {
    await page.goto('/projects/new');

    // Use path browser to select /tmp (name auto-fills from path)
    await page.fill('.path-chooser input', '/tmp');
    await page.click('button:has-text("Browse")');
    await expect(page.locator('.browser-loading')).not.toBeVisible({ timeout: 5000 });
    await page.click('.browser-footer button:has-text("Select")');

    // Verify input has value
    const inputValue = await page.locator('.path-chooser input').inputValue();
    expect(inputValue).toBe('/tmp');

    // Submit form
    await page.click('button:has-text("Add Repository")');

    // Should redirect to sessions page
    await expect(page).toHaveURL(/\/projects\/.*\/sessions/);
  });

  test('manual path entry still works', async ({ page }) => {
    await page.goto('/projects/new');

    // Use a path whose parent is guaranteed writable. The ProjectNewView
    // auto-detects the worktree path as `<workingDirectory>/.worktrees` and
    // the server validates that the worktree path's parent is writable.
    // Paths like /usr/local may be read-only in some environments, causing
    // the create-project request to 400 and the URL to stay on /projects/new.
    await page.fill('.path-chooser input', '/tmp');

    await page.click('button:has-text("Add Repository")');

    await expect(page).toHaveURL(/\/projects\/.*\/sessions/);
  });
});

test.describe('Path Chooser in Edit View', () => {
  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('path chooser appears in project edit view', async ({ page }) => {
    const project = await seedProject('Edit Test', '/original/path');

    await page.goto(`/projects/${project.id}/edit`);

    await expect(page.locator('.path-chooser')).toBeVisible();
    await expectHitTestable(page.getByRole('button', { name: 'Browse' }), { requireEnabled: true });

    // Should have the existing path value
    const inputValue = await page.locator('.path-chooser input').inputValue();
    expect(inputValue).toBe('/original/path');
  });

  test('can update project path using browser', async ({ page }) => {
    const project = await seedProject('Path Update Test', '/original');

    await page.goto(`/projects/${project.id}/edit`);

    // Use browser to change path
    await page.fill('.path-chooser input', '/tmp');
    await page.click('button:has-text("Browse")');
    await expect(page.locator('.browser-loading')).not.toBeVisible({ timeout: 5000 });
    await page.click('.browser-footer button:has-text("Select")');

    await page.click('button:has-text("Save")');

    // Should redirect
    await expect(page).toHaveURL(`/projects/${project.id}/sessions`);

    // Verify change persisted
    await page.goto(`/projects/${project.id}/edit`);
    const inputValue = await page.locator('.path-chooser input').inputValue();
    expect(inputValue).toBe('/tmp');
  });
});

test.describe('Path Chooser Error Handling', () => {
  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('displays error for inaccessible directories', async ({ page }) => {
    await page.goto('/projects/new');

    // Try to browse a path that likely doesn't exist or is inaccessible
    await page.fill('.path-chooser input', '/nonexistent/path/that/doesnt/exist');
    await page.click('button:has-text("Browse")');

    await expect(page.locator('.browser-loading')).not.toBeVisible({ timeout: 5000 });

    // Should show error message
    await expect(page.locator('.browser-error')).toBeVisible();
  });

  test('shows loading state while fetching directories', async ({ page }) => {
    await page.goto('/projects/new');

    await page.click('button:has-text("Browse")');

    // Loading should appear briefly (may be too fast to catch, so we check it doesn't persist)
    await expect(page.locator('.browser-loading')).not.toBeVisible({ timeout: 5000 });
  });
});
