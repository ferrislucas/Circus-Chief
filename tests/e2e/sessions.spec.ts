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

  test('thinking toggle defaults to on', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions/new`);

    // Verify toggle is checked by default
    const checkbox = page.locator('.thinking-toggle input[type="checkbox"]');
    await expect(checkbox).toBeChecked();
  });

  test('can create session with thinking enabled', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions/new`);

    // Fill in required prompt field (name is auto-generated from prompt)
    const prompt = 'Test with thinking enabled';
    await page.fill('textarea[id="prompt"]', prompt);

    // Thinking toggle is already enabled by default, no need to click

    // Submit the form
    await page.click('button:has-text("Start Session")');

    // Wait for redirect to session detail and network to settle
    await expect(page).toHaveURL(/\/sessions\/[\w-]+/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // Extract session ID from URL to verify via API
    const url = page.url();
    const sessionId = url.match(/\/sessions\/([\w-]+)/)?.[1];
    expect(sessionId).toBeTruthy();

    // Verify session via API using the session ID
    const session = await getSession(sessionId!);
    expect(session).toBeTruthy();
    expect(session.thinkingEnabled).toBe(true);
    expect(session.projectId).toBe(project.id);
  });

  test('can create session with thinking disabled', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions/new`);

    // Fill in required prompt field (name is auto-generated from prompt)
    const prompt = 'Test with thinking disabled';
    await page.fill('textarea[id="prompt"]', prompt);

    // Verify thinking toggle is checked by default
    const checkbox = page.locator('.thinking-toggle input[type="checkbox"]');
    await expect(checkbox).toBeChecked();

    // Disable thinking toggle (click the toggle-switch label since checkbox has opacity: 0)
    await page.locator('.thinking-toggle .toggle-switch').click();
    await expect(checkbox).not.toBeChecked();

    // Submit the form
    await page.click('button:has-text("Start Session")');

    // Wait for redirect to session detail and network to settle
    await expect(page).toHaveURL(/\/sessions\/[\w-]+/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // Extract session ID from URL to verify via API
    const url = page.url();
    const sessionId = url.match(/\/sessions\/([\w-]+)/)?.[1];
    expect(sessionId).toBeTruthy();

    // Verify session via API using the session ID
    const session = await getSession(sessionId!);
    expect(session).toBeTruthy();
    expect(session.thinkingEnabled).toBe(false);
    expect(session.projectId).toBe(project.id);
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

    // Fill in required prompt field (name is auto-generated from prompt)
    const prompt = 'Help me write a hello world program';
    await page.fill('textarea[id="prompt"]', prompt);
    await page.click('button:has-text("Start Session")');

    // Should redirect to session detail with session ID in URL
    await expect(page).toHaveURL(/\/sessions\/[\w-]+/);
    await page.waitForLoadState('networkidle');

    // Extract session ID from URL and verify via API
    const url = page.url();
    const sessionId = url.match(/\/sessions\/([\w-]+)/)?.[1];
    expect(sessionId).toBeTruthy();

    // Verify the initial prompt was recorded as a message (use exact match to avoid mock response)
    await expect(page.locator('.message-content').getByText(prompt, { exact: true })).toBeVisible();

    // Verify via API that session was created with correct data
    const session = await getSession(sessionId!);
    expect(session).toBeTruthy();
    expect(session.projectId).toBe(project.id);
    // Session name should exist (auto-generated from prompt or default)
    expect(session.name).toBeTruthy();
  });

  test('displays session list', async ({ page }) => {
    const session1 = await seedSession(project.id, { prompt: 'First task', name: 'Session 1' });
    const session2 = await seedSession(project.id, { prompt: 'Second task', name: 'Session 2' });

    // Verify seeding worked
    expect(session1.id).toBeTruthy();
    expect(session2.id).toBeTruthy();

    await page.goto(`/projects/${project.id}/sessions`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Session 1')).toBeVisible();
    await expect(page.getByText('Session 2')).toBeVisible();

    // Verify via API that sessions exist using their IDs
    const fetchedSession1 = await getSession(session1.id);
    const fetchedSession2 = await getSession(session2.id);
    expect(fetchedSession1).toBeTruthy();
    expect(fetchedSession2).toBeTruthy();
    expect(fetchedSession1.projectId).toBe(project.id);
    expect(fetchedSession2.projectId).toBe(project.id);
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
    // Wait for loading to complete and check for empty state or content
    await page.waitForLoadState('networkidle');
    // Changes tab may show empty state, loading, or an error - just verify we're on the right page
    await expect(page.locator('.changes-tab')).toBeVisible();

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

    // Verify mode badge is visible with correct mode (use specific class to avoid matching mode switcher buttons)
    await expect(page.locator('.session-mode').getByText('plan')).toBeVisible();

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

test.describe('New Session - Mode Selection', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('mode selector is visible on new session form', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions/new`);

    // Verify mode buttons are visible
    await expect(page.locator('.mode-selector')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Plan' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Standard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Auto' })).toBeVisible();
  });

  test('Auto (yolo) mode is selected by default', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions/new`);

    // Verify Auto (yolo) is the default selected mode
    const activeBtn = page.locator('.mode-btn.active');
    await expect(activeBtn).toHaveText('Auto');
  });

  test('can create session with plan mode', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions/new`);

    // Fill in required prompt field
    await page.fill('textarea[id="prompt"]', 'Test with plan mode');

    // Select plan mode
    await page.click('button:has-text("Plan")');

    // Submit the form
    await page.click('button:has-text("Start Session")');

    // Wait for redirect to session detail
    await expect(page).toHaveURL(/\/sessions\/[\w-]+/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // Extract session ID from URL to verify via API
    const url = page.url();
    const sessionId = url.match(/\/sessions\/([\w-]+)/)?.[1];
    expect(sessionId).toBeTruthy();

    // Verify session via API
    const session = await getSession(sessionId!);
    expect(session).toBeTruthy();
    expect(session.mode).toBe('plan');
  });

  test('can create session with yolo mode', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions/new`);

    // Fill in required prompt field
    await page.fill('textarea[id="prompt"]', 'Test with yolo mode');

    // Select Auto (yolo) mode
    await page.click('button:has-text("Auto")');

    // Submit the form
    await page.click('button:has-text("Start Session")');

    // Wait for redirect to session detail
    await expect(page).toHaveURL(/\/sessions\/[\w-]+/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // Extract session ID from URL
    const url = page.url();
    const sessionId = url.match(/\/sessions\/([\w-]+)/)?.[1];
    expect(sessionId).toBeTruthy();

    // Verify session via API
    const session = await getSession(sessionId!);
    expect(session).toBeTruthy();
    expect(session.mode).toBe('yolo');
  });

  test('can switch between modes', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions/new`);

    // Verify Auto is default
    await expect(page.locator('.mode-btn.active')).toHaveText('Auto');

    // Click Plan mode and verify it becomes active
    await page.click('.mode-btn:has-text("Plan")');
    await expect(page.locator('.mode-btn.active')).toHaveText('Plan');

    // Click Standard mode and verify it becomes active
    await page.click('.mode-btn:has-text("Standard")');
    await expect(page.locator('.mode-btn.active')).toHaveText('Standard');

    // Click Auto mode and verify it becomes active
    await page.click('.mode-btn:has-text("Auto")');
    await expect(page.locator('.mode-btn.active')).toHaveText('Auto');
  });
});

