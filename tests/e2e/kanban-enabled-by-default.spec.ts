import { test, expect } from '@playwright/test';
import {
  seedProject,
  cleanupCreatedResources,
  navigateAndWait,
  API_URL,
} from './helpers';

test.describe('Kanban default behavior', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Kanban Default Project', '/tmp/test-kanban-default');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('new projects expose the Kanban tab and load the board', async ({ page }) => {
    const apiResponse = await fetch(`${API_URL}/api/projects/${project.id}`);
    expect(apiResponse.ok).toBe(true);
    const payload = await apiResponse.json();
    expect(payload).not.toHaveProperty('kanbanEnabled');

    await navigateAndWait(page, `/projects/${project.id}/sessions`, {
      waitFor: '.tabs-desktop',
    });

    const kanbanTab = page.locator('.tabs-desktop .tab', { hasText: 'Kanban' });
    await expect(kanbanTab).toBeVisible();

    await kanbanTab.click();
    await page.waitForURL(`**/projects/${project.id}/kanban`);
    await expect(page.locator('.kanban-board')).toBeVisible();
  });
});
