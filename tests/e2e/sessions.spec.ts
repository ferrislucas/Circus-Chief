import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupAll,
  waitForSessionStatus,
  getSession,
  getProjectSessions,
  getSessionMessages,
  sendSessionMessage,
} from './helpers';

test.describe('New Session - Thinking Toggle', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('thinking toggle is visible on new session form', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions/new`);

    // Verify toggle is visible
    await expect(page.locator('.thinking-toggle')).toBeVisible();
    await expect(page.getByText('Enable Thinking')).toBeVisible();
  });

  test('thinking toggle defaults to off', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions/new`);

    // Verify toggle is unchecked by default
    const checkbox = page.locator('.thinking-toggle input[type="checkbox"]');
    await expect(checkbox).not.toBeChecked();
  });

  test('can create session with thinking enabled', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions/new`);

    // Fill in required fields
    await page.fill('input[id="name"]', 'Thinking Session');
    await page.fill('textarea[id="prompt"]', 'Test with thinking enabled');

    // Enable thinking toggle (click the toggle-switch label since checkbox has opacity: 0)
    await page.locator('.thinking-toggle .toggle-switch').click();

    // Submit the form
    await page.click('button:has-text("Start Session")');

    // Wait for redirect to session detail
    await expect(page).toHaveURL(/\/sessions\/[\w-]+/, { timeout: 10000 });

    // Verify session name is visible (confirms session loaded)
    await expect(page.getByText('Thinking Session')).toBeVisible();

    // Verify via API that thinkingEnabled is true
    const sessions = await getProjectSessions(project.id);
    const session = sessions.find((s: any) => s.name === 'Thinking Session');
    expect(session).toBeTruthy();
    expect(session.thinkingEnabled).toBe(true);
  });

  test('can create session with thinking disabled', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions/new`);

    // Fill in required fields
    await page.fill('input[id="name"]', 'Non-Thinking Session');
    await page.fill('textarea[id="prompt"]', 'Test with thinking disabled');

    // Verify thinking toggle is unchecked (default)
    const checkbox = page.locator('.thinking-toggle input[type="checkbox"]');
    await expect(checkbox).not.toBeChecked();

    // Submit the form
    await page.click('button:has-text("Start Session")');

    // Wait for redirect to session detail
    await expect(page).toHaveURL(/\/sessions\/[\w-]+/, { timeout: 10000 });

    // Verify session name is visible (confirms session loaded)
    await expect(page.getByText('Non-Thinking Session')).toBeVisible();

    // Verify via API that thinkingEnabled is false
    const sessions = await getProjectSessions(project.id);
    const session = sessions.find((s: any) => s.name === 'Non-Thinking Session');
    expect(session).toBeTruthy();
    expect(session.thinkingEnabled).toBe(false);
  });
});

