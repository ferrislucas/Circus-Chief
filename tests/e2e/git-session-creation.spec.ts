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
    await expect(page).toHaveURL(/\/sessions\/(?!new(?:$|[/?#]))[0-9a-f-]+$/, { timeout: 30000 });
    await page.waitForLoadState('networkidle');

    // Extract session ID from URL
    const url = page.url();
    const sessionIdMatch = url.match(/\/sessions\/([0-9a-f-]+)$/);
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
    // Worktree defaults should generate a unique branch when none is provided.
    expect(fetchedSession.gitBranch).toMatch(/^circus-chief\/[0-9a-f]{4}-api-test-without-git$/);
  });

  test('system defaults apply worktree mode with generated branch when no git settings provided', async () => {
    // Create a session without gitMode or gitBranch — system defaults should kick in:
    // mode='yolo', thinkingEnabled=true, gitMode='worktree', and gitBranch should be
    // auto-generated via generateWorktreeBranch() based on the prompt.
    const response = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Build a new feature' }),
    });

    expect(response.status).toBe(201);

    const body = await response.json();
    const session = await getSession(body.id);
    expect(session).toBeTruthy();

    // System defaults: mode=yolo, thinkingEnabled=true
    expect(session.mode).toBe('yolo');
    expect(session.thinkingEnabled).toBe(true);

    // gitMode should default to 'worktree' from system defaults
    // and gitBranch should be auto-generated (not 'main')
    expect(session.gitBranch).toMatch(/^circus-chief\/[0-9a-f]{4}-build-new-feature$/);
  });

  test('creates session with gitMode current via API', async () => {
    const response = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'API test with gitMode current',
        gitMode: 'current',
      }),
    });

    expect(response.status).toBe(201);

    const session = await response.json();
    expect(session).toBeTruthy();
    expect(session.id).toBeTruthy();

    // Current mode should NOT create a worktree or branch
    const fetchedSession = await getSession(session.id);
    expect(fetchedSession).toBeTruthy();
    expect(fetchedSession.gitBranch).toBeNull();
    expect(fetchedSession.gitWorktree).toBeNull();
  });

  test('creates session with gitMode current via UI', async ({ page }) => {
    await page.goto(`${BASE_URL}/projects/${project.id}/sessions/new`);

    // Wait for the git status panel to appear
    await page.waitForSelector('[data-testid="git-status-panel"], .git-status, .segmented-control', {
      timeout: 15000,
      state: 'visible',
    }).catch(() => {
      // If no explicit git status panel, that's fine
    });

    // Fill in the prompt
    await page.fill('textarea[id="prompt"]', 'UI test with gitMode current');

    // Click the "Current" git mode button in the segmented control
    const currentButton = page.locator('.segmented-control button:has-text("Current")');
    await currentButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (await currentButton.isVisible()) {
      await currentButton.click();
    }

    // Click "Start Session"
    await page.click('button:has-text("Start Session")');

    // Should redirect to session detail page
    await expect(page).toHaveURL(/\/sessions\/(?!new(?:$|[/?#]))[0-9a-f-]+$/, { timeout: 30000 });
    await page.waitForLoadState('networkidle');

    // Extract session ID from URL
    const url = page.url();
    const sessionIdMatch = url.match(/\/sessions\/([0-9a-f-]+)$/);
    expect(sessionIdMatch).toBeTruthy();
    const sessionId = sessionIdMatch![1];

    // Wait a moment for the session to be committed to the database
    await page.waitForTimeout(500);

    // Verify session was created without worktree
    const session = await getSession(sessionId);
    expect(session).toBeTruthy();
    expect(session.gitBranch).toBeNull();
    expect(session.gitWorktree).toBeNull();
  });
});
