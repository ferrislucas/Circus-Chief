import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedProjectTemplate,
  seedGlobalTemplate,
  deleteTemplate,
  updateTemplate,
  cleanupCreatedResources,
  waitForPageReady,
  getAPIURL,
  openSessionOverlay,
} from './helpers';

const API_URL = getAPIURL();

const createdGlobalTemplateIds: string[] = [];

function trackGlobalTemplate(id: string) {
  createdGlobalTemplateIds.push(id);
}

async function cleanupTrackedGlobalTemplates() {
  while (createdGlobalTemplateIds.length > 0) {
    const id = createdGlobalTemplateIds.pop()!;
    try {
      await deleteTemplate(id);
    } catch {
      // Already deleted — ignore
    }
  }
}

async function seedQuickResponseTemplate(
  projectId: string,
  data: {
    label: string;
    content: string;
    autoSubmit?: boolean;
    sortOrder?: number;
    isGlobal?: boolean;
  }
) {
  const templateData = {
    name: data.label,
    prompt: data.content,
    showInQuickResponses: true,
    quickResponseAutoSubmit: data.autoSubmit ?? false,
    quickResponseSortOrder: data.sortOrder ?? 0,
  };

  if (data.isGlobal) {
    const template = await seedGlobalTemplate(templateData);
    trackGlobalTemplate(template.id);
    return template;
  }

  return seedProjectTemplate(projectId, templateData);
}

// ============================================================
// Helper: Navigate to session detail conversation view and expand panel.
// Wait for the store to finish loading templates before returning.
// ============================================================
async function navigateToSessionAndExpandPanel(page, sessionId: string) {
  // Set up the templates API response listener BEFORE navigating.
  // The templates fetch happens late in the page lifecycle:
  //   1. SessionDetailView.initializeSession() fetches session + conversations
  //   2. Vue re-renders, ConversationTab mounts
  //   3. ConversationTab.onMounted fires fetchProjectTemplates() (without await)
  // We need to catch the templates response whenever it arrives.
  const apiDone = page.waitForResponse(
    (resp) => resp.url().includes('/templates') && resp.status() === 200,
    { timeout: 30000 }
  );

  await page.goto(`/sessions/${sessionId}/summary`);
  await openSessionOverlay(page);

  // Wait for the templates API call to complete.
  await apiDone;

  // Wait for the panel to render.
  const panel = page.locator('.quick-responses-panel');
  await expect(panel).toBeVisible({ timeout: 10000 });

  // Click on the panel to expand it.
  await panel.click();

  // Wait for responses content or empty state to appear.
  // Scope to within the panel to avoid matching other components' .empty-state
  await expect(
    panel.locator('.responses-content, .empty-state')
  ).toBeVisible({ timeout: 5000 });
}

// ============================================================
// Setup / Teardown
// ============================================================

test.beforeEach(async () => {
  await cleanupCreatedResources();
  await cleanupTrackedGlobalTemplates();
});

test.afterEach(async () => {
  await cleanupCreatedResources();
  await cleanupTrackedGlobalTemplates();
});

// ============================================================
// Category 2: Quick Response Panel in Conversation View (6 tests)
// ============================================================

