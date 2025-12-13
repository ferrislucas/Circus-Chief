import { test, expect } from '@playwright/test';
import { seedProject, seedSession, seedCanvasItem, cleanupAll } from './helpers';

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
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Test Markdown',
      label: 'Test Label',
    });

    await page.goto(`/sessions/${session.id}/canvas`);

    await expect(page.getByText('Test Label')).toBeVisible();
    await expect(page.getByText('markdown')).toBeVisible();
  });

  test('can delete canvas item', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Delete me',
      label: 'To Delete',
    });

    await page.goto(`/sessions/${session.id}/canvas`);
    await expect(page.getByText('To Delete')).toBeVisible();

    // Handle confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());
    await page.click('button[title="Delete"]');

    await expect(page.getByText('To Delete')).not.toBeVisible();
  });

  test('displays different canvas item types', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Plain text content',
      label: 'Text Item',
    });

    await seedCanvasItem(session.id, {
      type: 'json',
      content: JSON.stringify({ key: 'value' }),
      label: 'JSON Item',
    });

    await page.goto(`/sessions/${session.id}/canvas`);

    await expect(page.getByText('Text Item')).toBeVisible();
    await expect(page.getByText('JSON Item')).toBeVisible();
    await expect(page.getByText('text')).toBeVisible();
    await expect(page.getByText('json')).toBeVisible();
  });
});
