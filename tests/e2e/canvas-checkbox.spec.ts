import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedCanvasItem,
  cleanupAll,
  navigateAndWait,
  API_URL,
} from './helpers';

test.describe('Canvas Markdown Task Checkboxes', () => {
  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Checkbox Test Project', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'Test', name: 'Checkbox Test', startImmediately: false });
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('task items render as clickable checkboxes and persist after reload', async ({ page }) => {
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '- [ ] task one\n- [x] task two',
      filename: 'tasks.md',
    });

    await navigateAndWait(page, `/sessions/${session.id}/canvas`, {
      waitFor: '.file-row',
      timeout: 15000,
    });

    await page.locator('.file-row').first().click();
    const box0 = page.locator('input[data-task-line="0"]');
    const box1 = page.locator('input[data-task-line="1"]');
    await expect(box0).toBeVisible({ timeout: 5000 });
    await expect(box0).not.toBeChecked();
    await expect(box1).toBeChecked();

    // Click the unchecked box and wait for the in-place PUT to land
    await box0.click();
    await expect(box0).toBeChecked({ timeout: 5000 });

    // Agent-facing endpoint serves the flipped content (no new version needed)
    const res = await fetch(
      `${API_URL}/api/sessions/${session.id}/canvas/file/tasks.md/content`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe('- [x] task one\n- [x] task two');

    // State persists across reload. Reload refetches the item list (metadata
    // only) plus the item content before the viewer renders, so wait for the
    // markdown viewer first with extra headroom for parallel-run load.
    await page.reload();
    await expect(page.locator('.canvas-file-viewer .viewer-markdown')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('input[data-task-line="0"]')).toBeChecked({ timeout: 10000 });
  });
});
