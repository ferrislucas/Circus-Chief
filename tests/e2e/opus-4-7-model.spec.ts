import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  openSessionOverlay,
  cleanupCreatedResources,
  API_URL,
  TEST_PREFIX,
  getProviders,
} from './helpers';

/**
 * E2E tests for Claude Opus 4.7 model availability.
 *
 * Verifies that the Opus 4.7 model appears in both:
 * 1. The providers API response (backend)
 * 2. The model selector dropdown (frontend)
 *
 * Also verifies that Opus 4.6 remains available for backward compatibility
 * (existing sessions may still reference it).
 */
test.describe('Opus 4.7 Model Availability', () => {
  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Opus 4.7 Test', '/tmp/opus-47-test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('providers API includes both claude-opus-4-6 and claude-opus-4-7', async () => {
    const providers = await getProviders();

    // Find the built-in Anthropic provider
    const builtIn = providers.find((p: any) => p.isBuiltIn);
    expect(builtIn, 'Built-in Anthropic provider should exist').toBeTruthy();

    // Get all model IDs from the built-in provider
    const modelIds = builtIn.models.map((m: any) => m.modelId);
    console.log('Built-in provider model IDs:', modelIds);

    // Both Opus versions must be present
    expect(modelIds, 'Should include claude-opus-4-6').toContain('claude-opus-4-6');
    expect(modelIds, 'Should include claude-opus-4-7').toContain('claude-opus-4-7');

    // Verify Opus 4.7 display name and tier
    const opus47 = builtIn.models.find((m: any) => m.modelId === 'claude-opus-4-7');
    expect(opus47.displayName).toBe('Opus 4.7');
    expect(opus47.tier).toBe('opus');

    // Verify Opus 4.6 is marked as previous generation
    const opus46 = builtIn.models.find((m: any) => m.modelId === 'claude-opus-4-6');
    expect(opus46.displayName).toBe('Opus 4.6');
    expect(opus46.description).toBe('Previous generation');
  });

  test('model selector dropdown includes both Opus 4.6 and 4.7 options', async ({ page }) => {
    // Create a draft session so we can see the model selector
    const session = await seedSession(project.id, {
      prompt: 'Test Opus 4.7 availability in model selector',
      startImmediately: false,
      gitMode: 'none',
      gitBranch: 'main',
    });

    // Navigate to session and open the chat overlay
    await page.goto(`/sessions/${session.id}/summary`);
    await page.waitForLoadState('networkidle');
    await openSessionOverlay(page);

    // Wait for model selector to be visible
    const modelSelect = page.locator('#model-select');
    await expect(modelSelect).toBeVisible({ timeout: 10000 });

    // Wait for options to load (providers store fetch)
    await page.waitForFunction(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      return select && select.options.length >= 4;
    }, { timeout: 10000 });

    // Gather all option values from the dropdown
    const optionValues = await page.evaluate(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      return Array.from(select.options).map(opt => ({
        value: opt.value,
        text: opt.textContent?.trim(),
      }));
    });
    console.log('Model selector options:', JSON.stringify(optionValues, null, 2));

    // Assert that both Opus versions are available
    const opus47Option = optionValues.find(opt => opt.value === 'claude-opus-4-7');
    expect(
      opus47Option,
      `Opus 4.7 should be in the model selector. Found: ${optionValues.map(o => o.value).join(', ')}`
    ).toBeTruthy();
    expect(opus47Option!.text).toContain('Opus 4.7');

    const opus46Option = optionValues.find(opt => opt.value === 'claude-opus-4-6');
    expect(
      opus46Option,
      `Opus 4.6 should still be in the model selector for backward compatibility. Found: ${optionValues.map(o => o.value).join(', ')}`
    ).toBeTruthy();
    expect(opus46Option!.text).toContain('Opus 4.6');
  });

  test('can select Opus 4.7 model on a draft session', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test selecting Opus 4.7',
      startImmediately: false,
      gitMode: 'none',
      gitBranch: 'main',
    });

    await page.goto(`/sessions/${session.id}/summary`);
    await page.waitForLoadState('networkidle');
    await openSessionOverlay(page);

    const modelSelect = page.locator('#model-select');
    await expect(modelSelect).toBeVisible({ timeout: 10000 });

    // Wait for options to be populated
    await page.waitForFunction(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      return select && Array.from(select.options).some(opt => opt.value === 'claude-opus-4-7');
    }, { timeout: 10000 });

    // Select Opus 4.7 and wait for the PATCH request
    const patchPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/sessions/') && resp.request().method() === 'PATCH',
      { timeout: 10000 }
    );
    await modelSelect.selectOption('claude-opus-4-7');
    const patchResponse = await patchPromise;
    expect(patchResponse.ok()).toBe(true);

    // Verify the session was updated via API
    const updatedRes = await fetch(`${API_URL}/api/sessions/${session.id}`);
    const updated = await updatedRes.json();
    expect(updated.model).toBe('claude-opus-4-7');
  });

  test('existing session with Opus 4.6 still shows correct model in dropdown', async ({ page }) => {
    // Create a session explicitly using Opus 4.6 (simulates a pre-existing session)
    const session = await seedSession(project.id, {
      prompt: 'Existing session with Opus 4.6',
      model: 'claude-opus-4-6',
      startImmediately: false,
      gitMode: 'none',
      gitBranch: 'main',
    });

    await page.goto(`/sessions/${session.id}/summary`);
    await page.waitForLoadState('networkidle');
    await openSessionOverlay(page);

    const modelSelect = page.locator('#model-select');
    await expect(modelSelect).toBeVisible({ timeout: 10000 });

    // Wait for the model selector to initialize with the session's model
    await page.waitForFunction(
      (expectedModel) => {
        const select = document.querySelector('#model-select') as HTMLSelectElement;
        return select && select.value === expectedModel;
      },
      'claude-opus-4-6',
      { timeout: 10000 }
    );

    // The selected value should be claude-opus-4-6
    const selectedValue = await modelSelect.inputValue();
    expect(selectedValue).toBe('claude-opus-4-6');
  });
});
