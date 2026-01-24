import { test, expect } from '@playwright/test';
import {
  seedProject,
  cleanupCreatedResources,
  getSessionConversations,
  getSessionMessages,
  seedSessionWithMessages,
} from './helpers';

/**
 * These tests validate the conversation branching UI flow.
 *
 * KEY BUG BEING TESTED:
 * When branching a conversation, the UI should update immediately after clicking
 * "Branch & Submit". The reported issue is that the UI hangs/freezes and only
 * shows the correct state after refreshing the page.
 *
 * What "hang" means:
 * - The BranchEditor stays visible with "Creating..." spinner
 * - The conversation selector doesn't show the new branch
 * - The messages don't update to show the new conversation
 * - Refreshing the page shows everything correctly
 *
 * These tests will fail/timeout if the UI hangs, thus surfacing the bug.
 */

test.describe('Conversation Branching UI', () => {
  let projectId: string;
  let sessionId: string;

  test.beforeEach(async () => {
    // Create a test project
    const project = await seedProject('Branching Test', '/tmp/test-branching');
    projectId = project.id;

    // Create a session with pre-seeded messages (fast - no Claude API call needed)
    const session = await seedSessionWithMessages(projectId, {
      name: 'Branching Test Session',
      userMessage: 'Hello from the main conversation',
      assistantMessage: 'Hello! I am responding to your message from the main conversation.',
    });
    sessionId = session.id;
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('UI should update immediately after branching without hanging', async ({ page }) => {
    // Navigate to the session (route is /sessions/:id)
    await page.goto(`/sessions/${sessionId}`);

    // Wait for the conversation to load - assistant should have responded
    await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 10000 });

    // Verify we can see at least one user message (our initial prompt)
    const userMessages = page.locator('[data-testid="message-user"]');
    await expect(userMessages.first()).toBeVisible({ timeout: 5000 });

    // Find the first user message and click the branch button
    const firstUserMessage = userMessages.first();

    // The branch button should be visible (no hover needed based on current CSS)
    const branchButton = firstUserMessage.locator('[data-testid="branch-button"]');
    await expect(branchButton).toBeVisible({ timeout: 5000 });
    await branchButton.click();

    // The BranchEditor should appear
    const branchEditor = page.locator('.branch-editor');
    await expect(branchEditor).toBeVisible({ timeout: 5000 });

    // Enter a new prompt
    const promptInput = page.locator('.branch-prompt-input');
    await promptInput.fill('Say "Hello from the BRANCHED conversation"');

    // Click "Branch & Submit"
    const submitButton = page.locator('button:has-text("Branch & Submit")');
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // ============================================================
    // CRITICAL ASSERTIONS - These will timeout if UI hangs
    // ============================================================

    // 1. The BranchEditor should close within 5 seconds
    //    If the UI hangs, this will timeout
    await expect(branchEditor).not.toBeVisible({ timeout: 5000 });

    // 2. A success toast should appear (use .first() to handle multiple toasts in test env)
    const successToast = page.locator('.toast:has-text("Branch created")').first();
    await expect(successToast).toBeVisible({ timeout: 5000 });

    // 3. The conversation selector should become visible (shows when > 1 conversation)
    //    This proves the store was updated with the new conversation
    const conversationSelector = page.locator('[data-testid="conversation-selector"]');
    await expect(conversationSelector).toBeVisible({ timeout: 5000 });

    // 4. The messages should update to show the new prompt
    //    We should see "BRANCHED" in the latest user message
    const latestUserMessage = userMessages.last();
    await expect(latestUserMessage).toContainText('BRANCHED', { timeout: 5000 });
  });

  test('conversation selector should show new branch in dropdown', async ({ page }) => {
    // Navigate to the session
    await page.goto(`/sessions/${sessionId}`);

    // Wait for conversation to load
    await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 10000 });

    // Perform the branch
    const userMessage = page.locator('[data-testid="message-user"]').first();
    const branchButton = userMessage.locator('[data-testid="branch-button"]');
    await branchButton.click();

    const promptInput = page.locator('.branch-prompt-input');
    await promptInput.fill('Branch prompt for dropdown test');

    const submitButton = page.locator('button:has-text("Branch & Submit")');
    await submitButton.click();

    // Wait for branch editor to close
    await expect(page.locator('.branch-editor')).not.toBeVisible({ timeout: 5000 });

    // The conversation selector should now be visible
    const conversationSelector = page.locator('[data-testid="conversation-selector"]');
    await expect(conversationSelector).toBeVisible({ timeout: 5000 });

    // Click to open the dropdown
    await conversationSelector.click();

    // Should see 2 conversation options in the dropdown
    const conversationOptions = page.locator('[data-testid="conversation-option"]');
    await expect(conversationOptions).toHaveCount(2, { timeout: 5000 });
  });

  test('state should be correct without page refresh', async ({ page }) => {
    // This test specifically validates that we don't need to refresh
    // to see the correct state after branching

    // Navigate to the session
    await page.goto(`/sessions/${sessionId}`);

    // Wait for conversation to load
    await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 10000 });

    // Perform the branch
    const userMessage = page.locator('[data-testid="message-user"]').first();
    const branchButton = userMessage.locator('[data-testid="branch-button"]');
    await branchButton.click();

    const promptInput = page.locator('.branch-prompt-input');
    await promptInput.fill('New branch message for state test');

    const submitButton = page.locator('button:has-text("Branch & Submit")');
    await submitButton.click();

    // Wait for the branch editor to close
    await expect(page.locator('.branch-editor')).not.toBeVisible({ timeout: 5000 });

    // Give a moment for state to settle
    await page.waitForTimeout(500);

    // NOW verify state WITHOUT refreshing
    // The user message should now contain our new prompt (from the branched conversation)
    await expect(page.locator('[data-testid="message-user"]').last()).toContainText('New branch message', { timeout: 5000 });

    // Verify via API that the branch was actually created
    const conversations = await getSessionConversations(sessionId);
    expect(conversations.length).toBe(2);

    // Find the active conversation
    const activeConv = conversations.find((c: any) => c.isActive);
    expect(activeConv).toBeTruthy();

    // Get messages for this session (should be from active conversation)
    const messages = await getSessionMessages(sessionId);
    const userMsgs = messages.filter((m: any) => m.role === 'user');

    // The active conversation should have our new prompt
    const hasNewPrompt = userMsgs.some((m: any) => m.content.includes('New branch message'));
    expect(hasNewPrompt).toBe(true);
  });

  test('branch editor should not stay stuck in "Creating..." state', async ({ page }) => {
    // This test specifically checks for the "Creating..." spinner hang

    await page.goto(`/sessions/${sessionId}`);
    await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 10000 });

    // Open branch editor
    const userMessage = page.locator('[data-testid="message-user"]').first();
    await userMessage.locator('[data-testid="branch-button"]').click();
    await expect(page.locator('.branch-editor')).toBeVisible();

    // Fill and submit
    await page.locator('.branch-prompt-input').fill('Test for stuck state');

    const submitButton = page.locator('button:has-text("Branch & Submit")');
    await submitButton.click();

    // The button should briefly show "Creating..."
    // but should NOT stay in that state for more than 5 seconds

    // Either the editor closes (success) or we see an error
    // If it stays showing "Creating...", this test will fail
    await expect(page.locator('.branch-editor')).not.toBeVisible({ timeout: 5000 });

    // If we get here, the UI didn't hang
  });

  test('should handle branch creation errors gracefully', async ({ page }) => {
    // Navigate to the session
    await page.goto(`/sessions/${sessionId}`);

    // Wait for the conversation to load
    await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 10000 });

    // Find the first user message and click the branch button
    const userMessage = page.locator('[data-testid="message-user"]').first();
    await userMessage.locator('[data-testid="branch-button"]').click();

    // The BranchEditor should appear
    await expect(page.locator('.branch-editor')).toBeVisible({ timeout: 5000 });

    // The submit button should be disabled when prompt is empty
    const submitButton = page.locator('button:has-text("Branch & Submit")');
    await expect(submitButton).toBeDisabled();

    // Enter a prompt then clear it - button should become disabled again
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

  test('should allow multiple branches from same message', async ({ page }) => {
    await page.goto(`/sessions/${sessionId}`);
    await page.waitForSelector('[data-testid="message-assistant"]', { timeout: 10000 });

    // Create first branch
    const userMessage = page.locator('[data-testid="message-user"]').first();
    await userMessage.locator('[data-testid="branch-button"]').click();
    await page.locator('.branch-prompt-input').fill('First branch');
    await page.locator('button:has-text("Branch & Submit")').click();
    await expect(page.locator('.branch-editor')).not.toBeVisible({ timeout: 5000 });

    // Wait for first branch to settle
    await page.waitForTimeout(1000);

    // Now we need to switch back to the original conversation to branch again
    // Click the conversation selector
    const conversationSelector = page.locator('[data-testid="conversation-selector"]');
    await expect(conversationSelector).toBeVisible({ timeout: 5000 });
    await conversationSelector.click();

    // Select the first (original) conversation
    const firstOption = page.locator('[data-testid="conversation-option"]').first();
    await firstOption.click();

    // Wait for messages to update
    await page.waitForTimeout(500);

    // Create second branch from the same original conversation
    const userMessageAgain = page.locator('[data-testid="message-user"]').first();
    await userMessageAgain.locator('[data-testid="branch-button"]').click();
    await page.locator('.branch-prompt-input').fill('Second branch');
    await page.locator('button:has-text("Branch & Submit")').click();
    await expect(page.locator('.branch-editor')).not.toBeVisible({ timeout: 5000 });

    // Should now have 3 conversations
    await conversationSelector.click();
    const options = page.locator('[data-testid="conversation-option"]');
    await expect(options).toHaveCount(3, { timeout: 5000 });
  });
});
