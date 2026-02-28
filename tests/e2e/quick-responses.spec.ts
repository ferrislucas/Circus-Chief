import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedQuickResponse,
  getQuickResponses,
  deleteQuickResponse,
  reorderQuickResponses,
  cleanupCreatedResources,
  navigateAndWait,
  waitForPageReady,
  getAPIURL,
} from './helpers';

const API_URL = getAPIURL();

/**
 * Track global quick response IDs created by the current test.
 * We only delete OUR global QRs to avoid interfering with parallel tests.
 */
const createdGlobalQRIds: string[] = [];

function trackGlobalQR(id: string) {
  createdGlobalQRIds.push(id);
}

async function cleanupTrackedGlobalQRs() {
  while (createdGlobalQRIds.length > 0) {
    const id = createdGlobalQRIds.pop()!;
    try {
      await deleteQuickResponse(id);
    } catch {
      // Already deleted (e.g., by cascade or prior cleanup) — ignore
    }
  }
}

// ============================================================
// Helper: Open the Quick Response Settings modal from the Project Edit page.
// ============================================================
async function openSettingsModal(page, projectId: string) {
  await page.goto(`/projects/${projectId}/edit`);
  await waitForPageReady(page);

  // Expand the Quick Responses <details> section
  const details = page.locator('details').filter({ hasText: 'Quick Responses' });
  const summary = details.locator('summary');
  await summary.click();
  await page.waitForTimeout(300);

  // Click "Manage Quick Responses"
  await page.getByRole('button', { name: 'Manage Quick Responses' }).click();
  await page.waitForLoadState('networkidle');

  // Wait for settings panel to appear
  await expect(page.locator('.settings-panel[role="dialog"]')).toBeVisible({ timeout: 5000 });
}

// ============================================================
// Helper: Open the "+ Add" dialog for a given section (project or global).
// ============================================================
async function openAddDialog(page, section: 'project' | 'global') {
  const settingsPanel = page.locator('.settings-panel[role="dialog"]');
  const addButtons = settingsPanel.locator('.add-button');

  if (section === 'project') {
    await addButtons.first().click();
  } else {
    await addButtons.nth(1).click();
  }

  // Wait for the QR dialog to appear
  const dialog = page.locator('[role="dialog"]').filter({ has: page.locator('#qr-label') });
  await expect(dialog).toBeVisible({ timeout: 5000 });
  return dialog;
}

// ============================================================
// Helper: Navigate to session detail conversation view and expand panel.
// Wait for the store to finish loading quick responses before returning.
// ============================================================
async function navigateToSessionAndExpandPanel(page, sessionId: string) {
  // Set up the quick-responses API response listener BEFORE navigating.
  // The quick-responses fetch happens late in the page lifecycle:
  //   1. SessionDetailView.initializeSession() fetches session + conversations
  //   2. Vue re-renders, ConversationTab mounts
  //   3. ConversationTab.onMounted fires fetchForProject() (without await)
  // We need to catch the quick-responses response whenever it arrives.
  const apiDone = page.waitForResponse(
    (resp) => resp.url().includes('/quick-responses') && resp.status() === 200,
    { timeout: 30000 }
  );

  await page.goto(`/sessions/${sessionId}/conversation`);

  // Wait for the quick-responses API call to complete.
  await apiDone;

  // Wait for the panel to render.
  const panel = page.locator('.quick-responses-panel');
  await expect(panel).toBeVisible({ timeout: 10000 });

  // Click on the panel to expand it.
  await panel.click();

  // Wait for responses content or empty state to appear.
  await expect(
    page.locator('.responses-content, .empty-state')
  ).toBeVisible({ timeout: 5000 });
}

// ============================================================
// Setup / Teardown
// ============================================================

test.beforeEach(async () => {
  await cleanupCreatedResources();
  await cleanupTrackedGlobalQRs();
});

test.afterEach(async () => {
  await cleanupCreatedResources();
  await cleanupTrackedGlobalQRs();
});

// ============================================================
// Category 1: Quick Response CRUD via Settings Modal (6 tests)
// ============================================================

