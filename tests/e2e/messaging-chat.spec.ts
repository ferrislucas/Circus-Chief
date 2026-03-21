import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupAll,
  updateSessionStatus,
  navigateAndWait,
  seedAssistantMessage,
  seedAssistantMessageWithTools,
  seedUserMessage,
  seedConversationHistory,
  seedWorkLog,
  getSessionMessages,
} from './helpers';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

test.describe('Markdown Rendering', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Markdown Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('renders headings in assistant messages', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Heading Test', startImmediately: false });
    seedAssistantMessage(
      session.id,
      '# Heading One\n## Heading Two\n### Heading Three\nSome content.',
      'claude-sonnet-4-20250514'
    );
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    // Wait for message content to render before checking specific elements
    await page.locator('.message-assistant .message-content').first().waitFor({ timeout: 10000 });

    const messageContent = page.locator('.message-assistant .message-content').first();
    await expect(messageContent.locator('h1')).toBeVisible({ timeout: 10000 });
    await expect(messageContent.locator('h2')).toBeVisible({ timeout: 10000 });
    await expect(messageContent.locator('h3')).toBeVisible({ timeout: 10000 });
  });

  test('renders code blocks', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Code Block Test', startImmediately: false });
    seedAssistantMessage(
      session.id,
      'Here is some code:\n```js\nconsole.log("hello world");\n```',
      'claude-sonnet-4-20250514'
    );
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const messageContent = page.locator('.message-assistant .message-content').first();
    await expect(messageContent.locator('pre')).toBeVisible({ timeout: 10000 });
    await expect(messageContent.locator('pre code')).toBeVisible({ timeout: 10000 });
  });

  test('renders inline code', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Inline Code Test', startImmediately: false });
    seedAssistantMessage(
      session.id,
      'Use `console.log` to debug your code.',
      'claude-sonnet-4-20250514'
    );
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const messageContent = page.locator('.message-assistant .message-content').first();
    const inlineCode = messageContent.locator('code').first();
    await expect(inlineCode).toBeVisible({ timeout: 10000 });
    await expect(inlineCode).toContainText('console.log');
  });

  test('renders unordered and ordered lists', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'List Test', startImmediately: false });
    seedAssistantMessage(
      session.id,
      '- item one\n- item two\n- item three\n\n1. first\n2. second\n3. third',
      'claude-sonnet-4-20250514'
    );
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    // Wait for message content to render before checking specific elements
    await page.locator('.message-assistant .message-content').first().waitFor({ timeout: 10000 });

    const messageContent = page.locator('.message-assistant .message-content').first();
    await expect(messageContent.locator('ul')).toBeVisible({ timeout: 10000 });
    await expect(messageContent.locator('ul li').first()).toBeVisible({ timeout: 10000 });
    await expect(messageContent.locator('ol')).toBeVisible({ timeout: 10000 });
    await expect(messageContent.locator('ol li').first()).toBeVisible({ timeout: 10000 });
  });

  test('renders links as clickable anchors', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Link Test' , startImmediately: false });
    seedAssistantMessage(
      session.id,
      'Visit [Example](https://example.com) for more information.',
      'claude-sonnet-4-20250514'
    );
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const messageContent = page.locator('.message-assistant .message-content').first();
    const link = messageContent.locator('a[href="https://example.com"]');
    await expect(link).toBeVisible({ timeout: 10000 });
    await expect(link).toContainText('Example');
  });

  test('renders markdown tables', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Table Test' , startImmediately: false });
    seedAssistantMessage(
      session.id,
      '| Column A | Column B |\n|----------|----------|\n| Cell 1   | Cell 2   |\n| Cell 3   | Cell 4   |',
      'claude-sonnet-4-20250514'
    );
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const messageContent = page.locator('.message-assistant .message-content').first();
    await expect(messageContent.locator('table')).toBeVisible({ timeout: 10000 });
    await expect(messageContent.locator('th').first()).toBeVisible({ timeout: 10000 });
    await expect(messageContent.locator('td').first()).toBeVisible({ timeout: 10000 });
  });

  test('renders bold and italic text', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Bold Italic Test' , startImmediately: false });
    seedAssistantMessage(
      session.id,
      'This is **bold text** and this is *italic text*.',
      'claude-sonnet-4-20250514'
    );
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const messageContent = page.locator('.message-assistant .message-content').first();
    await expect(messageContent.locator('strong')).toBeVisible({ timeout: 10000 });
    await expect(messageContent.locator('em')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Tool Usage Display', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Tool Usage Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('shows tool use section when message has tool calls', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Tool Usage Test' , startImmediately: false });
    seedAssistantMessageWithTools(
      session.id,
      'Let me read that file for you.',
      [{ type: 'tool_use', id: 'toolu_abc123', name: 'Read', input: { file_path: '/test.js' } }],
      'claude-sonnet-4-20250514'
    );
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const toolsSection = page.locator('.message-assistant .message-tools').first();
    await expect(toolsSection).toBeVisible({ timeout: 10000 });
  });

  test('tool details are collapsible using details element', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Tool Collapsible Test' , startImmediately: false });
    seedAssistantMessageWithTools(
      session.id,
      'Checking the file.',
      [{ type: 'tool_use', id: 'toolu_def456', name: 'Read', input: { file_path: '/app.js' } }],
      'claude-sonnet-4-20250514'
    );
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const toolDetails = page.locator('.message-assistant .message-tools details').first();
    await expect(toolDetails).toBeVisible({ timeout: 10000 });

    // Click the summary to expand the details
    const summary = toolDetails.locator('summary').first();
    await expect(summary).toBeVisible({ timeout: 10000 });
    await summary.click();

    // After clicking, the details content (pre) should be visible
    await expect(toolDetails.locator('pre')).toBeVisible({ timeout: 5000 });
  });

  test('displays tool name in tool section', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Tool Name Test' , startImmediately: false });
    seedAssistantMessageWithTools(
      session.id,
      'Running bash command.',
      [{ type: 'tool_use', id: 'toolu_ghi789', name: 'Bash', input: { command: 'ls -la' } }],
      'claude-sonnet-4-20250514'
    );
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const toolsSection = page.locator('.message-assistant .message-tools').first();
    await expect(toolsSection).toContainText('Bash', { timeout: 10000 });
  });

  test('displays tool input when details expanded', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Tool Input Test' , startImmediately: false });
    seedAssistantMessageWithTools(
      session.id,
      'Reading the file.',
      [{ type: 'tool_use', id: 'toolu_jkl012', name: 'Read', input: { file_path: '/test.js' } }],
      'claude-sonnet-4-20250514'
    );
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const toolDetails = page.locator('.message-assistant .message-tools details').first();
    const summary = toolDetails.locator('summary').first();
    await summary.click();

    const toolPre = toolDetails.locator('pre').first();
    await expect(toolPre).toBeVisible({ timeout: 5000 });
    await expect(toolPre).toContainText('/test.js');
  });

  test('shows multiple tool calls as multiple detail blocks', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Multiple Tools Test' , startImmediately: false });
    seedAssistantMessageWithTools(
      session.id,
      'Using multiple tools.',
      [
        { type: 'tool_use', id: 'toolu_001', name: 'Read', input: { file_path: '/file1.js' } },
        { type: 'tool_use', id: 'toolu_002', name: 'Bash', input: { command: 'ls' } },
      ],
      'claude-sonnet-4-20250514'
    );
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const toolBlocks = page.locator('.message-assistant .message-tools details');
    await expect(toolBlocks).toHaveCount(2, { timeout: 10000 });
  });
});

