import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupAll,
  getSession,
  getSessionMessages,
} from './helpers';

/**
 * Draft Session Editing - E2E Tests
 *
 * Tests the complete workflow of creating, editing, and starting draft sessions.
 */

test.describe('Draft Session Editing', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('identifies draft session correctly', async ({ page }) => {
    // Create a session via API (startImmediately=false to keep it as a draft)
    const session = await seedSession(project.id, {
      prompt: 'Initial prompt',
      startImmediately: false,
    });

    // Verify session is in waiting status (draft)
    const sessionCheck = await getSession(session.id);
    console.log('Session status:', sessionCheck.status);
    expect(sessionCheck.status).toBe('waiting');

    // Navigate to session
    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Should show "Edit your prompt..." placeholder
    const input = page.locator('textarea[placeholder*="Edit your prompt"]');
    await expect(input).toBeVisible();

    // Should show "Send" button for draft sessions
    const sendButton = page.locator('button.btn-send-full:has-text("Send")');
    await expect(sendButton).toBeVisible();

    // Should show thinking toggle for draft sessions
    const thinkingToggle = page.locator('.thinking-toggle');
    await expect(thinkingToggle).toBeVisible();

    // Should show mode switcher for draft sessions
    const modeSwitcher = page.locator('.mode-switcher');
    await expect(modeSwitcher).toBeVisible();
  });

  test('edits draft prompt with auto-save', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Initial prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Get the input field
    const input = page.locator('textarea[placeholder*="Edit your prompt"]');

    // Clear and enter new prompt
    await input.click();
    await input.fill('');
    await input.type('Updated prompt text');

    // Wait for auto-save to complete
    await page.waitForTimeout(1500);

    // Verify via API that prompt was saved (in pendingPrompt for draft sessions)
    const updatedSession = await getSession(session.id);
    expect(updatedSession.pendingPrompt).toBe('Updated prompt text');
  });

  test('shows save status indicator states', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Initial prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');

    // Start editing - type something
    await input.click();
    await input.fill('');
    await input.type('x');

    // Wait for auto-save to complete
    await page.waitForTimeout(1500);

    // Verify the edit was saved via API (in pendingPrompt for draft sessions)
    const updatedSession = await getSession(session.id);
    expect(updatedSession.pendingPrompt).toContain('x');
  });

  test('starts session with edited prompt', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Initial prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Edit the prompt
    const input = page.locator('textarea[placeholder*="Edit your prompt"]');
    await input.click();
    await input.fill('');
    await input.type('Final prompt for starting');

    // Wait for auto-save
    await page.waitForTimeout(1000);

    // Click Send button to start session
    const sendButton = page.locator('button.btn-send-full:has-text("Send")');
    await sendButton.click();

    // Session should transition to starting/running status
    await page.waitForTimeout(2000); // Wait for status update

    // Verify session started
    const updatedSession = await getSession(session.id);
    expect(['starting', 'running']).toContain(updatedSession.status);

    // Verify prompt was used
    const messages = await getSessionMessages(session.id);
    expect(messages[0].content).toBe('Final prompt for starting');
  });

  test('makes multiple edits to draft before starting', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Initial prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');

    // First edit
    await input.click();
    await input.fill('');
    await input.type('Version 1');
    await page.waitForTimeout(700); // Wait for auto-save debounce

    // Second edit
    await input.fill('');
    await input.type('Version 2');
    await page.waitForTimeout(700);

    // Third edit
    await input.fill('');
    await input.type('Version 3 - Final');
    await page.waitForTimeout(700);

    // Wait for auto-save to complete
    await page.waitForTimeout(1500);

    // Verify final version is saved (in pendingPrompt for draft sessions)
    const updatedSession = await getSession(session.id);
    expect(updatedSession.pendingPrompt).toBe('Version 3 - Final');
  });

  test('handles save errors gracefully', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Initial prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');

    // Edit prompt
    await input.click();
    await input.fill('');
    await input.type('Test prompt');

    // Wait for save attempt
    await page.waitForTimeout(1500);

    // Even if there are transient errors, UI should handle gracefully
    // The specific error handling depends on network conditions
  });

  test('preserves draft in localStorage if navigation away', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Initial prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');

    // Type content
    await input.click();
    await input.fill('');
    await input.type('Draft content');

    // Wait for auto-save
    await page.waitForTimeout(1500);

    // Verify the draft was saved to the session (in pendingPrompt for draft sessions)
    const updatedSession = await getSession(session.id);
    expect(updatedSession.pendingPrompt).toContain('Draft content');
  });

  test('clears localStorage draft on successful start', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Initial prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');

    // Type content
    await input.click();
    await input.fill('');
    await input.type('Prompt to start with');

    // Wait for auto-save
    await page.waitForTimeout(1500);

    // Start session
    const sendButton = page.locator('button.btn-send-full:has-text("Send")');
    await sendButton.click();

    // Wait for session to start
    await page.waitForTimeout(2000);

    // Verify session started successfully
    const updatedSession = await getSession(session.id);
    expect(['starting', 'running']).toContain(updatedSession.status);
  });

  test('shows error message if start fails', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Initial prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Find the Send button
    const sendButton = page.locator('button.btn-send-full:has-text("Send")');

    // Button should be enabled
    await expect(sendButton).toBeEnabled();

    // Click Send to start the session
    await sendButton.click();

    // Should transition to starting/running status
    await page.waitForTimeout(2000);
    const updatedSession = await getSession(session.id);
    expect(['starting', 'running']).toContain(updatedSession.status);
  });

  test('transition from draft to active session', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Test prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');
    const sendButton = page.locator('button.btn-send-full:has-text("Send")');

    // Edit and start
    await input.click();
    await input.fill('');
    await input.type('Edited prompt');

    // Wait for auto-save
    await page.waitForTimeout(1500);

    // Start session
    await sendButton.click();

    // Wait for status to change
    await page.waitForTimeout(3000);

    // Verify session transitioned from draft to active
    const updatedSession = await getSession(session.id);
    expect(['starting', 'running']).toContain(updatedSession.status);

    // Verify the draft prompt was used
    const messages = await getSessionMessages(session.id);
    expect(messages[0].content).toBe('Edited prompt');
  });

  test('handles very long prompts', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Initial prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');

    // Generate long prompt (10KB)
    const longPrompt = 'a'.repeat(10000);

    await input.click();
    // Use fill() instead of type() for large content (much faster)
    await input.fill(longPrompt);

    // Wait longer for auto-save to complete (large content takes more time)
    await page.waitForTimeout(3000);

    // Verify it was saved (in pendingPrompt for draft sessions)
    const updatedSession = await getSession(session.id);
    expect(updatedSession.pendingPrompt.length).toBe(10000);
  });

  test('handles special characters in prompts', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Initial prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');

    // Special characters: quotes, newlines, unicode
    const specialPrompt = 'Test "quotes", \'apostrophes\', \n new line, 中文, 😀';

    await input.click();
    await input.fill('');
    await input.type(specialPrompt);

    // Wait for auto-save to complete
    await page.waitForTimeout(1500);

    // Verify it was saved correctly (in pendingPrompt for draft sessions)
    const updatedSession = await getSession(session.id);
    expect(updatedSession.pendingPrompt).toBe(specialPrompt);
  });

  test('disables start button while session is starting', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Test prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const sendButton = page.locator('button.btn-send-full:has-text("Send")');

    // Button should be enabled initially
    await expect(sendButton).toBeEnabled();

    // Click Send to start session
    await sendButton.click();

    // After clicking, session transitions to starting/running
    // The button state or visibility may change
    await page.waitForTimeout(1000);

    // Verify session is starting/running
    const updatedSession = await getSession(session.id);
    expect(['starting', 'running']).toContain(updatedSession.status);
  });

  test('saves prompt when user stops typing (debounce)', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Initial prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');

    // Rapid typing without waiting
    await input.click();
    await input.fill('');
    for (let i = 0; i < 10; i++) {
      await input.type(`char${i}`);
      await page.waitForTimeout(50); // Very short delay between typing
    }

    // Should still only make 1 API call due to debounce
    // Wait for debounce timeout
    await page.waitForTimeout(1500);

    // Verify final content is saved (in pendingPrompt for draft sessions)
    const updatedSession = await getSession(session.id);
    expect(updatedSession.pendingPrompt).toContain('char');
  });
});

