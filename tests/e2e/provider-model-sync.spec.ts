import { test, expect } from '@playwright/test';
import {
  cleanupCreatedResources,
  createProvider,
  addProviderModel,
  removeProviderModel,
  updateProviderModel,
  seedProject,
  seedSession,
} from './helpers';

/**
 * E2E test for provider model ID sync in the Model Selector.
 *
 * Verifies that after changing a provider's model list (remove old, add new),
 * the Model Selector correctly reflects the updated model IDs.
 */
test.describe('Provider Model Sync in Model Selector', () => {
  test.describe.configure({ timeout: 60000 });

  let provider: any;
  let sonnetModel: any;
  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();

    // 1. Create a third-party provider (no model fields at creation time)
    provider = await createProvider({
      name: '[TEST] Sync Test Provider',
      baseUrl: 'https://api.example.com',
      authToken: 'test-token-sync',
    });

    // 2. Add an initial sonnet-tiered model
    sonnetModel = await addProviderModel(provider.id, {
      modelId: 'test-model-v1',
      displayName: 'Test Sonnet v1',
      tier: 'sonnet',
    });

    // 3. Create a project and a draft session
    project = await seedProject('Model Sync Test', '/tmp/model-sync-test');
    session = await seedSession(project.id, {
      prompt: 'Test prompt for model sync',
      name: 'Model Sync Session',
    });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('model selector reflects updated provider model IDs after edit', async ({ page }) => {
    // 4. Navigate to the session conversation tab
    await page.goto(`/sessions/${session.id}/conversation`);
    await page.waitForLoadState('networkidle');

    // 5. Wait for the model selector to load with providers
    const modelSelect = page.locator('#model-select');
    await expect(modelSelect).toBeVisible({ timeout: 10000 });

    // Wait for our test provider's model to appear in the select options
    await page.waitForFunction(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      if (!select) return false;
      const options = Array.from(select.options);
      return options.some(opt => opt.value === 'test-model-v1');
    }, { timeout: 10000 });

    // Verify test-model-v1 is present as an option
    const v1Options = modelSelect.locator('option[value="test-model-v1"]');
    expect(await v1Options.count()).toBeGreaterThanOrEqual(1);

    // 6. Update the provider's model via API: remove old, add new
    await removeProviderModel(provider.id, sonnetModel.id);
    const newModel = await addProviderModel(provider.id, {
      modelId: 'test-model-v2',
      displayName: 'Test Sonnet v2',
      tier: 'sonnet',
    });
    console.log('Provider models updated - new model:', newModel.modelId);

    // 7. Navigate to the providers settings page and back to force a fresh store refetch
    //    (simulates the user flow: edit provider on settings page, then go back to session)
    await page.goto('/settings/providers');
    await page.waitForLoadState('networkidle');

    // 8. Navigate back to the session conversation tab
    await page.goto(`/sessions/${session.id}/conversation`);
    await page.waitForLoadState('networkidle');

    // 9. Assert the model selector now contains test-model-v2 and NOT test-model-v1
    const modelSelectAfter = page.locator('#model-select');
    await expect(modelSelectAfter).toBeVisible({ timeout: 10000 });

    // Wait for model selector to fully re-populate with providers+models
    await page.waitForFunction(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      if (!select) return false;
      return select.options.length > 1;
    }, { timeout: 10000 });

    // Collect all option values for debugging
    const allOptionValues = await modelSelectAfter.locator('option').evaluateAll(
      (options: HTMLOptionElement[]) => options.map(o => o.value)
    );
    console.log('Model selector options after update:', JSON.stringify(allOptionValues));

    // The NEW model (test-model-v2) should be present
    expect(allOptionValues).toContain('test-model-v2');

    // The OLD model (test-model-v1) should be gone
    expect(allOptionValues).not.toContain('test-model-v1');
  });

  test('model selector reflects updated provider model IDs after PATCH update', async ({ page }) => {
    // 4. Navigate to the session conversation tab
    await page.goto(`/sessions/${session.id}/conversation`);
    await page.waitForLoadState('networkidle');

    // 5. Wait for the model selector to load with providers
    const modelSelect = page.locator('#model-select');
    await expect(modelSelect).toBeVisible({ timeout: 10000 });

    // Wait for our test provider's model to appear in the select options
    await page.waitForFunction(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      if (!select) return false;
      const options = Array.from(select.options);
      return options.some(opt => opt.value === 'test-model-v1');
    }, { timeout: 10000 });

    // Verify test-model-v1 is present as an option
    const v1Options = modelSelect.locator('option[value="test-model-v1"]');
    expect(await v1Options.count()).toBeGreaterThanOrEqual(1);

    // 6. Update the provider's model via API: PATCH to change modelId
    const updatedModel = await updateProviderModel(provider.id, sonnetModel.id, {
      modelId: 'test-model-v2-updated',
      displayName: 'Test Sonnet v2 Updated',
    });
    console.log('Provider model updated via PATCH - new modelId:', updatedModel.modelId);

    // 7. Navigate to the providers settings page and back to force a fresh store refetch
    await page.goto('/settings/providers');
    await page.waitForLoadState('networkidle');

    // 8. Navigate back to the session conversation tab
    await page.goto(`/sessions/${session.id}/conversation`);
    await page.waitForLoadState('networkidle');

    // 9. Assert the model selector now contains test-model-v2-updated and NOT test-model-v1
    const modelSelectAfter = page.locator('#model-select');
    await expect(modelSelectAfter).toBeVisible({ timeout: 10000 });

    // Wait for model selector to fully re-populate with providers+models
    await page.waitForFunction(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      if (!select) return false;
      return select.options.length > 1;
    }, { timeout: 10000 });

    // Collect all option values for debugging
    const allOptionValues = await modelSelectAfter.locator('option').evaluateAll(
      (options: HTMLOptionElement[]) => options.map(o => o.value)
    );
    console.log('Model selector options after PATCH update:', JSON.stringify(allOptionValues));

    // The NEW model ID (test-model-v2-updated) should be present
    expect(allOptionValues).toContain('test-model-v2-updated');

    // The OLD model ID (test-model-v1) should be gone
    expect(allOptionValues).not.toContain('test-model-v1');
  });
});