test.describe('Work Log UI Panels', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Work Log UI Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('work log panel appears on assistant messages with associated logs', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Work Log Panel Test' , startImmediately: false });
    const msg = seedAssistantMessage(session.id, 'I ran some tools for you.', 'claude-sonnet-4-20250514');
    await seedWorkLog(session.id, {
      type: 'tool_input',
      content: '{"command": "ls -la"}',
      toolName: 'Bash',
      messageId: msg.id,
    });
    await seedWorkLog(session.id, {
      type: 'tool_output',
      content: 'total 8\ndrwxr-xr-x  2 user user 4096 Jan  1 12:00 .',
      toolName: 'Bash',
      messageId: msg.id,
    });
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const workLogPanel = page.locator('.message-assistant .work-log-panel').first();
    await expect(workLogPanel).toBeVisible({ timeout: 10000 });
  });

  test('thinking blocks display thinking content', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Thinking Block Test' , startImmediately: false });
    const msg = seedAssistantMessage(session.id, 'After thinking, here is my answer.', 'claude-sonnet-4-20250514');
    await seedWorkLog(session.id, {
      type: 'thinking',
      content: 'Let me analyze this carefully and think through the options.',
      messageId: msg.id,
    });
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const workLogHeader = page.locator('.message-assistant .work-log-panel summary').first();
    await expect(workLogHeader).toBeVisible({ timeout: 10000 });
    await workLogHeader.click();

    const thinkingBlock = page.locator('.message-assistant .thinking-block').first();
    await expect(thinkingBlock).toBeVisible({ timeout: 5000 });
    await expect(thinkingBlock).toContainText('Let me analyze this carefully');
  });

  test('thinking block shows "show more" button for long content', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Thinking Truncate Test' , startImmediately: false });
    const msg = seedAssistantMessage(session.id, 'I thought extensively about this.', 'claude-sonnet-4-20250514');
    const longThinking = 'This is my thinking process. '.repeat(30); // ~870 chars
    await seedWorkLog(session.id, {
      type: 'thinking',
      content: longThinking,
      messageId: msg.id,
    });
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const workLogHeader = page.locator('.message-assistant .work-log-panel summary').first();
    await expect(workLogHeader).toBeVisible({ timeout: 10000 });
    await workLogHeader.click();

    const showMoreBtn = page.locator('.message-assistant .show-more-btn').first();
    await expect(showMoreBtn).toBeVisible({ timeout: 5000 });
    await expect(showMoreBtn).toContainText('Show more');

    await showMoreBtn.click();
    const thinkingBlock = page.locator('.message-assistant .thinking-block').first();
    await expect(thinkingBlock).toContainText('This is my thinking process.');
  });
});