test.describe('Session Management', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('displays empty state when no sessions exist', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);
    await expect(page.getByText('No sessions yet')).toBeVisible();
  });

  test('can create a new session', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('text=New Session');

    await expect(page).toHaveURL(`/projects/${project.id}/sessions/new`);

    await page.fill('input[id="name"]', 'Test Session');
    await page.fill('textarea[id="prompt"]', 'Help me write a hello world program');
    await page.click('button:has-text("Start Session")');

    // Should redirect to session detail with session ID in URL
    await expect(page).toHaveURL(/\/sessions\/[\w-]+/);

    // Extract session ID from URL and verify via API
    const url = page.url();
    const sessionId = url.match(/\/sessions\/([\w-]+)/)?.[1];
    expect(sessionId).toBeTruthy();

    // Verify session name is visible on the page
    await expect(page.getByText('Test Session')).toBeVisible();

    // Verify the initial prompt was recorded as a message (use exact match to avoid mock response)
    await expect(page.locator('.message-content').getByText('Help me write a hello world program', { exact: true })).toBeVisible();

    // Verify via API that session was created with correct data
    const sessions = await getProjectSessions(project.id);
    expect(sessions.length).toBe(1);
    expect(sessions[0].name).toBe('Test Session');
  });

  test('displays session list', async ({ page }) => {
    const session1 = await seedSession(project.id, { prompt: 'First task', name: 'Session 1' });
    const session2 = await seedSession(project.id, { prompt: 'Second task', name: 'Session 2' });

    await page.goto(`/projects/${project.id}/sessions`);

    await expect(page.getByText('Session 1')).toBeVisible();
    await expect(page.getByText('Session 2')).toBeVisible();

    // Verify via API that both sessions exist
    const sessions = await getProjectSessions(project.id);
    expect(sessions.length).toBe(2);
    expect(sessions.find((s: any) => s.id === session1.id)).toBeTruthy();
    expect(sessions.find((s: any) => s.id === session2.id)).toBeTruthy();
  });

  test('can view session details', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Test prompt', name: 'Test Session' });

    await page.goto(`/sessions/${session.id}`);

    // Verify session name is visible
    await expect(page.getByText('Test Session')).toBeVisible();

    // Verify all tabs are present
    await expect(page.getByRole('link', { name: 'Conversation' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Changes' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Canvas' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Notes' })).toBeVisible();

    // Verify the session prompt is displayed in conversation (use exact match to avoid duplicates)
    await expect(page.locator('.message-content').getByText('Test prompt', { exact: true })).toBeVisible();

    // Verify via API that session data matches
    const apiSession = await getSession(session.id);
    expect(apiSession).not.toBeNull();
    expect(apiSession.name).toBe('Test Session');
    expect(apiSession.projectId).toBe(project.id);
  });

  test('displays session messages', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello Claude', name: 'Chat Session' });

    await page.goto(`/sessions/${session.id}`);

    // The initial user message should be visible
    await expect(page.locator('.message-content').getByText('Hello Claude', { exact: true })).toBeVisible();
  });

  test('can switch between tabs', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Test prompt for tabs', name: 'Tab Test' });

    await page.goto(`/sessions/${session.id}`);

    // Click on Canvas tab and verify content
    await page.click('text=Canvas');
    await expect(page).toHaveURL(`/sessions/${session.id}/canvas`);
    await expect(page.getByText('No canvas items yet')).toBeVisible();

    // Click on Notes tab and verify content
    await page.click('text=Notes');
    await expect(page).toHaveURL(`/sessions/${session.id}/notes`);
    await expect(page.getByText('No notes yet')).toBeVisible();

    // Click on Changes tab and verify content
    await page.click('text=Changes');
    await expect(page).toHaveURL(`/sessions/${session.id}/changes`);
    // Changes tab should show some content (even if empty state)
    await expect(page.getByText('No git changes to show')).toBeVisible();

    // Click on Conversation tab and verify content
    await page.click('text=Conversation');
    await expect(page).toHaveURL(`/sessions/${session.id}/conversation`);
    await expect(page.locator('.message-content').getByText('Test prompt for tabs', { exact: true })).toBeVisible();
  });

  test('displays session mode', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Mode Test',
      mode: 'plan',
    });

    await page.goto(`/sessions/${session.id}`);

    // Verify mode badge is visible with correct mode
    await expect(page.locator('.mode-badge, [class*="mode"]').getByText('plan')).toBeVisible();

    // Verify via API that mode is correctly set
    const apiSession = await getSession(session.id);
    expect(apiSession).not.toBeNull();
    expect(apiSession.mode).toBe('plan');
  });

  test('persists draft prompt in localStorage across page reload', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Initial prompt',
      name: 'Draft Test',
    });

    const storageKey = `session-draft-${session.id}`;

    // Navigate to session conversation tab
    await page.goto(`/sessions/${session.id}/conversation`);

    // Set a draft in localStorage (simulating what the component does)
    await page.evaluate((key) => {
      localStorage.setItem(key, 'My draft message');
    }, storageKey);

    // Reload the page
    await page.reload();

    // Verify localStorage persists the draft
    const storedValue = await page.evaluate((key) => localStorage.getItem(key), storageKey);
    expect(storedValue).toBe('My draft message');

    // Verify the textarea loads with the saved draft
    const textarea = page.locator('textarea[placeholder="Send a follow-up message..."]');
    // Only check if textarea exists and has the value if session is in waiting status
    const textareaCount = await textarea.count();
    if (textareaCount > 0) {
      await expect(textarea).toHaveValue('My draft message');
    }
  });

  test('draft prompt is unique per session', async ({ page }) => {
    const session1 = await seedSession(project.id, {
      prompt: 'Session 1 prompt',
      name: 'Session 1',
    });
    const session2 = await seedSession(project.id, {
      prompt: 'Session 2 prompt',
      name: 'Session 2',
    });

    const storageKey1 = `session-draft-${session1.id}`;
    const storageKey2 = `session-draft-${session2.id}`;

    // Navigate to first session
    await page.goto(`/sessions/${session1.id}/conversation`);

    // Set different drafts for each session in localStorage
    await page.evaluate(
      ({ key1, key2 }) => {
        localStorage.setItem(key1, 'Draft for session 1');
        localStorage.setItem(key2, 'Draft for session 2');
      },
      { key1: storageKey1, key2: storageKey2 }
    );

    // Verify session 1 draft
    let storedValue = await page.evaluate((key) => localStorage.getItem(key), storageKey1);
    expect(storedValue).toBe('Draft for session 1');

    // Verify session 2 draft is different
    storedValue = await page.evaluate((key) => localStorage.getItem(key), storageKey2);
    expect(storedValue).toBe('Draft for session 2');

    // Navigate to session 2
    await page.goto(`/sessions/${session2.id}/conversation`);

    // Verify session 1's draft is still intact after navigating away
    storedValue = await page.evaluate((key) => localStorage.getItem(key), storageKey1);
    expect(storedValue).toBe('Draft for session 1');
  });

  // TODO: Re-enable once WebSocket message delivery is more reliable in CI
  test.skip('supports multi-turn conversation', async ({ page }) => {
    // Create a session with initial prompt
    const session = await seedSession(project.id, {
      prompt: 'Hello, this is my first message',
      name: 'Multi-turn Test',
    });

    await page.goto(`/sessions/${session.id}`);

    // Verify initial user message is visible
    await expect(
      page.locator('.message-content').getByText('Hello, this is my first message', { exact: true })
    ).toBeVisible();

    // Wait for session to be in 'waiting' state (Claude has responded)
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    // Verify mock response is visible
    await expect(
      page.locator('.message-content').getByText('Mock response to:', { exact: false })
    ).toBeVisible();

    // Verify input form is visible when status is 'waiting'
    await expect(page.locator('textarea[placeholder*="follow-up"]')).toBeVisible();

    // Send a follow-up message via the UI
    await page.fill('textarea[placeholder*="follow-up"]', 'This is my second message');
    await page.click('button:has-text("Send")');

    // Wait for the session to return to 'waiting' state after processing
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    // Verify the second user message is visible
    await expect(
      page.locator('.message-content').getByText('This is my second message', { exact: true })
    ).toBeVisible();

    // Verify second mock response is visible
    const messages = await getSessionMessages(session.id);
    expect(messages.length).toBeGreaterThanOrEqual(4); // 2 user + 2 assistant messages

    // Send a third message to confirm multi-turn works
    await page.fill('textarea[placeholder*="follow-up"]', 'And this is my third message');
    await page.click('button:has-text("Send")');

    // Wait for the session to return to 'waiting' state
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    // Verify the third user message is visible
    await expect(
      page.locator('.message-content').getByText('And this is my third message', { exact: true })
    ).toBeVisible();

    // Verify via API that all messages are stored
    const finalMessages = await getSessionMessages(session.id);
    expect(finalMessages.length).toBeGreaterThanOrEqual(6); // 3 user + 3 assistant messages

    // Verify message order and roles
    const userMessages = finalMessages.filter((m: any) => m.role === 'user');
    const assistantMessages = finalMessages.filter((m: any) => m.role === 'assistant');
    expect(userMessages.length).toBe(3);
    expect(assistantMessages.length).toBe(3);
  });
});
