import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedCanvasItem,
  cleanupAll,
  cleanupCreatedResources,
  getCanvasItems,
  getCanvasTrash,
  deleteCanvasItem,
  recoverCanvasFile,
  permanentlyDeleteCanvasItem,
  navigateAndWait,
  waitForSessionToExist,
  waitForCanvasItems,
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

  test('displays empty canvas state with upload option', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}/canvas`);
    // Empty state message should be visible
    await expect(page.getByText('No canvas items yet')).toBeVisible({ timeout: 10000 });
    // Upload button should be present
    await expect(page.getByRole('button', { name: 'Upload File' })).toBeVisible({ timeout: 10000 });
  });

  test('displays single canvas item directly in viewer (no list)', async ({ page }) => {
    const item = await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Test Markdown',
      label: 'Test Label',
    });

    // Ensure canvas item is available
    await waitForCanvasItems(session.id, 1);

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Single item should show directly in viewer (not in list)
    await expect(page.locator('.viewer-filename')).toContainText('Test Label', { timeout: 10000 });

    // Back button should NOT be visible (only one item)
    await expect(page.locator('.btn-back')).not.toBeVisible();

    // Upload button should still be visible
    await expect(page.getByRole('button', { name: 'Upload File' })).toBeVisible();

    // Verify via API that the item exists with correct data
    const items = await getCanvasItems(session.id);
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(item.id);
    expect(items[0].type).toBe('markdown');
    expect(items[0].label).toBe('Test Label');
    expect(items[0].content).toBe('# Test Markdown');
  });

  test('displays file list when multiple items exist', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# First',
      label: 'First Item',
    });

    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Second content',
      label: 'Second Item',
    });

    // Wait for both items to be available
    await waitForCanvasItems(session.id, 2);

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Should show list view with both items
    await expect(page.locator('.file-row')).toHaveCount(2, { timeout: 10000 });
    await expect(page.getByText('First Item')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Second Item')).toBeVisible({ timeout: 10000 });
  });

  test('clicking list item opens viewer', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# First',
      label: 'First Item',
    });

    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Second content',
      label: 'Second Item',
    });

    // Wait for items to be available
    await waitForCanvasItems(session.id, 2);

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Click on first item
    await page.locator('.file-row').filter({ hasText: 'First Item' }).click();

    // Should show viewer with back button
    await expect(page.locator('.viewer-filename')).toContainText('First Item', { timeout: 10000 });
    await expect(page.locator('.btn-back')).toBeVisible();
  });

  test('back button returns to list view', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# First',
      label: 'First Item',
    });

    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Second content',
      label: 'Second Item',
    });

    // Wait for items to be available
    await waitForCanvasItems(session.id, 2);

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Click on first item to open viewer
    await page.locator('.file-row').filter({ hasText: 'First Item' }).click();
    await expect(page.locator('.viewer-filename')).toBeVisible();

    // Click back button
    await page.locator('.btn-back').click();

    // Should show list view again
    await expect(page.locator('.file-row')).toHaveCount(2);
  });

  test('markdown items default to preview mode and can toggle to raw', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Heading\n\nSome **bold** text',
      label: 'Markdown Test',
    });

    // Wait for canvas item to be available
    await waitForCanvasItems(session.id, 1);

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Should be in preview mode by default - shows rendered markdown
    await expect(page.locator('.markdown-viewer')).toBeVisible();
    await expect(page.locator('.viewer-markdown-raw')).not.toBeVisible();

    // Preview toggle button should show "Raw" option (since we're in preview mode)
    const toggleButton = page.locator('.preview-toggle');
    await expect(toggleButton).toContainText('Raw');

    // Click to switch to raw mode
    await toggleButton.click();

    // Should now show raw markdown
    await expect(page.locator('.viewer-markdown-raw')).toBeVisible();
    await expect(page.locator('.markdown-viewer')).not.toBeVisible();
    await expect(page.locator('.viewer-markdown-raw')).toContainText('# Heading');

    // Toggle button should now show "Preview" option
    await expect(toggleButton).toContainText('Preview');

    // Click to switch back to preview mode
    await toggleButton.click();

    // Should be back in preview mode
    await expect(page.locator('.markdown-viewer')).toBeVisible();
    await expect(page.locator('.viewer-markdown-raw')).not.toBeVisible();
  });

  test('markdown items render properly with MarkdownViewer', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Main Heading\n\n- List item 1\n- List item 2\n\n```js\nconst x = 1;\n```',
      label: 'Rich Markdown',
    });

    // Wait for canvas item to be available
    await waitForCanvasItems(session.id, 1);

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Verify markdown is rendered (not raw)
    await expect(page.locator('.markdown-viewer h1')).toContainText('Main Heading');
    await expect(page.locator('.markdown-viewer ul li').first()).toContainText('List item 1');
    await expect(page.locator('.markdown-viewer pre code')).toContainText('const x = 1;');
  });

  test('can delete single canvas item', async ({ page }) => {
    const item = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Delete me',
      label: 'To Delete',
    });

    // Verify item exists via API before deletion
    let items = await getCanvasItems(session.id);
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(item.id);

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);
    await expect(page.locator('.viewer-filename')).toContainText('To Delete', { timeout: 10000 });

    // Handle confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());

    // Open menu and click delete file button
    await page.locator('.btn-menu').click();
    await page.getByText('Delete file').click();

    // Verify empty state is shown
    await expect(page.getByText('No canvas items yet')).toBeVisible();

    // Verify via API that the item was actually deleted
    items = await getCanvasItems(session.id);
    expect(items.length).toBe(0);
  });

  test('displays different canvas item types in list', async ({ page }) => {
    const textItem = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Plain text content',
      label: 'Text Item',
    });

    const jsonItem = await seedCanvasItem(session.id, {
      type: 'json',
      content: JSON.stringify({ key: 'value' }),
      label: 'JSON Item',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Verify both items are visible in list with correct labels and types
    await expect(page.getByText('Text Item')).toBeVisible();
    await expect(page.getByText('JSON Item')).toBeVisible();
    await expect(page.locator('.file-type').getByText('text')).toBeVisible();
    await expect(page.locator('.file-type').getByText('json')).toBeVisible();

    // Verify via API that both items exist with correct types
    const items = await getCanvasItems(session.id);
    expect(items.length).toBe(2);

    const apiTextItem = items.find((i: any) => i.id === textItem.id);
    const apiJsonItem = items.find((i: any) => i.id === jsonItem.id);

    expect(apiTextItem).toBeTruthy();
    expect(apiTextItem.type).toBe('text');
    expect(apiTextItem.content).toBe('Plain text content');

    expect(apiJsonItem).toBeTruthy();
    expect(apiJsonItem.type).toBe('json');
    expect(JSON.parse(apiJsonItem.content)).toEqual({ key: 'value' });
  });

  test('image renders correctly in viewer when using data and mimeType fields', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'image',
      data: TEST_PNG_BASE64,
      mimeType: 'image/png',
      label: 'Test Image',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Should be in viewer directly (single item)
    await expect(page.locator('.viewer-filename')).toContainText('Test Image');

    // Verify the image renders correctly (not broken)
    const image = page.locator('.viewer-image');
    await expect(image).toBeVisible();

    // Check that the image has loaded successfully by verifying naturalWidth > 0
    const naturalWidth = await image.evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);
  });

  test('image renders correctly when using data URL in content field', async ({ page }) => {
    const dataUrl = `data:image/png;base64,${TEST_PNG_BASE64}`;

    await seedCanvasItem(session.id, {
      type: 'image',
      content: dataUrl,
      label: 'Data URL Image',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Should be in viewer directly (single item)
    await expect(page.locator('.viewer-filename')).toContainText('Data URL Image');

    // Verify the image renders correctly (not broken)
    const image = page.locator('.viewer-image');
    await expect(image).toBeVisible();

    // Check that the image has loaded successfully by verifying naturalWidth > 0
    const naturalWidth = await image.evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);
  });

  test('image with invalid data shows as broken', async ({ page }) => {
    // Seed an image with invalid base64 data
    await seedCanvasItem(session.id, {
      type: 'image',
      data: 'invalid-base64-data',
      mimeType: 'image/png',
      label: 'Broken Image',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Verify the image element is present
    const image = page.locator('.viewer-image');
    await expect(image).toBeVisible();

    // Check that the image is broken (naturalWidth === 0 for broken images)
    const naturalWidth = await image.evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(naturalWidth).toBe(0);
  });

  test('API returns error when image posted with raw base64 content (no data URL)', async () => {
    const API_URL = process.env.API_URL || 'http://localhost:5000';

    // Try to post an image with raw base64 in content (incorrect format)
    const response = await fetch(`${API_URL}/api/sessions/${session.id}/canvas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'image',
        content: TEST_PNG_BASE64, // Raw base64, not a data URL
        label: 'Bad Image',
      }),
    });

    // Should return 400 error with helpful message
    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error).toContain('Image requires either');
    expect(error.error).toContain('filePath');
    expect(error.error).toContain('data URL');
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

  test('can upload an image file via file input', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Initially empty
    await expect(page.getByText('No canvas items yet')).toBeVisible();

    // Get the file input (hidden but accessible)
    const fileInput = page.locator('input[type="file"]');

    // Create a minimal valid PNG (1x1 pixel transparent)
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, // IDAT chunk
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, // IEND chunk
      0x42, 0x60, 0x82,
    ]);

    // Upload the image file
    await fileInput.setInputFiles({
      name: 'test-image.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    });

    // Wait for upload to complete - should show in viewer (single item)
    await expect(page.locator('.viewer-filename')).toContainText('test-image.png', { timeout: 10000 });

    // Empty state should be gone
    await expect(page.getByText('No canvas items yet')).not.toBeVisible();

    // Verify via API
    const items = await getCanvasItems(session.id);
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('image');
    expect(items[0].mimeType).toBe('image/png');
    expect(items[0].label).toBe('test-image.png');
  });

  test('version grouping: shows version badge in list for files with same name', async ({ page }) => {
    // Upload multiple versions of the same file
    await seedCanvasItem(session.id, {
      type: 'image',
      data: TEST_PNG_BASE64,
      mimeType: 'image/png',
      filename: 'screenshot.png',
      label: 'screenshot.png',
    });

    // Wait a bit to ensure different createdAt
    await new Promise((resolve) => setTimeout(resolve, 10));

    await seedCanvasItem(session.id, {
      type: 'image',
      data: TEST_PNG_BASE64,
      mimeType: 'image/png',
      filename: 'screenshot.png',
      label: 'screenshot.png',
    });

    // Add another file
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Other content',
      filename: 'other.txt',
      label: 'other.txt',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Should show list with 2 groups (screenshot.png with v2, other.txt with no badge)
    const rows = page.locator('.file-row');
    await expect(rows).toHaveCount(2);

    // Find the screenshot row and verify it has version badge
    const screenshotRow = page.locator('.file-row').filter({ hasText: 'screenshot.png' });
    await expect(screenshotRow.locator('.version-badge')).toContainText('v2');

    // Other.txt should not have version badge
    const otherRow = page.locator('.file-row').filter({ hasText: 'other.txt' });
    await expect(otherRow.locator('.version-badge')).not.toBeVisible();
  });

  test('version dropdown: can switch between versions', async ({ page }) => {
    // Upload multiple versions of the same file
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Version 1 content',
      filename: 'doc.txt',
      label: 'doc.txt',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Version 2 content',
      filename: 'doc.txt',
      label: 'doc.txt',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Single group, should show viewer directly
    await expect(page.locator('.viewer-filename')).toContainText('doc.txt');

    // Should show version dropdown with v2 (newest has highest version number)
    const versionDropdown = page.locator('.version-dropdown');
    await expect(versionDropdown).toBeVisible();
    await expect(versionDropdown.locator('summary')).toContainText('v2');

    // Content should be latest version
    await expect(page.locator('.viewer-text')).toContainText('Version 2 content');

    // Open dropdown and switch to older version
    await versionDropdown.locator('summary').click();
    await page.locator('.version-list li').nth(1).click();

    // Content should now be older version
    await expect(page.locator('.viewer-text')).toContainText('Version 1 content');
    await expect(versionDropdown.locator('summary')).toContainText('v1');
  });

  test('delete all versions: removes entire file group', async ({ page }) => {
    // Upload multiple versions of the same file
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Version 1',
      filename: 'doc.txt',
      label: 'doc.txt',
    });

    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Version 2',
      filename: 'doc.txt',
      label: 'doc.txt',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Handle confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());

    // Open menu and click delete file button
    await page.locator('.btn-menu').click();
    await page.getByText('Delete file').click();

    // Should show empty state
    await expect(page.getByText('No canvas items yet')).toBeVisible();

    // Verify via API
    const items = await getCanvasItems(session.id);
    expect(items.length).toBe(0);
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

  test('deleted items go to trash (soft delete)', async ({ page }) => {
    const item = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Will be deleted',
      label: 'Trash Item',
    });

    await waitForCanvasItems(session.id, 1);
    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Handle confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());

    // Delete the item
    await page.locator('.btn-menu').click();
    await page.getByText('Delete file').click();

    // Verify item is gone from canvas via API
    const items = await getCanvasItems(session.id);
    expect(items.length).toBe(0);

    // Verify item is in trash via API
    const trashedItems = await getCanvasTrash(session.id);
    expect(trashedItems.length).toBe(1);
    expect(trashedItems[0].id).toBe(item.id);
    expect(trashedItems[0].deletedAt).toBeDefined();
  });

  test('trash toggle button appears when trash has items', async ({ page }) => {
    // Create and delete an item
    const item = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Will be trashed',
      label: 'Trash Test Item',
    });

    await deleteCanvasItem(session.id, item.id);

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Trash toggle button should be visible
    await expect(page.locator('.trash-toggle')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.trash-count')).toContainText('1');
  });

  test('can view trash and see deleted items', async ({ page }) => {
    // Create and delete items
    const item1 = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Deleted 1',
      label: 'Item One',
    });
    const item2 = await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Deleted 2',
      label: 'Item Two',
    });

    await deleteCanvasItem(session.id, item1.id);
    await deleteCanvasItem(session.id, item2.id);

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Click trash toggle
    await page.locator('.trash-toggle').click();

    // Should show trash view with both items
    await expect(page.locator('.trash-header h3')).toContainText('Trash');
    await expect(page.locator('.trash-row')).toHaveCount(2);
    await expect(page.getByText('Item One')).toBeVisible();
    await expect(page.getByText('Item Two')).toBeVisible();
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

  test('back button returns from trash to canvas', async ({ page }) => {
    const item = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Test',
      label: 'BackTest',
    });

    await deleteCanvasItem(session.id, item.id);

    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Go to trash
    await page.locator('.trash-toggle').click();
    await expect(page.locator('.trash-header h3')).toContainText('Trash');

    // Click back button
    await page.locator('.trash-header .btn').filter({ hasText: 'Back to Canvas' }).click();

    // Should be back on canvas (empty state since item is trashed)
    await expect(page.getByText('No canvas items yet')).toBeVisible();
  });
});

test.describe('Canvas Copy Button', () => {
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

  test('copy button exists in file list', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Content 1',
      label: 'File1.txt',
    });
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Content 2',
      label: 'File2.txt',
    });

    await waitForCanvasItems(session.id, 2);
    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Each file row should have a copy button
    const copyButtons = page.locator('.copy-button');
    await expect(copyButtons).toHaveCount(2);
  });

  test('copy button exists in viewer header', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Single file content',
      label: 'SingleFile.txt',
    });

    await waitForCanvasItems(session.id, 1);
    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    // Should be in viewer mode (single item)
    await expect(page.locator('.viewer-header-left .copy-button')).toBeVisible();
  });

  test('copy button has correct aria-label for accessibility', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Accessible content',
      label: 'accessible-file.txt',
    });

    await waitForCanvasItems(session.id, 1);
    await navigateAndWait(page, `/sessions/${session.id}/canvas`);

    const copyButton = page.locator('.viewer-header-left .copy-button');
    await expect(copyButton).toHaveAttribute('aria-label', /Copy.*accessible-file\.txt/);
  });
});