test.describe('Jump Navigation Buttons', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Jump Nav Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('"jump to latest" button not visible when at bottom with few messages', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Jump Latest Hidden Test' , startImmediately: false });
    seedAssistantMessage(session.id, 'Hello! How can I help you?', 'claude-sonnet-4-20250514');
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    // Button should not be visible when at bottom (hasNewMessages starts false)
    const jumpBtn = page.locator('.jump-to-latest');
    await expect(jumpBtn).not.toBeVisible({ timeout: 5000 });
  });

  test('"jump to latest" button not visible on initial load even with many messages', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Jump Latest Many Messages Test' , startImmediately: false });
    seedConversationHistory(session.id, 30);
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(800);

    // On initial load, page auto-scrolls to bottom; hasNewMessages is false
    const jumpBtn = page.locator('.jump-to-latest');
    await expect(jumpBtn).not.toBeVisible({ timeout: 5000 });
  });

  test('"scroll-to-claude" button visible when session is waiting with assistant messages', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Scroll To Claude Test' , startImmediately: false });
    seedUserMessage(session.id, 'Please help me with this task.');
    seedAssistantMessage(session.id, 'Sure, I can help you with that!', 'claude-sonnet-4-20250514');
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    // hasAssistantMessages=true, isNearBottom=true (loaded at bottom), isUsersTurn=true (waiting)
    const scrollToClaudeBtn = page.locator('.scroll-to-claude-btn');
    await expect(scrollToClaudeBtn).toBeVisible({ timeout: 10000 });
  });

  test('"scroll-to-claude" button not visible when session is running', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Scroll To Claude Running Test' , startImmediately: false });
    seedAssistantMessage(session.id, 'I am currently working...', 'claude-sonnet-4-20250514');
    await updateSessionStatus(session.id, 'running');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    // isUsersTurn = false when running
    const scrollToClaudeBtn = page.locator('.scroll-to-claude-btn');
    await expect(scrollToClaudeBtn).not.toBeVisible({ timeout: 5000 });
  });

  test('"scroll-to-claude" button not visible when no assistant messages', async ({ page }) => {
    // Draft session = waiting status with no assistant messages
    const session = await seedSession(project.id, { prompt: 'Hello there, draft session', name: 'No Assistant Test' , startImmediately: false });

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const scrollToClaudeBtn = page.locator('.scroll-to-claude-btn');
    await expect(scrollToClaudeBtn).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe('Resizable Textarea', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Textarea Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('textarea is visible when session is waiting with prior conversation', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Textarea Visible Test' , startImmediately: false });
    // Seed an assistant message so the session is not a draft
    seedAssistantMessage(session.id, 'Hello! How can I help?', 'claude-sonnet-4-20250514');
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const textarea = page.locator('.input-form textarea');
    await expect(textarea).toBeVisible({ timeout: 10000 });
  });

  test('textarea accepts text input', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Textarea Input Test' , startImmediately: false });
    seedAssistantMessage(session.id, 'How can I help?', 'claude-sonnet-4-20250514');
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const textarea = page.locator('.input-form textarea');
    await expect(textarea).toBeVisible({ timeout: 10000 });
    await textarea.fill('This is a test message for the textarea');
    await expect(textarea).toHaveValue('This is a test message for the textarea');
  });

  test('Cmd+Enter submits the message', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Cmd Enter Test' , startImmediately: false });
    seedAssistantMessage(session.id, 'How can I help?', 'claude-sonnet-4-20250514');
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const textarea = page.locator('.input-form textarea');
    await expect(textarea).toBeVisible({ timeout: 10000 });
    await textarea.fill('My follow-up question');

    // Press Cmd+Enter (Meta+Enter on macOS / Control+Enter on others)
    await page.keyboard.press('Meta+Enter');
    await page.waitForTimeout(1000);

    // After submission, a new user message should exist in the API
    const msgs = await getSessionMessages(session.id);
    const userMessages = msgs.filter((m: any) => m.role === 'user');
    expect(userMessages.length).toBeGreaterThanOrEqual(1);
    const lastUserMsg = userMessages[userMessages.length - 1];
    expect(lastUserMsg.content).toContain('My follow-up question');
  });

  test('send button is disabled when textarea is empty', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Send Disabled Test', startImmediately: false });
    seedAssistantMessage(session.id, 'I am here.', 'claude-sonnet-4-20250514');
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    // Clear the textarea (pendingPrompt is pre-filled for startImmediately=false sessions)
    const textarea = page.locator('.input-form textarea');
    await textarea.fill('');

    const sendBtn = page.locator('.btn-send-full').first();
    await expect(sendBtn).toBeDisabled({ timeout: 10000 });
  });

  test('send button is enabled when textarea has content', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Send Enabled Test' , startImmediately: false });
    seedAssistantMessage(session.id, 'I am here.', 'claude-sonnet-4-20250514');
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const textarea = page.locator('.input-form textarea');
    await textarea.fill('Some message content');

    const sendBtn = page.locator('.btn-send-full').first();
    await expect(sendBtn).not.toBeDisabled({ timeout: 10000 });
  });
});

