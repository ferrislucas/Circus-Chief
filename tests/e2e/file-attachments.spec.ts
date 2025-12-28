import { test, expect } from '@playwright/test';
import {
  seedProject,
  cleanupAll,
  cleanupCreatedResources,
  seedSessionWithFiles,
  sendMessageWithFiles,
  getSessionMessages,
  getSessionAttachments,
  updateSessionStatus,
  navigateAndWait,
  waitForSessionToExist,
  waitForPageReady,
} from './helpers';

// Helper to set session to waiting status for testing
async function prepareSessionForTest(page: any, sessionId: string) {
  // Force session to waiting status since there's no actual Claude process
  await updateSessionStatus(sessionId, 'waiting');
  // Wait for status to be reflected
  await page.waitForTimeout(500);
}

test.describe('File Attachments - Session Creation', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('File Attachment Test', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('creates session with text file attachment', async ({ page }) => {
    const testFileContent = 'Hello, this is test file content!';
    const session = await seedSessionWithFiles(
      project.id,
      { prompt: 'Analyze this file', name: 'Text File Test' },
      [{ name: 'test.txt', content: testFileContent, type: 'text/plain' }]
    );

    expect(session.id).toBeTruthy();
    expect(session.name).toBe('Text File Test');

    // Navigate and prepare session for testing
    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await prepareSessionForTest(page, session.id);

    // Verify attachments are stored and returned in messages
    const attachments = await getSessionAttachments(session.id);
    expect(attachments.length).toBe(1);
    expect(attachments[0].filename).toBe('test.txt');
    expect(attachments[0].mimeType).toBe('text/plain');
  });

  test('creates session with multiple file attachments', async ({ page }) => {
    const session = await seedSessionWithFiles(
      project.id,
      { prompt: 'Analyze these files', name: 'Multiple Files Test' },
      [
        { name: 'file1.txt', content: 'Content of file 1', type: 'text/plain' },
        { name: 'file2.json', content: '{"key": "value"}', type: 'application/json' },
        { name: 'file3.md', content: '# Heading\n\nSome markdown', type: 'text/markdown' },
      ]
    );

    expect(session.id).toBeTruthy();

    // Navigate and prepare session for testing
    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await prepareSessionForTest(page, session.id);

    // Verify all attachments are stored
    const attachments = await getSessionAttachments(session.id);
    expect(attachments.length).toBe(3);

    const filenames = attachments.map((a: any) => a.filename);
    expect(filenames).toContain('file1.txt');
    expect(filenames).toContain('file2.json');
    expect(filenames).toContain('file3.md');
  });

  test('file content is included in session messages', async ({ page }) => {
    const uniqueContent = `UNIQUE_TEST_CONTENT_${Date.now()}`;
    const session = await seedSessionWithFiles(
      project.id,
      { prompt: 'What is in this file?', name: 'Content Verification Test' },
      [{ name: 'unique-test.txt', content: uniqueContent, type: 'text/plain' }]
    );

    expect(session.id).toBeTruthy();

    // Navigate and prepare session for testing
    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await prepareSessionForTest(page, session.id);

    // Get messages and verify the user message exists with the file
    const messages = await getSessionMessages(session.id);
    expect(messages.length).toBeGreaterThanOrEqual(1);

    // The first message should be the user's prompt
    const userMessage = messages.find((m: any) => m.role === 'user');
    expect(userMessage).toBeTruthy();
    expect(userMessage.content).toContain('What is in this file?');

    // Verify the attachment is associated with the message
    expect(userMessage.attachments).toBeTruthy();
    expect(userMessage.attachments.length).toBe(1);
    expect(userMessage.attachments[0].filename).toBe('unique-test.txt');
  });

  test('attachments are associated with the correct message', async ({ page }) => {
    const session = await seedSessionWithFiles(
      project.id,
      { prompt: 'Review this code', name: 'Message Association Test' },
      [{ name: 'code.js', content: 'const x = 1;', type: 'application/javascript' }]
    );

    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await prepareSessionForTest(page, session.id);

    // Get messages with attachments
    const messages = await getSessionMessages(session.id);
    const userMessage = messages.find((m: any) => m.role === 'user');

    expect(userMessage).toBeTruthy();
    expect(userMessage.attachments).toBeTruthy();
    expect(userMessage.attachments.length).toBe(1);
    expect(userMessage.attachments[0].filename).toBe('code.js');
  });
});

test.describe('File Attachments - Follow-up Messages', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Follow-up Attachment Test', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('follow-up message API accepts file attachment', async ({ page }) => {
    // Create initial session without attachments
    const session = await seedSessionWithFiles(
      project.id,
      { prompt: 'Hello', name: 'Follow-up Test' },
      []
    );

    // Navigate and prepare session for testing
    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await prepareSessionForTest(page, session.id);

    // Send follow-up message with attachment - this should succeed
    // Note: Without a real Claude process, the message won't be saved to DB
    // but the API should accept the request and store the attachment
    const followUpContent = 'Now analyze this file';

    // The sendMessageWithFiles function should not throw
    let error = null;
    try {
      await sendMessageWithFiles(
        session.id,
        followUpContent,
        [{ name: 'followup.txt', content: 'Follow-up file content', type: 'text/plain' }]
      );
    } catch (e: any) {
      error = e;
    }

    // The API should accept the request without error
    expect(error).toBeNull();
  });

  test('initial session message has correct attachment', async ({ page }) => {
    // Create session with initial attachment
    const session = await seedSessionWithFiles(
      project.id,
      { prompt: 'Start conversation', name: 'Initial Attachment Test' },
      [{ name: 'initial.txt', content: 'Initial content', type: 'text/plain' }]
    );

    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await prepareSessionForTest(page, session.id);

    // Verify the initial message has the attachment
    const messages = await getSessionMessages(session.id);
    const userMessages = messages.filter((m: any) => m.role === 'user');

    expect(userMessages.length).toBeGreaterThanOrEqual(1);

    // Initial message should have initial.txt
    const initialMsg = userMessages.find((m: any) => m.content === 'Start conversation');
    expect(initialMsg).toBeTruthy();
    expect(initialMsg?.attachments?.[0]?.filename).toBe('initial.txt');
  });
});