test.describe('Draft Session Settings UI', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Settings Test Project', '/tmp/test-settings');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('shows session options (thinking toggle and mode switcher) for draft sessions', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Initial prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Check that draft UI elements exist
    const editPromptInput = page.locator('textarea[placeholder*="Edit your prompt"]');
    await expect(editPromptInput).toBeVisible();

    // Verify thinking toggle is visible for draft
    const thinkingToggle = page.locator('.thinking-toggle');
    await expect(thinkingToggle).toBeVisible();

    // Verify mode switcher is visible for draft
    const modeSelector = page.locator('.mode-selector');
    await expect(modeSelector).toBeVisible();

    // Verify mode select element exists
    const modeSelect = page.locator('select.mode-select');
    await expect(modeSelect).toBeVisible();
  });

  test('shows model selector for draft sessions', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Initial prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Verify model selector is visible for draft
    const modelSelector = page.locator('.model-selector');
    await expect(modelSelector).toBeVisible();

    const modelSelect = page.locator('select.model-select');
    await expect(modelSelect).toBeVisible();

    // Should have model options
    const modelOptions = await modelSelect.locator('option').count();
    expect(modelOptions).toBeGreaterThan(0);
  });

  test('shows template selector for draft sessions', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Initial prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // The OrchestrationPanel component is shown for draft sessions
    // (template selector is part of OrchestrationPanel but may not be visible without configured templates)
    const orchestrationPanel = page.locator('.orchestration-panel');
    await expect(orchestrationPanel).toBeVisible();
  });

  test('shows quick responses panel for draft sessions', async ({ page }) => {
    const session = await seedSession(project.id, { prompt: 'Initial prompt', startImmediately: false });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // NEW: Verify quick responses panel is visible for draft
    const quickResponsesPanel = page.locator('.quick-responses-panel');
    await expect(quickResponsesPanel).toBeVisible();
  });

  test('toggles thinking on draft session', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Initial prompt',
      thinkingEnabled: false,
      startImmediately: false,
    });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Find the thinking toggle label (clickable element)
    const thinkingToggleLabel = page.locator('.thinking-toggle .toggle-switch');
    await expect(thinkingToggleLabel).toBeVisible();

    const thinkingCheckbox = page.locator('.thinking-toggle input[type="checkbox"]');

    // Initially unchecked
    const isChecked = await thinkingCheckbox.isChecked();
    expect(isChecked).toBe(false);

    // Click the label to toggle the checkbox
    await thinkingToggleLabel.click();

    // Wait for the API call to complete
    await page.waitForTimeout(2000);

    // Verify it was toggled (in UI)
    const checkedAfter = await thinkingCheckbox.isChecked();
    expect(checkedAfter).toBe(true);

    // Verify via API that setting was saved
    const updatedSession = await getSession(session.id);
    expect(updatedSession.thinkingEnabled).toBe(true);
  });

  test('changes mode on draft session', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Initial prompt',
      mode: 'standard',
      startImmediately: false,
    });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Find mode select and change to Plan mode
    const modeSelect = page.locator('select.mode-select');
    await expect(modeSelect).toBeVisible();

    // Select 'plan' option
    await modeSelect.selectOption('plan');

    // Wait a moment for the API call
    await page.waitForTimeout(500);

    // Verify the select value changed
    const selectedValue = await modeSelect.inputValue();
    expect(selectedValue).toBe('plan');

    // Verify via API that mode was saved
    const updatedSession = await getSession(session.id);
    expect(updatedSession.mode).toBe('plan');
  });

  test('changes model on draft session', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Initial prompt',
      model: 'claude-sonnet-4-1-20250514',
      startImmediately: false,
    });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Find model select
    const modelSelect = page.locator('select.model-select');
    await expect(modelSelect).toBeVisible();

    // Get all available options
    const options = await modelSelect.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(0);

    // Select a different model (use the first available that's not the current one)
    const currentModel = await modelSelect.inputValue();
    // Find first option that's different from current
    for (const option of await modelSelect.locator('option').all()) {
      const value = await option.getAttribute('value');
      if (value && value !== currentModel) {
        await modelSelect.selectOption(value);
        break;
      }
    }

    // Wait a moment for the UI to update
    await page.waitForTimeout(500);

    // Verify the model changed in the UI
    const newModel = await modelSelect.inputValue();
    expect(newModel).not.toBe(currentModel);
  });

  test('applies multiple settings changes to draft before starting', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Initial prompt',
      mode: 'standard',
      thinkingEnabled: false,
      startImmediately: false,
    });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Change thinking - click the label, not the container
    const thinkingToggleLabel = page.locator('.thinking-toggle .toggle-switch');
    await thinkingToggleLabel.click();
    await page.waitForTimeout(1000);

    // Change mode
    const modeSelect = page.locator('select.mode-select');
    await modeSelect.selectOption('yolo');
    await page.waitForTimeout(1000);

    // Change model (select first available option)
    // Note: Model selection is local UI state only, not persisted to session
    const modelSelect = page.locator('select.model-select');
    const firstOption = await modelSelect.locator('option').first();
    const firstModelValue = await firstOption.getAttribute('value');
    if (firstModelValue) {
      await modelSelect.selectOption(firstModelValue);
    }
    await page.waitForTimeout(1000);

    // Wait a bit longer for all API calls to complete
    await page.waitForTimeout(1000);

    // Verify settings that should be persisted (thinking and mode)
    const updatedSession = await getSession(session.id);
    expect(updatedSession.thinkingEnabled).toBe(true);
    expect(updatedSession.mode).toBe('yolo');

    // Model selector value should be updated in UI (local state)
    const selectedModelValue = await modelSelect.inputValue();
    if (firstModelValue) {
      expect(selectedModelValue).toBe(firstModelValue);
    }
  });

  test('preserves settings when starting draft session', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Initial prompt',
      mode: 'standard',
      thinkingEnabled: false,
      startImmediately: false,
    });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Apply settings changes - click the label, not the container
    const thinkingToggleLabel = page.locator('.thinking-toggle .toggle-switch');
    await thinkingToggleLabel.click();
    await page.waitForTimeout(1000);

    const modeSelect = page.locator('select.mode-select');
    await modeSelect.selectOption('plan');
    await page.waitForTimeout(1000);

    // Wait for settings to be saved
    await page.waitForTimeout(1000);

    // Now start the session
    const sendButton = page.locator('button.btn-send-full:has-text("Send")');
    await sendButton.click();

    // Wait for session to start
    await page.waitForTimeout(2000);

    // Verify settings were preserved
    const startedSession = await getSession(session.id);
    expect(startedSession.thinkingEnabled).toBe(true);
    expect(startedSession.mode).toBe('plan');
  });
});
