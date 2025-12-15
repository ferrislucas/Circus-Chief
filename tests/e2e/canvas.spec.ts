import { test, expect } from '@playwright/test';
import { seedProject, seedSession, seedCanvasItem, cleanupAll, getCanvasItems } from './helpers';

test.describe('Canvas Management', () => {
  // Run tests serially to avoid race conditions with shared database
  test.describe.configure({ mode: 'serial' });

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

    // Verify canvas item card structure
    const canvasItem = page.locator('.canvas-item').filter({ hasText: 'Test Label' });
    await expect(canvasItem).toBeVisible();

    // Verify item label is within the canvas item
    await expect(canvasItem.locator('.canvas-item-label, [class*="label"]')).toHaveText('Test Label');

    // Verify item type badge shows correct type
    await expect(canvasItem.locator('.canvas-item-type')).toHaveText('markdown');

    // Verify delete button is present
    await expect(canvasItem.locator('button[title="Delete"]')).toBeVisible();

    // Verify empty state is NOT visible
    await expect(page.getByText('No canvas items yet')).not.toBeVisible();

    // Verify via API that the item exists with correct data
    const items = await getCanvasItems(session.id);
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(item.id);
    expect(items[0].type).toBe('markdown');
    expect(items[0].label).toBe('Test Label');
    expect(items[0].content).toBe('# Test Markdown');
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

    // Find the specific canvas item
    const canvasItem = page.locator('.canvas-item').filter({ hasText: 'To Delete' });
    await expect(canvasItem).toBeVisible();

    // Handle confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());

    // Click delete button within the specific canvas item
    await canvasItem.locator('button[title="Delete"]').click();

    // Verify not visible in UI
    await expect(page.getByText('To Delete')).not.toBeVisible();

    // Verify empty state is shown
    await expect(page.getByText('No canvas items yet')).toBeVisible();

    // Verify toast notification for success
    await expect(page.locator('.toast-success, .toast')).toBeVisible({ timeout: 3000 });

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

    // Verify correct number of canvas items
    const canvasItems = page.locator('.canvas-item');
    await expect(canvasItems).toHaveCount(2);

    // Verify Text Item card structure
    const textItemCard = page.locator('.canvas-item').filter({ hasText: 'Text Item' });
    await expect(textItemCard).toBeVisible();
    await expect(textItemCard.locator('.canvas-item-type')).toHaveText('text');
    await expect(textItemCard.locator('.canvas-item-content, [class*="content"]')).toContainText(
      'Plain text content'
    );

    // Verify JSON Item card structure
    const jsonItemCard = page.locator('.canvas-item').filter({ hasText: 'JSON Item' });
    await expect(jsonItemCard).toBeVisible();
    await expect(jsonItemCard.locator('.canvas-item-type')).toHaveText('json');

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

  test('can cancel canvas item deletion', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Keep this item',
      label: 'Keep Me',
    });

    await page.goto(`/sessions/${session.id}/canvas`);

    // Handle confirmation dialog - dismiss it
    page.on('dialog', (dialog) => dialog.dismiss());

    // Click delete button
    await page.click('button[title="Delete"]');

    // Item should still be visible
    await expect(page.getByText('Keep Me')).toBeVisible();

    // Empty state should not be visible
    await expect(page.getByText('No canvas items yet')).not.toBeVisible();

    // Verify via API that item still exists
    const items = await getCanvasItems(session.id);
    expect(items.length).toBe(1);
    expect(items[0].label).toBe('Keep Me');
  });

  test('displays loading state while fetching canvas items', async ({ page }) => {
    await page.goto(`/sessions/${session.id}/canvas`);

    // Loading state should resolve quickly
    await expect(page.locator('.loading-state')).not.toBeVisible({ timeout: 5000 });

    // Should show empty state since no items
    await expect(page.getByText('No canvas items yet')).toBeVisible();
  });

  test('canvas items display in grid layout', async ({ page }) => {
    // Add multiple items
    await seedCanvasItem(session.id, { type: 'text', content: 'Item 1', label: 'First' });
    await seedCanvasItem(session.id, { type: 'text', content: 'Item 2', label: 'Second' });
    await seedCanvasItem(session.id, { type: 'text', content: 'Item 3', label: 'Third' });

    await page.goto(`/sessions/${session.id}/canvas`);

    // Verify all items are visible
    await expect(page.locator('.canvas-item')).toHaveCount(3);
    await expect(page.getByText('First')).toBeVisible();
    await expect(page.getByText('Second')).toBeVisible();
    await expect(page.getByText('Third')).toBeVisible();

    // Verify canvas grid container exists
    await expect(page.locator('.canvas-grid, .canvas-items')).toBeVisible();
  });
});
