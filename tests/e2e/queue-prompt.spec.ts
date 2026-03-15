import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedProjectTemplate,
  getSession,
  cleanupAll,
  cleanupTemplates,
  navigateAndWait,
  updateSessionStatus,
  updateSessionFields,
  updatePendingPrompt,
} from './helpers';

// ============================================================
// Category 1: Input Form Visibility During Running (3 tests)
// ============================================================

test.describe('Queue Prompt - Input Form Visibility During Running', () => {
  test.describe.configure({ timeout: 15000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('QueuePrompt Visibility', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('textarea is visible and editable when session is running', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Running Textarea Test',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await navigateAndWait(page, `/sessions/${session.id}`);

    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();

    await textarea.fill('My queued prompt');
    await expect(textarea).toHaveValue('My queued prompt');
  });

  test('send button is hidden when session is running', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Running No Send Test',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await navigateAndWait(page, `/sessions/${session.id}`);

    await expect(page.locator('.send-button-row')).not.toBeVisible();
    await expect(page.locator('.input-controls')).not.toBeVisible();
  });

  test('input form is not visible when session is starting', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Starting No Input Test',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'starting');
    await navigateAndWait(page, `/sessions/${session.id}`);

    // The input form should not be visible when starting
    await expect(page.locator('.input-form')).not.toBeVisible();
  });
});

// ============================================================
// Category 2: Auto-Send Checkbox (4 tests)
// ============================================================

test.describe('Queue Prompt - Auto-Send Checkbox', () => {
  test.describe.configure({ timeout: 15000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('QueuePrompt AutoSend', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('auto-send checkbox appears when running with content in textarea', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'AutoSend Visible Test',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await navigateAndWait(page, `/sessions/${session.id}`);

    await page.locator('textarea').fill('My prompt');

    await expect(page.locator('.auto-send-row')).toBeVisible();
    await expect(page.locator('.auto-send-text')).toContainText('Send automatically when Claude finishes');
  });

  test('auto-send checkbox is hidden when textarea is empty during running', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'AutoSend Hidden Empty Test',
      startImmediately: false,
    });
    // Clear the pending prompt so the textarea starts empty
    await updatePendingPrompt(session.id, '');
    await updateSessionStatus(session.id, 'running');
    await navigateAndWait(page, `/sessions/${session.id}`);

    // Ensure textarea is empty
    await page.locator('textarea').fill('');

    await expect(page.locator('.auto-send-row')).not.toBeVisible();
  });

  test('auto-send checkbox is hidden when session is not running', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'AutoSend Hidden Waiting Test',
      startImmediately: false,
    });
    // Session stays in waiting state (startImmediately: false sets to waiting by default)
    await navigateAndWait(page, `/sessions/${session.id}`);

    await page.locator('textarea').fill('Some content');

    await expect(page.locator('.auto-send-row')).not.toBeVisible();
  });

  test('auto-send checkbox defaults to unchecked', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'AutoSend Default Test',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await navigateAndWait(page, `/sessions/${session.id}`);

    await page.locator('textarea').fill('Prompt');

    const checkbox = page.locator('.auto-send-checkbox');
    await expect(checkbox).not.toBeChecked();
  });
});

// ============================================================
// Category 3: Auto-Send Toggle Persistence (2 tests)
// ============================================================

test.describe('Queue Prompt - Auto-Send Toggle Persistence', () => {
  test.describe.configure({ timeout: 15000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('QueuePrompt Persist', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('checking auto-send persists the flag to the server', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'AutoSend Persist Check Test',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await navigateAndWait(page, `/sessions/${session.id}`);

    await page.locator('textarea').fill('My prompt');
    await page.locator('.auto-send-checkbox').check();

    // Wait for the API call to complete
    await page.waitForTimeout(1500);

    const updatedSession = await getSession(session.id);
    expect(updatedSession.autoSendPendingPrompt).toBe(true);
  });

  test('unchecking auto-send clears the flag on the server', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'AutoSend Persist Uncheck Test',
      startImmediately: false,
    });
    await updatePendingPrompt(session.id, 'test');
    await updateSessionFields(session.id, { autoSendPendingPrompt: true });
    await updateSessionStatus(session.id, 'running');
    await navigateAndWait(page, `/sessions/${session.id}`);

    // The textarea should show the pendingPrompt, and checkbox should be checked
    await expect(page.locator('.auto-send-checkbox')).toBeChecked();

    await page.locator('.auto-send-checkbox').uncheck();
    await page.waitForTimeout(1500);

    const updatedSession = await getSession(session.id);
    expect(updatedSession.autoSendPendingPrompt).toBe(false);
  });
});

// ============================================================
// Category 4: OrchestrationPanel During Running (2 tests)
// ============================================================

test.describe('Queue Prompt - OrchestrationPanel During Running', () => {
  test.describe.configure({ timeout: 15000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('QueuePrompt Orch', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('orchestration panel is visible during running', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Orch Panel Running Test',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await navigateAndWait(page, `/sessions/${session.id}`);

    await expect(page.locator('.orchestration-panel')).toBeVisible();
  });

  test('template selector is interactive during running', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: 'Test Template',
      prompt: 'Do it',
    });
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Orch Template Running Test',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await navigateAndWait(page, `/sessions/${session.id}`);

    // Expand orchestration panel
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();

    // Select the template
    await page.locator('.template-selector select.form-input').selectOption(template.id);
    await page.waitForTimeout(1500);

    const updatedSession = await getSession(session.id);
    expect(updatedSession.nextTemplateId).toBe(template.id);
  });
});

// ============================================================
// Category 5: Auto-Send Reset on Transitions (2 tests)
// ============================================================

test.describe('Queue Prompt - Auto-Send Reset on Transitions', () => {
  test.describe.configure({ timeout: 20000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('QueuePrompt Reset', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('auto-send flag resets when session is stopped', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'AutoSend Reset Stop Test',
      startImmediately: false,
    });
    await updatePendingPrompt(session.id, 'test');
    await updateSessionFields(session.id, { autoSendPendingPrompt: true });
    await updateSessionStatus(session.id, 'running');
    await navigateAndWait(page, `/sessions/${session.id}`);

    // Verify checkbox is checked
    await expect(page.locator('.auto-send-checkbox')).toBeChecked();

    // Stop the session (triggers WebSocket broadcast)
    await updateSessionStatus(session.id, 'stopped');
    await page.waitForTimeout(2000);

    // The auto-send flag should have been reset by the frontend watcher
    const updatedSession = await getSession(session.id);
    expect(updatedSession.autoSendPendingPrompt).toBe(false);
  });

  test('prompt text stays in textarea after stopping with auto-send', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'AutoSend Stop Prompt Stay Test',
      startImmediately: false,
    });
    await updateSessionStatus(session.id, 'running');
    await navigateAndWait(page, `/sessions/${session.id}`);

    // Type a prompt and enable auto-send
    await page.locator('textarea').fill('My important prompt');
    await page.locator('.auto-send-checkbox').check();
    await page.waitForTimeout(500);

    // Stop the session — the pendingPrompt is still set on the server,
    // so the frontend should NOT clear the input
    await updateSessionStatus(session.id, 'stopped');
    await page.waitForTimeout(2000);

    // Prompt should still be in the textarea
    await expect(page.locator('textarea')).toHaveValue('My important prompt');
  });
});
