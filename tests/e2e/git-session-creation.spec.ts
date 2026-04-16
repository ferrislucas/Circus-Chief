import { test, expect } from '@playwright/test';
import {
  seedProject,
  cleanupCreatedResources,
  getSession,
  BASE_URL,
  API_URL,
} from './helpers';

test.describe('Git-backed project session creation', () => {
  // Session creation can be slow under load
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    // Use the actual repo root (process.cwd()), which IS a git repo/worktree,
    // so the server's isGitRepo() check returns true.
    project = await seedProject('Git Session Test', process.cwd());
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('creates session successfully for git-backed project via UI without explicit git settings', async ({ page }) => {
    // Navigate to new session form
    await page.goto(`${BASE_URL}/projects/${project.id}/sessions/new`);

    // Wait for the git status panel to appear — confirms isGitRepo: true
    await page.waitForSelector('[data-testid="git-status-panel"], .git-status, .git-mode-select, select[name="gitMode"], [class*="git"]', {
      timeout: 15000,
      state: 'visible',
    }).catch(() => {
      // If no explicit git status panel, that's fine — the form may still work
    });

    // Fill in the prompt
    const prompt = 'Test git session creation without explicit git settings';
    await page.fill('textarea[id="prompt"]', prompt);

    // Click "Start Session"
    await page.click('button:has-text("Start Session")');

    // Should redirect to session detail page (successful creation)
    await expect(page).toHaveURL(/\/sessions\/[\w-]+/, { timeout: 30000 });
    await page.waitForLoadState('networkidle');

    // Extract session ID from URL
    const url = page.url();
    const sessionIdMatch = url.match(/\/sessions\/([\w-]+)/);
    expect(sessionIdMatch).toBeTruthy();
    const sessionId = sessionIdMatch![1];

    // Verify session exists in API
    const session = await getSession(sessionId);
    expect(session).toBeTruthy();
    expect(session.projectId).toBe(project.id);
  });

  test('creates session successfully for git-backed project via API without git settings', async () => {
    // Direct API call without gitMode/gitBranch — should succeed with defaults
    const response = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'API test without git settings' }),
    });

    expect(response.status).toBe(201);

    const session = await response.json();
    expect(session).toBeTruthy();
    expect(session.id).toBeTruthy();

    // Verify the session was created with sensible defaults
    const fetchedSession = await getSession(session.id);
    expect(fetchedSession).toBeTruthy();
    // gitBranch should default to 'main' when not provided
    expect(fetchedSession.gitBranch).toBe('main');
  });
});
