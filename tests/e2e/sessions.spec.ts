import { test, expect } from '@playwright/test';
import { seedProject, seedSession, cleanupAll, waitForSessionStatus } from './helpers';

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

    // Should redirect to session detail
    await expect(page).toHaveURL(/\/sessions\/.*$/);
  });

  test('displays session list', async ({ page }) => {
    await seedSession(project.id, { prompt: 'First task', name: 'Session 1' });
    await seedSession(project.id, { prompt: 'Second task', name: 'Session 2' });

    await page.goto(`/projects/${project.id}/sessions`);

    await expect(page.getByText('Session 1')).toBeVisible();
    await expect(page.getByText('Session 2')).toBeVisible();
  });

  test('can view session details', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Test prompt', name: 'Test Session' });

    await page.goto(`/sessions/${session.id}`);

    await expect(page.getByText('Test Session')).toBeVisible();
    await expect(page.getByText('Conversation')).toBeVisible();
    await expect(page.getByText('Changes')).toBeVisible();
    await expect(page.getByText('Canvas')).toBeVisible();
    await expect(page.getByText('Notes')).toBeVisible();
  });

  test('displays session messages', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Hello Claude', name: 'Chat Session' });

    await page.goto(`/sessions/${session.id}`);

    // The initial user message should be visible
    await expect(page.getByText('Hello Claude')).toBeVisible();
  });

  test('can switch between tabs', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Test', name: 'Tab Test' });

    await page.goto(`/sessions/${session.id}`);

    // Click on Canvas tab
    await page.click('text=Canvas');
    await expect(page).toHaveURL(`/sessions/${session.id}/canvas`);

    // Click on Notes tab
    await page.click('text=Notes');
    await expect(page).toHaveURL(`/sessions/${session.id}/notes`);

    // Click on Changes tab
    await page.click('text=Changes');
    await expect(page).toHaveURL(`/sessions/${session.id}/changes`);

    // Click on Conversation tab
    await page.click('text=Conversation');
    await expect(page).toHaveURL(`/sessions/${session.id}/conversation`);
  });

  test('displays session mode', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Mode Test',
      mode: 'plan',
    });

    await page.goto(`/sessions/${session.id}`);
    await expect(page.getByText('plan')).toBeVisible();
  });
});