test.describe('Category 2: Quick Response Panel in Conversation View', () => {
  test('panel displays project and global responses with correct styling', async ({ page }) => {
    const project = await seedProject('QR Panel Styling', '/tmp/qr-panel-1');
    await seedQuickResponseTemplate(project.id, { label: 'Project Response', content: 'Project content' });
    await seedQuickResponseTemplate(project.id, { label: 'Global Response', content: 'Global content', isGlobal: true });

    const session = await seedSession(project.id, { prompt: 'Test prompt', startImmediately: false });
    await navigateToSessionAndExpandPanel(page, session.id);

    // Verify project responses have .project-response class (cyan)
    // Use text-based matching for robustness
    const projectBtn = page.locator('.response-button.project-response', { hasText: 'Project Response' });
    await expect(projectBtn).toBeVisible({ timeout: 10000 });

    // Verify global responses have .global-response class (gray)
    const globalBtn = page.locator('.response-button.global-response', { hasText: 'Global Response' });
    await expect(globalBtn).toBeVisible({ timeout: 10000 });
  });

  test('clicking a response inserts content into textarea', async ({ page }) => {
    const project = await seedProject('QR Panel Insert', '/tmp/qr-panel-2');
    await seedQuickResponseTemplate(project.id, { label: 'Insert Me', content: 'Inserted content here' });

    const session = await seedSession(project.id, { prompt: 'Test prompt', startImmediately: false });
    await navigateToSessionAndExpandPanel(page, session.id);

    await page.locator('.auto-submit-toggle input[type="checkbox"]').uncheck();

    // Click the response chip
    const responseBtn = page.locator('.response-button', { hasText: 'Insert Me' });
    await responseBtn.click();

    // Verify textarea contains the response content
    // The textarea may already contain the session prompt ("Test prompt"),
    // so the quick response content is appended after it.
    const textarea = page.locator('textarea').first();
    await expect(textarea).toHaveValue(/Inserted content here/, { timeout: 5000 });

    // Verify panel auto-collapses (responses-content should not be visible)
    await expect(page.locator('.responses-content')).not.toBeVisible({ timeout: 3000 });
  });

  test('panel auto-submit checkbox controls old template auto-submit values', async ({ page }) => {
    const project = await seedProject('QR Panel AutoSubmit', '/tmp/qr-panel-3');
    await seedQuickResponseTemplate(project.id, {
      label: 'Auto Response',
      content: 'Auto content',
      autoSubmit: true,
    });

    const session = await seedSession(project.id, { prompt: 'Test prompt', startImmediately: false });
    await navigateToSessionAndExpandPanel(page, session.id);

    const checkbox = page.locator('.auto-submit-toggle input[type="checkbox"]');
    await expect(checkbox).toBeVisible({ timeout: 5000 });
    await expect(checkbox).toBeChecked();

    const autoBtn = page.locator('.response-button', { hasText: 'Auto Response' });
    await expect(autoBtn).toBeVisible({ timeout: 5000 });
    await expect(autoBtn).not.toHaveClass(/auto-submit/);
    await expect(autoBtn.locator('.auto-icon')).toHaveCount(0);

    await checkbox.uncheck();
    await expect(page.locator('.responses-content')).toBeVisible();
    await expect(checkbox).not.toBeChecked();
  });

  test('panel collapse and expand toggle works', async ({ page }) => {
    const project = await seedProject('QR Panel Toggle', '/tmp/qr-panel-5');
    await seedQuickResponseTemplate(project.id, { label: 'Toggle Test', content: 'Toggle content' });

    const session = await seedSession(project.id, { prompt: 'Test prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}/summary`);
    await waitForPageReady(page);
    await openSessionOverlay(page);

    const panel = page.locator('.quick-responses-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });

    // Verify panel starts collapsed (responses-content not visible)
    await expect(page.locator('.responses-content')).not.toBeVisible();

    // Click to expand
    await panel.click();
    await expect(page.locator('.responses-content')).toBeVisible({ timeout: 3000 });

    // Click to collapse
    await panel.click();
    await expect(page.locator('.responses-content')).not.toBeVisible({ timeout: 3000 });
  });

  test('settings gear opens template list from conversation view', async ({ page }) => {
    const project = await seedProject('QR Panel Settings', '/tmp/qr-panel-6');
    await seedQuickResponseTemplate(project.id, { label: 'Gear Test', content: 'Gear content' });

    const session = await seedSession(project.id, { prompt: 'Test prompt', startImmediately: false });
    await navigateToSessionAndExpandPanel(page, session.id);

    // Click the settings gear button
    const settingsBtn = page.locator('button[aria-label="Manage templates"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/templates`), { timeout: 5000 });
  });

  test('template list is reachable from session overlay', async ({ page }) => {
    const project = await seedProject('QR Overlay Interact', '/tmp/qr-overlay-interact');
    await seedQuickResponseTemplate(project.id, { label: 'Interact Test', content: 'Test content' });

    const session = await seedSession(project.id, { prompt: 'Test prompt', startImmediately: false });
    await navigateToSessionAndExpandPanel(page, session.id);

    // Click the settings gear button
    const settingsBtn = page.locator('button[aria-label="Manage templates"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/templates`), { timeout: 5000 });
  });
});

// ============================================================
// Category 3: Quick Response Panel in New Session View (4 tests)
// ============================================================

test.describe('Category 3: Quick Response Panel in New Session View', () => {
  test('panel displays responses in new session view', async ({ page }) => {
    const project = await seedProject('QR NewSession Display', '/tmp/qr-new-1');
    await seedQuickResponseTemplate(project.id, { label: 'New Session QR', content: 'New session content' });

    await page.goto(`/projects/${project.id}/sessions/new`);
    await waitForPageReady(page);

    // Expand the panel
    const panel = page.locator('.quick-responses-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });
    await panel.click();
    await page.waitForTimeout(300);

    // Verify response chip is visible with correct label
    const responseBtn = page.locator('.response-button', { hasText: 'New Session QR' });
    await expect(responseBtn).toBeVisible({ timeout: 5000 });
  });

  test('clicking response inserts content into prompt textarea', async ({ page }) => {
    const project = await seedProject('QR NewSession Insert', '/tmp/qr-new-2');
    await seedQuickResponseTemplate(project.id, { label: 'Insert Prompt', content: 'Prompt content here' });

    await page.goto(`/projects/${project.id}/sessions/new`);
    await waitForPageReady(page);

    // Expand and click response
    const panel = page.locator('.quick-responses-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });
    await panel.click();
    await page.waitForTimeout(300);

    await page.locator('.auto-submit-toggle input[type="checkbox"]').uncheck();
    await page.locator('.response-button', { hasText: 'Insert Prompt' }).click();

    // Verify prompt textarea contains the content
    const textarea = page.locator('textarea#prompt');
    await expect(textarea).toHaveValue('Prompt content here', { timeout: 5000 });
  });

  test('auto-submit response triggers form submission in new session', async ({ page }) => {
    const project = await seedProject('QR NewSession AutoSubmit', '/tmp/qr-new-3');
    await seedQuickResponseTemplate(project.id, {
      label: 'Auto Create',
      content: 'Auto-create this session',
      autoSubmit: false,
    });

    await page.goto(`/projects/${project.id}/sessions/new`);
    await waitForPageReady(page);

    // Expand and click response. Auto-submit is checked by default.
    const panel = page.locator('.quick-responses-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });
    await panel.click();
    await page.waitForTimeout(300);

    await page.locator('.response-button', { hasText: 'Auto Create' }).click();

    // Auto-submit should trigger form submission, which navigates away
    await expect(page).not.toHaveURL(/\/sessions\/new/, { timeout: 10000 });
  });

  test('unchecked panel inserts without submitting even when old template auto-submit is true', async ({ page }) => {
    const project = await seedProject('QR NewSession OldAutoNoSubmit', '/tmp/qr-new-old-auto');
    await seedQuickResponseTemplate(project.id, {
      label: 'Old Auto',
      content: 'Old auto content',
      autoSubmit: true,
    });

    await page.goto(`/projects/${project.id}/sessions/new`);
    await waitForPageReady(page);

    const panel = page.locator('.quick-responses-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });
    await panel.click();
    await page.waitForTimeout(300);

    const checkbox = page.locator('.auto-submit-toggle input[type="checkbox"]');
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await page.locator('.response-button', { hasText: 'Old Auto' }).click();

    const textarea = page.locator('textarea#prompt');
    await expect(textarea).toHaveValue('Old auto content', { timeout: 5000 });
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/sessions/new`));
  });

  test('settings gear opens template list from new session view', async ({ page }) => {
    const project = await seedProject('QR NewSession Settings', '/tmp/qr-new-settings');
    await seedQuickResponseTemplate(project.id, { label: 'Settings Test', content: 'Settings content' });

    const apiDone = page.waitForResponse(
      (resp) => resp.url().includes('/templates') && resp.status() === 200,
      { timeout: 30000 }
    );

    await page.goto(`/projects/${project.id}/sessions/new`);
    await apiDone;

    // Expand the panel
    const panel = page.locator('.quick-responses-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });
    await panel.click();

    await expect(
      page.locator('.responses-content, .empty-state')
    ).toBeVisible({ timeout: 5000 });

    // Click the settings gear button
    const settingsBtn = page.locator('button[aria-label="Manage templates"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/templates`), { timeout: 5000 });
  });
});

// ============================================================
// Category 4: Scope Isolation (3 tests)
// ============================================================

test.describe('Category 4: Scope Isolation', () => {
  test('project-scoped response only appears in its own project', async ({ page }) => {
    const projectA = await seedProject('QR Scope A', '/tmp/qr-scope-a');
    const projectB = await seedProject('QR Scope B', '/tmp/qr-scope-b');

    await seedQuickResponseTemplate(projectA.id, { label: 'Only In A', content: 'Project A content' });

    const sessionA = await seedSession(projectA.id, { prompt: 'Test A', startImmediately: false });
    const sessionB = await seedSession(projectB.id, { prompt: 'Test B', startImmediately: false });

    // Navigate to project B session — response should NOT be visible
    await navigateToSessionAndExpandPanel(page, sessionB.id);
    await expect(page.locator('.response-button', { hasText: 'Only In A' })).not.toBeVisible({ timeout: 3000 });

    // Navigate to project A session — response should be visible
    await navigateToSessionAndExpandPanel(page, sessionA.id);
    await expect(page.locator('.response-button', { hasText: 'Only In A' })).toBeVisible({ timeout: 5000 });
  });

  test('global response appears in all projects', async ({ page }) => {
    const projectA = await seedProject('QR Global A', '/tmp/qr-global-a');
    const projectB = await seedProject('QR Global B', '/tmp/qr-global-b');

    const globalTemplate = await seedQuickResponseTemplate(projectA.id, {
      label: 'Everywhere',
      content: 'Global content',
      isGlobal: true,
    });
    expect(globalTemplate.projectId).toBeNull();

    const sessionA = await seedSession(projectA.id, { prompt: 'Test A', startImmediately: false });
    const sessionB = await seedSession(projectB.id, { prompt: 'Test B', startImmediately: false });

    for (const session of [sessionA, sessionB]) {
      await navigateToSessionAndExpandPanel(page, session.id);
      await expect(page.locator('.response-button.global-response', { hasText: 'Everywhere' }))
        .toBeVisible({ timeout: 10000 });
    }
  });

  test('templates API returns both project and global quick response templates together', async () => {
    const project = await seedProject('QR API Combined', '/tmp/qr-api-combined');

    await seedQuickResponseTemplate(project.id, { label: 'ProjResp1', content: 'Content 1' });
    await seedQuickResponseTemplate(project.id, { label: 'ProjResp2', content: 'Content 2' });
    await seedQuickResponseTemplate(project.id, {
      label: 'GlobalResp1',
      content: 'Global Content 1',
      isGlobal: true,
    });

    const response = await fetch(`${API_URL}/api/projects/${project.id}/templates`);
    expect(response.ok).toBe(true);
    const templates = await response.json();

    expect(templates.project.filter((t: any) => t.showInQuickResponses)).toHaveLength(2);
    expect(templates.project.map((t: any) => t.name)).toEqual(
      expect.arrayContaining(['ProjResp1', 'ProjResp2'])
    );

    const globalLabels = templates.global
      .filter((t: any) => t.showInQuickResponses)
      .map((t: any) => t.name);
    expect(globalLabels).toContain('GlobalResp1');
  });
});

// ============================================================
// Category 5: Sort Ordering and Reordering (3 tests)
// ============================================================

test.describe('Category 5: Sort Ordering and Reordering', () => {
  test('responses display in sort order', async ({ page }) => {
    const project = await seedProject('QR Sort Display', '/tmp/qr-sort-1');

    // Seed 3 responses with explicit sort orders (not in display order)
    await seedQuickResponseTemplate(project.id, { label: 'Third', content: 'C', sortOrder: 2 });
    await seedQuickResponseTemplate(project.id, { label: 'First', content: 'A', sortOrder: 0 });
    await seedQuickResponseTemplate(project.id, { label: 'Second', content: 'B', sortOrder: 1 });

    const session = await seedSession(project.id, { prompt: 'Test sort', startImmediately: false });
    await navigateToSessionAndExpandPanel(page, session.id);

    // Get all project response buttons and verify order
    const buttons = page.locator('.project-response .button-label');
    await expect(buttons).toHaveCount(3, { timeout: 5000 });

    const labels = await buttons.allTextContents();
    expect(labels).toEqual(['First', 'Second', 'Third']);
  });

  test('template API updates response order', async () => {
    const project = await seedProject('QR Reorder API', '/tmp/qr-sort-2');

    const r1 = await seedQuickResponseTemplate(project.id, { label: 'Alpha', content: 'A', sortOrder: 0 });
    const r2 = await seedQuickResponseTemplate(project.id, { label: 'Beta', content: 'B', sortOrder: 1 });
    const r3 = await seedQuickResponseTemplate(project.id, { label: 'Gamma', content: 'C', sortOrder: 2 });

    await updateTemplate(r1.id, { quickResponseSortOrder: 2 });
    await updateTemplate(r2.id, { quickResponseSortOrder: 1 });
    await updateTemplate(r3.id, { quickResponseSortOrder: 0 });

    const response = await fetch(`${API_URL}/api/projects/${project.id}/templates`);
    expect(response.ok).toBe(true);
    const templates = await response.json();
    const labels = templates.project
      .filter((t: any) => t.showInQuickResponses)
      .sort((a: any, b: any) => a.quickResponseSortOrder - b.quickResponseSortOrder)
      .map((t: any) => t.name);
    expect(labels).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  test('reordered responses display in new order in panel', async ({ page }) => {
    const project = await seedProject('QR Reorder Panel', '/tmp/qr-sort-3');

    const r1 = await seedQuickResponseTemplate(project.id, { label: 'Uno', content: 'A', sortOrder: 0 });
    const r2 = await seedQuickResponseTemplate(project.id, { label: 'Dos', content: 'B', sortOrder: 1 });
    const r3 = await seedQuickResponseTemplate(project.id, { label: 'Tres', content: 'C', sortOrder: 2 });

    // Reverse order via template API
    await updateTemplate(r1.id, { quickResponseSortOrder: 2 });
    await updateTemplate(r2.id, { quickResponseSortOrder: 1 });
    await updateTemplate(r3.id, { quickResponseSortOrder: 0 });

    const session = await seedSession(project.id, { prompt: 'Test reorder', startImmediately: false });
    await navigateToSessionAndExpandPanel(page, session.id);

    // Verify the new order
    const buttons = page.locator('.project-response .button-label');
    await expect(buttons).toHaveCount(3, { timeout: 5000 });

    const labels = await buttons.allTextContents();
    expect(labels).toEqual(['Tres', 'Dos', 'Uno']);
  });
});
