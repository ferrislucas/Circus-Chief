import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedProjectTemplate,
  setNextTemplate,
  updateSessionScheduling,
  getSession,
  cleanupAll,
  cleanupTemplates,
  navigateAndWait,
  openSessionOverlay,
} from './helpers';

// ============================================================
// Category 1: Panel Visibility & Expand/Collapse (4 tests)
// ============================================================

test.describe('Orchestration Panel - Panel Visibility & Expand/Collapse', () => {
  test.describe.configure({ timeout: 15000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('OrchPanel Visibility', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('orchestration panel is visible on session detail conversation tab', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Panel Visible Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    const panel = page.locator('.orchestration-panel');
    await expect(panel).toBeVisible();

    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await expect(panelHeader).toBeVisible();
    await expect(panelHeader).toContainText('Orchestration');
  });

  test('panel is collapsed by default and can be expanded', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Panel Collapse Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Panel content should NOT be visible (collapsed by default)
    const content = page.locator('.orchestration-content');
    await expect(content).not.toBeVisible();

    // Click the panel header to expand
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();

    // Now the content should be visible
    await expect(content).toBeVisible();

    // Toggle button should indicate expanded state (scoped to orchestration panel)
    const toggleButton = page.locator('.orchestration-panel .toggle-button');
    await expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
  });

  test('panel starts expanded when auto-reschedule is enabled', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'AutoExpand Reschedule Test',
      startImmediately: false,
    });

    // Enable auto-reschedule via API
    await updateSessionScheduling(session.id, { autoRescheduleEnabled: true });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Content should be visible without clicking (auto-expanded)
    const content = page.locator('.orchestration-content');
    await expect(content).toBeVisible();

    const toggleButton = page.locator('.orchestration-panel .toggle-button');
    await expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
  });

  test('panel starts expanded when next template is set', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'AutoExpand Template Test',
      startImmediately: false,
    });

    const template = await seedProjectTemplate(project.id, {
      name: 'OrchPanel Expand Template',
      prompt: 'Do something',
    });

    // Set next template via API
    await setNextTemplate(session.id, template.id);

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Content should be visible without clicking (auto-expanded)
    const content = page.locator('.orchestration-content');
    await expect(content).toBeVisible();

    // Template selector should show the selected template
    const templateSelect = page.locator('.template-selector select.form-input');
    await expect(templateSelect).toBeVisible();
  });
});

// ============================================================
// Category 2: Schedule Button State (3 tests)
// ============================================================

test.describe('Orchestration Panel - Schedule Button State', () => {
  test.describe.configure({ timeout: 15000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('OrchPanel Schedule', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('schedule button is visible in expanded panel', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Schedule Visible Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Expand the panel
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();

    // Schedule button should be visible
    const scheduleBtn = page.locator('.btn-schedule');
    await expect(scheduleBtn).toBeVisible();
    await expect(scheduleBtn).toContainText('Scheduling');

    // Schedule row should be visible
    const scheduleRow = page.locator('.schedule-row');
    await expect(scheduleRow).toBeVisible();
  });

  test('schedule button is disabled when textarea is cleared', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Schedule Disabled Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Expand the panel
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();

    // Clear the textarea (draft sessions pre-populate from pendingPrompt)
    const textarea = page.locator('textarea');
    await textarea.clear();

    // Schedule button should be disabled
    const scheduleBtn = page.locator('.btn-schedule');
    await expect(scheduleBtn).toBeDisabled();

    // Disabled hint should be visible
    const hint = page.locator('.schedule-disabled-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Prompt is required before scheduling');
  });

  test('schedule button becomes enabled when textarea has content', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Schedule Enabled Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Expand the panel
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();

    // First clear the textarea
    const textarea = page.locator('textarea');
    await textarea.clear();

    // Verify it's disabled first
    const scheduleBtn = page.locator('.btn-schedule');
    await expect(scheduleBtn).toBeDisabled();

    // Now type content into the textarea
    await textarea.fill('My scheduled prompt');

    // Schedule button should now be enabled
    await expect(scheduleBtn).toBeEnabled();

    // Disabled hint should NOT be visible
    const hint = page.locator('.schedule-disabled-hint');
    await expect(hint).not.toBeVisible();
  });
});

// ============================================================
// Category 3: Auto-Reschedule Modal (5 tests)
// ============================================================