test.describe('Category 1: Quick Response CRUD via Settings Modal', () => {
  test('creates a project-scoped quick response via settings modal', async ({ page }) => {
    const project = await seedProject('QR CRUD Create Project', '/tmp/qr-crud-1');
    await openSettingsModal(page, project.id);

    // Click "+ Add" in project section
    const dialog = await openAddDialog(page, 'project');

    // Fill label and content
    await dialog.locator('#qr-label').fill('Approve PR');
    await dialog.locator('#qr-content').fill('Looks good to me, approved!');

    // Save
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Verify response appears in the settings list
    await expect(page.locator('.response-label', { hasText: 'Approve PR' })).toBeVisible({ timeout: 5000 });
  });

  test('creates a global quick response via settings modal', async ({ page }) => {
    const project = await seedProject('QR CRUD Create Global', '/tmp/qr-crud-2');
    await openSettingsModal(page, project.id);

    // Click "+ Add" in global section (second add button)
    const dialog = await openAddDialog(page, 'global');

    // Verify "Global (all projects)" radio is pre-selected by checking the label text
    const globalRadioLabel = dialog.locator('.radio-label').filter({ hasText: 'Global (all projects)' });
    const globalRadio = globalRadioLabel.locator('input[type="radio"]');
    await expect(globalRadio).toBeChecked();

    // Fill label and content
    await dialog.locator('#qr-label').fill('Global LGTM');
    await dialog.locator('#qr-content').fill('Looks good, ship it!');

    // Save
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Verify response appears in the global section
    const globalSection = page.locator('.section').filter({ hasText: 'Global Responses' });
    await expect(globalSection.locator('.response-label', { hasText: 'Global LGTM' })).toBeVisible({ timeout: 5000 });

    // Track the created global QR for cleanup (it was created via UI, not seedQuickResponse)
    const allGlobals = await getQuickResponses(project.id);
    const uiCreatedGlobal = allGlobals.global.find((r: any) => r.label === 'Global LGTM');
    if (uiCreatedGlobal) trackGlobalQR(uiCreatedGlobal.id);
  });

  test('edits an existing quick response', async ({ page }) => {
    const project = await seedProject('QR CRUD Edit', '/tmp/qr-crud-3');
    await seedQuickResponse(project.id, {
      label: 'Original Label',
      content: 'Original content',
    });

    await openSettingsModal(page, project.id);

    // Wait for the response to appear
    await expect(page.locator('.response-label', { hasText: 'Original Label' })).toBeVisible({ timeout: 5000 });

    // Click edit button
    await page.locator('button.action-button[title="Edit"]').first().click();

    // Verify edit dialog
    const dialog = page.locator('[role="dialog"]').filter({ has: page.locator('#qr-label') });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.locator('.dialog-title')).toContainText('Edit Quick Response');

    // Verify scope selection is NOT shown in edit mode
    await expect(dialog.locator('.radio-group')).not.toBeVisible();

    // Change label
    const labelInput = dialog.locator('#qr-label');
    await labelInput.clear();
    await labelInput.fill('Updated Label');

    // Save
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Verify updated label in list
    await expect(page.locator('.response-label', { hasText: 'Updated Label' })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.response-label', { hasText: 'Original Label' })).not.toBeVisible();
  });

  test('deletes a quick response with confirmation', async ({ page }) => {
    const project = await seedProject('QR CRUD Delete', '/tmp/qr-crud-4');
    await seedQuickResponse(project.id, {
      label: 'Delete Me',
      content: 'This will be deleted',
    });

    await openSettingsModal(page, project.id);

    // Wait for the response to appear
    await expect(page.locator('.response-label', { hasText: 'Delete Me' })).toBeVisible({ timeout: 5000 });

    // Click delete button
    await page.locator('button.action-button.action-danger[title="Delete"]').first().click();

    // Verify confirmation dialog appears
    const confirmDialog = page.locator('.confirm-dialog');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.confirm-message')).toContainText('Are you sure you want to delete');

    // Confirm delete
    await confirmDialog.locator('.btn-danger').click();

    // Verify response is removed
    await expect(confirmDialog).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.response-label', { hasText: 'Delete Me' })).not.toBeVisible({ timeout: 5000 });
  });

  test('creates a quick response with auto-submit enabled', async ({ page }) => {
    const project = await seedProject('QR CRUD AutoSubmit', '/tmp/qr-crud-5');
    await openSettingsModal(page, project.id);

    const dialog = await openAddDialog(page, 'project');

    // Fill label and content
    await dialog.locator('#qr-label').fill('Quick Send');
    await dialog.locator('#qr-content').fill('Auto-submitted response');

    // Check auto-submit
    await dialog.locator('input[type="checkbox"]').check();

    // Save
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Verify auto-submit badge is visible
    await expect(page.locator('.auto-badge')).toBeVisible({ timeout: 5000 });
  });

  test('creates a quick response with category', async ({ page }) => {
    const project = await seedProject('QR CRUD Category', '/tmp/qr-crud-6');
    await openSettingsModal(page, project.id);

    const dialog = await openAddDialog(page, 'project');

    // Fill label, content, and category
    await dialog.locator('#qr-label').fill('Run Tests');
    await dialog.locator('#qr-content').fill('Please run the test suite');
    await dialog.locator('#qr-category').fill('commands');

    // Save
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Verify response appears in the list
    await expect(page.locator('.response-label', { hasText: 'Run Tests' })).toBeVisible({ timeout: 5000 });

    // Verify category was saved via API
    const responses = await getQuickResponses(project.id);
    const created = responses.project.find((r: any) => r.label === 'Run Tests');
    expect(created).toBeTruthy();
    expect(created.category).toBe('commands');
  });
});

