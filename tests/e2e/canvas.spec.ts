import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedCanvasItem,
  cleanupAll,
  getCanvasItems,
  getAllCanvasItems,
  getCanvasTrash,
  getCanvasFileContent,
  deleteCanvasItem,
  navigateAndWait,
} from './helpers';

// A minimal 1x1 red PNG image in base64
const TEST_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

test.describe('Canvas Management', () => {
  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Test Project', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'Test', name: 'Canvas Test' });
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('API returns error when image file path does not exist', async () => {
    const API_URL = process.env.API_URL || 'http://localhost:5000';

    const response = await fetch(`${API_URL}/api/sessions/${session.id}/canvas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'image',
        filePath: '/nonexistent/path/to/image.png',
        label: 'Missing File',
      }),
    });

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error).toContain('File not found');
  });
});

test.describe('Canvas Trash & Soft Delete', () => {
  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Trash Test Project', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'Test', name: 'Trash Test' });
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('can recover file from trash', async ({ page }) => {
    const item = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Recover me',
      label: 'Recoverable',
      filename: 'recover.txt',
    });

    await deleteCanvasItem(session.id, item.id);

    // waitFor ensures async fetchTrashedItems completes so .trash-toggle renders
    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.trash-toggle',
      timeout: 15000,
    });

    // Click trash toggle
    await page.locator('.trash-toggle').click();
    await expect(page.locator('.trash-row')).toHaveCount(1);

    // Click recover button
    await page.locator('.btn-success').filter({ hasText: 'Recover' }).click();

    // Wait for recovery to complete
    await page.waitForTimeout(500);

    // Verify item is back via API
    const items = await getCanvasItems(session.id);
    expect(items.length).toBe(1);
    expect(items[0].deletedAt).toBeNull();

    // Verify trash is empty via API
    const trashedItems = await getCanvasTrash(session.id);
    expect(trashedItems.length).toBe(0);
  });

  test('can permanently delete from trash', async ({ page }) => {
    const item = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Gone forever',
      label: 'PermanentDelete',
      filename: 'permanent.txt',
    });

    await deleteCanvasItem(session.id, item.id);

    // waitFor ensures async fetchTrashedItems completes so .trash-toggle renders
    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.trash-toggle',
      timeout: 15000,
    });

    // Handle confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());

    // Click trash toggle
    await page.locator('.trash-toggle').click();
    await expect(page.locator('.trash-row')).toHaveCount(1);

    // Click delete forever button
    await page.locator('.btn-danger').filter({ hasText: 'Delete Forever' }).click();

    // Wait for deletion to complete
    await page.waitForTimeout(500);

    // Verify trash is empty - should show empty state
    await expect(page.getByText('Trash is empty')).toBeVisible();

    // Verify via API - item is completely gone
    const items = await getCanvasItems(session.id);
    const trashedItems = await getCanvasTrash(session.id);
    expect(items.length).toBe(0);
    expect(trashedItems.length).toBe(0);
  });

  test('deleting from list view removes all versions', async ({ page }) => {
    // Create two versions of the same file
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Version 1',
      label: 'MultiVersion',
      filename: 'report.txt',
    });

    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Version 2',
      label: 'MultiVersion',
      filename: 'report.txt',
    });

    // Verify we have 2 items via API (using getAllCanvasItems to get all versions)
    const itemsBefore = await getAllCanvasItems(session.id);
    expect(itemsBefore.length).toBe(2);

    // waitFor ensures async fetchItems completes so canvas file list renders
    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.btn-menu',
      timeout: 15000,
    });

    // Handle confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());

    // Click the context menu button for the file (first .btn-menu)
    await page.locator('.btn-menu').first().click();

    // Click "Delete file" in the menu
    await page.locator('.menu-item.is-danger').filter({ hasText: 'Delete file' }).click();

    // Wait for deletion to complete
    await page.waitForTimeout(500);

    // Verify both versions are gone from the list view via API
    const itemsAfter = await getAllCanvasItems(session.id);
    expect(itemsAfter.length).toBe(0);

    // Verify both versions are in trash via API
    const trashedItems = await getCanvasTrash(session.id);
    expect(trashedItems.length).toBe(2);
    expect(trashedItems[0].filename).toBe('report.txt');
    expect(trashedItems[1].filename).toBe('report.txt');
  });
});

test.describe('Canvas Copy File Contents', () => {
  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Copy Test Project', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'Test', name: 'Copy Test' });
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('copy file contents copies actual content for text files', async ({ page, context }) => {
    // Grant clipboard permissions so navigator.clipboard.writeText works
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const testContent = 'Hello, this is test content for copy!';

    await seedCanvasItem(session.id, {
      type: 'text',
      content: testContent,
      label: 'CopyTest',
      filename: 'copy-test.txt',
    });

    // Verify the content is actually stored via the API
    const apiContent = await getCanvasFileContent(session.id, 'copy-test.txt');
    expect(apiContent.content).toBe(testContent);

    // Navigate to the canvas tab and wait for file list to render
    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.btn-menu',
      timeout: 15000,
    });

    // Intercept clipboard writes to capture what gets copied
    await page.evaluate(() => {
      (window as any).__clipboardWrites = [];
      const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (text: string) => {
        (window as any).__clipboardWrites.push(text);
        return originalWriteText(text);
      };
    });

    // Click the context menu button for the file
    await page.locator('.btn-menu').first().click();

    // Click "Copy file contents" in the menu
    await page.locator('.menu-item').filter({ hasText: 'Copy file contents' }).click();

    // Wait for the async fetch + copy to complete
    await page.waitForTimeout(1000);

    // Check what was written to the clipboard
    const clipboardWrites = await page.evaluate(() => (window as any).__clipboardWrites);

    // The bug: content copied is '' (empty string) instead of the actual file content.
    // This is because fetchItemContent patches the store's raw items array,
    // but the component reads from a stale prop/computed copy that doesn't
    // reflect the store mutation.
    expect(clipboardWrites.length).toBeGreaterThan(0);
    expect(clipboardWrites[0]).toBe(testContent);
  });

  test('copy file contents copies actual content for markdown files', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const testContent = '# Hello World\n\nThis is **markdown** content.';

    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: testContent,
      label: 'MarkdownCopy',
      filename: 'copy-test.md',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.btn-menu',
      timeout: 15000,
    });

    // Intercept clipboard writes
    await page.evaluate(() => {
      (window as any).__clipboardWrites = [];
      const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (text: string) => {
        (window as any).__clipboardWrites.push(text);
        return originalWriteText(text);
      };
    });

    await page.locator('.btn-menu').first().click();
    await page.locator('.menu-item').filter({ hasText: 'Copy file contents' }).click();
    await page.waitForTimeout(1000);

    const clipboardWrites = await page.evaluate(() => (window as any).__clipboardWrites);
    expect(clipboardWrites.length).toBeGreaterThan(0);
    expect(clipboardWrites[0]).toBe(testContent);
  });

  test('copy file contents copies actual content for JSON files', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const testData = JSON.stringify({ hello: 'world', number: 42 });

    // For JSON type, the server maps content -> data internally
    await seedCanvasItem(session.id, {
      type: 'json',
      content: testData,
      label: 'JSONCopy',
      filename: 'copy-test.json',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.btn-menu',
      timeout: 15000,
    });

    // Intercept clipboard writes
    await page.evaluate(() => {
      (window as any).__clipboardWrites = [];
      const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (text: string) => {
        (window as any).__clipboardWrites.push(text);
        return originalWriteText(text);
      };
    });

    await page.locator('.btn-menu').first().click();
    await page.locator('.menu-item').filter({ hasText: 'Copy file contents' }).click();
    await page.waitForTimeout(1000);

    const clipboardWrites = await page.evaluate(() => (window as any).__clipboardWrites);
    expect(clipboardWrites.length).toBeGreaterThan(0);
    expect(clipboardWrites[0]).toBe(testData);
  });

  test('copy filename copies the filename correctly', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Some content',
      label: 'FilenameCopy',
      filename: 'my-file.txt',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.btn-menu',
      timeout: 15000,
    });

    // Intercept clipboard writes
    await page.evaluate(() => {
      (window as any).__clipboardWrites = [];
      const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (text: string) => {
        (window as any).__clipboardWrites.push(text);
        return originalWriteText(text);
      };
    });

    await page.locator('.btn-menu').first().click();
    await page.locator('.menu-item').filter({ hasText: 'Copy filename' }).click();
    await page.waitForTimeout(500);

    const clipboardWrites = await page.evaluate(() => (window as any).__clipboardWrites);
    expect(clipboardWrites.length).toBeGreaterThan(0);
    expect(clipboardWrites[0]).toBe('my-file.txt');
  });
});
