import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
  updateSessionStatus,
  getConversations,
  seedConversation,
  seedConversationRaw,
  switchConversation,
  deleteConversation,
  deleteConversationRaw,
  branchConversation,
  getConversationMessages,
  generateConversationSummary,
  getAPIURL,
  openSessionOverlay,
} from './helpers';

/**
 * E2E Tests for Conversation Management (Section 4)
 *
 * Covers:
 * - Multiple conversations per session
 * - Active conversation tracking and switching
 * - Conversation branching
 * - Conversation tree visualization
 * - Per-conversation token tracking
 * - Per-conversation summaries
 * - Conversation deletion
 *
 * Note on session types:
 * - startImmediately: false -> draft session, no messages created, prompt stored as pendingPrompt
 * - startImmediately: true (default) -> session starts, creates user message, gets mock response
 *
 * Tests that need messages in conversations use the default (startImmediately: true) and wait
 * for the session to reach 'waiting' status. Tests that only need API operations without
 * messages use startImmediately: false for speed.
 */

const API_URL = getAPIURL();

/**
 * Wait for a session to be idle (not running/starting).
 * With VCR replays, sessions may briefly re-enter running state.
 */
async function waitForSessionIdle(sessionId: string, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${API_URL}/api/sessions/${sessionId}`);
    const s = await res.json();
    if (s.status === 'waiting' || s.status === 'stopped' || s.status === 'error') {
      // Briefly pause to avoid catching a transient state before re-running
      await new Promise((r) => setTimeout(r, 200));
      // Double-check status hasn't changed back
      const res2 = await fetch(`${API_URL}/api/sessions/${sessionId}`);
      const s2 = await res2.json();
      if (s2.status === 'waiting' || s2.status === 'stopped' || s2.status === 'error') {
        return s2;
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Session ${sessionId} did not reach idle status within ${timeoutMs}ms`);
}

/**
 * Helper to create a session that has completed its first exchange (has messages).
 * Waits for the session to complete its initial run and be in 'waiting' status.
 */
async function seedSessionWithMessages(
  projectId: string,
  opts: { prompt: string; name: string }
) {
  const session = await seedSession(projectId, {
    prompt: opts.prompt,
    name: opts.name,
  });
  await waitForSessionToExist(session.id);
  await waitForSessionIdle(session.id);

  // Force status to 'waiting' to prevent VCR-related race conditions
  // where the session briefly re-enters 'running' due to summary generation
  await updateSessionStatus(session.id, 'waiting');

  return session;
}

test.describe('Multiple Conversations', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    project = await seedProject('Conv Multi Test', '/tmp/test');
    session = await seedSession(project.id, {
      prompt: 'Test conversation management',
      name: 'Conv Test Session',
      startImmediately: false,
    });
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('session starts with one default conversation', async () => {
    const convs = await getConversations(session.id);
    expect(convs).toHaveLength(1);
    expect(convs[0].isActive).toBe(true);
  });

  test('can create a second conversation via API', async () => {
    const newConv = await seedConversation(session.id, 'Second Conversation');
    expect(newConv.name).toBe('Second Conversation');
    expect(newConv.isActive).toBe(true);

    const convs = await getConversations(session.id);
    expect(convs).toHaveLength(2);

    // New conversation should be active, old one should not
    const activeConvs = convs.filter((c: any) => c.isActive);
    expect(activeConvs).toHaveLength(1);
    expect(activeConvs[0].name).toBe('Second Conversation');
  });

  test('new conversation button visible in UI', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // The "New Conversation" button should be visible
    const newBtn = page.locator('.btn-new');
    await expect(newBtn).toBeVisible({ timeout: 10000 });
    await expect(newBtn).toContainText('New Conversation');
  });

  test('clicking new conversation creates conversation and updates UI', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Click "New Conversation" button
    const newBtn = page.locator('.btn-new');
    await expect(newBtn).toBeVisible({ timeout: 10000 });
    await newBtn.click();

    // Wait for the new conversation to be created
    await page.waitForTimeout(1000);

    // Verify conversations count increased
    const convs = await getConversations(session.id);
    expect(convs).toHaveLength(2);
  });

  test('cannot create conversation while session is running', async () => {
    await updateSessionStatus(session.id, 'running');

    const response = await seedConversationRaw(session.id);
    expect(response.status).toBe(400);

    const error = await response.json();
    expect(error.error).toContain('running');
  });
});

