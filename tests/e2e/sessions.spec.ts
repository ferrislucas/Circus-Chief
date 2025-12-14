import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupAll,
  waitForSessionStatus,
  getSession,
  getProjectSessions,
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
});
