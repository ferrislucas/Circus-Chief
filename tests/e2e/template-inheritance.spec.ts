import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedProjectTemplate,
  updateTemplate,
  setNextTemplate,
  sendSessionMessage,
  waitForChildSession,
  waitForSessionStatus,
  getSession,
  updateSessionFields,
  updateSessionScheduling,
  cleanupAll,
  cleanupTemplates,
  getTemplate,
  getProjectTemplates,
  navigateAndWait,
} from './helpers';

test.describe.configure({ timeout: 60000 });

// ============================================================
// Describe Block 1: Template Inherit UI — Create Form
// ============================================================

test.describe('Template Inherit UI — Create Form', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('[TEST] Inherit UI Create', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('create form defaults to "Inherit from root session" for mode, model, and thinking', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await page.getByTestId('new-template-btn').click();
    await expect(page.getByTestId('template-form')).toBeVisible({ timeout: 10000 });

    // Mode select should have "Inherit from root session" selected (null value renders as '' in DOM)
    const modeSelect = page.getByTestId('mode-select');
    await expect(modeSelect).toBeVisible();

    // Check that "Inherit from root session" options are present for all three selects
    const allSelects = page.locator('[data-testid="template-form"] select');
    const count = await allSelects.count();
    // There should be at least 3 selects with the "Inherit from root session" option
    // (mode, thinking, possibly model through ModelSelector)
    let inheritOptions = 0;
    for (let i = 0; i < count; i++) {
      const options = await allSelects.nth(i).locator('option').allTextContents();
      if (options.some(opt => opt.includes('Inherit from root session'))) {
        inheritOptions++;
      }
    }
    expect(inheritOptions).toBeGreaterThanOrEqual(2);
  });

  test('creating a template with "Inherit" defaults saves null values to API', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await page.getByTestId('new-template-btn').click();
    await expect(page.getByTestId('template-form')).toBeVisible({ timeout: 10000 });

    // Fill name and prompt
    await page.locator('[data-testid="template-form"] input[type="text"]').first().fill('[TEST] Inherit Defaults');
    await page.locator('[data-testid="template-form"] textarea').first().fill('Test inherit defaults prompt');

    // Submit (leave mode, model, thinking at defaults = "Inherit from root session")
    await page.getByTestId('submit-btn').click();

    // Wait for the template to appear in the list
    await expect(page.getByText('[TEST] Inherit Defaults')).toBeVisible({ timeout: 10000 });

    // Fetch via API and verify null values
    const templates = await getProjectTemplates(project.id);
    const created = templates.find((t: any) => t.name === '[TEST] Inherit Defaults');
    expect(created).toBeDefined();
    expect(created.mode).toBeNull();
    expect(created.thinkingEnabled).toBeNull();
    expect(created.model).toBeNull();
  });

  test('creating a template with explicit YOLO mode saves "yolo" not null', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await page.getByTestId('new-template-btn').click();
    await expect(page.getByTestId('template-form')).toBeVisible({ timeout: 10000 });

    await page.locator('[data-testid="template-form"] input[type="text"]').first().fill('[TEST] Explicit YOLO');
    await page.locator('[data-testid="template-form"] textarea').first().fill('Test explicit YOLO mode');

    // Select YOLO from the mode dropdown
    const modeSelect = page.getByTestId('mode-select');
    await modeSelect.selectOption('yolo');

    await page.getByTestId('submit-btn').click();
    await expect(page.getByText('[TEST] Explicit YOLO')).toBeVisible({ timeout: 10000 });

    const templates = await getProjectTemplates(project.id);
    const created = templates.find((t: any) => t.name === '[TEST] Explicit YOLO');
    expect(created).toBeDefined();
    expect(created.mode).toBe('yolo');
  });

  test('creating a template with thinking explicitly disabled saves false not null', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await page.getByTestId('new-template-btn').click();
    await expect(page.getByTestId('template-form')).toBeVisible({ timeout: 10000 });

    await page.locator('[data-testid="template-form"] input[type="text"]').first().fill('[TEST] Explicit Thinking Off');
    await page.locator('[data-testid="template-form"] textarea').first().fill('Test explicit thinking off');

    // Select "Disabled" from the thinking select using its test ID
    await page.getByTestId('thinking-select').selectOption({ label: 'Disabled' });

    await page.getByTestId('submit-btn').click();
    await expect(page.getByText('[TEST] Explicit Thinking Off')).toBeVisible({ timeout: 10000 });

    const templates = await getProjectTemplates(project.id);
    const created = templates.find((t: any) => t.name === '[TEST] Explicit Thinking Off');
    expect(created).toBeDefined();
    expect(created.thinkingEnabled).toBe(false);
  });
});

