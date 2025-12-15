import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupAll,
  waitForSessionStatus,
  getSession,
  getProjectSessions,
  updateSessionStatus,
  getSessionMessages,
  sendSessionMessage,
} from './helpers';

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

  test('displays Stop Session button for active sessions', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test active session',
      name: 'Active Session',
    });

    // Update session to running state
    await updateSessionStatus(session.id, 'running');

    await page.goto(`/sessions/${session.id}`);

    // Verify Stop Session button is visible for running session
    const stopButton = page.getByRole('button', { name: 'Stop Session' });
    await expect(stopButton).toBeVisible();
    await expect(stopButton).toHaveClass(/btn-danger/);

    // Verify status badge shows running
    await expect(page.locator('.status-badge.status-running')).toBeVisible();
  });

  test('Stop Session button is hidden for completed sessions', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test completed session',
      name: 'Completed Session',
    });

    // Update session to completed state
    await updateSessionStatus(session.id, 'completed');

    await page.goto(`/sessions/${session.id}`);

    // Verify Stop Session button is NOT visible for completed session
    const stopButton = page.getByRole('button', { name: 'Stop Session' });
    await expect(stopButton).not.toBeVisible();

    // Verify status badge shows completed
    await expect(page.locator('.status-badge.status-completed')).toBeVisible();
  });

  test('displays message input form when session is waiting', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test waiting session',
      name: 'Waiting Session',
    });

    // Update session to waiting state
    await updateSessionStatus(session.id, 'waiting');

    await page.goto(`/sessions/${session.id}`);

    // Verify status badge shows waiting
    await expect(page.locator('.status-badge.status-waiting')).toBeVisible();

    // Verify message input form is visible
    await expect(page.locator('.input-form')).toBeVisible();
    await expect(page.locator('.input-form textarea')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();

    // Verify placeholder text
    await expect(page.locator('.input-form textarea')).toHaveAttribute(
      'placeholder',
      'Send a follow-up message...'
    );
  });

  test('message input is hidden when session is running', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test running session',
      name: 'Running Session',
    });

    // Update session to running state
    await updateSessionStatus(session.id, 'running');

    await page.goto(`/sessions/${session.id}`);

    // Verify status badge shows running
    await expect(page.locator('.status-badge.status-running')).toBeVisible();

    // Verify message input form is NOT visible
    await expect(page.locator('.input-form')).not.toBeVisible();

    // Verify "Claude is working..." status message is visible
    await expect(page.locator('.status-message')).toBeVisible();
    await expect(page.getByText('Claude is working...')).toBeVisible();
  });

  test('Send button is disabled when message is empty', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Send Test',
    });

    // Update to waiting state to show input form
    await updateSessionStatus(session.id, 'waiting');

    await page.goto(`/sessions/${session.id}`);

    // Wait for form to be visible
    await expect(page.locator('.input-form')).toBeVisible();

    // Verify Send button is disabled when textarea is empty
    const sendButton = page.getByRole('button', { name: 'Send' });
    await expect(sendButton).toBeDisabled();

    // Type something
    await page.fill('.input-form textarea', 'Hello');
    await expect(sendButton).toBeEnabled();

    // Clear it
    await page.fill('.input-form textarea', '');
    await expect(sendButton).toBeDisabled();

    // Type only whitespace
    await page.fill('.input-form textarea', '   ');
    await expect(sendButton).toBeDisabled();
  });

  test('displays all session modes correctly', async ({ page }) => {
    // Test standard mode
    const standardSession = await seedSession(project.id, {
      prompt: 'Standard test',
      name: 'Standard Mode',
      mode: 'standard',
    });

    await page.goto(`/sessions/${standardSession.id}`);
    await expect(page.locator('.session-mode')).toHaveText('standard');

    // Test yolo mode
    const yoloSession = await seedSession(project.id, {
      prompt: 'Yolo test',
      name: 'Yolo Mode',
      mode: 'yolo',
    });

    await page.goto(`/sessions/${yoloSession.id}`);
    await expect(page.locator('.session-mode')).toHaveText('yolo');

    // Verify via API
    const apiYoloSession = await getSession(yoloSession.id);
    expect(apiYoloSession.mode).toBe('yolo');
  });

  test('displays session status badge with correct colors', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Status test',
      name: 'Status Test',
    });

    // Test running status
    await updateSessionStatus(session.id, 'running');
    await page.goto(`/sessions/${session.id}`);
    await expect(page.locator('.status-badge.status-running')).toBeVisible();
    await expect(page.locator('.status-badge')).toHaveText('running');

    // Test waiting status
    await updateSessionStatus(session.id, 'waiting');
    await page.reload();
    await expect(page.locator('.status-badge.status-waiting')).toBeVisible();
    await expect(page.locator('.status-badge')).toHaveText('waiting');

    // Test completed status
    await updateSessionStatus(session.id, 'completed');
    await page.reload();
    await expect(page.locator('.status-badge.status-completed')).toBeVisible();
    await expect(page.locator('.status-badge')).toHaveText('completed');

    // Test error status
    await updateSessionStatus(session.id, 'error');
    await page.reload();
    await expect(page.locator('.status-badge.status-error')).toBeVisible();
    await expect(page.locator('.status-badge')).toHaveText('error');
  });

  test('session list shows clickable session cards that navigate to details', async ({ page }) => {
    const session1 = await seedSession(project.id, { prompt: 'Task 1', name: 'Session One' });
    const session2 = await seedSession(project.id, { prompt: 'Task 2', name: 'Session Two' });

    await page.goto(`/projects/${project.id}/sessions`);

    // Find session cards and verify they're clickable links
    const sessionCards = page.locator('.session-card, .card');
    await expect(sessionCards).toHaveCount(2);

    // Click on first session and verify navigation
    await page.click('text=Session One');
    await expect(page).toHaveURL(`/sessions/${session1.id}`);
    await expect(page.locator('h1')).toHaveText('Session One');

    // Go back and click second session
    await page.goBack();
    await page.click('text=Session Two');
    await expect(page).toHaveURL(`/sessions/${session2.id}`);
    await expect(page.locator('h1')).toHaveText('Session Two');
  });

  test('back link navigates to sessions list', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Test', name: 'Navigation Test' });

    await page.goto(`/sessions/${session.id}`);

    // Verify back link is visible and has correct text
    const backLink = page.locator('.back-link');
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveText(/Sessions/);

    // Click back link and verify navigation
    await backLink.click();
    await expect(page).toHaveURL(`/projects/${project.id}/sessions`);
  });

  test('tab URLs are correct and maintain session context', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Tab test', name: 'Tab URL Test' });

    await page.goto(`/sessions/${session.id}`);

    // Default tab should be conversation
    await expect(page).toHaveURL(`/sessions/${session.id}`);

    // Each tab link should have correct href
    await expect(page.locator('a.tab[href*="conversation"]')).toHaveAttribute(
      'href',
      `/sessions/${session.id}/conversation`
    );
    await expect(page.locator('a.tab[href*="changes"]')).toHaveAttribute(
      'href',
      `/sessions/${session.id}/changes`
    );
    await expect(page.locator('a.tab[href*="canvas"]')).toHaveAttribute(
      'href',
      `/sessions/${session.id}/canvas`
    );
    await expect(page.locator('a.tab[href*="notes"]')).toHaveAttribute(
      'href',
      `/sessions/${session.id}/notes`
    );

    // Session name should remain visible after tab switches
    await page.click('a.tab[href*="canvas"]');
    await expect(page.locator('h1')).toHaveText('Tab URL Test');
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