test.describe('Model Name Display', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Model Name Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('model name shown on assistant messages', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Model Name Test' , startImmediately: false });
    seedAssistantMessage(session.id, 'I am Claude Sonnet.', 'claude-sonnet-4-20250514');
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const assistantMsg = page.locator('[data-testid="message-assistant"]').first();
    const modelDisplay = assistantMsg.locator('.message-model');
    await expect(modelDisplay).toBeVisible({ timeout: 10000 });
  });

  test('model name not shown on user messages', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'User No Model Test' , startImmediately: false });
    seedUserMessage(session.id, 'This is my user message.');
    seedAssistantMessage(session.id, 'Got it!', 'claude-sonnet-4-20250514');
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const userMsg = page.locator('[data-testid="message-user"]').first();
    const modelDisplay = userMsg.locator('.message-model');
    await expect(modelDisplay).not.toBeVisible({ timeout: 5000 });
  });

  test('different model names shown for different assistant messages', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Multiple Models Test' , startImmediately: false });
    seedAssistantMessage(session.id, 'I am Sonnet.', 'claude-sonnet-4-20250514');
    seedAssistantMessage(session.id, 'I am Haiku.', 'claude-haiku-4-20250514');
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const assistantMessages = page.locator('[data-testid="message-assistant"]');
    await expect(assistantMessages).toHaveCount(2, { timeout: 10000 });

    const firstModelDisplay = assistantMessages.nth(0).locator('.message-model');
    const secondModelDisplay = assistantMessages.nth(1).locator('.message-model');

    await expect(firstModelDisplay).toBeVisible({ timeout: 10000 });
    await expect(secondModelDisplay).toBeVisible({ timeout: 10000 });

    const firstModelText = await firstModelDisplay.textContent();
    const secondModelText = await secondModelDisplay.textContent();
    expect(firstModelText).not.toEqual(secondModelText);
  });
});

test.describe('Message States & Error Handling', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Message States Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('draft session shows textarea with prompt', async ({ page }) => {
    // Draft = waiting status with no assistant messages
    const session = await seedSession(project.id, {
      prompt: 'My draft prompt text',
      name: 'Draft Session Test',
    });

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const textarea = page.locator('.input-form textarea');
    await expect(textarea).toBeVisible({ timeout: 10000 });
  });

  test('messages not rendered for draft sessions', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Draft prompt with no responses',
      name: 'Draft Messages Hidden Test',
      startImmediately: false, // Don't auto-start - keeps it as a true draft
    });

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    // Draft sessions hide messages in the template (v-if="!isDraft && !isScheduledDraft")
    const messageItems = page.locator('[data-testid="message-user"], [data-testid="message-assistant"]');
    await expect(messageItems).toHaveCount(0, { timeout: 10000 });
  });

  test('input area visible after session completes a turn', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Input After Turn Test' , startImmediately: false });
    seedUserMessage(session.id, 'Can you help me?');
    seedAssistantMessage(session.id, 'Yes, I can help you!', 'claude-sonnet-4-20250514');
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const inputForm = page.locator('.input-form');
    await expect(inputForm).toBeVisible({ timeout: 10000 });
  });

  test('stop button visible during running state', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello', name: 'Stop Button Test' , startImmediately: false });
    seedAssistantMessage(session.id, 'Processing...', 'claude-sonnet-4-20250514');
    await updateSessionStatus(session.id, 'running');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/conversation`);
    await page.waitForTimeout(500);

    const runningState = page.locator('.running-state');
    await expect(runningState).toBeVisible({ timeout: 10000 });

    const stopBtn = runningState.locator('.btn-stop');
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
  });
});
