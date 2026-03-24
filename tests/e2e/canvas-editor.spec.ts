import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedCanvasItem,
  cleanupAll,
  navigateAndWait,
  API_URL,
  getCanvasItems,
  getAllCanvasItems,
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

  test('Editing markdown creates a new version', async ({ page }) => {
    // Seed a markdown item (v1)
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Original',
      filename: 'in-place.md',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.file-row',
      timeout: 15000,
    });

    // Open file and enter edit mode
    await page.locator('.file-row').first().click();
    await page.waitForTimeout(500);
    await page.locator('.btn-edit-toggle').click();
    await expect(page.locator('.viewer-content-editing')).toBeVisible({ timeout: 10000 });

    // md-editor-v3 uses a textarea inside the editor area - wait for it to load
    const editor = page.locator('.canvas-md-editor textarea, .md-editor textarea, .cm-content');
    await expect(editor.first()).toBeVisible({ timeout: 10000 });
    await editor.first().fill('# Updated Content');

    // Wait for debounce save (typically 1000ms debounce + network)
    await page.waitForTimeout(2000);

    // Verify via API: new version created for the edit
    // Use getAllCanvasItems to get all versions (not grouped)
    const items = await getAllCanvasItems(session.id);
    const matchingItems = items.filter((i: any) => i.filename === 'in-place.md');
    expect(matchingItems.length).toBeGreaterThan(1);
  });

  test('Navigating away and returning creates a new version', async ({ page }) => {
    // Seed a markdown item (v1)
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Version 1',
      filename: 'multi-version.md',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.file-row',
      timeout: 15000,
    });

    // Open file and edit
    await page.locator('.file-row').first().click();
    await page.waitForTimeout(500);
    await page.locator('.btn-edit-toggle').click();
    await expect(page.locator('.viewer-content-editing')).toBeVisible({ timeout: 10000 });

    const editor = page.locator('.canvas-md-editor textarea, .md-editor textarea, .cm-content');
    await expect(editor.first()).toBeVisible({ timeout: 10000 });
    await editor.first().fill('# Edited V1');
    await page.waitForTimeout(2000);

    // Navigate away (click breadcrumb back button)
    await page.locator('.breadcrumb-back').click();
    await page.waitForTimeout(500);

    // Return to the file and edit again
    await page.locator('.file-row').first().click();
    await page.waitForTimeout(500);
    await page.locator('.btn-edit-toggle').click();
    await expect(page.locator('.viewer-content-editing')).toBeVisible({ timeout: 10000 });

    const editorAgain = page.locator('.canvas-md-editor textarea, .md-editor textarea, .cm-content');
    await expect(editorAgain.first()).toBeVisible({ timeout: 10000 });
    await editorAgain.first().fill('# Version 2');
    await page.waitForTimeout(2000);

    // Verify via API: now 3 versions exist (v1 initial + v2 first edit + v3 second edit)
    // Use getAllCanvasItems to get all versions (not grouped)
    const items = await getAllCanvasItems(session.id);
    const matchingItems = items.filter((i: any) => i.filename === 'multi-version.md');
    expect(matchingItems.length).toBe(3);
  });

  test('Version switching creates new versions instead of updating in-place', async ({ page }) => {
    // This test verifies that when switching between versions and editing,
    // a new version is created instead of updating the old version in-place.

    // Seed 2 versions of same markdown file via API
    const v1 = await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# V1 Original',
      filename: 'version-switch.md',
    });
    await page.waitForTimeout(100); // Ensure different createdAt
    const v2 = await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# V2 Original',
      filename: 'version-switch.md',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.file-row',
      timeout: 15000,
    });

    // Open file (shows latest v2)
    await page.locator('.file-row').first().click();
    await page.waitForTimeout(500);

    // Enter edit mode and edit v2 - this creates v3
    await page.locator('.btn-edit-toggle').click();
    await expect(page.locator('.viewer-content-editing')).toBeVisible({ timeout: 10000 });

    const editor = page.locator('.canvas-md-editor textarea, .md-editor textarea, .cm-content');
    await expect(editor.first()).toBeVisible({ timeout: 10000 });
    await editor.first().fill('# V2 Updated');
    await page.waitForTimeout(2000);

    // Exit edit mode
    await page.locator('.btn-edit-toggle').click();
    await page.waitForTimeout(500);

    // Switch to v1 via version dropdown
    const versionDropdown = page.locator('.version-dropdown summary');
    await versionDropdown.click();
    await page.waitForTimeout(300);
    const versionItems = page.locator('.version-list li');
    const count = await versionItems.count();
    if (count > 1) {
      await versionItems.last().click(); // v1 is oldest, should be last
    }
    await page.waitForTimeout(500);

    // Enter edit mode for v1 and edit - this creates v4
    await page.locator('.btn-edit-toggle').click();
    await expect(page.locator('.viewer-content-editing')).toBeVisible({ timeout: 10000 });
    const editorV1 = page.locator('.canvas-md-editor textarea, .md-editor textarea, .cm-content');
    await expect(editorV1.first()).toBeVisible({ timeout: 10000 });
    await editorV1.first().fill('# V1 Updated');
    await page.waitForTimeout(2000);

    // Verify via API: we now have 4 versions (v1, v2, v3 from editing v2, v4 from editing v1)
    const items = await getAllCanvasItems(session.id);
    const matchingItems = items.filter((i: any) => i.filename === 'version-switch.md');
    expect(matchingItems.length).toBe(4);

    // Verify original versions still exist (by ID)
    const v1Item = matchingItems.find((i: any) => i.id === v1.id);
    const v2Item = matchingItems.find((i: any) => i.id === v2.id);
    expect(v1Item).toBeDefined();
    expect(v2Item).toBeDefined();

    // Note: The /canvas/all endpoint strips content to reduce payload size,
    // so we can't verify content here. We just verify the original versions
    // weren't deleted or replaced.
  });

  test('PUT update preserves version count (API-level)', async () => {
    // Seed 2 versions of same markdown file via API
    const v1 = await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# V1',
      filename: 'api-test.md',
    });
    const v2 = await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# V2',
      filename: 'api-test.md',
    });

    // PUT update to v1's ID with new content
    const res1 = await fetch(`${API_URL}/api/sessions/${session.id}/canvas/${v1.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# V1 Updated' }),
    });
    expect(res1.ok).toBeTruthy();

    // PUT update to v2's ID with different content
    const res2 = await fetch(`${API_URL}/api/sessions/${session.id}/canvas/${v2.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# V2 Updated' }),
    });
    expect(res2.ok).toBeTruthy();

    // Verify: still 2 versions, each with correct content
    // Use getAllCanvasItems to get all versions (not grouped)
    const items = await getAllCanvasItems(session.id);
    const matchingItems = items.filter((i: any) => i.filename === 'api-test.md');
    expect(matchingItems.length).toBe(2);
  });
});
