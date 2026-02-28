import { test, expect } from '@playwright/test';
import {
  navigateAndWait,
  getSummarySettings,
  updateSummarySettings,
  resetSummarySettings,
  createProvider,
  cleanupProviders,
  BASE_URL,
  API_URL,
  TEST_PREFIX,
} from './helpers';

// Run tests serially to avoid global state interference with summary settings
test.describe.configure({ mode: 'serial' });

test.describe('Settings', () => {

  test.afterEach(async () => {
    // Always reset summary settings to avoid leaking state between categories
    await resetSummarySettings();
    await cleanupProviders();
  });

  test.describe('Category 1: Navigation', () => {
    test('navigating to /settings redirects to /settings/providers', async ({ page }) => {
      await navigateAndWait(page, `${BASE_URL}/settings`);

      expect(page.url()).toMatch(/\/settings\/providers$/);
      await expect(page.locator('a.tab[href="/settings/providers"]')).toHaveClass(/active/);
    });

    test('settings page shows three tabs', async ({ page }) => {
      await navigateAndWait(page, `${BASE_URL}/settings`);

      const tabs = page.locator('.tab');
      await expect(tabs).toHaveCount(3);

      await expect(tabs.nth(0)).toContainText('Model Providers');
      await expect(tabs.nth(1)).toContainText('Summary Settings');
      await expect(tabs.nth(2)).toContainText('Settings');
    });

    test('clicking Summary Settings tab navigates to summary view', async ({ page }) => {
      await navigateAndWait(page, `${BASE_URL}/settings/providers`);

      // Wait for the tab to be ready and clickable
      const summaryTab = page.locator('a.tab[href="/settings/summary"]');
      await summaryTab.waitFor({ state: 'visible' });
      await summaryTab.click();

      // Wait for navigation to complete
      await page.waitForURL(/\/settings\/summary$/);

      expect(page.url()).toMatch(/\/settings\/summary$/);
      await expect(page.locator('a.tab[href="/settings/summary"]')).toHaveClass(/active/);
      await expect(page.locator('a.tab[href="/settings/providers"]')).not.toHaveClass(/active/);
      await expect(page.locator('form.form.card')).toBeVisible();
    });

    test('clicking Model Providers tab navigates to providers view', async ({ page }) => {
      await navigateAndWait(page, `${BASE_URL}/settings/summary`);

      // Wait for the tab to be ready and clickable
      const providersTab = page.locator('a.tab[href="/settings/providers"]');
      await providersTab.waitFor({ state: 'visible' });
      await providersTab.click();

      // Wait for navigation to complete
      await page.waitForURL(/\/settings\/providers$/);

      expect(page.url()).toMatch(/\/settings\/providers$/);
      await expect(page.locator('a.tab[href="/settings/providers"]')).toHaveClass(/active/);
      // Wait for provider list to appear (may show skeleton briefly)
      await page.waitForSelector('.provider-list', { timeout: 10000 });
    });
  });

  test.describe('Category 2: Summary Settings — Display', () => {
    test.beforeEach(async () => {
      await resetSummarySettings();
    });

    test('summary settings form loads with default values', async ({ page }) => {
      await navigateAndWait(page, `${BASE_URL}/settings/summary`);
      await page.waitForSelector('form.form.card', { timeout: 10000 });

      const checkboxes = page.locator('input[type="checkbox"]');
      await expect(checkboxes.nth(0)).not.toBeChecked();
      await expect(checkboxes.nth(1)).not.toBeChecked();

      const textarea = page.locator('textarea#sessionTitlePrompt');
      const value = await textarea.inputValue();
      expect(value.length).toBeGreaterThan(0);
      expect(value).toContain('Guidelines for generating session titles');
    });

    test('form shows both checkboxes with labels', async ({ page }) => {
      await navigateAndWait(page, `${BASE_URL}/settings/summary`);
      await page.waitForSelector('form.form.card', { timeout: 10000 });

      const checkboxLabels = page.locator('.checkbox-label');
      await expect(checkboxLabels).toHaveCount(2);

      await expect(checkboxLabels.nth(0)).toContainText('Disable session summaries');
      await expect(checkboxLabels.nth(1)).toContainText('Disable conversation summaries');
    });

    test('form shows session title prompt textarea', async ({ page }) => {
      await navigateAndWait(page, `${BASE_URL}/settings/summary`);
      await page.waitForSelector('form.form.card', { timeout: 10000 });

      await expect(page.locator('label.form-label[for="sessionTitlePrompt"]')).toBeVisible();
      await expect(page.locator('label.form-label[for="sessionTitlePrompt"]')).toHaveText('Custom Session Title Prompt');

      const textarea = page.locator('textarea#sessionTitlePrompt');
      await expect(textarea).toBeVisible();

      // Verify it's editable
      await textarea.fill('Test text');
      await expect(textarea).toHaveValue('Test text');
      await textarea.fill('');
    });

    test('form shows Save and Reset buttons', async ({ page }) => {
      await navigateAndWait(page, `${BASE_URL}/settings/summary`);
      await page.waitForSelector('form.form.card', { timeout: 10000 });

      const saveButton = page.locator('button.btn.btn-primary[type="submit"]');
      await expect(saveButton).toBeVisible();
      await expect(saveButton).toBeEnabled();
      await expect(saveButton).toHaveText('Save Settings');

      const resetButton = page.locator('button.btn.btn-secondary');
      await expect(resetButton).toBeVisible();
      await expect(resetButton).toBeEnabled();
      await expect(resetButton).toHaveText('Reset to Defaults');
    });
  });

  test.describe('Category 3: Summary Settings — Save & Persistence', () => {
    test.beforeEach(async ({ page }) => {
      await resetSummarySettings();
      await navigateAndWait(page, `${BASE_URL}/settings/summary`);
      await page.waitForSelector('form.form.card', { timeout: 10000 });
    });

    test('checking disable session summaries and saving persists the setting', async ({ page }) => {
      await page.locator('.checkbox-label:has-text("Disable session summaries") input').check();
      await page.locator('button[type="submit"]').click();

      await expect(page.locator('.toast-message')).toHaveText('Summary settings saved successfully', { timeout: 10000 });
      await page.waitForSelector('form.form.card', { timeout: 10000 });

      // Reload page to verify persistence
      await page.reload();
      await page.waitForSelector('form.form.card', { timeout: 10000 });

      await expect(page.locator('.checkbox-label:has-text("Disable session summaries") input')).toBeChecked();

      // Verify via API
      const settings = await getSummarySettings();
      expect(settings.disableSessionSummaries).toBe(true);
    });

    test('checking disable conversation summaries and saving persists the setting', async ({ page }) => {
      await page.locator('.checkbox-label:has-text("Disable conversation summaries") input').check();
      await page.locator('button[type="submit"]').click();

      await expect(page.locator('.toast-message')).toHaveText('Summary settings saved successfully', { timeout: 10000 });
      await page.waitForSelector('form.form.card', { timeout: 10000 });

      // Reload page to verify persistence
      await page.reload();
      await page.waitForSelector('form.form.card', { timeout: 10000 });

      await expect(page.locator('.checkbox-label:has-text("Disable conversation summaries") input')).toBeChecked();

      // Verify via API
      const settings = await getSummarySettings();
      expect(settings.disableConversationSummaries).toBe(true);
    });

    test('editing session title prompt and saving persists the text', async ({ page }) => {
      await page.locator('textarea#sessionTitlePrompt').fill('Generate fun titles');
      await page.locator('button[type="submit"]').click();

      await expect(page.locator('.toast-message')).toHaveText('Summary settings saved successfully', { timeout: 10000 });
      await page.waitForSelector('form.form.card', { timeout: 10000 });

      // Reload page to verify persistence
      await page.reload();
      await page.waitForSelector('form.form.card', { timeout: 10000 });

      await expect(page.locator('textarea#sessionTitlePrompt')).toHaveValue('Generate fun titles');

      // Verify via API
      const settings = await getSummarySettings();
      expect(settings.sessionTitlePrompt).toBe('Generate fun titles');
    });

    test('saving multiple settings at once persists all changes', async ({ page }) => {
      await page.locator('.checkbox-label:has-text("Disable session summaries") input').check();
      await page.locator('.checkbox-label:has-text("Disable conversation summaries") input').check();
      await page.locator('textarea#sessionTitlePrompt').fill('Custom prompt');
      await page.locator('button[type="submit"]').click();

      await expect(page.locator('.toast-message')).toHaveText('Summary settings saved successfully', { timeout: 10000 });
      await page.waitForSelector('form.form.card', { timeout: 10000 });

      // Verify via API
      const settings = await getSummarySettings();
      expect(settings.disableSessionSummaries).toBe(true);
      expect(settings.disableConversationSummaries).toBe(true);
      expect(settings.sessionTitlePrompt).toBe('Custom prompt');
    });
  });

  test.describe('Category 4: Summary Settings — Reset', () => {
    test.beforeEach(async () => {
      // Pre-set non-default values via API
      await updateSummarySettings({
        disableSessionSummaries: true,
        disableConversationSummaries: true,
        sessionTitlePrompt: 'Custom title prompt for testing',
      });
    });

    test('reset to defaults shows confirmation dialog', async ({ page }) => {
      await navigateAndWait(page, `${BASE_URL}/settings/summary`);
      await page.waitForSelector('form.form.card', { timeout: 10000 });

      // Verify pre-conditions loaded
      await expect(page.locator('.checkbox-label:has-text("Disable session summaries") input')).toBeChecked();

      // Register dialog handler to dismiss
      page.once('dialog', async (dialog) => {
        expect(dialog.message()).toContain('Reset all summary settings to defaults?');
        await dialog.dismiss();
      });

      await page.locator('button:has-text("Reset to Defaults")').click();
    });

    test('accepting reset dialog resets all settings to defaults', async ({ page }) => {
      await navigateAndWait(page, `${BASE_URL}/settings/summary`);
      await page.waitForSelector('form.form.card', { timeout: 10000 });

      // Verify pre-conditions loaded
      await expect(page.locator('.checkbox-label:has-text("Disable session summaries") input')).toBeChecked();

      // Register dialog handler to accept
      page.once('dialog', async (dialog) => {
        expect(dialog.message()).toContain('Reset all summary settings to defaults?');
        await dialog.accept();
      });

      await page.locator('button:has-text("Reset to Defaults")').click();

      // Wait for toast and form to reappear
      await expect(page.locator('.toast-message')).toHaveText('Summary settings reset to defaults', { timeout: 10000 });
      await page.waitForSelector('form.form.card', { timeout: 10000 });

      // Both checkboxes should be unchecked
      await expect(page.locator('.checkbox-label:has-text("Disable session summaries") input')).not.toBeChecked();
      await expect(page.locator('.checkbox-label:has-text("Disable conversation summaries") input')).not.toBeChecked();

      // Textarea should show default prompt
      const textarea = page.locator('textarea#sessionTitlePrompt');
      const value = await textarea.inputValue();
      expect(value.length).toBeGreaterThan(0);

      // Verify via API
      const settings = await getSummarySettings();
      expect(settings.disableSessionSummaries).toBe(false);
      expect(settings.disableConversationSummaries).toBe(false);
      expect(settings.sessionTitlePrompt).toBe('');
    });

    test('dismissing reset dialog does not change settings', async ({ page }) => {
      await navigateAndWait(page, `${BASE_URL}/settings/summary`);
      await page.waitForSelector('form.form.card', { timeout: 10000 });

      // Verify pre-conditions loaded
      await expect(page.locator('.checkbox-label:has-text("Disable session summaries") input')).toBeChecked();

      // Register dialog handler to dismiss
      page.once('dialog', async (dialog) => {
        expect(dialog.message()).toContain('Reset all summary settings to defaults?');
        await dialog.dismiss();
      });

      await page.locator('button:has-text("Reset to Defaults")').click();

      // Form does NOT vanish — dialog dismiss prevents the store call
      // Assertions can proceed immediately

      // Both checkboxes should remain checked
      await expect(page.locator('.checkbox-label:has-text("Disable session summaries") input')).toBeChecked();
      await expect(page.locator('.checkbox-label:has-text("Disable conversation summaries") input')).toBeChecked();

      // Textarea should still contain custom text
      await expect(page.locator('textarea#sessionTitlePrompt')).toHaveValue('Custom title prompt for testing');

      // Verify via API - settings should be unchanged
      const settings = await getSummarySettings();
      expect(settings.disableSessionSummaries).toBe(true);
      expect(settings.disableConversationSummaries).toBe(true);
      expect(settings.sessionTitlePrompt).toBe('Custom title prompt for testing');
    });
  });

  test.describe('Category 5: Summary Settings API', () => {
    test('GET /settings/summary returns default settings', async () => {
      await resetSummarySettings();
      const settings = await getSummarySettings();

      expect(settings.disableSessionSummaries).toBe(false);
      expect(settings.disableConversationSummaries).toBe(false);
      expect(settings.sessionTitlePrompt).toBe('');
      expect(typeof settings.defaultSessionTitlePrompt).toBe('string');
      expect(settings.defaultSessionTitlePrompt.length).toBeGreaterThan(0);
    });

    test('PUT /settings/summary updates all fields', async () => {
      await resetSummarySettings();
      const result = await updateSummarySettings({
        disableSessionSummaries: true,
        disableConversationSummaries: true,
        sessionTitlePrompt: 'My prompt',
      });

      expect(result.disableSessionSummaries).toBe(true);
      expect(result.disableConversationSummaries).toBe(true);
      expect(result.sessionTitlePrompt).toBe('My prompt');
      expect(typeof result.defaultSessionTitlePrompt).toBe('string');
      expect(result.defaultSessionTitlePrompt.length).toBeGreaterThan(0);
    });

    test('PUT /settings/summary persists across requests', async () => {
      await resetSummarySettings();
      await updateSummarySettings({
        disableSessionSummaries: true,
        disableConversationSummaries: false,
        sessionTitlePrompt: 'Persistent prompt',
      });

      const settings = await getSummarySettings();
      expect(settings.disableSessionSummaries).toBe(true);
      expect(settings.disableConversationSummaries).toBe(false);
      expect(settings.sessionTitlePrompt).toBe('Persistent prompt');
    });

    test('PUT /settings/summary rejects invalid types', async () => {
      await resetSummarySettings();
      const response = await fetch(`${API_URL}/api/settings/summary`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disableSessionSummaries: 'yes',
          disableConversationSummaries: false,
          sessionTitlePrompt: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('must be booleans');
    });

    test('DELETE /settings/summary resets to defaults', async () => {
      // Set non-default values
      await updateSummarySettings({
        disableSessionSummaries: true,
        disableConversationSummaries: true,
        sessionTitlePrompt: 'Custom prompt',
      });

      // Reset
      const resetResult = await resetSummarySettings();
      expect(resetResult.disableSessionSummaries).toBe(false);
      expect(resetResult.disableConversationSummaries).toBe(false);
      expect(resetResult.sessionTitlePrompt).toBe('');

      // Verify via GET
      const settings = await getSummarySettings();
      expect(settings.disableSessionSummaries).toBe(false);
      expect(settings.disableConversationSummaries).toBe(false);
      expect(settings.sessionTitlePrompt).toBe('');
      expect(typeof settings.defaultSessionTitlePrompt).toBe('string');
    });
  });

  test.describe('Category 6: Providers Tab', () => {
    test.beforeEach(async () => {
      await cleanupProviders();
    });

    test.afterEach(async () => {
      // Extra cleanup for this category to ensure no leftover providers
      await cleanupProviders();
    });

    test('built-in Anthropic provider is displayed', async ({ page }) => {
      await navigateAndWait(page, `${BASE_URL}/settings/providers`);
      await page.waitForSelector('.provider-list', { timeout: 10000 });

      const anthropicCard = page.locator('.provider-card:has-text("Anthropic")');
      await expect(anthropicCard).toBeVisible();

      // Check for built-in badge (DOM text is "Built-in", CSS renders it as "BUILT-IN")
      await expect(anthropicCard.locator('.built-in-badge')).toBeVisible();
      await expect(anthropicCard.locator('.built-in-badge')).toHaveText('Built-in');
    });

    test('built-in provider has no edit/delete/test buttons', async ({ page }) => {
      await navigateAndWait(page, `${BASE_URL}/settings/providers`);
      await page.waitForSelector('.provider-list', { timeout: 10000 });

      const anthropicCard = page.locator('.provider-card:has-text("Anthropic")');

      await expect(anthropicCard.locator('button:has-text("Edit")')).toHaveCount(0);
      await expect(anthropicCard.locator('button:has-text("Delete")')).toHaveCount(0);
      await expect(anthropicCard.locator('button:has-text("Test")')).toHaveCount(0);
    });

    test('add provider button is visible', async ({ page }) => {
      await navigateAndWait(page, `${BASE_URL}/settings/providers`);
      await page.waitForSelector('.provider-list', { timeout: 10000 });

      const addButton = page.locator('button.btn.btn-primary:has-text("Add Provider")');
      await expect(addButton).toBeVisible();
    });

    test('custom provider shows test/edit/delete buttons', async ({ page }) => {
      // Use a unique name for this specific test
      const uniqueProviderName = `${TEST_PREFIX} Custom Provider Buttons Test`;

      await createProvider({
        name: uniqueProviderName,
        baseUrl: 'https://example.com/v1',
      });

      await navigateAndWait(page, `${BASE_URL}/settings/providers`);
      await page.waitForSelector('.provider-list', { timeout: 10000 });

      // Use the exact unique name to scope the locator
      const customCard = page.locator(`.provider-card:has-text("${uniqueProviderName}")`);

      await expect(customCard.locator('button:has-text("Test")')).toHaveCount(1);
      await expect(customCard.locator('button:has-text("Edit")')).toHaveCount(1);
      await expect(customCard.locator('button.btn-danger:has-text("Delete")')).toHaveCount(1);
    });
  });
});