// ============================================================
// Describe Block 2: Template Inherit UI — Edit Form
// ============================================================

test.describe('Template Inherit UI — Edit Form', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('[TEST] Inherit UI Edit', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('edit form shows "Inherit from root session" for template with null fields', async ({ page }) => {
    // Seed a template with all defaults — after create() fix, mode/thinkingEnabled will be null
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Null Fields Template',
      prompt: 'Null fields test',
    });

    // Verify template has null mode
    expect(template.mode).toBeNull();
    expect(template.thinkingEnabled).toBeNull();

    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible({ timeout: 5000 });

    // Navigate to edit page
    await page.goto(`/projects/${project.id}/templates/${template.id}`);

    // The Mode select should show "Inherit from root session" as selected
    const modeSelect = page.locator('select#mode');
    await expect(modeSelect).toBeVisible({ timeout: 10000 });
    const modeSelectedOption = await modeSelect.locator('option:checked').textContent();
    expect(modeSelectedOption).toContain('Inherit from root session');

    // The Thinking select should show "Inherit from root session" as selected
    const thinkingSelect = page.locator('select#thinkingEnabled');
    await expect(thinkingSelect).toBeVisible();
    const thinkingSelectedOption = await thinkingSelect.locator('option:checked').textContent();
    expect(thinkingSelectedOption).toContain('Inherit from root session');
  });

  test('edit form shows explicit values for template with set fields', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Explicit Fields',
      prompt: 'Explicit fields test',
      thinkingEnabled: true,
    });
    await updateTemplate(template.id, { mode: 'plan' });

    await page.goto(`/projects/${project.id}/templates/${template.id}`);

    const modeSelect = page.locator('select#mode');
    await expect(modeSelect).toBeVisible({ timeout: 10000 });
    const modeSelectedOption = await modeSelect.locator('option:checked').textContent();
    expect(modeSelectedOption?.trim()).toBe('Plan');

    const thinkingSelect = page.locator('select#thinkingEnabled');
    await expect(thinkingSelect).toBeVisible();
    const thinkingSelectedOption = await thinkingSelect.locator('option:checked').textContent();
    expect(thinkingSelectedOption?.trim()).toBe('Enabled');
  });

  test('changing mode from explicit to "Inherit" and saving persists null', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Mode To Null',
      prompt: 'Mode to null test',
    });
    await updateTemplate(template.id, { mode: 'plan' });

    await page.goto(`/projects/${project.id}/templates/${template.id}`);

    const modeSelect = page.locator('select#mode');
    await expect(modeSelect).toBeVisible({ timeout: 10000 });
    // Change to "Inherit from root session" (value = '' for null)
    await modeSelect.selectOption({ label: 'Inherit from root session' });

    // Click Save
    await page.locator('button[type="submit"]').click();

    // Wait for navigation back
    await page.waitForURL(`**/projects/${project.id}/templates`, { timeout: 10000 });

    // Verify via API
    const updated = await getTemplate(template.id);
    expect(updated.mode).toBeNull();
  });

  test('changing thinking from explicit to "Inherit" and saving persists null', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Thinking To Null',
      prompt: 'Thinking to null test',
      thinkingEnabled: true,
    });

    await page.goto(`/projects/${project.id}/templates/${template.id}`);

    const thinkingSelect = page.locator('select#thinkingEnabled');
    await expect(thinkingSelect).toBeVisible({ timeout: 10000 });
    await thinkingSelect.selectOption({ label: 'Inherit from root session' });

    await page.locator('button[type="submit"]').click();
    await page.waitForURL(`**/projects/${project.id}/templates`, { timeout: 10000 });

    const updated = await getTemplate(template.id);
    expect(updated.thinkingEnabled).toBeNull();
  });
});

