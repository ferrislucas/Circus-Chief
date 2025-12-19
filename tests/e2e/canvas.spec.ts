import { test, expect } from '@playwright/test';
import { seedProject, seedSession, seedCanvasItem, cleanupAll, getCanvasItems } from './helpers';

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

  test('displays empty canvas state', async ({ page }) => {
    await page.goto(`/sessions/${session.id}/canvas`);
    await expect(page.getByText('No canvas items yet')).toBeVisible();
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
});
