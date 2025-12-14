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
