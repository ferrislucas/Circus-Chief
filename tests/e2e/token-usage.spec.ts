import { test, expect } from '@playwright/test';
import {
  cleanupCreatedResources,
  navigateAndWait,
  seedConversationTokens,
  seedProject,
  seedSession,
} from './helpers';

test.describe('Token usage display', () => {
  test.beforeEach(async () => {
    await cleanupCreatedResources();
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('conversation overlay shows raw token total and breakdown', async ({ page }) => {
    const project = await seedProject('Token Usage Test', '/tmp');
    const session = await seedSession(project.id, {
      prompt: 'Test raw token display',
      startImmediately: false,
    });

    seedConversationTokens(session.id, null, {
      inputTokens: 5000,
      outputTokens: 1000,
      thinkingTokens: 250,
      cacheReadInputTokens: 3000,
      cacheCreationInputTokens: 750,
    });

    await navigateAndWait(page, `/sessions/${session.id}`);

    await expect(page.getByText('Tokens:')).toBeVisible();
    await expect(page.getByText('10.0K')).toBeVisible();

    await page.getByText('Tokens:').click();
    await expect(page.getByText('Input')).toBeVisible();
    await expect(page.getByText('Output')).toBeVisible();
    await expect(page.getByText('Thinking')).toBeVisible();
    await expect(page.getByText('Cache Read')).toBeVisible();
    await expect(page.getByText('Cache Create')).toBeVisible();
  });
});
