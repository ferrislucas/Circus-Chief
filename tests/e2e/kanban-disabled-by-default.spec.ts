import { test, expect } from '@playwright/test';
import {
  seedProject,
  cleanupCreatedResources,
  navigateAndWait,
  API_URL,
} from './helpers';

test.describe('Kanban experimental default (off)', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    // No kanbanEnabled option → should default to false (experimental opt-in)
    project = await seedProject('Kanban Default Off Project', '/tmp/test-kanban-off');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('new projects do not expose the Kanban tab and redirect /kanban to /sessions', async ({ page }) => {
    // Sanity check: confirm the API responded with kanbanEnabled=false so the
    // rest of the UI expectations below are meaningful.
    const apiResponse = await fetch(`${API_URL}/api/projects/${project.id}`);
    expect(apiResponse.ok).toBe(true);
    const payload = await apiResponse.json();
    expect(payload.kanbanEnabled).toBe(false);

    // Navigate to the sessions list. The Kanban tab should be absent because
    // the project was created with the default (off) experimental flag.
    await navigateAndWait(page, `/projects/${project.id}/sessions`, {
      waitFor: '.tabs-desktop',
    });

    const desktopTabs = page.locator('.tabs-desktop');
    await expect(desktopTabs).toBeVisible();
    await expect(desktopTabs).not.toContainText('Kanban');

    // Directly navigating to the kanban route should redirect to the sessions
    // list rather than surfacing the experimental board.
    await page.goto(`/projects/${project.id}/kanban`);
    await page.waitForURL(`**/projects/${project.id}/sessions`);
    expect(page.url()).toContain(`/projects/${project.id}/sessions`);
  });

  test('opting in via the API re-enables the Kanban tab with an Experimental badge', async ({ page }) => {
    // Opt-in by PATCH/PUT so we exercise the same path a user would trigger
    // from the Project Edit view.
    const response = await fetch(`${API_URL}/api/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kanbanEnabled: true }),
    });
    expect(response.ok).toBe(true);

    await navigateAndWait(page, `/projects/${project.id}/sessions`, {
      waitFor: '.tabs-desktop',
    });

    const kanbanTab = page.locator('.tabs-desktop .tab', { hasText: 'Kanban' });
    await expect(kanbanTab).toBeVisible();
    await expect(kanbanTab).toContainText('Experimental');
  });
});
