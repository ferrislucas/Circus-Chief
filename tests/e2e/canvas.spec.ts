import { test, expect } from '@playwright/test';
import { seedProject, seedSession, seedCanvasItem, cleanupAll, getCanvasItems } from './helpers';

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
    await page.goto(`/sessions/${session.id}/canvas`);
    // Empty state message should be visible
    await expect(page.getByText('No canvas items yet')).toBeVisible();
    // Upload button should be present
    await expect(page.getByRole('button', { name: 'Upload File' })).toBeVisible();
  });

  test('displays canvas items', async ({ page }) => {
    const item = await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Test Markdown',
      label: 'Test Label',
    });

    await page.goto(`/sessions/${session.id}/canvas`);

    // Verify item label and type are visible
    await expect(page.getByText('Test Label')).toBeVisible();
    await expect(page.locator('.canvas-item-type').getByText('markdown')).toBeVisible();

    // Verify via API that the item exists with correct data
    const items = await getCanvasItems(session.id);
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(item.id);
    expect(items[0].type).toBe('markdown');
    expect(items[0].label).toBe('Test Label');
    expect(items[0].content).toBe('# Test Markdown');
  });

  test('markdown items default to preview mode and can toggle to raw', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Heading\n\nSome **bold** text',
      label: 'Markdown Test',
    });

    await page.goto(`/sessions/${session.id}/canvas`);

    // Should be in preview mode by default - shows rendered markdown
    const canvasItem = page.locator('.canvas-item').first();
    await expect(canvasItem.locator('.markdown-viewer')).toBeVisible();
    await expect(canvasItem.locator('.canvas-markdown-raw')).not.toBeVisible();

    // Preview toggle button should show "Raw" option (since we're in preview mode)
    const toggleButton = canvasItem.locator('.preview-toggle');
    await expect(toggleButton).toContainText('Raw');

    // Click to switch to raw mode
    await toggleButton.click();

    // Should now show raw markdown
    await expect(canvasItem.locator('.canvas-markdown-raw')).toBeVisible();
    await expect(canvasItem.locator('.markdown-viewer')).not.toBeVisible();
    await expect(canvasItem.locator('.canvas-markdown-raw')).toContainText('# Heading');

    // Toggle button should now show "Preview" option
    await expect(toggleButton).toContainText('Preview');

    // Click to switch back to preview mode
    await toggleButton.click();

    // Should be back in preview mode
    await expect(canvasItem.locator('.markdown-viewer')).toBeVisible();
    await expect(canvasItem.locator('.canvas-markdown-raw')).not.toBeVisible();
  });

  test('markdown items render properly with MarkdownViewer', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Main Heading\n\n- List item 1\n- List item 2\n\n```js\nconst x = 1;\n```',
      label: 'Rich Markdown',
    });

    await page.goto(`/sessions/${session.id}/canvas`);

    const canvasItem = page.locator('.canvas-item').first();

    // Verify markdown is rendered (not raw)
    await expect(canvasItem.locator('.markdown-viewer h1')).toContainText('Main Heading');
    await expect(canvasItem.locator('.markdown-viewer ul li').first()).toContainText('List item 1');
    await expect(canvasItem.locator('.markdown-viewer pre code')).toContainText('const x = 1;');
  });

  test('can delete canvas item', async ({ page }) => {
    const item = await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Delete me',
      label: 'To Delete',
    });

    // Verify item exists via API before deletion
    let items = await getCanvasItems(session.id);
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(item.id);

    await page.goto(`/sessions/${session.id}/canvas`);
    await expect(page.getByText('To Delete')).toBeVisible();

    // Handle confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());
    await page.click('button[title="Delete"]');

    // Verify not visible in UI
    await expect(page.getByText('To Delete')).not.toBeVisible();

    // Verify empty state is shown
    await expect(page.getByText('No canvas items yet')).toBeVisible();

    // Verify via API that the item was actually deleted
    items = await getCanvasItems(session.id);
    expect(items.length).toBe(0);
  });

  test('displays different canvas item types', async ({ page }) => {
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

    await page.goto(`/sessions/${session.id}/canvas`);

    // Verify both items are visible with correct labels and types
    await expect(page.getByText('Text Item')).toBeVisible();
    await expect(page.getByText('JSON Item')).toBeVisible();
    await expect(page.locator('.canvas-item-type').getByText('text')).toBeVisible();
    await expect(page.locator('.canvas-item-type').getByText('json')).toBeVisible();

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

  test('image renders correctly when using data and mimeType fields', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'image',
      data: TEST_PNG_BASE64,
      mimeType: 'image/png',
      label: 'Test Image',
    });

    await page.goto(`/sessions/${session.id}/canvas`);

    // Verify the image label and type are visible
    await expect(page.getByText('Test Image')).toBeVisible();
    await expect(page.locator('.canvas-item-type').getByText('image')).toBeVisible();

    // Verify the image renders correctly (not broken)
    const image = page.locator('.canvas-image');
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

    await page.goto(`/sessions/${session.id}/canvas`);

    // Verify the image label and type are visible
    await expect(page.getByText('Data URL Image')).toBeVisible();
    await expect(page.locator('.canvas-item-type').getByText('image')).toBeVisible();

    // Verify the image renders correctly (not broken)
    const image = page.locator('.canvas-image');
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

    await page.goto(`/sessions/${session.id}/canvas`);

    // Verify the image element is present
    const image = page.locator('.canvas-image');
    await expect(image).toBeVisible();

    // Check that the image is broken (naturalWidth === 0 for broken images)
    const naturalWidth = await image.evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(naturalWidth).toBe(0);
  });

  // Skip in CI - filePath requires shared filesystem between test runner and server
  test('image renders correctly when using filePath', async ({ page }) => {
    test.skip(!!process.env.CI, 'Skipped in CI - requires shared filesystem');

    // First, create a test image file
    const fs = await import('fs');
    const testImagePath = '/tmp/test-canvas-image.png';

    // Write the test PNG to a file
    const imageBuffer = Buffer.from(TEST_PNG_BASE64, 'base64');
    fs.writeFileSync(testImagePath, imageBuffer);

    try {
      await seedCanvasItem(session.id, {
        type: 'image',
        filePath: testImagePath,
        label: 'File Path Image',
      });

      await page.goto(`/sessions/${session.id}/canvas`);

      // Verify the image label and type are visible
      await expect(page.getByText('File Path Image')).toBeVisible();
      await expect(page.locator('.canvas-item-type').getByText('image')).toBeVisible();

      // Verify the image renders correctly (not broken)
      const image = page.locator('.canvas-image');
      await expect(image).toBeVisible();

      // Check that the image has loaded successfully by verifying naturalWidth > 0
      const naturalWidth = await image.evaluate((img: HTMLImageElement) => img.naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);
    } finally {
      // Clean up the test file
      if (fs.existsSync(testImagePath)) {
        fs.unlinkSync(testImagePath);
      }
    }
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

  // Skip in CI - filePath requires shared filesystem between test runner and server
  test('API returns error for unsupported image format', async () => {
    test.skip(!!process.env.CI, 'Skipped in CI - requires shared filesystem');

    const API_URL = process.env.API_URL || 'http://localhost:5000';
    const fs = await import('fs');
    const testFilePath = '/tmp/test-unsupported.xyz';

    // Create a file with unsupported extension
    fs.writeFileSync(testFilePath, 'fake image data');

    try {
      const response = await fetch(`${API_URL}/api/sessions/${session.id}/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'image',
          filePath: testFilePath,
          label: 'Unsupported Format',
        }),
      });

      expect(response.status).toBe(400);
      const error = await response.json();
      expect(error.error).toContain('Unsupported image format');
    } finally {
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    }
  });

  test('can upload an image file via file input', async ({ page }) => {
    await page.goto(`/sessions/${session.id}/canvas`);

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

    // Wait for upload to complete - look for the image type indicator
    await expect(page.locator('.canvas-item-type').getByText('image')).toBeVisible({ timeout: 10000 });

    // Empty state should be gone
    await expect(page.getByText('No canvas items yet')).not.toBeVisible();

    // Verify the label is displayed (filename) - use specific selector to avoid matching toast
    await expect(page.locator('.canvas-item-label').getByText('test-image.png')).toBeVisible();

    // Verify via API
    const items = await getCanvasItems(session.id);
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('image');
    expect(items[0].mimeType).toBe('image/png');
    expect(items[0].label).toBe('test-image.png');
  });
});