// ============================================================
// Category 2: Quick Response Panel in Conversation View (6 tests)
// ============================================================

test.describe('Category 2: Quick Response Panel in Conversation View', () => {
  test('panel displays project and global responses with correct styling', async ({ page }) => {
    const project = await seedProject('QR Panel Styling', '/tmp/qr-panel-1');
    await seedQuickResponse(project.id, { label: 'Project Response', content: 'Project content' });
    const globalQR1 = await seedQuickResponse(project.id, { label: 'Global Response', content: 'Global content', isGlobal: true });
    trackGlobalQR(globalQR1.id);

    // Verify via API that both responses are available before navigating
    const available = await getQuickResponses(project.id);
    expect(available.project.map((r: any) => r.label)).toContain('Project Response');
    expect(available.global.map((r: any) => r.label)).toContain('Global Response');

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
    await seedQuickResponse(project.id, { label: 'Insert Me', content: 'Inserted content here' });

    const session = await seedSession(project.id, { prompt: 'Test prompt', startImmediately: false });
    await navigateToSessionAndExpandPanel(page, session.id);

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

  test('auto-submit response shows lightning bolt indicator', async ({ page }) => {
    const project = await seedProject('QR Panel AutoSubmit', '/tmp/qr-panel-3');
    await seedQuickResponse(project.id, {
      label: 'Auto Response',
      content: 'Auto content',
      autoSubmit: true,
    });

    const session = await seedSession(project.id, { prompt: 'Test prompt', startImmediately: false });
    await navigateToSessionAndExpandPanel(page, session.id);

    // Verify the response button has .auto-submit class
    const autoBtn = page.locator('.response-button.auto-submit');
    await expect(autoBtn).toBeVisible({ timeout: 5000 });

    // Verify lightning bolt icon exists
    const autoIcon = autoBtn.locator('.auto-icon');
    await expect(autoIcon).toBeVisible();
  });

  test('panel shows empty state when no responses exist', async ({ page }) => {
    const project = await seedProject('QR Panel Empty', '/tmp/qr-panel-4');
    const session = await seedSession(project.id, { prompt: 'Test prompt', startImmediately: false });

    // Use the shared helper which waits for the quick-responses API call
    await navigateToSessionAndExpandPanel(page, session.id);

    // Verify empty state text
    await expect(page.locator('.empty-text')).toContainText('No quick responses yet');
  });

  test('panel collapse and expand toggle works', async ({ page }) => {
    const project = await seedProject('QR Panel Toggle', '/tmp/qr-panel-5');
    await seedQuickResponse(project.id, { label: 'Toggle Test', content: 'Toggle content' });

    const session = await seedSession(project.id, { prompt: 'Test prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}/conversation`);
    await waitForPageReady(page);

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

  test('settings gear opens settings modal from conversation view', async ({ page }) => {
    const project = await seedProject('QR Panel Settings', '/tmp/qr-panel-6');
    await seedQuickResponse(project.id, { label: 'Gear Test', content: 'Gear content' });

    const session = await seedSession(project.id, { prompt: 'Test prompt', startImmediately: false });
    await navigateToSessionAndExpandPanel(page, session.id);

    // Click the settings gear button
    const settingsBtn = page.locator('button[aria-label="Manage quick responses"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    // Verify settings modal opens
    const settingsModal = page.locator('.settings-panel[role="dialog"]');
    await expect(settingsModal).toBeVisible({ timeout: 5000 });
    await expect(settingsModal.locator('.settings-title')).toContainText('Quick Responses');
  });
});

// ============================================================
// Category 3: Quick Response Panel in New Session View (3 tests)
// ============================================================

test.describe('Category 3: Quick Response Panel in New Session View', () => {
  test('panel displays responses in new session view', async ({ page }) => {
    const project = await seedProject('QR NewSession Display', '/tmp/qr-new-1');
    await seedQuickResponse(project.id, { label: 'New Session QR', content: 'New session content' });

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
    await seedQuickResponse(project.id, { label: 'Insert Prompt', content: 'Prompt content here' });

    await page.goto(`/projects/${project.id}/sessions/new`);
    await waitForPageReady(page);

    // Expand and click response
    const panel = page.locator('.quick-responses-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });
    await panel.click();
    await page.waitForTimeout(300);

    await page.locator('.response-button', { hasText: 'Insert Prompt' }).click();

    // Verify prompt textarea contains the content
    const textarea = page.locator('textarea#prompt');
    await expect(textarea).toHaveValue('Prompt content here', { timeout: 5000 });
  });

  test('auto-submit response triggers form submission in new session', async ({ page }) => {
    const project = await seedProject('QR NewSession AutoSubmit', '/tmp/qr-new-3');
    await seedQuickResponse(project.id, {
      label: 'Auto Create',
      content: 'Auto-create this session',
      autoSubmit: true,
    });

    await page.goto(`/projects/${project.id}/sessions/new`);
    await waitForPageReady(page);

    // Expand and click auto-submit response
    const panel = page.locator('.quick-responses-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });
    await panel.click();
    await page.waitForTimeout(300);

    await page.locator('.response-button', { hasText: 'Auto Create' }).click();

    // Auto-submit should trigger form submission, which navigates away from the new session view.
    // Verify we navigate away (URL changes to session detail)
    await expect(page).not.toHaveURL(/\/sessions\/new/, { timeout: 10000 });
  });
});

// ============================================================
// Category 4: Scope Isolation (3 tests)
// ============================================================

test.describe('Category 4: Scope Isolation', () => {
  test('project-scoped response only appears in its own project', async ({ page }) => {
    const projectA = await seedProject('QR Scope A', '/tmp/qr-scope-a');
    const projectB = await seedProject('QR Scope B', '/tmp/qr-scope-b');

    await seedQuickResponse(projectA.id, { label: 'Only In A', content: 'Project A content' });

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

    const globalQR = await seedQuickResponse(projectA.id, { label: 'Everywhere', content: 'Global content', isGlobal: true });
    trackGlobalQR(globalQR.id);
    expect(globalQR.projectId).toBeNull();

    // Verify via API that global response is retrievable for both projects
    const apiA = await getQuickResponses(projectA.id);
    expect(apiA.global.map((r: any) => r.label)).toContain('Everywhere');
    const apiB = await getQuickResponses(projectB.id);
    expect(apiB.global.map((r: any) => r.label)).toContain('Everywhere');

    // Verify global response appears in the settings modal for BOTH projects.
    // This proves that a global QR (projectId=NULL) is visible across all projects.
    for (const project of [projectA, projectB]) {
      await openSettingsModal(page, project.id);

      // The global section should show the "Everywhere" response.
      // Use .first() to handle potential duplicates.
      const globalSection = page.locator('.section').filter({ hasText: 'Global Responses' });
      await expect(
        globalSection.locator('.response-label', { hasText: 'Everywhere' }).first()
      ).toBeVisible({ timeout: 10000 });

      // Close the modal before navigating to the next project
      await page.locator('.close-button').click();
      await expect(page.locator('.settings-panel[role="dialog"]')).not.toBeVisible({ timeout: 3000 });
    }
  });

  test('API returns both project and global responses together', async () => {
    const project = await seedProject('QR API Combined', '/tmp/qr-api-combined');

    await seedQuickResponse(project.id, { label: 'ProjResp1', content: 'Content 1' });
    await seedQuickResponse(project.id, { label: 'ProjResp2', content: 'Content 2' });
    const globalQR2 = await seedQuickResponse(project.id, { label: 'GlobalResp1', content: 'Global Content 1', isGlobal: true });
    trackGlobalQR(globalQR2.id);

    const responses = await getQuickResponses(project.id);
    // Project responses should be exactly 2 (scoped to this project)
    expect(responses.project).toHaveLength(2);
    expect(responses.project.map((r: any) => r.label)).toContain('ProjResp1');
    expect(responses.project.map((r: any) => r.label)).toContain('ProjResp2');

    // Global responses may include leftovers from other tests, so check at least 1 exists
    // and that our specific global response is present
    expect(responses.global.length).toBeGreaterThanOrEqual(1);
    const globalLabels = responses.global.map((r: any) => r.label);
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
    await seedQuickResponse(project.id, { label: 'Third', content: 'C', sortOrder: 2 });
    await seedQuickResponse(project.id, { label: 'First', content: 'A', sortOrder: 0 });
    await seedQuickResponse(project.id, { label: 'Second', content: 'B', sortOrder: 1 });

    const session = await seedSession(project.id, { prompt: 'Test sort', startImmediately: false });
    await navigateToSessionAndExpandPanel(page, session.id);

    // Get all project response buttons and verify order
    const buttons = page.locator('.project-response .button-label');
    await expect(buttons).toHaveCount(3, { timeout: 5000 });

    const labels = await buttons.allTextContents();
    expect(labels).toEqual(['First', 'Second', 'Third']);
  });

  test('reorder API updates response order', async () => {
    const project = await seedProject('QR Reorder API', '/tmp/qr-sort-2');

    const r1 = await seedQuickResponse(project.id, { label: 'Alpha', content: 'A', sortOrder: 0 });
    const r2 = await seedQuickResponse(project.id, { label: 'Beta', content: 'B', sortOrder: 1 });
    const r3 = await seedQuickResponse(project.id, { label: 'Gamma', content: 'C', sortOrder: 2 });

    // Reverse the order via reorder API
    await reorderQuickResponses(project.id, [
      { id: r1.id, sortOrder: 2 },
      { id: r2.id, sortOrder: 1 },
      { id: r3.id, sortOrder: 0 },
    ]);

    // Verify via GET
    const responses = await getQuickResponses(project.id);
    const labels = responses.project.map((r: any) => r.label);
    expect(labels).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  test('reordered responses display in new order in panel', async ({ page }) => {
    const project = await seedProject('QR Reorder Panel', '/tmp/qr-sort-3');

    const r1 = await seedQuickResponse(project.id, { label: 'Uno', content: 'A', sortOrder: 0 });
    const r2 = await seedQuickResponse(project.id, { label: 'Dos', content: 'B', sortOrder: 1 });
    const r3 = await seedQuickResponse(project.id, { label: 'Tres', content: 'C', sortOrder: 2 });

    // Reverse order via API
    await reorderQuickResponses(project.id, [
      { id: r1.id, sortOrder: 2 },
      { id: r2.id, sortOrder: 1 },
      { id: r3.id, sortOrder: 0 },
    ]);

    const session = await seedSession(project.id, { prompt: 'Test reorder', startImmediately: false });
    await navigateToSessionAndExpandPanel(page, session.id);

    // Verify the new order
    const buttons = page.locator('.project-response .button-label');
    await expect(buttons).toHaveCount(3, { timeout: 5000 });

    const labels = await buttons.allTextContents();
    expect(labels).toEqual(['Tres', 'Dos', 'Uno']);
  });
});

// ============================================================
// Category 6: Validation and Edge Cases (3 tests)
// ============================================================

test.describe('Category 6: Validation and Edge Cases', () => {
  test('save button disabled when label is empty', async ({ page }) => {
    const project = await seedProject('QR Validation Label', '/tmp/qr-val-1');
    await openSettingsModal(page, project.id);

    const dialog = await openAddDialog(page, 'project');

    // Leave label empty, fill content
    await dialog.locator('#qr-content').fill('Some content');

    // Verify save button is disabled
    const saveBtn = dialog.locator('button[type="submit"]');
    await expect(saveBtn).toBeDisabled();
  });

  test('save button disabled when content is empty', async ({ page }) => {
    const project = await seedProject('QR Validation Content', '/tmp/qr-val-2');
    await openSettingsModal(page, project.id);

    const dialog = await openAddDialog(page, 'project');

    // Fill label, leave content empty
    await dialog.locator('#qr-label').fill('My Label');

    // Verify save button is disabled
    const saveBtn = dialog.locator('button[type="submit"]');
    await expect(saveBtn).toBeDisabled();
  });

  test('label is trimmed on save', async ({ page }) => {
    const project = await seedProject('QR Validation Trim', '/tmp/qr-val-3');
    await openSettingsModal(page, project.id);

    const dialog = await openAddDialog(page, 'project');

    // Enter label with leading/trailing spaces
    await dialog.locator('#qr-label').fill('  Trimmed Label  ');
    await dialog.locator('#qr-content').fill('Content for trimmed label');

    // Trigger blur on label to invoke inline trim handler
    await dialog.locator('#qr-content').click();
    await page.waitForTimeout(200);

    // Save
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Verify via API that label is trimmed
    const responses = await getQuickResponses(project.id);
    const created = responses.project.find((r: any) => r.label === 'Trimmed Label');
    expect(created).toBeTruthy();
    expect(created.label).toBe('Trimmed Label');
  });
});