test.describe('Orchestration Panel - Auto-Reschedule Modal', () => {
  test.describe.configure({ timeout: 15000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('OrchPanel AutoReschedule', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('configure button is visible when auto-reschedule is disabled', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Configure Button Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Expand the panel
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();

    // Configure button should be visible
    const configureBtn = page.locator('.btn-configure');
    await expect(configureBtn).toBeVisible();
    await expect(configureBtn).toContainText('Configure');

    // Status button should NOT be visible (auto-reschedule is disabled)
    const statusBtn = page.locator('.btn-status');
    await expect(statusBtn).not.toBeVisible();
  });

  test('clicking configure opens auto-reschedule modal', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Open Modal Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Expand the panel
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();

    // Click configure button
    const configureBtn = page.locator('.btn-configure');
    await configureBtn.click();

    // Modal should be visible
    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible();

    // Modal title should be correct
    const modalTitle = page.locator('.modal-title');
    await expect(modalTitle).toContainText('Auto-Reschedule Settings');

    // Toggle switch should be visible (scoped to modal to avoid ambiguity)
    const toggleSwitch = page.locator('.modal-content .toggle-switch');
    await expect(toggleSwitch).toBeVisible();

    // Cancel and Save buttons should be visible
    await expect(page.locator('.modal-footer .btn-secondary')).toBeVisible();
    await expect(page.locator('.modal-footer .btn-primary')).toBeVisible();
  });

  test('enabling auto-reschedule toggle shows additional settings', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Toggle Settings Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Expand panel → click configure
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();
    await page.locator('.btn-configure').click();

    // Enable the toggle by clicking the toggle-switch label (checkbox is hidden via CSS)
    const toggleLabel = page.locator('.modal-content .toggle-switch');
    await toggleLabel.click();

    // Additional settings should appear
    const rescheduleSettings = page.locator('.reschedule-settings');
    await expect(rescheduleSettings).toBeVisible();

    // Trigger checkboxes should be visible
    await expect(page.locator('.checkbox-option').filter({ hasText: 'Token limit errors' })).toBeVisible();
    await expect(page.locator('.checkbox-option').filter({ hasText: 'Service unavailability' })).toBeVisible();

    // Delay dropdown should be visible
    const delaySelect = page.locator('.reschedule-settings select.form-input');
    await expect(delaySelect).toBeVisible();
  });

  test('saving auto-reschedule settings updates the panel', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Save Settings Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Expand panel → click configure
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();
    await page.locator('.btn-configure').click();

    // Enable the toggle by clicking the toggle-switch label (checkbox is hidden via CSS)
    const toggleLabel = page.locator('.modal-content .toggle-switch');
    await toggleLabel.click();

    // Click Save
    const saveBtn = page.locator('.modal-footer .btn-primary');
    await saveBtn.click();

    // Modal should close
    const modal = page.locator('.modal-backdrop');
    await expect(modal).not.toBeVisible();

    // Panel should now show status button with "Enabled" badge
    const statusBtn = page.locator('.btn-status');
    await expect(statusBtn).toBeVisible();

    const statusBadge = page.locator('.status-badge');
    await expect(statusBadge).toContainText('Enabled');

    const editLink = page.locator('.edit-link');
    await expect(editLink).toContainText('Edit');

    // Configure button should no longer be visible
    const configureBtn = page.locator('.btn-configure');
    await expect(configureBtn).not.toBeVisible();

    // Verify via API
    const updatedSession = await getSession(session.id);
    expect(updatedSession.autoRescheduleEnabled).toBe(true);
  });

  test('disabling auto-reschedule via modal updates panel back to Configure', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Disable Reschedule Test',
      startImmediately: false,
    });

    // Enable auto-reschedule via API first
    await updateSessionScheduling(session.id, { autoRescheduleEnabled: true });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Panel should be expanded (auto-expanded because autoRescheduleEnabled)
    const content = page.locator('.orchestration-content');
    await expect(content).toBeVisible();

    // Click status button to open modal
    const statusBtn = page.locator('.btn-status');
    await expect(statusBtn).toBeVisible();
    await statusBtn.click();

    // Modal opens — toggle off by clicking the toggle-switch label (checkbox is hidden via CSS)
    const toggleLabel = page.locator('.modal-content .toggle-switch');
    await toggleLabel.click();

    // Click Save
    const saveBtn = page.locator('.modal-footer .btn-primary');
    await saveBtn.click();

    // Modal should close
    const modal = page.locator('.modal-backdrop');
    await expect(modal).not.toBeVisible();

    // Panel should now show Configure button again
    const configureBtn = page.locator('.btn-configure');
    await expect(configureBtn).toBeVisible();

    // Status button should no longer be visible
    await expect(page.locator('.btn-status')).not.toBeVisible();

    // Verify via API
    const updatedSession = await getSession(session.id);
    expect(updatedSession.autoRescheduleEnabled).toBe(false);
  });
});

