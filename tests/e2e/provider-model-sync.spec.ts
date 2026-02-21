import { test, expect } from '@playwright/test';
import {
  cleanupCreatedResources,
  createProvider,
  updateProvider,
  seedProject,
  seedSession,
} from './helpers';

/**
 * E2E test for provider model ID sync in the Model Selector
 *
 * Bug: When you update a third-party provider's model ID (e.g. defaultSonnetModel),
 * the database updates correctly but the Model Selector still shows old model IDs.
 *
 * Root cause: There are two ways to fetch providers (with and without models).
 * When the wrong fetch wins, models disappear from the store, causing stale data
 * in the model selector.
 *
 * This test should FAIL before the fix and PASS after.
 */
test.describe('Provider Model Sync in Model Selector', () => {
  test.describe.configure({ timeout: 60000 });

  let provider: any;
  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();

    // 1. Create a third-party provider with a known defaultSonnetModel
    provider = await createProvider({
      name: '[TEST] Sync Test Provider',
      baseUrl: 'https://api.example.com',
      authToken: 'test-token-sync',
      defaultSonnetModel: 'test-model-v1',
    });

    // 2. Create a project and a draft session
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
    // 3. Navigate to the session conversation tab
    await page.goto(`/sessions/${session.id}/conversation`);
    await page.waitForLoadState('networkidle');

    // 4. Wait for the model selector to load with providers
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

    // 5. Update the provider's defaultSonnetModel via API (reliable, avoids UI flakiness)
    const updated = await updateProvider(provider.id, {
      defaultSonnetModel: 'test-model-v2',
    });
    console.log('Provider updated - defaultSonnetModel:', updated.defaultSonnetModel);

    // 6. Navigate to the providers settings page and back to force a fresh store refetch
    //    (simulates the user flow: edit provider on settings page, then go back to session)
    await page.goto('/settings/providers');
    await page.waitForLoadState('networkidle');

    // 7. Navigate back to the session conversation tab
    await page.goto(`/sessions/${session.id}/conversation`);
    await page.waitForLoadState('networkidle');

    // 8. Assert the model selector now contains test-model-v2 and NOT test-model-v1
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
});
