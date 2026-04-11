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
  API_URL,
} from './helpers';

// A minimal 1x1 red PNG image in base64
const TEST_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

test.describe('Canvas Management', () => {
  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Test Project', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'Test', name: 'Canvas Test', startImmediately: false });
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('API returns error when image file path does not exist', async () => {
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
    session = await seedSession(project.id, { prompt: 'Test', name: 'Trash Test', startImmediately: false });
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

  test('bulk delete moves all versions of selected files to trash', async ({ page }) => {
    // Create two files, each with multiple versions
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Alpha V1',
      filename: 'alpha.txt',
    });
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Alpha V2',
      filename: 'alpha.txt',
    });
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Alpha V3',
      filename: 'alpha.txt',
    });
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Beta V1',
      filename: 'beta.txt',
    });
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Beta V2',
      filename: 'beta.txt',
    });

    // Verify 5 items via API
    const itemsBefore = await getAllCanvasItems(session.id);
    expect(itemsBefore.length).toBe(5);

    // Handle confirmation dialog for bulk delete
    page.on('dialog', (dialog) => dialog.accept());

    // Navigate to canvas — wait for the file list container to render
    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.canvas-file-list',
      timeout: 15000,
    });

    // The list shows grouped items (2 rows: alpha.txt and beta.txt)
    await expect(page.locator('.file-row')).toHaveCount(2);

    // Click the checkbox on the row containing "alpha.txt" to select it
    const alphaRow = page.locator('.file-row', { hasText: 'alpha.txt' });
    await alphaRow.locator('.item-checkbox').click();

    // Bulk toolbar should appear with "Delete Selected"
    await expect(page.locator('.bulk-action-toolbar')).toBeVisible();

    // Click "Delete Selected"
    await page.locator('.btn-danger').filter({ hasText: 'Delete Selected' }).click();

    // Wait for the operation to complete
    await page.waitForTimeout(500);

    // Verify via API: all 3 versions of alpha.txt are in trash
    const trashedItems = await getCanvasTrash(session.id);
    const trashedAlpha = trashedItems.filter((i: any) => i.filename === 'alpha.txt');
    expect(trashedAlpha.length).toBe(3);

    // beta.txt should still be active with both versions (use /all to get all versions)
    const activeItems = await getAllCanvasItems(session.id);
    const activeBeta = activeItems.filter((i: any) => i.filename === 'beta.txt');
    expect(activeBeta.length).toBe(2);
  });

  test('bulk recover in trash restores all versions of selected files', async ({ page }) => {
    // Create a file with 3 versions and soft-delete all of them
    const v1 = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Report V1',
      filename: 'report.txt',
    });
    const v2 = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Report V2',
      filename: 'report.txt',
    });
    const v3 = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Report V3',
      filename: 'report.txt',
    });

    // Also create another file in trash to ensure it's untouched
    const other = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Other file',
      filename: 'other.txt',
    });

    // Soft-delete all items via API
    await deleteCanvasItem(session.id, v1.id);
    await deleteCanvasItem(session.id, v2.id);
    await deleteCanvasItem(session.id, v3.id);
    await deleteCanvasItem(session.id, other.id);

    // Handle confirmation dialog for bulk recover
    page.on('dialog', (dialog) => dialog.accept());

    // Navigate to canvas and open trash
    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.trash-toggle',
      timeout: 15000,
    });
    await page.locator('.trash-toggle').click();

    // Trash should show 2 grouped rows (report.txt and other.txt)
    await expect(page.locator('.trash-row')).toHaveCount(2);

    // Click checkbox on the report.txt trash row to select it
    const reportRow = page.locator('.trash-row', { hasText: 'report.txt' });
    await reportRow.locator('.item-checkbox').click();

    // Bulk toolbar should appear with "Recover Selected"
    await expect(page.locator('.bulk-action-toolbar')).toBeVisible();

    // Click "Recover Selected"
    await page.locator('.bulk-action-toolbar .btn-success').filter({ hasText: 'Recover Selected' }).click();

    // Wait for operation
    await page.waitForTimeout(1000);

    // Verify via API: all 3 versions of report.txt are recovered (use /all to get all versions)
    const activeItems = await getAllCanvasItems(session.id);
    const activeReports = activeItems.filter((i: any) => i.filename === 'report.txt');
    expect(activeReports.length).toBe(3);

    // other.txt should still be in trash
    const trashedItems = await getCanvasTrash(session.id);
    const trashedOther = trashedItems.filter((i: any) => i.filename === 'other.txt');
    expect(trashedOther.length).toBe(1);
  });

  test('bulk permanent delete in trash removes all versions of selected files', async ({ page }) => {
    // Create a file with 3 versions and soft-delete all
    const v1 = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Delete V1',
      filename: 'deleteme.txt',
    });
    const v2 = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Delete V2',
      filename: 'deleteme.txt',
    });
    const v3 = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Delete V3',
      filename: 'deleteme.txt',
    });

    // Soft-delete all versions
    await deleteCanvasItem(session.id, v1.id);
    await deleteCanvasItem(session.id, v2.id);
    await deleteCanvasItem(session.id, v3.id);

    // Handle confirmation dialog for bulk permanent delete
    page.on('dialog', (dialog) => dialog.accept());

    // Navigate to canvas and open trash
    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.trash-toggle',
      timeout: 15000,
    });
    await page.locator('.trash-toggle').click();

    // Trash should show 1 grouped row (deleteme.txt with 3 versions)
    await expect(page.locator('.trash-row')).toHaveCount(1);
    await expect(page.locator('.trash-row').first()).toContainText('3 versions');

    // Click checkbox to select the trash row
    const deleteRow = page.locator('.trash-row', { hasText: 'deleteme.txt' });
    await deleteRow.locator('.item-checkbox').click();

    // Bulk toolbar should appear
    await expect(page.locator('.bulk-action-toolbar')).toBeVisible();

    // Click "Delete Forever" in the bulk toolbar (not the per-row button)
    await page.locator('.bulk-action-toolbar .btn-danger').filter({ hasText: 'Delete Forever' }).click();

    // Wait for operation
    await page.waitForTimeout(1000);

    // Trash should be empty
    await expect(page.getByText('Trash is empty')).toBeVisible({ timeout: 5000 });

    // Verify via API: all items are completely gone
    const activeItems = await getAllCanvasItems(session.id);
    const trashedItems = await getCanvasTrash(session.id);
    expect(activeItems.length).toBe(0);
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
      waitFor: '.canvas-file-list',
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