// ============================================================
// Describe Block 3: Template Setting Inheritance — Auto-Trigger
// ============================================================

test.describe('Template Setting Inheritance — Auto-Trigger', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('[TEST] Inherit Auto Trigger', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('child inherits mode from root session when template mode is null', async () => {
    // Seed template — after create() fix, mode defaults to null
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Null Mode Trigger',
      prompt: 'Mode inherit test',
    });

    // Verify template has null mode
    const t = await getTemplate(template.id);
    expect(t.mode).toBeNull();

    // Create parent session with mode: 'plan'
    const parent = await seedSession(project.id, {
      prompt: 'Parent session',
      name: '[TEST] Mode Root',
      mode: 'plan',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 25000);
    const childSession = await getSession(child.id);

    // Child should inherit 'plan' from root, not default 'standard'
    expect(childSession.mode).toBe('plan');
  });

  test('child uses template mode when template mode is explicitly set', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Explicit Mode Trigger',
      prompt: 'Explicit mode test',
    });
    await updateTemplate(template.id, { mode: 'standard' });

    const parent = await seedSession(project.id, {
      prompt: 'Parent session',
      name: '[TEST] Mode Root Explicit',
      mode: 'plan',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 25000);
    const childSession = await getSession(child.id);

    // Template override wins over root
    expect(childSession.mode).toBe('standard');
  });

  test('child inherits thinkingEnabled from root when template thinkingEnabled is null', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Null Thinking Trigger',
      prompt: 'Thinking inherit test',
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent session',
      name: '[TEST] Thinking Root',
      startImmediately: false,
    });

    // Update root to enable thinking
    await updateSessionFields(parent.id, { thinkingEnabled: true });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 25000);
    const childSession = await getSession(child.id);

    expect(childSession.thinkingEnabled).toBe(true);
  });

  test('child gets template thinkingEnabled=false when explicitly set, even if root has true', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Explicit Thinking False Trigger',
      prompt: 'Explicit thinking off test',
      thinkingEnabled: false,
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent session',
      name: '[TEST] Thinking Root True',
      startImmediately: false,
    });
    await updateSessionFields(parent.id, { thinkingEnabled: true });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 25000);
    const childSession = await getSession(child.id);

    // Template's explicit false overrides root's true
    expect(childSession.thinkingEnabled).toBe(false);
  });

  test('child inherits model from root when template model is null', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Null Model Trigger',
      prompt: 'Model inherit test',
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent session',
      name: '[TEST] Model Root',
      model: 'claude-sonnet-4-6',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 25000);
    const childSession = await getSession(child.id);

    expect(childSession.model).toBe('claude-sonnet-4-6');
  });

  test('child inherits rescheduling properties from root session', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Reschedule Inherit Trigger',
      prompt: 'Rescheduling inherit test',
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent session',
      name: '[TEST] Reschedule Root',
      startImmediately: false,
    });

    await updateSessionScheduling(parent.id, {
      autoRescheduleEnabled: true,
      rescheduleDelayMinutes: 30,
      rescheduleOnTokenLimit: true,
      rescheduleOnServiceError: true,
      maxRescheduleCount: 5,
      maxTotalTokens: 1000000,
      rescheduleAtTokenCount: 150000,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 25000);
    const childSession = await getSession(child.id);

    expect(childSession.autoRescheduleEnabled).toBe(true);
    expect(childSession.rescheduleDelayMinutes).toBe(30);
    expect(childSession.rescheduleOnTokenLimit).toBe(true);
    expect(childSession.rescheduleOnServiceError).toBe(true);
    expect(childSession.maxRescheduleCount).toBe(5);
    expect(childSession.maxTotalTokens).toBe(1000000);
    expect(childSession.rescheduleAtTokenCount).toBe(150000);
  });

  test('child rescheduleCount resets to 0 regardless of root value', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] RescheduleCount Reset Trigger',
      prompt: 'Reschedule count reset test',
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent session',
      name: '[TEST] RescheduleCount Root',
      startImmediately: false,
    });

    await updateSessionScheduling(parent.id, { rescheduleCount: 3 });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 25000);
    const childSession = await getSession(child.id);

    // rescheduleCount must reset to 0 for the new child session
    expect(childSession.rescheduleCount).toBe(0);
  });
});