test.describe('File Attachments - UI Display', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('UI Display Test', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('attachments are displayed in conversation view', async ({ page }) => {
    const session = await seedSessionWithFiles(
      project.id,
      { prompt: 'Check this file', name: 'UI Display Test' },
      [{ name: 'display-test.txt', content: 'Test content for display', type: 'text/plain' }]
    );

    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await prepareSessionForTest(page, session.id);
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify the attachment is displayed in the attachment chip area specifically
    // Use locator to find the attachment-name element within an attachment-chip
    await expect(page.locator('.attachment-chip .attachment-name').filter({ hasText: 'display-test.txt' }).first()).toBeVisible({ timeout: 10000 });
  });

  test('multiple attachments display correctly', async ({ page }) => {
    const session = await seedSessionWithFiles(
      project.id,
      { prompt: 'Review these files', name: 'Multi Display Test' },
      [
        { name: 'file-a.txt', content: 'Content A', type: 'text/plain' },
        { name: 'file-b.json', content: '{}', type: 'application/json' },
      ]
    );

    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await prepareSessionForTest(page, session.id);
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify both attachments are displayed in the attachment chip area
    await expect(page.locator('.attachment-chip .attachment-name').filter({ hasText: 'file-a.txt' }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.attachment-chip .attachment-name').filter({ hasText: 'file-b.json' }).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('File Attachments - Different File Types', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('File Types Test', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('handles JSON files correctly', async ({ page }) => {
    const jsonContent = JSON.stringify({ name: 'test', value: 123, nested: { key: 'value' } });
    const session = await seedSessionWithFiles(
      project.id,
      { prompt: 'Parse this JSON', name: 'JSON Test' },
      [{ name: 'data.json', content: jsonContent, type: 'application/json' }]
    );

    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await prepareSessionForTest(page, session.id);

    const attachments = await getSessionAttachments(session.id);
    expect(attachments.length).toBe(1);
    expect(attachments[0].mimeType).toBe('application/json');
  });

  test('handles JavaScript files correctly', async ({ page }) => {
    const jsContent = 'function hello() {\n  console.log("Hello, World!");\n}\n\nhello();';
    const session = await seedSessionWithFiles(
      project.id,
      { prompt: 'Review this JavaScript', name: 'JS Test' },
      [{ name: 'script.js', content: jsContent, type: 'application/javascript' }]
    );

    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await prepareSessionForTest(page, session.id);

    const attachments = await getSessionAttachments(session.id);
    expect(attachments.length).toBe(1);
    expect(attachments[0].filename).toBe('script.js');
  });

  test('handles Markdown files correctly', async ({ page }) => {
    const mdContent = '# Title\n\n## Subtitle\n\n- Item 1\n- Item 2\n\n```javascript\nconst x = 1;\n```';
    const session = await seedSessionWithFiles(
      project.id,
      { prompt: 'Convert this markdown', name: 'Markdown Test' },
      [{ name: 'readme.md', content: mdContent, type: 'text/markdown' }]
    );

    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await prepareSessionForTest(page, session.id);

    const attachments = await getSessionAttachments(session.id);
    expect(attachments.length).toBe(1);
    expect(attachments[0].filename).toBe('readme.md');
  });

  test('handles CSS files correctly', async ({ page }) => {
    const cssContent = 'body {\n  margin: 0;\n  padding: 0;\n}\n\n.container {\n  max-width: 1200px;\n}';
    const session = await seedSessionWithFiles(
      project.id,
      { prompt: 'Improve this CSS', name: 'CSS Test' },
      [{ name: 'styles.css', content: cssContent, type: 'text/css' }]
    );

    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await prepareSessionForTest(page, session.id);

    const attachments = await getSessionAttachments(session.id);
    expect(attachments.length).toBe(1);
    expect(attachments[0].filename).toBe('styles.css');
  });
});

test.describe('File Attachments - Error Handling', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Error Handling Test', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('session works without attachments', async ({ page }) => {
    // Create session without any attachments
    const session = await seedSessionWithFiles(
      project.id,
      { prompt: 'No files here', name: 'No Attachment Test' },
      []
    );

    expect(session.id).toBeTruthy();

    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await prepareSessionForTest(page, session.id);

    const attachments = await getSessionAttachments(session.id);
    expect(attachments.length).toBe(0);

    // Verify the session still works - message is created
    const messages = await getSessionMessages(session.id);
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  test('handles empty file content', async ({ page }) => {
    const session = await seedSessionWithFiles(
      project.id,
      { prompt: 'This file is empty', name: 'Empty File Test' },
      [{ name: 'empty.txt', content: '', type: 'text/plain' }]
    );

    expect(session.id).toBeTruthy();

    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await prepareSessionForTest(page, session.id);

    const attachments = await getSessionAttachments(session.id);
    expect(attachments.length).toBe(1);
    expect(attachments[0].filename).toBe('empty.txt');
  });
});
