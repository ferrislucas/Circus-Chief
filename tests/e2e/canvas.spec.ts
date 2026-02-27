import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedCanvasItem,
  cleanupAll,
  getCanvasItems,
  getAllCanvasItems,
  getCanvasTrash,
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

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

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

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

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

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

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