// ============================================================
// Category 4: Template Selector (6 tests)
// ============================================================

test.describe('Orchestration Panel - Template Selector', () => {
  test.describe.configure({ timeout: 15000 });

  let project: any;
  let template1: any;
  let template2: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('OrchPanel TemplateSelector', '/tmp/test');
    template1 = await seedProjectTemplate(project.id, {
      name: 'OrchPanel Template A',
      prompt: 'Do task A',
    });
    template2 = await seedProjectTemplate(project.id, {
      name: 'OrchPanel Template B',
      prompt: 'Do task B',
    });
  });

  test.afterEach(async () => {
    await cleanupTemplates();
    await cleanupAll();
  });

  test('template selector is visible in expanded panel', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Template Visible Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Expand the panel
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();

    // Template selector should be visible
    const templateSelector = page.locator('.template-selector');
    await expect(templateSelector).toBeVisible();

    // Label should be present
    const label = page.locator('.selector-label');
    await expect(label).toContainText('Next Template');

    // Dropdown should be visible
    const dropdown = page.locator('.template-selector select.form-input');
    await expect(dropdown).toBeVisible();

    // Help text should be visible (no template selected yet)
    const helpText = page.locator('.selector-help');
    await expect(helpText).toBeVisible();
  });

  test('template dropdown shows available templates', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Template Dropdown Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Expand the panel
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();

    // Verify template options are available
    const dropdown = page.locator('.template-selector select.form-input');

    // Check the default selected option
    const selectedText = await dropdown.locator('option:checked').textContent();
    expect(selectedText).toContain('Select a template');

    // Check that our templates appear as options
    const options = dropdown.locator('option');
    const allText = await options.allTextContents();
    expect(allText.some(t => t.includes('Template A'))).toBe(true);
    expect(allText.some(t => t.includes('Template B'))).toBe(true);
  });

  test('selecting a template shows preview and persists to session', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Template Select Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Expand the panel
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();

    // Select template A from dropdown using value (template ID)
    const dropdown = page.locator('.template-selector select.form-input');
    await dropdown.selectOption(template1.id);

    // Template preview should appear
    const preview = page.locator('.template-preview');
    await expect(preview).toBeVisible({ timeout: 5000 });

    // Help text should no longer be visible
    const helpText = page.locator('.selector-help');
    await expect(helpText).not.toBeVisible();

    // Verify via API that the template was persisted
    // Wait a moment for the save to complete
    await page.waitForTimeout(1500);
    const updatedSession = await getSession(session.id);
    expect(updatedSession.nextTemplateId).toBe(template1.id);
  });

  test('clear button removes the selected template', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Template Clear Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Expand the panel
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();

    // Select template A using value (template ID)
    const dropdown = page.locator('.template-selector select.form-input');
    await dropdown.selectOption(template1.id);

    // Wait for preview to appear (confirms selection went through)
    const preview = page.locator('.template-preview');
    await expect(preview).toBeVisible({ timeout: 5000 });

    // Click the clear button
    const clearBtn = page.locator('.btn-clear');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    // Dropdown should reset to default
    const selectedText = await dropdown.locator('option:checked').textContent();
    expect(selectedText).toContain('Select a template');

    // Preview should disappear
    await expect(preview).not.toBeVisible();

    // Help text should reappear
    const helpText = page.locator('.selector-help');
    await expect(helpText).toBeVisible();

    // Verify via API
    await page.waitForTimeout(1500);
    const updatedSession = await getSession(session.id);
    expect(updatedSession.nextTemplateId).toBeNull();
  });

  test('template selector shows chain indicator when template has chaining', async ({ page }) => {
    // Create template C that chains to template B
    const templateC = await seedProjectTemplate(project.id, {
      name: 'OrchPanel Template C',
      prompt: 'Do task C',
      nextTemplateId: template2.id,
    });

    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Template Chain Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Expand the panel
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();

    // Select template C (which chains to B) using its ID
    const dropdown = page.locator('.template-selector select.form-input');
    await dropdown.selectOption(templateC.id);

    // Chain indicator should be visible
    const chainIndicator = page.locator('.chain-indicator');
    await expect(chainIndicator).toBeVisible({ timeout: 5000 });

    // Should contain reference to Template B
    await expect(chainIndicator).toContainText('Template B');
  });

  test('pre-set template is shown on page load', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Pre-set Template Test',
      startImmediately: false,
    });

    // Set next template via API before navigating
    await setNextTemplate(session.id, template1.id);

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Panel should be auto-expanded (because template is set)
    const content = page.locator('.orchestration-content');
    await expect(content).toBeVisible();

    // Template dropdown should show template A selected
    const dropdown = page.locator('.template-selector select.form-input');
    const selectedValue = await dropdown.inputValue();
    expect(selectedValue).toBe(template1.id);

    // Preview should be visible
    const preview = page.locator('.template-preview');
    await expect(preview).toBeVisible();
  });
});

