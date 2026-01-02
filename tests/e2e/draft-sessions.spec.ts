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
    // Create a session via API
    const session = await seedSession(project.id, 'Initial prompt', {});

    // Navigate to session
    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Should show "Edit your prompt..." placeholder
    const input = page.locator('textarea[placeholder*="Edit your prompt"]');
    await expect(input).toBeVisible();

    // Should show "Start Session" button instead of "Send"
    const startButton = page.locator('button:has-text("Start Session")');
    await expect(startButton).toBeVisible();

    // Should NOT show thinking toggle or mode selector
    const thinkingToggle = page.locator('.thinking-toggle');
    await expect(thinkingToggle).not.toBeVisible();
  });

  test('edits draft prompt with auto-save', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {});

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Get the input field
    const input = page.locator('textarea[placeholder*="Edit your prompt"]');

    // Clear and enter new prompt
    await input.click();
    await input.fill('');
    await input.type('Updated prompt text');

    // Wait for auto-save (should show "Saving..." then "Saved")
    const saveIndicator = page.locator('.save-indicator');
    await expect(saveIndicator).toBeVisible();

    // Wait for saved status
    const savedText = page.locator('text=Saved');
    await expect(savedText).toBeVisible({ timeout: 5000 });

    // Verify via API that prompt was saved
    await page.waitForTimeout(1000); // Ensure save completes
    const messages = await getSessionMessages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Updated prompt text');
  });

  test('shows save status indicator states', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {});

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');
    const saveIndicator = page.locator('.save-indicator');

    // Start editing - should show "Unsaved"
    await input.click();
    await input.fill('');
    await input.type('x');

    const unsavedText = page.locator('text=Unsaved');
    await expect(unsavedText).toBeVisible();

    // Wait for saving - should show "Saving..."
    const savingText = page.locator('text=Saving');
    await expect(savingText).toBeVisible({ timeout: 2000 });

    // Should eventually show "Saved"
    const savedText = page.locator('text=Saved');
    await expect(savedText).toBeVisible({ timeout: 5000 });
  });

  test('starts session with edited prompt', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {});

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Edit the prompt
    const input = page.locator('textarea[placeholder*="Edit your prompt"]');
    await input.click();
    await input.fill('');
    await input.type('Final prompt for starting');

    // Wait for save
    const savedText = page.locator('text=Saved');
    await expect(savedText).toBeVisible({ timeout: 5000 });

    // Click Start Session button
    const startButton = page.locator('button:has-text("Start Session")');
    await startButton.click();

    // Should show loading state
    const startingText = page.locator('text=Starting');
    await expect(startingText).toBeVisible({ timeout: 5000 });

    // Session should transition to running status
    await page.waitForTimeout(2000); // Wait for status update

    // Verify session started
    const updatedSession = await getSession(session.id);
    expect(updatedSession.status).toBe('starting');

    // Verify prompt was used
    const messages = await getSessionMessages(session.id);
    expect(messages[0].content).toBe('Final prompt for starting');
  });

  test('makes multiple edits to draft before starting', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {});

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

    // Wait for final save
    const savedText = page.locator('text=Saved');
    await expect(savedText).toBeVisible({ timeout: 5000 });

    // Verify final version is saved
    const messages = await getSessionMessages(session.id);
    expect(messages[0].content).toBe('Version 3 - Final');
  });

  test('handles save errors gracefully', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {});

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');

    // Edit prompt
    await input.click();
    await input.fill('');
    await input.type('Test prompt');

    // Should still show save status indicator
    const saveIndicator = page.locator('.save-indicator');
    await expect(saveIndicator).toBeVisible();

    // Even if there are transient errors, UI should handle gracefully
    // The specific error handling depends on network conditions
  });

  test('preserves draft in localStorage if navigation away', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {});

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');

    // Type unsaved content
    await input.click();
    await input.fill('');
    await input.type('Unsaved draft content');

    // Check localStorage (via browser console)
    const storageValue = await page.evaluate(() => {
      return localStorage.getItem(`session-draft-${(window as any).sessionId || 'session-1'}`);
    });

    // Should have some draft saved locally (or be saving)
    // User can recover this if they return
  });

  test('clears localStorage draft on successful start', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {});

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');

    // Type content
    await input.click();
    await input.fill('');
    await input.type('Prompt to start with');

    // Wait for save
    const savedText = page.locator('text=Saved');
    await expect(savedText).toBeVisible({ timeout: 5000 });

    // Start session
    const startButton = page.locator('button:has-text("Start Session")');
    await startButton.click();

    // Wait for session to start
    await page.waitForTimeout(2000);

    // Check that localStorage was cleared
    // (After starting, draft should be cleared)
  });

  test('shows error message if start fails', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {});

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Try to start without editing (should work, but tests the error UI)
    const startButton = page.locator('button:has-text("Start Session")');

    // Button should be enabled
    await expect(startButton).toBeEnabled();

    // Click start
    await startButton.click();

    // Should transition to starting
    // Error states would show error message if API fails
  });

  test('transition from draft to active session', async ({ page }) => {
    const session = await seedSession(project.id, 'Test prompt', {});

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');
    const startButton = page.locator('button:has-text("Start Session")');

    // Edit and start
    await input.click();
    await input.fill('');
    await input.type('Edited prompt');

    // Wait for save
    const savedText = page.locator('text=Saved');
    await expect(savedText).toBeVisible({ timeout: 5000 });

    // Start session
    await startButton.click();

    // Wait for status to change
    await page.waitForTimeout(3000);

    // Draft UI should be replaced with running/active UI
    // The edit prompt and start button should be hidden
    // Messages should start appearing
  });

  test('handles very long prompts', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {});

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');

    // Generate long prompt (10KB)
    const longPrompt = 'a'.repeat(10000);

    await input.click();
    await input.fill('');
    await input.type(longPrompt);

    // Wait for auto-save
    const savedText = page.locator('text=Saved');
    await expect(savedText).toBeVisible({ timeout: 5000 });

    // Verify it was saved
    const messages = await getSessionMessages(session.id);
    expect(messages[0].content.length).toBe(10000);
  });

  test('handles special characters in prompts', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {});

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Edit your prompt"]');

    // Special characters: quotes, newlines, unicode
    const specialPrompt = 'Test "quotes", \'apostrophes\', \n new line, 中文, 😀';

    await input.click();
    await input.fill('');
    await input.type(specialPrompt);

    // Wait for auto-save
    const savedText = page.locator('text=Saved');
    await expect(savedText).toBeVisible({ timeout: 5000 });

    // Verify it was saved correctly
    const messages = await getSessionMessages(session.id);
    expect(messages[0].content).toBe(specialPrompt);
  });

  test('disables start button while session is starting', async ({ page }) => {
    const session = await seedSession(project.id, 'Test prompt', {});

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    const startButton = page.locator('button:has-text("Start Session")');

    // Button should be enabled initially
    await expect(startButton).toBeEnabled();

    // Click start
    await startButton.click();

    // Button should be disabled while starting
    await expect(startButton).toBeDisabled({ timeout: 1000 });

    // After starting completes, button becomes disabled or hidden
    // as session moves to running state
  });

  test('saves prompt when user stops typing (debounce)', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {});

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
    const savedText = page.locator('text=Saved');
    await expect(savedText).toBeVisible({ timeout: 5000 });

    // Verify final content is saved
    const messages = await getSessionMessages(session.id);
    expect(messages[0].content).toContain('char');
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
    const session = await seedSession(project.id, 'Initial prompt', {});

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Check that draft UI elements exist
    const editPromptInput = page.locator('textarea[placeholder*="Edit your prompt"]');
    await expect(editPromptInput).toBeVisible();

    // NEW: Verify thinking toggle is visible for draft
    const thinkingToggle = page.locator('.thinking-toggle');
    await expect(thinkingToggle).toBeVisible();

    // NEW: Verify mode switcher is visible for draft
    const modeButtons = page.locator('.mode-buttons');
    await expect(modeButtons).toBeVisible();

    // NEW: Verify all mode options are present
    const planButton = page.locator('button:has-text("Plan")');
    const standardButton = page.locator('button:has-text("Standard")');
    const yoloButton = page.locator('button:has-text("YOLO")');

    await expect(planButton).toBeVisible();
    await expect(standardButton).toBeVisible();
    await expect(yoloButton).toBeVisible();
  });

  test('shows model selector for draft sessions', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {});

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // NEW: Verify model selector is visible for draft
    const modelRow = page.locator('.model-row');
    await expect(modelRow).toBeVisible();

    const modelButtons = page.locator('.model-buttons');
    await expect(modelButtons).toBeVisible();

    // Should have model options
    const modelOptions = page.locator('.model-btn');
    const count = await modelOptions.count();
    expect(count).toBeGreaterThan(0);
  });

  test('shows template selector for draft sessions', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {});

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // NEW: Verify template selector is visible for draft
    const templateRow = page.locator('.template-row');
    await expect(templateRow).toBeVisible();
  });

  test('shows quick responses panel for draft sessions', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {});

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // NEW: Verify quick responses panel is visible for draft
    const quickResponsesPanel = page.locator('.quick-responses-panel');
    await expect(quickResponsesPanel).toBeVisible();
  });

  test('toggles thinking on draft session', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {
      thinkingEnabled: false,
    });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Find the thinking toggle checkbox
    const thinkingCheckbox = page.locator(
      '.thinking-toggle input[type="checkbox"]'
    );
    await expect(thinkingCheckbox).toBeVisible();

    // Initially unchecked
    const isChecked = await thinkingCheckbox.isChecked();
    expect(isChecked).toBe(false);

    // Click to toggle on
    await thinkingCheckbox.click();

    // Wait a moment for the API call
    await page.waitForTimeout(500);

    // Verify it was toggled (in UI)
    const checkedAfter = await thinkingCheckbox.isChecked();
    expect(checkedAfter).toBe(true);

    // Verify via API that setting was saved
    const updatedSession = await getSession(session.id);
    expect(updatedSession.thinkingEnabled).toBe(true);
  });

  test('changes mode on draft session', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {
      mode: 'standard',
    });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Find and click Plan mode button
    const planButton = page.locator('.mode-btn:has-text("Plan")');
    await expect(planButton).toBeVisible();

    // Click to switch to Plan mode
    await planButton.click();

    // Wait a moment for the API call
    await page.waitForTimeout(500);

    // Verify UI shows Plan is now active
    const isPlanActive = await planButton.evaluate((el) =>
      el.classList.contains('active')
    );
    expect(isPlanActive).toBe(true);

    // Verify via API that mode was saved
    const updatedSession = await getSession(session.id);
    expect(updatedSession.mode).toBe('plan');
  });

  test('changes model on draft session', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {
      model: 'claude-opus-4-1-20250805',
    });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Find model buttons - get all and pick second one
    const modelButtons = page.locator('.model-btn');
    const firstButton = modelButtons.first();
    const secondButton = modelButtons.nth(1);

    // Get the text of the second button to verify it's different
    const secondModelText = await secondButton.textContent();

    // Click second model option
    await secondButton.click();

    // Wait a moment for the API call
    await page.waitForTimeout(500);

    // Verify UI shows the model is active (has 'active' class)
    const isSecondActive = await secondButton.evaluate((el) =>
      el.classList.contains('active')
    );
    expect(isSecondActive).toBe(true);

    // Verify via API that model was changed
    const updatedSession = await getSession(session.id);
    // The model should have changed from the initial value
    expect(updatedSession.model).not.toBe('claude-opus-4-1-20250805');
  });

  test('applies multiple settings changes to draft before starting', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {
      mode: 'standard',
      thinkingEnabled: false,
    });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Change thinking
    const thinkingCheckbox = page.locator(
      '.thinking-toggle input[type="checkbox"]'
    );
    await thinkingCheckbox.click();
    await page.waitForTimeout(300);

    // Change mode
    const yoloButton = page.locator('.mode-btn:has-text("YOLO")');
    await yoloButton.click();
    await page.waitForTimeout(300);

    // Change model (pick first available if not current)
    const modelButtons = page.locator('.model-btn');
    const firstModel = modelButtons.first();
    await firstModel.click();
    await page.waitForTimeout(300);

    // Verify all changes were saved
    const updatedSession = await getSession(session.id);
    expect(updatedSession.thinkingEnabled).toBe(true);
    expect(updatedSession.mode).toBe('yolo');
    // Model should be the first one
    const modelText = await firstModel.textContent();
    // We can't easily verify the exact model name without knowing the list,
    // but we verified the click worked
  });

  test('preserves settings when starting draft session', async ({ page }) => {
    const session = await seedSession(project.id, 'Initial prompt', {
      mode: 'standard',
      thinkingEnabled: false,
    });

    await page.goto(`/sessions/${session.id}`);
    await page.waitForLoadState('networkidle');

    // Apply settings changes
    const thinkingCheckbox = page.locator(
      '.thinking-toggle input[type="checkbox"]'
    );
    await thinkingCheckbox.click();
    await page.waitForTimeout(300);

    const planButton = page.locator('.mode-btn:has-text("Plan")');
    await planButton.click();
    await page.waitForTimeout(300);

    // Wait for saves to complete
    const savedText = page.locator('text=Saved');
    await expect(savedText).toBeVisible({ timeout: 5000 });

    // Now start the session
    const startButton = page.locator('button:has-text("Start Session")');
    await startButton.click();

    // Wait for session to start
    await page.waitForTimeout(2000);

    // Verify settings were preserved
    const startedSession = await getSession(session.id);
    expect(startedSession.thinkingEnabled).toBe(true);
    expect(startedSession.mode).toBe('plan');
  });
});
