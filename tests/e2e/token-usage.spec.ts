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

  async function openOverlay(page: any, sessionId: string) {
    await navigateAndWait(page, `/sessions/${sessionId}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });
    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();
    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    return overlay;
  }

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

    const overlay = await openOverlay(page, session.id);

    await expect(overlay.getByText('Tokens:')).toBeVisible();
    await expect(overlay.getByText('10.0K')).toBeVisible();

    await overlay.getByText('Tokens:').click();
    const tokenBreakdown = overlay.locator('.token-breakdown');
    await expect(tokenBreakdown.getByText('Input')).toBeVisible();
    await expect(tokenBreakdown.getByText('Output')).toBeVisible();
    await expect(tokenBreakdown.getByText('Thinking')).toBeVisible();
    await expect(tokenBreakdown.getByText('Cache Read')).toBeVisible();
    await expect(tokenBreakdown.getByText('Cache Create')).toBeVisible();
  });
});