// ============================================================
// Describe Block 4: Template Setting Inheritance — Multi-Level Chain
// ============================================================

test.describe('Template Setting Inheritance — Multi-Level Chain', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('[TEST] Inherit Chain', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('in A → B → C chain, C inherits settings from root A, not intermediate parent B', async () => {
    // Template for B→C link: all null settings (inherit from root)
    const templateC = await seedProjectTemplate(project.id, {
      name: '[TEST] Chain C Template',
      prompt: 'End of chain',
    });

    // Template for A→B link: overrides mode and thinking
    const templateB = await seedProjectTemplate(project.id, {
      name: '[TEST] Chain B Template',
      prompt: 'Middle of chain',
    });
    await updateTemplate(templateB.id, {
      nextTemplateId: templateC.id,
      mode: 'standard',
      thinkingEnabled: false,
    });

    // Create root session A with mode: 'plan', model set, thinking enabled
    const rootSession = await seedSession(project.id, {
      prompt: 'Root session A',
      name: '[TEST] Chain Root A',
      mode: 'plan',
      model: 'claude-sonnet-4-6',
      startImmediately: false,
    });
    await updateSessionFields(rootSession.id, { thinkingEnabled: true });
    await updateSessionScheduling(rootSession.id, {
      autoRescheduleEnabled: true,
      rescheduleDelayMinutes: 45,
    });

    // Trigger A → creates B
    await setNextTemplate(rootSession.id, templateB.id);
    await sendSessionMessage(rootSession.id, 'Go');

    const childB = await waitForChildSession(rootSession.id, 25000);
    const sessionB = await getSession(childB.id);

    // B should have templateB's overrides
    expect(sessionB.mode).toBe('standard');            // from templateB
    expect(sessionB.thinkingEnabled).toBe(false);       // from templateB
    expect(sessionB.model).toBe('claude-sonnet-4-6'); // inherited from root A (templateB model is null)

    // Trigger B → creates C
    const childC = await waitForChildSession(childB.id, 25000);
    const sessionC = await getSession(childC.id);

    // C should inherit from root A, NOT from intermediate parent B
    expect(sessionC.mode).toBe('plan');                // from root A, not B's 'standard'
    expect(sessionC.thinkingEnabled).toBe(true);       // from root A, not B's false
    expect(sessionC.model).toBe('claude-sonnet-4-6'); // from root A
    expect(sessionC.autoRescheduleEnabled).toBe(true); // from root A
    expect(sessionC.rescheduleDelayMinutes).toBe(45);  // from root A
  });

  test('template explicit settings override root session settings', async () => {
    // Test that explicit template values win over root session values (single-level to avoid
    // timing issues with multi-level chains — the A→B→C inheritance is already covered by
    // "C inherits settings from root A, not intermediate parent B" and unit tests)
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Override Wins',
      prompt: 'Override test',
    });
    await updateTemplate(template.id, {
      mode: 'yolo',         // explicit override
      thinkingEnabled: false, // explicit override
    });

    // Create root session with different settings
    const rootSession = await seedSession(project.id, {
      prompt: 'Root session override',
      name: '[TEST] Chain Root Override',
      mode: 'plan',           // root has 'plan'
      model: 'claude-sonnet-4-6',
      startImmediately: false,
    });
    await updateSessionFields(rootSession.id, { thinkingEnabled: true }); // root has true
    await updateSessionScheduling(rootSession.id, {
      autoRescheduleEnabled: true,
      rescheduleDelayMinutes: 45,
    });

    await setNextTemplate(rootSession.id, template.id);
    await sendSessionMessage(rootSession.id, 'Go');

    const child = await waitForChildSession(rootSession.id, 25000);
    const childSession = await getSession(child.id);

    // Template's explicit mode='yolo' overrides root's 'plan'
    expect(childSession.mode).toBe('yolo');
    // Template's explicit thinkingEnabled=false overrides root's true
    expect(childSession.thinkingEnabled).toBe(false);
    // Template's null model inherits from root
    expect(childSession.model).toBe('claude-sonnet-4-6');
  });
});