// ============================================================
// Category 5: Integration — Combined Panel Configuration (3 tests)
// ============================================================

test.describe('Orchestration Panel - Integration', () => {
  test.describe.configure({ timeout: 15000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('OrchPanel Integration', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupTemplates();
    await cleanupAll();
  });

  test('all three orchestration controls are visible when panel is expanded', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'All Controls Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Expand the panel
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();

    // Schedule row with button
    const scheduleRow = page.locator('.schedule-row');
    await expect(scheduleRow).toBeVisible();
    const scheduleBtn = page.locator('.btn-schedule');
    await expect(scheduleBtn).toBeVisible();

    // Template row with selector
    const templateRow = page.locator('.template-row');
    await expect(templateRow).toBeVisible();
    const templateSelector = page.locator('.template-selector');
    await expect(templateSelector).toBeVisible();

    // Auto-reschedule row with button
    const rescheduleRow = page.locator('.auto-reschedule-row');
    await expect(rescheduleRow).toBeVisible();
  });

  test('template + auto-reschedule can be configured together', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: 'OrchPanel Integration Template',
      prompt: 'Do integration task',
    });

    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Combined Config Test',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Expand the panel
    const panelHeader = page.locator('.orchestration-panel .panel-header');
    await panelHeader.click();

    // 1) Select template using its ID
    const dropdown = page.locator('.template-selector select.form-input');
    await dropdown.selectOption(template.id);

    // Wait for template preview to appear
    const preview = page.locator('.template-preview');
    await expect(preview).toBeVisible({ timeout: 5000 });

    // 2) Open auto-reschedule modal and enable
    const configureBtn = page.locator('.btn-configure');
    await configureBtn.click();

    // Enable the toggle by clicking the toggle-switch label (checkbox is hidden via CSS)
    const toggleLabel = page.locator('.modal-content .toggle-switch');
    await toggleLabel.click();

    // Save
    const saveBtn = page.locator('.modal-footer .btn-primary');
    await saveBtn.click();

    // Modal closes
    const modal = page.locator('.modal-backdrop');
    await expect(modal).not.toBeVisible();

    // Verify panel shows both:
    // - Template preview visible
    await expect(preview).toBeVisible();

    // - Auto-reschedule enabled badge
    const statusBadge = page.locator('.status-badge');
    await expect(statusBadge).toContainText('Enabled');

    // Verify via API
    await page.waitForTimeout(1500);
    const updatedSession = await getSession(session.id);
    expect(updatedSession.nextTemplateId).toBe(template.id);
    expect(updatedSession.autoRescheduleEnabled).toBe(true);
  });

  test('panel reflects all pre-configured settings on load', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: 'OrchPanel Preconfig Template',
      prompt: 'Pre-configured task',
    });

    const session = await seedSession(project.id, {
      prompt: 'Test',
      name: 'Preconfig Test',
      startImmediately: false,
    });

    // Pre-configure via API
    await setNextTemplate(session.id, template.id);
    await updateSessionScheduling(session.id, {
      autoRescheduleEnabled: true,
      rescheduleDelayMinutes: 15,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Panel should be auto-expanded (template + auto-reschedule set)
    const content = page.locator('.orchestration-content');
    await expect(content).toBeVisible();

    // Template selector should show the selected template with preview
    const preview = page.locator('.template-preview');
    await expect(preview).toBeVisible();

    // Auto-reschedule should show enabled status
    const statusBtn = page.locator('.btn-status');
    await expect(statusBtn).toBeVisible();

    const statusBadge = page.locator('.status-badge');
    await expect(statusBadge).toContainText('Enabled');
  });
});
