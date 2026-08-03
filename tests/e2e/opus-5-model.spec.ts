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
 * E2E tests for Claude Opus 5 model availability.
 *
 * Opus 5 supersedes Opus 4.8 as the current, enabled-by-default Anthropic
 * choice (see the "Add Opus 5 to the Built-in Anthropic Catalog" plan).
 * Opus 4.6, 4.7, and 4.8 are now all `lifecycle: 'older'` catalog entries and
 * are disabled by default (FRD-built-in-model-choices.md §0 "Every model
 * classified as older or legacy... is disabled by default"). These tests
 * verify:
 * 1. All four Opus generations still exist in the providers API response
 *    (disabled != removed -- they remain valid, resolvable model ids).
 * 2. A fresh draft session's model selector only offers the current (Opus 5)
 *    generation by default.
 * 3. An admin can re-enable an older generation (Opus 4.8) via provider
 *    management, after which it becomes selectable for new sessions too.
 * 4. An existing session already using an older generation (Opus 4.6 or
 *    Opus 4.8) keeps showing/using it even though it's disabled by default
 *    (historical continuity, US5).
 */
test.describe('Opus 5 Model Availability', () => {
  // These tests intentionally toggle a global built-in provider row. Keep the
  // read/default assertions and the mutation in one serial sequence so a
  // fully-parallel Playwright configuration cannot expose the transient state.
  test.describe.configure({ mode: 'serial' });

  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Opus 5 Test', '/tmp/opus-5-test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('providers API includes claude-opus-4-6, claude-opus-4-7, claude-opus-4-8, and claude-opus-5', async () => {
    const providers = await getProviders();

    // Find the built-in Anthropic provider
    const builtIn = providers.find((p: any) => p.isBuiltIn);
    expect(builtIn, 'Built-in Anthropic provider should exist').toBeTruthy();

    // Get all model IDs from the built-in provider
    const modelIds = builtIn.models.map((m: any) => m.modelId);
    console.log('Built-in provider model IDs:', modelIds);

    // All four Opus versions must be present
    expect(modelIds, 'Should include claude-opus-4-6').toContain('claude-opus-4-6');
    expect(modelIds, 'Should include claude-opus-4-7').toContain('claude-opus-4-7');
    expect(modelIds, 'Should include claude-opus-4-8').toContain('claude-opus-4-8');
    expect(modelIds, 'Should include claude-opus-5').toContain('claude-opus-5');

    // Verify Opus 5 display name and tier
    const opus5 = builtIn.models.find((m: any) => m.modelId === 'claude-opus-5');
    expect(opus5.displayName).toBe('Opus 5');
    expect(opus5.tier).toBe('opus');

    // Verify Opus 4.8 is now marked as previous generation
    const opus48 = builtIn.models.find((m: any) => m.modelId === 'claude-opus-4-8');
    expect(opus48.displayName).toBe('Opus 4.8');
    expect(opus48.tier).toBe('opus');
    expect(opus48.description).toBe('Previous generation');

    // Verify Opus 4.7 is marked as previous generation
    const opus47 = builtIn.models.find((m: any) => m.modelId === 'claude-opus-4-7');
    expect(opus47.displayName).toBe('Opus 4.7');
    expect(opus47.description).toBe('Previous generation');

    // Verify Opus 4.6 is marked as previous generation
    const opus46 = builtIn.models.find((m: any) => m.modelId === 'claude-opus-4-6');
    expect(opus46.displayName).toBe('Opus 4.6');
    expect(opus46.description).toBe('Previous generation');

    // Opus 5 is the current generation (enabled by default); Opus 4.6/4.7/4.8
    // are older, superseded generations (disabled by default) -- valid and
    // resolvable, but hidden from new-selection pickers until re-enabled.
    expect(opus5.lifecycle).toBe('current');
    expect(opus5.enabled).toBe(true);
    expect(opus48.lifecycle).toBe('older');
    expect(opus48.enabled).toBe(false);
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
      gitMode: 'current',
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

    // Option values use providerId::modelId format (e.g. "anthropic-default::claude-opus-5")
    const opus5Option = optionValues.find(opt => opt.value.endsWith('::claude-opus-5'));
    expect(
      opus5Option,
      `Opus 5 should be in the model selector. Found: ${optionValues.map(o => o.value).join(', ')}`
    ).toBeTruthy();
    expect(opus5Option!.text).toContain('Opus 5');

    // Opus 4.6, 4.7, and 4.8 are disabled-by-default older generations and
    // this draft session has no historical usage of any of them -- none
    // should appear as a new-selection choice.
    for (const olderId of ['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6']) {
      const olderOption = optionValues.find(opt => opt.value.endsWith(`::${olderId}`));
      expect(olderOption, `Disabled-by-default ${olderId} should not be offered to a fresh draft session`).toBeFalsy();
    }
  });

  test('re-enabling Opus 4.8 via provider management makes it selectable for new sessions', async ({ page }) => {
    const providers = await getProviders();
    const builtIn = providers.find((p: any) => p.isBuiltIn && p.kind === 'anthropic');
    const opus48Row = builtIn.models.find((m: any) => m.modelId === 'claude-opus-4-8');
    expect(opus48Row, 'Opus 4.8 row should exist on the built-in Anthropic provider').toBeTruthy();

    await updateProviderModel(builtIn.id, opus48Row.id, { enabled: true });

    try {
      const session = await seedSession(project.id, {
        prompt: 'Test selecting a re-enabled Opus 4.8',
        startImmediately: false,
        gitMode: 'current',
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
    } finally {
      // Restore the catalog default so later tests see Opus 4.8 disabled again.
      await updateProviderModel(builtIn.id, opus48Row.id, { enabled: false });
    }
  });

  test('can select Opus 5 model on a draft session', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test selecting Opus 5',
      startImmediately: false,
      gitMode: 'current',
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
      return select && Array.from(select.options).some(opt => opt.value.endsWith('::claude-opus-5'));
    }, { timeout: 10000 });

    // Find the full option value (providerId::claude-opus-5) to use with selectOption
    const opus5OptionValue = await page.evaluate(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      const opt = Array.from(select.options).find(o => o.value.endsWith('::claude-opus-5'));
      return opt ? opt.value : null;
    });
    expect(opus5OptionValue).toBeTruthy();

    // Select Opus 5 and wait for the PATCH request
    const patchPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/sessions/') && resp.request().method() === 'PATCH',
      { timeout: 10000 }
    );
    await modelSelect.selectOption(opus5OptionValue!);
    const patchResponse = await patchPromise;
    expect(patchResponse.ok()).toBe(true);

    // Verify the session was updated via API
    const updatedRes = await fetch(`${API_URL}/api/sessions/${session.id}`);
    const updated = await updatedRes.json();
    expect(updated.model).toBe('claude-opus-5');
  });

  test('existing session with Opus 4.6 still shows correct model in dropdown', async ({ page }) => {
    // Create a session explicitly using Opus 4.6 (simulates a pre-existing session)
    const session = await seedSession(project.id, {
      prompt: 'Existing session with Opus 4.6',
      model: 'claude-opus-4-6',
      startImmediately: false,
      gitMode: 'current',
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

  test('existing session with Opus 4.8 still shows correct model in dropdown', async ({ page }) => {
    // Create a session explicitly using Opus 4.8 (simulates a pre-existing
    // session from before Opus 5 became the default -- historical continuity
    // for the newly-disabled generation, US5).
    const session = await seedSession(project.id, {
      prompt: 'Existing session with Opus 4.8',
      model: 'claude-opus-4-8',
      startImmediately: false,
      gitMode: 'current',
      gitBranch: 'main',
    });

    await waitForSessionToExist(session.id, API_READY);
    await waitForSessionStatus(session.id, 'waiting', API_READY);

    await page.goto(`/sessions/${session.id}/summary`);
    await page.waitForLoadState('domcontentloaded');
    await openSessionOverlay(page);

    const modelSelect = page.locator('#model-select');
    await expect(modelSelect).toBeVisible({ timeout: 10000 });

    // Option values use providerId::modelId format (e.g. "anthropic-default::claude-opus-4-8")
    await page.waitForFunction(
      () => {
        const select = document.querySelector('#model-select') as HTMLSelectElement;
        return select && select.value.endsWith('::claude-opus-4-8');
      },
      { timeout: 10000 }
    );

    const selectedValue = await modelSelect.inputValue();
    expect(selectedValue.endsWith('::claude-opus-4-8')).toBe(true);
  });
});
