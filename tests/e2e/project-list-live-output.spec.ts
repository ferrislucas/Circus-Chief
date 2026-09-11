import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  navigateAndWait,
  updateSessionStatus,
  waitForSessionToExist,
} from './helpers';

test.describe('Project List Live Output', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Project List Live Output', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('live output pane stays visible after expanding it from the project list', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Live output test',
      name: 'Live Output Session',
    });
    await waitForSessionToExist(session.id);
    await updateSessionStatus(session.id, 'running');

    await navigateAndWait(page, '/projects', { waitFor: '.project-card' });
    await page.getByRole('button', { name: 'Show sessions' }).click();
    await expect(page.locator('.embedded-session-list .session-card')).toBeVisible();

    const stream = page.locator('[data-testid="session-log-stream"]');
    await expect(stream).toBeVisible();
    await stream.getByText('Show live output', { exact: true }).click();

    await expect(stream).toBeVisible();
    await expect(stream.getByText('Live Output', { exact: true })).toBeVisible();
    await expect(stream.getByText('Waiting for output…', { exact: true })).toBeVisible();
  });
});
