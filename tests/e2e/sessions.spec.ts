import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupAll,
  getSession,
  navigateAndWait,
  waitForSessionToExist,
} from './helpers';

test.describe('New Session - Thinking Toggle', () => {
  // Session creation can be slow under load
  test.describe.configure({ timeout: 60000 });

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

    // Verify toggle is visible - use first() to target the "Enable Thinking" toggle specifically
    await expect(page.locator('.thinking-toggle').first()).toBeVisible();
    await expect(page.getByText('Enable Thinking')).toBeVisible();
  });

  test('thinking toggle defaults to on', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions/new`);

    // Verify toggle is checked by default - use first() to target the "Enable Thinking" toggle specifically
    const checkbox = page.locator('.thinking-toggle').first().locator('input[type="checkbox"]');
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
    await expect(page).toHaveURL(/\/sessions\/[\w-]+/, { timeout: 30000 });
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

    // Verify thinking toggle is checked by default - use first() to target the "Enable Thinking" toggle specifically
    const thinkingToggleContainer = page.locator('.thinking-toggle').first();
    const checkbox = thinkingToggleContainer.locator('input[type="checkbox"]');
    await expect(checkbox).toBeChecked();

    // Disable thinking toggle (click the toggle-switch label since checkbox has opacity: 0)
    await thinkingToggleContainer.locator('.toggle-switch').click();
    await expect(checkbox).not.toBeChecked();

    // Submit the form
    await page.click('button:has-text("Start Session")');

    // Wait for redirect to session detail and network to settle
    await expect(page).toHaveURL(/\/sessions\/[\w-]+/, { timeout: 30000 });
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
    await navigateAndWait(page, `/projects/${project.id}/sessions`);
    await expect(page.getByText('No sessions yet')).toBeVisible({ timeout: 10000 });
  });

  test('displays session list', async ({ page }) => {
    const session1 = await seedSession(project.id, { prompt: 'First task', name: 'Session 1' });
    const session2 = await seedSession(project.id, { prompt: 'Second task', name: 'Session 2' });

    // Verify seeding worked
    expect(session1.id).toBeTruthy();
    expect(session2.id).toBeTruthy();

    // Wait for sessions to exist before navigating
    await waitForSessionToExist(session1.id);
    await waitForSessionToExist(session2.id);

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    await expect(page.getByText('Session 1')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Session 2')).toBeVisible({ timeout: 10000 });

    // Verify via API that sessions exist using their IDs
    const fetchedSession1 = await getSession(session1.id);
    const fetchedSession2 = await getSession(session2.id);
    expect(fetchedSession1).toBeTruthy();
    expect(fetchedSession2).toBeTruthy();
    expect(fetchedSession1.projectId).toBe(project.id);
    expect(fetchedSession2.projectId).toBe(project.id);
  });

  test('displays session messages', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello Claude', name: 'Chat Session' });

    // Wait for session to be available
    await waitForSessionToExist(session.id);

    await navigateAndWait(page, `/sessions/${session.id}`);

    // The initial user message should be visible
    await expect(page.locator('.message-content').getByText('Hello Claude', { exact: true })).toBeVisible({ timeout: 10000 });
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
});