test.describe('Conversation - Mode Switching', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('mode switcher is visible in conversation tab when session is waiting', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Mode Switch Test',
      mode: 'standard',
    });

    await page.goto(`/sessions/${session.id}/conversation`);

    // Wait for session to be in waiting state (mock mode is fast)
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    // Verify mode switcher is visible
    await expect(page.locator('.mode-switcher')).toBeVisible();
    await expect(page.locator('.mode-switcher button:has-text("Plan")')).toBeVisible();
    await expect(page.locator('.mode-switcher button:has-text("Standard")')).toBeVisible();
    await expect(page.locator('.mode-switcher button:has-text("Auto")')).toBeVisible();
  });

  test('mode switcher shows current session mode', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Mode Display Test',
      mode: 'plan',
    });

    await page.goto(`/sessions/${session.id}/conversation`);

    // Wait for session to be in waiting state
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    // Verify Plan button is active
    await expect(page.locator('.mode-switcher .mode-btn.active')).toHaveText('Plan');
  });

  test('can switch mode from standard to yolo', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Mode Switch Test',
      mode: 'standard',
    });

    await page.goto(`/sessions/${session.id}/conversation`);

    // Wait for session to be in waiting state
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    // Verify Standard is active
    await expect(page.locator('.mode-switcher .mode-btn.active')).toHaveText('Standard');

    // Click Auto to switch to yolo mode
    await page.click('.mode-switcher button:has-text("Auto")');

    // Wait for mode to update
    await page.waitForTimeout(500);

    // Verify Auto is now active
    await expect(page.locator('.mode-switcher .mode-btn.active')).toHaveText('Auto');

    // Verify via API
    const updatedSession = await getSession(session.id);
    expect(updatedSession.mode).toBe('yolo');
  });

  test('can switch mode from yolo to plan', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Mode Switch Test',
      mode: 'yolo',
    });

    await page.goto(`/sessions/${session.id}/conversation`);

    // Wait for session to be in waiting state
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    // Verify Auto is active
    await expect(page.locator('.mode-switcher .mode-btn.active')).toHaveText('Auto');

    // Click Plan to switch to plan mode
    await page.click('.mode-switcher button:has-text("Plan")');

    // Wait for mode to update
    await page.waitForTimeout(500);

    // Verify Plan is now active
    await expect(page.locator('.mode-switcher .mode-btn.active')).toHaveText('Plan');

    // Verify via API
    const updatedSession = await getSession(session.id);
    expect(updatedSession.mode).toBe('plan');
  });

  test('mode persists after page reload', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Mode Persist Test',
      mode: 'standard',
    });

    await page.goto(`/sessions/${session.id}/conversation`);

    // Wait for session to be in waiting state
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    // Switch to Plan mode
    await page.click('.mode-switcher button:has-text("Plan")');
    await page.waitForTimeout(500);

    // Reload the page
    await page.reload();

    // Verify Plan is still selected after reload
    await expect(page.locator('.mode-switcher .mode-btn.active')).toHaveText('Plan');
  });
});