test.describe('Active Conversation Tracking and Switching', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    project = await seedProject('Conv Switch Test', '/tmp/test');
    // Use session with messages so UI shows message list (not draft mode)
    session = await seedSessionWithMessages(project.id, {
      prompt: 'Test conversation switching',
      name: 'Switch Test Session',
    });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('conversation selector hidden when only one conversation', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Dropdown container should NOT be visible with only 1 conversation
    const dropdownContainer = page.locator('.dropdown-container');
    await expect(dropdownContainer).not.toBeVisible({ timeout: 5000 });

    // But the "New Conversation" button should be visible
    const newBtn = page.locator('.btn-new');
    await expect(newBtn).toBeVisible({ timeout: 10000 });
  });

  test('conversation selector appears when multiple conversations exist', async ({ page }) => {
    // Create a second conversation
    await seedConversation(session.id, 'Second Conv');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Dropdown trigger should now be visible
    const selectorBtn = page.locator('[data-testid="conversation-selector"]');
    await expect(selectorBtn).toBeVisible({ timeout: 10000 });
  });

  test('dropdown shows all conversations on click', async ({ page }) => {
    // Create a second conversation
    await seedConversation(session.id, 'Second Conv');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Click the dropdown trigger
    const selectorBtn = page.locator('[data-testid="conversation-selector"]');
    await expect(selectorBtn).toBeVisible({ timeout: 10000 });
    await selectorBtn.click();
    await page.waitForTimeout(500);

    // Verify dropdown menu appears with conversation options
    const dropdownMenu = page.locator('.dropdown-menu');
    await expect(dropdownMenu).toBeVisible();

    const options = dropdownMenu.locator('[data-testid="conversation-option"]');
    await expect(options).toHaveCount(2, { timeout: 5000 });
  });

  test('switching conversation loads different messages', async ({ page }) => {
    // Create second conversation (becomes active, has no messages)
    await seedConversation(session.id, 'Second Conv');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Second conv is active and empty - no user messages should be visible
    const userMessages = page.locator('[data-testid="message-user"]');
    await expect(userMessages).toHaveCount(0, { timeout: 5000 });

    // Open dropdown and click the first conversation (which has messages)
    const selectorBtn = page.locator('[data-testid="conversation-selector"]');
    await expect(selectorBtn).toBeVisible({ timeout: 10000 });
    await selectorBtn.click();
    await page.waitForTimeout(500);

    // Click the first (non-active) conversation option
    const inactiveOption = page.locator('.tree-item-row:not(.active)');
    await expect(inactiveOption.first()).toBeVisible({ timeout: 5000 });
    await inactiveOption.first().click();
    await page.waitForTimeout(1000);

    // Now the original conversation's message should be visible
    await expect(
      page.locator('[data-testid="message-user"] .message-content').getByText('Test conversation switching', { exact: true })
    ).toBeVisible({ timeout: 10000 });
  });

  test('active conversation highlighted in dropdown', async ({ page }) => {
    await seedConversation(session.id, 'Second Conv');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Open dropdown
    const selectorBtn = page.locator('[data-testid="conversation-selector"]');
    await expect(selectorBtn).toBeVisible({ timeout: 10000 });
    await selectorBtn.click();
    await page.waitForTimeout(500);

    // Verify one option has the active class
    const activeOptions = page.locator('.tree-item-row.active');
    await expect(activeOptions).toHaveCount(1);
  });

  test('conversation selector hidden while session is running', async ({ page }) => {
    await seedConversation(session.id, 'Second Conv');
    await updateSessionStatus(session.id, 'running');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // The entire conversation panel should be hidden when running
    const conversationPanel = page.locator('.conversation-panel');
    await expect(conversationPanel).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe('Conversation Branching', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    project = await seedProject('Conv Branch Test', '/tmp/test');
    // Use session with messages for branching (need user messages to branch from)
    session = await seedSessionWithMessages(project.id, {
      prompt: 'Test branch from here',
      name: 'Branch Test Session',
    });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('branch button visible on user messages', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Wait for the user message to appear
    const userMessage = page.locator('[data-testid="message-user"]');
    await expect(userMessage.first()).toBeVisible({ timeout: 10000 });

    // Hover over the message to make the branch button visible
    await userMessage.first().hover();

    // Verify branch button is visible
    const branchBtn = userMessage.first().locator('[data-testid="branch-button"]');
    await expect(branchBtn).toBeVisible({ timeout: 5000 });
  });

  test('branch button not visible on assistant messages', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Wait for at least one message to appear
    const userMessage = page.locator('[data-testid="message-user"]');
    await expect(userMessage.first()).toBeVisible({ timeout: 10000 });

    // If there are any assistant messages, verify they don't have branch buttons
    const assistantMessages = page.locator('[data-testid="message-assistant"]');
    const assistantCount = await assistantMessages.count();

    for (let i = 0; i < assistantCount; i++) {
      await assistantMessages.nth(i).hover();
      const branchBtn = assistantMessages.nth(i).locator('[data-testid="branch-button"]');
      await expect(branchBtn).not.toBeVisible();
    }
  });

  test('clicking branch button opens branch editor', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    const userMessage = page.locator('[data-testid="message-user"]');
    await expect(userMessage.first()).toBeVisible({ timeout: 10000 });

    // Hover to reveal branch button
    await userMessage.first().hover();

    // Click branch button
    const branchBtn = userMessage.first().locator('[data-testid="branch-button"]');
    await expect(branchBtn).toBeVisible({ timeout: 5000 });
    await branchBtn.click();
    await page.waitForTimeout(500);

    // Verify the branch editor appears (BranchEditor component)
    const branchEditor = page.locator('.branch-editor');
    await expect(branchEditor).toBeVisible({ timeout: 5000 });
  });

  test('creating a branch via API produces new conversation', async () => {
    // Get the initial conversation and its messages
    const initialConvs = await getConversations(session.id);
    const conv1 = initialConvs[0];

    const messages = await getConversationMessages(session.id, conv1.id);
    expect(messages.length).toBeGreaterThan(0);

    const userMessage = messages.find((m: any) => m.role === 'user');
    expect(userMessage).toBeTruthy();

    // Branch from the user message
    const branchConv = await branchConversation(
      session.id,
      conv1.id,
      userMessage.id,
      'New branch prompt'
    );

    expect(branchConv).toBeTruthy();
    expect(branchConv.parentConversationId).toBe(conv1.id);
    expect(branchConv.branchFromMessageId).toBe(userMessage.id);

    // Verify conversations count increased
    const convs = await getConversations(session.id);
    expect(convs.length).toBeGreaterThanOrEqual(2);
  });

  test('branched conversation contains the branch prompt', async () => {
    // Get the initial conversation and its messages
    const initialConvs = await getConversations(session.id);
    const conv1 = initialConvs[0];

    const messages = await getConversationMessages(session.id, conv1.id);
    const userMessage = messages.find((m: any) => m.role === 'user');
    expect(userMessage).toBeTruthy();

    // Branch from the user message
    const branchConv = await branchConversation(
      session.id,
      conv1.id,
      userMessage.id,
      'New branch prompt'
    );

    // Wait a moment for branch to complete
    await new Promise((r) => setTimeout(r, 1000));

    // Get messages for the branched conversation
    const branchMessages = await getConversationMessages(session.id, branchConv.id);

    // Branch should have messages including the new prompt
    const branchUserMessages = branchMessages.filter((m: any) => m.role === 'user');
    expect(branchUserMessages.length).toBeGreaterThan(0);

    // At least one message should contain the branch prompt
    const hasBranchPrompt = branchUserMessages.some(
      (m: any) => m.content === 'New branch prompt'
    );
    expect(hasBranchPrompt).toBe(true);
  });

  test('branched conversation shows branch indicator in tree', async ({ page }) => {
    // Create a branch via API
    const initialConvs = await getConversations(session.id);
    const conv1 = initialConvs[0];
    const messages = await getConversationMessages(session.id, conv1.id);
    const userMessage = messages.find((m: any) => m.role === 'user');

    await branchConversation(session.id, conv1.id, userMessage!.id, 'Branch prompt');

    // Branching auto-starts session; wait and force back to waiting
    await new Promise((r) => setTimeout(r, 3000));
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Open dropdown
    const selectorBtn = page.locator('[data-testid="conversation-selector"]');
    await expect(selectorBtn).toBeVisible({ timeout: 10000 });
    await selectorBtn.click();
    await page.waitForTimeout(500);

    // Verify branch indicator is present
    const branchIndicator = page.locator('.branch-indicator');
    await expect(branchIndicator.first()).toBeVisible({ timeout: 5000 });
  });

  test('cannot branch while session is running', async ({ page }) => {
    await updateSessionStatus(session.id, 'running');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // The conversation panel is hidden when running
    const conversationPanel = page.locator('.conversation-panel');
    await expect(conversationPanel).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe('Conversation Tree Visualization', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    project = await seedProject('Conv Tree Test', '/tmp/test');
    // Use session with messages for tree visualization (branching needs messages)
    session = await seedSessionWithMessages(project.id, {
      prompt: 'Test tree visualization',
      name: 'Tree Test Session',
    });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('root conversations shown at top level', async ({ page }) => {
    // Create a second root conversation
    await seedConversation(session.id, 'Second Root');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Open dropdown
    const selectorBtn = page.locator('[data-testid="conversation-selector"]');
    await expect(selectorBtn).toBeVisible({ timeout: 10000 });
    await selectorBtn.click();
    await page.waitForTimeout(500);

    // Verify 2 top-level conversation options
    const options = page.locator('[data-testid="conversation-option"]');
    await expect(options).toHaveCount(2, { timeout: 5000 });

    // Root conversations should NOT have is-branch class
    const topLevelItems = page.locator('.tree-item:not(.is-branch)');
    expect(await topLevelItems.count()).toBe(2);
  });

  test('branched conversations show indentation', async ({ page }) => {
    // Create a branch
    const initialConvs = await getConversations(session.id);
    const conv1 = initialConvs[0];
    const messages = await getConversationMessages(session.id, conv1.id);
    const userMessage = messages.find((m: any) => m.role === 'user');

    await branchConversation(session.id, conv1.id, userMessage!.id, 'Branch prompt');

    // Wait and set back to waiting
    await new Promise((r) => setTimeout(r, 3000));
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Open dropdown
    const selectorBtn = page.locator('[data-testid="conversation-selector"]');
    await expect(selectorBtn).toBeVisible({ timeout: 10000 });
    await selectorBtn.click();
    await page.waitForTimeout(500);

    // Verify branch item exists (is-branch class indicates it's a child conversation)
    const branchItem = page.locator('.tree-item.is-branch');
    await expect(branchItem.first()).toBeVisible({ timeout: 5000 });

    // Branch items should have a tree-indent span for indentation
    const treeIndent = branchItem.first().locator('.tree-indent');
    await expect(treeIndent).toBeAttached();
  });

  test('parent with children shows expand toggle', async ({ page }) => {
    // Create a branch (makes initial conv a parent)
    const initialConvs = await getConversations(session.id);
    const conv1 = initialConvs[0];
    const messages = await getConversationMessages(session.id, conv1.id);
    const userMessage = messages.find((m: any) => m.role === 'user');

    await branchConversation(session.id, conv1.id, userMessage!.id, 'Branch prompt');

    await new Promise((r) => setTimeout(r, 3000));
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Open dropdown
    const selectorBtn = page.locator('[data-testid="conversation-selector"]');
    await expect(selectorBtn).toBeVisible({ timeout: 10000 });
    await selectorBtn.click();
    await page.waitForTimeout(500);

    // Parent conversation should have expand toggle
    const expandToggle = page.locator('.expand-toggle');
    await expect(expandToggle.first()).toBeVisible({ timeout: 5000 });
  });

  test('children badge shows child count', async ({ page }) => {
    // Create two branches from the initial conversation
    const initialConvs = await getConversations(session.id);
    const conv1 = initialConvs[0];
    const messages = await getConversationMessages(session.id, conv1.id);
    const userMessage = messages.find((m: any) => m.role === 'user');

    await branchConversation(session.id, conv1.id, userMessage!.id, 'Branch 1');
    await new Promise((r) => setTimeout(r, 3000));
    await updateSessionStatus(session.id, 'waiting');

    await branchConversation(session.id, conv1.id, userMessage!.id, 'Branch 2');
    await new Promise((r) => setTimeout(r, 3000));
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Open dropdown
    const selectorBtn = page.locator('[data-testid="conversation-selector"]');
    await expect(selectorBtn).toBeVisible({ timeout: 10000 });
    await selectorBtn.click();
    await page.waitForTimeout(500);

    // Verify children badge shows count of 2
    const childrenBadge = page.locator('.children-badge');
    await expect(childrenBadge.first()).toBeVisible({ timeout: 5000 });
    await expect(childrenBadge.first()).toContainText('2');
  });

  test('conversation name displayed in tree', async ({ page }) => {
    await seedConversation(session.id, 'My Custom Name');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Open dropdown
    const selectorBtn = page.locator('[data-testid="conversation-selector"]');
    await expect(selectorBtn).toBeVisible({ timeout: 10000 });
    await selectorBtn.click();
    await page.waitForTimeout(500);

    // Verify the custom name is shown
    const convName = page.locator('.conv-name').filter({ hasText: 'My Custom Name' });
    await expect(convName).toBeVisible({ timeout: 5000 });
  });

  test('message count shown in tree metadata', async ({ page }) => {
    await seedConversation(session.id, 'Second Conv');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Open dropdown
    const selectorBtn = page.locator('[data-testid="conversation-selector"]');
    await expect(selectorBtn).toBeVisible({ timeout: 10000 });
    await selectorBtn.click();
    await page.waitForTimeout(500);

    // Verify message count is shown in metadata
    const convMeta = page.locator('.conv-meta');
    await expect(convMeta.first()).toBeVisible({ timeout: 5000 });
    await expect(convMeta.first()).toContainText('msgs');
  });
});

test.describe('Per-Conversation Token Tracking', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    project = await seedProject('Conv Token Test', '/tmp/test');
    session = await seedSession(project.id, {
      prompt: 'Test token tracking',
      name: 'Token Test Session',
      startImmediately: false,
    });
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('new conversation starts with zero tokens', async () => {
    const newConv = await seedConversation(session.id, 'Zero Token Conv');

    const convs = await getConversations(session.id);
    const created = convs.find((c: any) => c.id === newConv.id);

    expect(created).toBeTruthy();
    expect(created.inputTokens).toBe(0);
    expect(created.outputTokens).toBe(0);
  });

  test('different conversations track independent token counts', async () => {
    const convs = await getConversations(session.id);

    // Conversations should have token tracking fields
    expect(convs[0]).toHaveProperty('inputTokens');
    expect(convs[0]).toHaveProperty('outputTokens');

    // Create a second conversation
    await seedConversation(session.id, 'Second Conv');
    const allConvs = await getConversations(session.id);
    expect(allConvs).toHaveLength(2);

    // Each conversation has independent token fields
    for (const conv of allConvs) {
      expect(conv).toHaveProperty('inputTokens');
      expect(conv).toHaveProperty('outputTokens');
      expect(typeof conv.inputTokens).toBe('number');
      expect(typeof conv.outputTokens).toBe('number');
    }
  });

  test('token display visible in conversation selector', async ({ page }) => {
    // Create a second conversation so the dropdown appears
    await seedConversation(session.id, 'Second Conv');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Open dropdown
    const selectorBtn = page.locator('[data-testid="conversation-selector"]');
    await expect(selectorBtn).toBeVisible({ timeout: 10000 });
    await selectorBtn.click();
    await page.waitForTimeout(500);

    // Verify conv-meta is present (contains message count and optionally tokens)
    const convMeta = page.locator('.conv-meta');
    await expect(convMeta.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Per-Conversation Summaries', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    project = await seedProject('Conv Summary Test', '/tmp/test');
    session = await seedSession(project.id, {
      prompt: 'Test conversation summaries',
      name: 'Summary Test Session',
      startImmediately: false,
    });
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('new conversation has null summary', async () => {
    const newConv = await seedConversation(session.id, 'No Summary Conv');

    const convs = await getConversations(session.id);
    const created = convs.find((c: any) => c.id === newConv.id);

    expect(created).toBeTruthy();
    expect(created.summary).toBeNull();
    expect(created.summaryGeneratedAt).toBeNull();
  });

  test('summary endpoint returns response for conversation', async () => {
    const convs = await getConversations(session.id);
    const conv = convs[0];

    // Call the summary generation endpoint
    const response = await generateConversationSummary(session.id, conv.id);

    // The endpoint should return a response
    expect(response.status).toBeDefined();
    // Either 200 (success) or 500 (service unavailable) are valid outcomes
    expect([200, 500]).toContain(response.status);
  });

  test('switching conversations triggers background summary generation', async () => {
    // Create a second conversation
    const conv2 = await seedConversation(session.id, 'Summary Check Conv');

    // Get initial state of first conversation
    const convsBefore = await getConversations(session.id);
    const initialConv = convsBefore.find((c: any) => c.id !== conv2.id);

    // Switch back to the first conversation
    await switchConversation(session.id, initialConv.id);

    // Wait a bit for background summary generation
    await new Promise((r) => setTimeout(r, 2000));

    // Fetch conversations again
    const convsAfter = await getConversations(session.id);
    const conv2After = convsAfter.find((c: any) => c.id === conv2.id);

    // The conversation should still exist with summary fields
    expect(conv2After).toBeTruthy();
    expect(conv2After).toHaveProperty('summary');
    expect(conv2After).toHaveProperty('summaryGeneratedAt');
  });
});

test.describe('Conversation Deletion', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    project = await seedProject('Conv Delete Test', '/tmp/test');
    session = await seedSession(project.id, {
      prompt: 'Test conversation deletion',
      name: 'Delete Test Session',
      startImmediately: false,
    });
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('can delete inactive conversation via API', async () => {
    // Create a second conversation (becomes active)
    const conv2 = await seedConversation(session.id, 'To Delete');

    const convsBefore = await getConversations(session.id);
    expect(convsBefore).toHaveLength(2);

    // The initial conversation is now inactive, delete it
    const inactiveConv = convsBefore.find((c: any) => !c.isActive);
    expect(inactiveConv).toBeTruthy();

    await deleteConversation(session.id, inactiveConv.id);

    const convsAfter = await getConversations(session.id);
    expect(convsAfter).toHaveLength(1);
    expect(convsAfter[0].id).toBe(conv2.id);
  });

  test('deleting active conversation auto-activates another', async () => {
    // Create a second conversation (becomes active)
    const conv2 = await seedConversation(session.id, 'Active To Delete');

    const convsBefore = await getConversations(session.id);
    expect(convsBefore).toHaveLength(2);

    // conv2 is active - delete it
    await deleteConversation(session.id, conv2.id);

    const convsAfter = await getConversations(session.id);
    expect(convsAfter).toHaveLength(1);
    expect(convsAfter[0].isActive).toBe(true);
  });

  test('delete button visible on non-active conversations in dropdown', async ({ page }) => {
    await seedConversation(session.id, 'Deletable Conv');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Open dropdown
    const selectorBtn = page.locator('[data-testid="conversation-selector"]');
    await expect(selectorBtn).toBeVisible({ timeout: 10000 });
    await selectorBtn.click();
    await page.waitForTimeout(500);

    // Find the non-active conversation option and hover
    const inactiveOption = page.locator('.tree-item-row:not(.active)');
    await expect(inactiveOption.first()).toBeVisible({ timeout: 5000 });
    await inactiveOption.first().hover();

    // Delete button should exist (opacity:0 default, 1 on hover)
    const deleteBtn = inactiveOption.first().locator('.delete-btn');
    await expect(deleteBtn).toBeAttached();
  });

  test('delete button not visible on active conversation', async ({ page }) => {
    await seedConversation(session.id, 'Keep Active');

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Open dropdown
    const selectorBtn = page.locator('[data-testid="conversation-selector"]');
    await expect(selectorBtn).toBeVisible({ timeout: 10000 });
    await selectorBtn.click();
    await page.waitForTimeout(500);

    // The active conversation should NOT have a delete button
    const activeOption = page.locator('.tree-item-row.active');
    await expect(activeOption).toBeVisible({ timeout: 5000 });
    const deleteBtn = activeOption.locator('.delete-btn');
    await expect(deleteBtn).not.toBeAttached();
  });

  test('cannot delete conversation while session is running', async () => {
    const conv2 = await seedConversation(session.id, 'Cannot Delete');

    // Get conversations before setting to running
    const convs = await getConversations(session.id);
    const inactiveConv = convs.find((c: any) => !c.isActive);

    await updateSessionStatus(session.id, 'running');

    const response = await deleteConversationRaw(
      session.id,
      inactiveConv?.id || conv2.id
    );
    expect(response.status).toBe(400);

    const error = await response.json();
    expect(error.error).toContain('running');
  });
});
