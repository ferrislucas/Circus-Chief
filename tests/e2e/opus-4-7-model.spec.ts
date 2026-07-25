import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  openSessionOverlay,
  cleanupCreatedResources,
  API_URL,
  TEST_PREFIX,
  getProviders,
  updateProviderModel,
  waitForSessionToExist,
  waitForSessionStatus,
} from './helpers';
import { API_READY, PAGE_READY_TIMEOUT } from './timeouts';

/**
 * E2E tests for Claude Opus 4.7 model availability.
 *
 * Opus 4.6 and 4.7 are `lifecycle: 'older'` catalog entries (superseded by
 * Opus 4.8) and are disabled by default (FRD-built-in-model-choices.md §0
 * "Every model classified as older or legacy... is disabled by default").
 * These tests verify:
 * 1. All three Opus generations still exist in the providers API response
 *    (disabled != removed -- they remain valid, resolvable model ids).
 * 2. A fresh draft session's model selector only offers the current (Opus
 *    4.8) generation by default.
 * 3. An admin can re-enable an older generation via provider management,
 *    after which it becomes selectable for new sessions too.
 * 4. An existing session already using Opus 4.6 keeps showing/using it even
 *    though it's disabled by default (historical continuity, US5).
 */
test.describe('Opus 4.7 Model Availability', () => {
  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Opus 4.7 Test', '/tmp/opus-47-test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('providers API includes claude-opus-4-6, claude-opus-4-7, and claude-opus-4-8', async () => {
    const providers = await getProviders();

    // Find the built-in Anthropic provider
    const builtIn = providers.find((p: any) => p.isBuiltIn);
    expect(builtIn, 'Built-in Anthropic provider should exist').toBeTruthy();

    // Get all model IDs from the built-in provider
    const modelIds = builtIn.models.map((m: any) => m.modelId);
    console.log('Built-in provider model IDs:', modelIds);

    // All three Opus versions must be present
    expect(modelIds, 'Should include claude-opus-4-6').toContain('claude-opus-4-6');
    expect(modelIds, 'Should include claude-opus-4-7').toContain('claude-opus-4-7');
    expect(modelIds, 'Should include claude-opus-4-8').toContain('claude-opus-4-8');

    // Verify Opus 4.8 display name and tier
    const opus48 = builtIn.models.find((m: any) => m.modelId === 'claude-opus-4-8');
    expect(opus48.displayName).toBe('Opus 4.8');
    expect(opus48.tier).toBe('opus');

    // Verify Opus 4.7 is now marked as previous generation
    const opus47 = builtIn.models.find((m: any) => m.modelId === 'claude-opus-4-7');
    expect(opus47.displayName).toBe('Opus 4.7');
    expect(opus47.tier).toBe('opus');
    expect(opus47.description).toBe('Previous generation');

    // Verify Opus 4.6 is marked as previous generation
    const opus46 = builtIn.models.find((m: any) => m.modelId === 'claude-opus-4-6');
    expect(opus46.displayName).toBe('Opus 4.6');
    expect(opus46.description).toBe('Previous generation');

    // Opus 4.8 is the current generation (enabled by default); Opus 4.6/4.7
    // are older, superseded generations (disabled by default) -- valid and
    // resolvable, but hidden from new-selection pickers until re-enabled.
    expect(opus48.lifecycle).toBe('current');
    expect(opus48.enabled).toBe(true);
    expect(opus47.lifecycle).toBe('older');
    expect(opus47.enabled).toBe(false);
    expect(opus46.lifecycle).toBe('older');
    expect(opus46.enabled).toBe(false);
  });

  test('a fresh draft session model selector only offers the current Opus generation by default', async ({ page }) => {
    // Create a draft session so we can see the model selector
    const session = await seedSession(project.id, {
      prompt: 'Test Opus generation defaults in model selector',
      startImmediately: false,
      gitMode: 'none',
      gitBranch: 'main',
    });

    // API-first preconditions: ensure the session is persisted and in the
    // expected status before touching the UI. This keeps the overlay ready
    // path deterministic under parallel load.
    await waitForSessionToExist(session.id, API_READY);
    await waitForSessionStatus(session.id, 'waiting', API_READY);

    // Navigate to session and open the chat overlay
    await page.goto(`/sessions/${session.id}/summary`);
    await page.waitForLoadState('domcontentloaded');
    await openSessionOverlay(page);

    // Wait for model selector to be visible
    const modelSelect = page.locator('#model-select');
    await expect(modelSelect).toBeVisible({ timeout: 10000 });

    // Wait for options to load (providers store fetch)
    await page.waitForFunction(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      return select && select.options.length >= 3;
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

    // Option values use providerId::modelId format (e.g. "anthropic-default::claude-opus-4-8")
    const opus48Option = optionValues.find(opt => opt.value.endsWith('::claude-opus-4-8'));
    expect(
      opus48Option,
      `Opus 4.8 should be in the model selector. Found: ${optionValues.map(o => o.value).join(', ')}`
    ).toBeTruthy();
    expect(opus48Option!.text).toContain('Opus 4.8');

    // Opus 4.6 and 4.7 are disabled-by-default older generations and this
    // draft session has no historical usage of either -- neither should
    // appear as a new-selection choice.
    const opus47Option = optionValues.find(opt => opt.value.endsWith('::claude-opus-4-7'));
    expect(opus47Option, 'Disabled-by-default Opus 4.7 should not be offered to a fresh draft session').toBeFalsy();

    const opus46Option = optionValues.find(opt => opt.value.endsWith('::claude-opus-4-6'));
    expect(opus46Option, 'Disabled-by-default Opus 4.6 should not be offered to a fresh draft session').toBeFalsy();
  });

  test('re-enabling Opus 4.7 via provider management makes it selectable for new sessions', async ({ page }) => {
    const providers = await getProviders();
    const builtIn = providers.find((p: any) => p.isBuiltIn && p.kind === 'anthropic');
    const opus47Row = builtIn.models.find((m: any) => m.modelId === 'claude-opus-4-7');
    expect(opus47Row, 'Opus 4.7 row should exist on the built-in Anthropic provider').toBeTruthy();

    await updateProviderModel(builtIn.id, opus47Row.id, { enabled: true });

    try {
      const session = await seedSession(project.id, {
        prompt: 'Test selecting a re-enabled Opus 4.7',
        startImmediately: false,
        gitMode: 'none',
        gitBranch: 'main',
      });

      await waitForSessionToExist(session.id, API_READY);
      await waitForSessionStatus(session.id, 'waiting', API_READY);

      await page.goto(`/sessions/${session.id}/summary`);
      await page.waitForLoadState('domcontentloaded');
      await openSessionOverlay(page);

      const modelSelect = page.locator('#model-select');
      await expect(modelSelect).toBeVisible({ timeout: 10000 });

      // Wait for options to be populated (option values use providerId::modelId format)
      await page.waitForFunction(() => {
        const select = document.querySelector('#model-select') as HTMLSelectElement;
        return select && Array.from(select.options).some(opt => opt.value.endsWith('::claude-opus-4-7'));
      }, { timeout: 10000 });

      // Find the full option value (providerId::claude-opus-4-7) to use with selectOption
      const opus47OptionValue = await page.evaluate(() => {
        const select = document.querySelector('#model-select') as HTMLSelectElement;
        const opt = Array.from(select.options).find(o => o.value.endsWith('::claude-opus-4-7'));
        return opt ? opt.value : null;
      });
      expect(opus47OptionValue).toBeTruthy();

      // Select Opus 4.7 and wait for the PATCH request
      const patchPromise = page.waitForResponse(
        (resp) => resp.url().includes('/api/sessions/') && resp.request().method() === 'PATCH',
        { timeout: 10000 }
      );
      await modelSelect.selectOption(opus47OptionValue!);
      const patchResponse = await patchPromise;
      expect(patchResponse.ok()).toBe(true);

      // Verify the session was updated via API
      const updatedRes = await fetch(`${API_URL}/api/sessions/${session.id}`);
      const updated = await updatedRes.json();
      expect(updated.model).toBe('claude-opus-4-7');
    } finally {
      // Restore the catalog default so later tests see Opus 4.7 disabled again.
      await updateProviderModel(builtIn.id, opus47Row.id, { enabled: false });
    }
  });

  test('can select Opus 4.8 model on a draft session', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test selecting Opus 4.8',
      startImmediately: false,
      gitMode: 'none',
      gitBranch: 'main',
    });

    // API-first preconditions (see comment in previous test).
    await waitForSessionToExist(session.id, API_READY);
    await waitForSessionStatus(session.id, 'waiting', API_READY);

    await page.goto(`/sessions/${session.id}/summary`);
    await page.waitForLoadState('domcontentloaded');
    await openSessionOverlay(page);

    const modelSelect = page.locator('#model-select');
    await expect(modelSelect).toBeVisible({ timeout: 10000 });

    // Wait for options to be populated (option values use providerId::modelId format)
    await page.waitForFunction(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      return select && Array.from(select.options).some(opt => opt.value.endsWith('::claude-opus-4-8'));
    }, { timeout: 10000 });

    // Find the full option value (providerId::claude-opus-4-8) to use with selectOption
    const opus48OptionValue = await page.evaluate(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      const opt = Array.from(select.options).find(o => o.value.endsWith('::claude-opus-4-8'));
      return opt ? opt.value : null;
    });
    expect(opus48OptionValue).toBeTruthy();

    // Select Opus 4.8 and wait for the PATCH request
    const patchPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/sessions/') && resp.request().method() === 'PATCH',
      { timeout: 10000 }
    );
    await modelSelect.selectOption(opus48OptionValue!);
    const patchResponse = await patchPromise;
    expect(patchResponse.ok()).toBe(true);

    // Verify the session was updated via API
    const updatedRes = await fetch(`${API_URL}/api/sessions/${session.id}`);
    const updated = await updatedRes.json();
    expect(updated.model).toBe('claude-opus-4-8');
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

    // API-first preconditions (see comment in earlier test).
    await waitForSessionToExist(session.id, API_READY);
    await waitForSessionStatus(session.id, 'waiting', API_READY);

    await page.goto(`/sessions/${session.id}/summary`);
    await page.waitForLoadState('domcontentloaded');
    await openSessionOverlay(page);

    const modelSelect = page.locator('#model-select');
    await expect(modelSelect).toBeVisible({ timeout: 10000 });

    // Wait for the model selector to initialize with the session's model
    // Option values use providerId::modelId format (e.g. "anthropic-default::claude-opus-4-6")
    await page.waitForFunction(
      () => {
        const select = document.querySelector('#model-select') as HTMLSelectElement;
        return select && select.value.endsWith('::claude-opus-4-6');
      },
      { timeout: 10000 }
    );

    // The selected value should end with ::claude-opus-4-6
    const selectedValue = await modelSelect.inputValue();
    expect(selectedValue.endsWith('::claude-opus-4-6')).toBe(true);
  });
});
