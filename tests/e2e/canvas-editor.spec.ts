import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedCanvasItem,
  cleanupAll,
  navigateAndWait,
  API_URL,
  getCanvasItems,
} from './helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

test.describe('Canvas Markdown Editor', () => {
  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Editor Test Project', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'Test', name: 'Editor Test' });
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('Edit button appears for markdown canvas items', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Test Markdown\n\nHello world',
      filename: 'test-doc.md',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.file-row',
      timeout: 15000,
    });

    // Click on the markdown item to open it
    await page.locator('.file-row').first().click();
    await page.waitForTimeout(1000);

    // The Edit button should be visible for markdown items
    const editBtn = page.locator('.btn-edit-toggle');
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await expect(editBtn).toHaveText('Edit');
  });

  test('Edit button does NOT appear for text canvas items', async ({ page }) => {
    // Text items are NOT editable via the markdown editor
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Plain text content',
      filename: 'plain.txt',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.file-row',
      timeout: 15000,
    });

    // Click on the text item to open it
    await page.locator('.file-row').first().click();
    await page.waitForTimeout(1000);

    // The Edit button should NOT be visible for text items
    const editBtn = page.locator('.btn-edit-toggle');
    await expect(editBtn).not.toBeVisible();
  });

  test('Edit button does NOT appear for image canvas items', async ({ page }) => {
    // Create a minimal 1x1 PNG file on disk and use filePath mode
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-test-'));
    const pngPath = path.join(tmpDir, 'test-image.png');
    // Minimal valid PNG (1x1 red pixel)
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(pngPath, pngBuffer);

    try {
      await seedCanvasItem(session.id, {
        type: 'image',
        filePath: pngPath,
      });

      await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
        waitFor: '.file-row',
        timeout: 15000,
      });

      // Click on the image item to open it
      await page.locator('.file-row').first().click();
      await page.waitForTimeout(1000);

      // The Edit button should NOT be visible for image items
      const editBtn = page.locator('.btn-edit-toggle');
      await expect(editBtn).not.toBeVisible();
    } finally {
      // Cleanup temp file
      fs.unlinkSync(pngPath);
      fs.rmdirSync(tmpDir);
    }
  });

  test('clicking Edit loads the markdown editor component', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Editable Doc\n\nThis can be edited.',
      filename: 'editable.md',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.file-row',
      timeout: 15000,
    });

    // Click on the markdown item
    await page.locator('.file-row').first().click();
    await page.waitForTimeout(1000);

    // Click Edit button
    await page.locator('.btn-edit-toggle').click();

    // Wait for the editor container to appear
    const editorContainer = page.locator('.viewer-content-editing');
    await expect(editorContainer).toBeVisible({ timeout: 10000 });

    // The button should now say "Done"
    await expect(page.locator('.btn-edit-toggle')).toHaveText('Done');
  });

  test('clicking Done returns to preview mode', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Preview Test\n\nBack to preview.',
      filename: 'preview-test.md',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.file-row',
      timeout: 15000,
    });

    // Open the item
    await page.locator('.file-row').first().click();
    await page.waitForTimeout(1000);

    // Enter edit mode
    await page.locator('.btn-edit-toggle').click();
    await expect(page.locator('.viewer-content-editing')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.btn-edit-toggle')).toHaveText('Done');

    // Exit edit mode
    await page.locator('.btn-edit-toggle').click();
    await page.waitForTimeout(500);

    // Should be back to preview mode
    await expect(page.locator('.btn-edit-toggle')).toHaveText('Edit');
    await expect(page.locator('.viewer-content-editing')).not.toBeVisible();
  });

  test('content updates are persisted via PUT API', async () => {
    const item = await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Original Content',
      filename: 'persist-test.md',
    });

    // Update the content via the PUT API directly
    const updateResponse = await fetch(
      `${API_URL}/api/sessions/${session.id}/canvas/${item.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Updated Content\n\nThis was updated.' }),
      }
    );
    expect(updateResponse.ok).toBeTruthy();

    const updatedItem = await updateResponse.json();
    expect(updatedItem.content).toBe('# Updated Content\n\nThis was updated.');

    // Verify by fetching the item again
    const items = await getCanvasItems(session.id);
    const found = items.find((i: any) => i.id === item.id);
    expect(found).toBeTruthy();
  });

  test('PUT API rejects non-text-based item types', async () => {
    // Create an image canvas item using filePath mode
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-test-'));
    const pngPath = path.join(tmpDir, 'no-edit-image.png');
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(pngPath, pngBuffer);

    try {
      const imageItem = await seedCanvasItem(session.id, {
        type: 'image',
        filePath: pngPath,
      });

      // Try to update its content — should be rejected
      const updateResponse = await fetch(
        `${API_URL}/api/sessions/${session.id}/canvas/${imageItem.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Should not work' }),
        }
      );
      expect(updateResponse.status).toBe(400);
    } finally {
      fs.unlinkSync(pngPath);
      fs.rmdirSync(tmpDir);
    }
  });

  test('PUT API returns 404 for non-existent item', async () => {
    const updateResponse = await fetch(
      `${API_URL}/api/sessions/${session.id}/canvas/nonexistent-id`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Should not work' }),
      }
    );
    expect(updateResponse.status).toBe(404);
  });
});
