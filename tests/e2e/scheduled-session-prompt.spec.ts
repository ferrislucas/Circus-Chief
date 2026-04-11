import { test, expect } from '@playwright/test';
import { seedProject, cleanupAll, navigateAndWait, openSessionOverlay, getSessionMessages, API_URL } from './helpers';

/**
 * Test for Issue #435: Scheduled session prompt should appear in text input, not as message
 *
 * Expected behavior: When creating a scheduled session, the prompt should remain in the
 * text input field so the user can edit it before the scheduled time arrives.
 *
 * Actual (buggy) behavior: The prompt appears as the first user message in the conversation,
 * and the text input is empty.
 */
test.describe('Scheduled Session Prompt Location (#435)', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Schedule Prompt Test', '/tmp/schedule-prompt-test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('scheduled session prompt appears in text input, not as message', async ({ page }) => {
    const testPrompt = 'This is my scheduled task prompt that should be editable';

    // Create a scheduled session (1 hour in the future)
    const futureTime = Date.now() + 3600000; // 1 hour from now
    const session = await createScheduledSession(project.id, testPrompt, futureTime);

    // Navigate to the session detail page (conversation tab)
    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // VERIFY 1: Prompt should be in the text input field
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });
    const textareaValue = await textarea.inputValue();
    expect(textareaValue).toBe(testPrompt);

    // VERIFY 2: No user message should appear in the messages area
    // For scheduled sessions that haven't started, messages should be hidden
    const userMessage = page.locator('[data-testid="message-user"]');
    await expect(userMessage).not.toBeVisible();

    // VERIFY 3: User should be able to edit the prompt
    await textarea.clear();
    await textarea.fill('Modified prompt text');
    const newValue = await textarea.inputValue();
    expect(newValue).toBe('Modified prompt text');
  });

  test('scheduled session becomes regular session after starting', async ({ page }) => {
    const testPrompt = 'Test prompt for started session';

    // Create a scheduled session
    const futureTime = Date.now() + 3600000;
    const session = await createScheduledSession(project.id, testPrompt, futureTime);

    // Navigate to the session (conversation tab)
    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Verify prompt is in textarea initially
    const textarea = page.locator('textarea');
    await expect(textarea).toHaveValue(testPrompt);

    // Start the session (click the "Start Now" or "Start Session" button)
    const startButton = page.locator('button:has-text("Start Session")');
    if (await startButton.isVisible()) {
      await startButton.click();

      // Wait for session to start (status changes from 'scheduled' to 'running')
      // Once started, the prompt should move from textarea to messages
      await page.waitForTimeout(2000); // Wait for status update

      // After starting, messages should appear
      const userMessage = page.locator('[data-testid="message-user"]').first();
      await expect(userMessage).toBeVisible({ timeout: 10000 });

      // The message content should match the prompt
      const messageText = await userMessage.textContent();
      expect(messageText).toContain(testPrompt);
    }
  });
});

/**
 * Helper function to create a scheduled session via API
 */
async function createScheduledSession(projectId: string, prompt: string, scheduledAt: number) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      scheduledAt,
      startImmediately: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create scheduled session: ${response.status}`);
  }

  return response.json();
}
