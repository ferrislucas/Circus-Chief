import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  waitForSessionStatus,
} from './helpers';

test.describe('Conversation Branching', () => {
  let projectId: string;
  let sessionId: string;

  test.beforeEach(async () => {
    // Create a test project
    const project = await seedProject('Branching Test', '/tmp/test-branching');
    projectId = project.id;

    // Create a session with an initial message
    const session = await seedSession(projectId, {
      name: 'Branching Test Session',
      prompt: 'Say "Hello from the main conversation"',
    });
    sessionId = session.id;

    // Wait for session to complete the initial turn
    await waitForSessionStatus(sessionId, 'waiting', 30000);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('should create a branch and update UI immediately without hanging', async ({ page }) => {
    // Navigate to the session
    await page.goto(`/projects/${projectId}/sessions/${sessionId}`);

    // Wait for the initial conversation to load and Claude to respond
    await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 30000 });

    // Find the first user message and click the branch button
    const userMessage = page.locator('[data-testid="message-user"]').first();
    await userMessage.hover();

    // Click the branch button
    const branchButton = userMessage.locator('[data-testid="branch-button"]');
    await branchButton.click();

    // The BranchEditor should appear
    await expect(page.locator('.branch-editor')).toBeVisible({ timeout: 5000 });

    // Enter a new prompt
    const promptInput = page.locator('.branch-prompt-input');
    await promptInput.fill('Say "Hello from the branched conversation"');

    // Click "Branch & Submit"
    const submitButton = page.locator('button:has-text("Branch & Submit")');
    await submitButton.click();

    // CRITICAL: The UI should update immediately WITHOUT hanging
    // This is the main bug - the UI used to hang here because branchConversation
    // was blocking on async message/worklog fetches

    // 1. BranchEditor should close quickly (within 3 seconds - allowing for API roundtrip)
    await expect(page.locator('.branch-editor')).not.toBeVisible({ timeout: 3000 });

    // 2. A success toast should appear
    await expect(page.locator('.toast')).toContainText('Branch created', { timeout: 5000 });

    // 3. The conversation selector should show the new branch
    // Click the selector to open the dropdown
    const conversationSelector = page.locator('[data-testid="conversation-selector"]');
    await conversationSelector.click();

    // Should see 2 conversations in the dropdown
    const conversationOptions = page.locator('[data-testid="conversation-option"]');
    await expect(conversationOptions).toHaveCount(2, { timeout: 5000 });

    // Close the dropdown
    await conversationSelector.click();

    // 4. The new message should appear in the conversation
    // We should see the branched prompt
    await expect(page.locator('[data-testid="message-user"]').last()).toContainText('Hello from the branched conversation', { timeout: 5000 });

    // That's enough - we've verified the UI doesn't hang and updates immediately
    // The actual Claude response is not critical for this bug fix
  });

  test('should handle branch creation errors gracefully', async ({ page }) => {
    // Navigate to the session
    await page.goto(`/projects/${projectId}/sessions/${sessionId}`);

    // Wait for the conversation to load
    await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 30000 });

    // Find the first user message and click the branch button
    const userMessage = page.locator('[data-testid="message-user"]').first();
    await userMessage.hover();

    const branchButton = userMessage.locator('[data-testid="branch-button"]');
    await branchButton.click();

    // The BranchEditor should appear
    await expect(page.locator('.branch-editor')).toBeVisible({ timeout: 5000 });

    // Try to submit WITHOUT entering a prompt (should show error)
    const submitButton = page.locator('button:has-text("Branch & Submit")');

    // Button should be disabled when prompt is empty
    await expect(submitButton).toBeDisabled();

    // Enter a prompt then clear it
    const promptInput = page.locator('.branch-prompt-input');
    await promptInput.fill('test');
    await expect(submitButton).toBeEnabled();

    await promptInput.clear();
    await expect(submitButton).toBeDisabled();

    // Cancel the editor
    await page.locator('button:has-text("Cancel")').click();

    // Editor should close
    await expect(page.locator('.branch-editor')).not.toBeVisible({ timeout: 2000 });
  });
});