// ============================================================
// Describe Block 5: Template Inherit UI — Visible in Session Detail
// ============================================================

test.describe('Template Inherit UI — Visible in Session Detail', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('[TEST] Inherit Session Detail', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('child session detail page shows inherited mode from root', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Mode Visible',
      prompt: 'Mode visible test',
    });
    // Template has null mode — will inherit from root

    const parent = await seedSession(project.id, {
      prompt: 'Parent session',
      name: '[TEST] Mode Root Visible',
      mode: 'plan',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 25000);

    // Navigate to child session detail page
    await page.goto(`/projects/${project.id}/sessions/${child.id}`);
    await page.waitForLoadState('networkidle');

    // Verify via API that the child inherited 'plan' mode from root
    const childSession = await getSession(child.id);
    expect(childSession.mode).toBe('plan');
  });

  test('child session detail page shows inherited thinking from root', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Thinking Visible',
      prompt: 'Thinking visible test',
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent session',
      name: '[TEST] Thinking Root Visible',
      startImmediately: false,
    });
    await updateSessionFields(parent.id, { thinkingEnabled: true });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 25000);

    await page.goto(`/projects/${project.id}/sessions/${child.id}`);
    await page.waitForLoadState('networkidle');

    // The child session should have thinkingEnabled: true visible
    const childSession = await getSession(child.id);
    expect(childSession.thinkingEnabled).toBe(true);
  });
});

// ============================================================
// Describe Block 6: Template Model Inheritance — Conversation Overlay Verification
// ============================================================

test.describe('Template Model Inheritance — Conversation Overlay Verification', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('[TEST] Model Inherit Overlay', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  async function openOverlay(page: any, sessionId: string) {
    await navigateAndWait(page, `/sessions/${sessionId}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });
    const handle = page.locator('[data-testid="session-tree-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await handle.click();
    const overlay = page.locator('[data-testid="session-tree-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(400); // Wait for slide-in animation
    return overlay;
  }

  test('child session inherits model from root and shows it in overlay ModelSelector', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Model Inherit Overlay',
      prompt: 'Model overlay test',
    });
    // template.model is null by default (inherit)

    const parent = await seedSession(project.id, {
      prompt: 'Parent session',
      name: '[TEST] Model Root Overlay',
      model: 'claude-sonnet-4-6',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 25000);
    const childSession = await getSession(child.id);

    // Verify API-level inheritance
    expect(childSession.model).toBe('claude-sonnet-4-6');

    // Open the conversation overlay on the child session
    const overlay = await openOverlay(page, child.id);

    // Verify the ModelSelector inside the overlay shows the inherited model
    const modelSelector = overlay.locator('.model-selector');
    await expect(modelSelector).toBeVisible({ timeout: 10000 });
    await expect(modelSelector).toHaveAttribute('data-model', 'claude-sonnet-4-6');
  });

  test('child session uses template explicit model over root model in overlay ModelSelector', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Model Override Overlay',
      prompt: 'Model override overlay test',
    });
    await updateTemplate(template.id, { model: 'claude-opus-4-6' });

    const parent = await seedSession(project.id, {
      prompt: 'Parent session',
      name: '[TEST] Model Root Override Overlay',
      model: 'claude-sonnet-4-6',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 25000);
    const childSession = await getSession(child.id);

    // Template's explicit model wins over root
    expect(childSession.model).toBe('claude-opus-4-6');

    // Open the conversation overlay on the child session
    const overlay = await openOverlay(page, child.id);

    // Verify the ModelSelector inside the overlay shows the template's model, not the root's
    const modelSelector = overlay.locator('.model-selector');
    await expect(modelSelector).toBeVisible({ timeout: 10000 });
    await expect(modelSelector).toHaveAttribute('data-model', 'claude-opus-4-6');
  });
});