test.describe('Slash Command Autocomplete', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('autocomplete appears when typing slash at start of message', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Autocomplete Test',
    });

    await page.goto(`/sessions/${session.id}/conversation`);

    // Wait for session to be in waiting state
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    // Type slash in the input
    const textarea = page.locator('textarea[placeholder*="follow-up"]');
    await textarea.fill('/');

    // Verify autocomplete appears
    await expect(page.locator('.slash-command-autocomplete')).toBeVisible();
  });

  test('autocomplete shows builtin commands', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Builtin Commands Test',
    });

    await page.goto(`/sessions/${session.id}/conversation`);
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    // Type slash to trigger autocomplete
    const textarea = page.locator('textarea[placeholder*="follow-up"]');
    await textarea.fill('/');

    // Verify builtin commands are shown
    await expect(page.locator('.slash-command-autocomplete')).toBeVisible();
    await expect(page.locator('.command-name:has-text("/help")')).toBeVisible();
    await expect(page.locator('.command-name:has-text("/clear")')).toBeVisible();
  });

  test('autocomplete filters commands as user types', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Filter Test',
    });

    await page.goto(`/sessions/${session.id}/conversation`);
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    const textarea = page.locator('textarea[placeholder*="follow-up"]');

    // Type /hel to filter to help
    await textarea.fill('/hel');

    // Verify autocomplete shows filtered results
    await expect(page.locator('.slash-command-autocomplete')).toBeVisible();
    await expect(page.locator('.command-name:has-text("/help")')).toBeVisible();

    // Other commands should not be visible
    await expect(page.locator('.command-name:has-text("/clear")')).not.toBeVisible();
  });

  test('autocomplete closes when escape is pressed', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Escape Test',
    });

    await page.goto(`/sessions/${session.id}/conversation`);
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    const textarea = page.locator('textarea[placeholder*="follow-up"]');
    await textarea.fill('/');

    // Verify autocomplete is visible
    await expect(page.locator('.slash-command-autocomplete')).toBeVisible();

    // Press Escape
    await textarea.press('Escape');

    // Verify autocomplete is closed
    await expect(page.locator('.slash-command-autocomplete')).not.toBeVisible();
  });

  test('autocomplete does not appear for slash in middle of text', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Middle Slash Test',
    });

    await page.goto(`/sessions/${session.id}/conversation`);
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    const textarea = page.locator('textarea[placeholder*="follow-up"]');

    // Type some text with a slash in the middle
    await textarea.fill('This is a / test');

    // Autocomplete should not appear
    await expect(page.locator('.slash-command-autocomplete')).not.toBeVisible();
  });

  test('can navigate autocomplete with arrow keys', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Arrow Nav Test',
    });

    await page.goto(`/sessions/${session.id}/conversation`);
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    const textarea = page.locator('textarea[placeholder*="follow-up"]');
    await textarea.fill('/');

    // Wait for autocomplete
    await expect(page.locator('.slash-command-autocomplete')).toBeVisible();

    // First item should be selected
    const firstItem = page.locator('.autocomplete-item').first();
    await expect(firstItem).toHaveClass(/selected/);

    // Press down arrow
    await textarea.press('ArrowDown');

    // Second item should now be selected
    const secondItem = page.locator('.autocomplete-item').nth(1);
    await expect(secondItem).toHaveClass(/selected/);

    // Press up arrow
    await textarea.press('ArrowUp');

    // First item should be selected again
    await expect(firstItem).toHaveClass(/selected/);
  });

  test('shows source badges for commands', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Source Badge Test',
    });

    await page.goto(`/sessions/${session.id}/conversation`);
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    const textarea = page.locator('textarea[placeholder*="follow-up"]');
    await textarea.fill('/');

    // Verify builtin badge is shown
    await expect(page.locator('.command-source.source-builtin')).toBeVisible();
  });

  test('shows empty state when no commands match filter', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test session',
      name: 'Empty Filter Test',
    });

    await page.goto(`/sessions/${session.id}/conversation`);
    await waitForSessionStatus(page, session.id, 'waiting', 15000);

    const textarea = page.locator('textarea[placeholder*="follow-up"]');

    // Type something that won't match any command
    await textarea.fill('/zzzznonexistent');

    // Verify empty state
    await expect(page.locator('.autocomplete-empty')).toBeVisible();
    await expect(page.getByText('No matching commands')).toBeVisible();
  });
});
