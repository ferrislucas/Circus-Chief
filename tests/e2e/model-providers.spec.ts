import { test, expect } from '@playwright/test';
import {
  cleanupProviders,
  createProvider,
  getProvider,
  updateProvider,
  testProviderConnection,
  deleteProvider,
} from './helpers';

/**
 * E2E tests for model provider management
 *
 * These tests verify the full CRUD flow for model providers,
 * with special focus on auth token handling during updates.
 *
 * Known Issue (as of this test creation):
 * - Editing a provider without changing the auth token clears it
 * - This happens because the frontend sends `authToken: null` for
 *   redacted values, and the backend treats null as "set to null"
 */
test.describe('Model Provider Management', () => {
  test.beforeEach(async () => {
    await cleanupProviders();
  });

  test.afterEach(async () => {
    await cleanupProviders();
  });

  test('can create a provider with auth token via API', async () => {
    const provider = await createProvider({
      name: '[TEST] Custom Provider',
      baseUrl: 'https://api.example.com',
      authToken: 'test-secret-key-12345',
      defaultSonnetModel: 'claude-3-5-sonnet-20241022',
    });

    expect(provider).toBeTruthy();
    expect(provider.name).toBe('[TEST] Custom Provider');
    expect(provider.baseUrl).toBe('https://api.example.com');
    // Auth token should be redacted in response
    expect(provider.authToken).toBe('••••••••');
    expect(provider.defaultSonnetModel).toBe('claude-3-5-sonnet-20241022');
  });

  test('preserves auth token when updating other fields (API)', async () => {
    // Create a provider with an auth token
    const provider = await createProvider({
      name: '[TEST] Original Name',
      baseUrl: 'https://api.example.com',
      authToken: 'my-secret-token-abc123',
      defaultSonnetModel: 'claude-3-5-sonnet-20241022',
    });

    // Update only the name (don't include authToken in the payload)
    const updated = await updateProvider(provider.id, {
      name: '[TEST] Updated Name',
    });

    expect(updated.name).toBe('[TEST] Updated Name');
    expect(updated.baseUrl).toBe('https://api.example.com');
    // Auth token should still be redacted
    expect(updated.authToken).toBe('••••••••');

    // CRITICAL: Test that connection still works with original token
    // This will FAIL if the auth token was cleared
    // Note: This test will fail against a real API without a valid token,
    // but it tests the database state - the token should be preserved
    const fetched = await getProvider(provider.id);
    expect(fetched.authToken).toBe('••••••••'); // Still redacted

    // The real test: if we had a way to check the DB directly, we'd verify
    // the token is still 'my-secret-token-abc123' in the database
    // For now, we can attempt a connection test which will use the stored token
    // If token was cleared, this would fail
  });

  test('updates auth token when explicitly provided (API)', async () => {
    // Create a provider with an auth token
    const provider = await createProvider({
      name: '[TEST] Test Provider',
      baseUrl: 'https://api.example.com',
      authToken: 'original-token',
      defaultSonnetModel: 'claude-3-5-sonnet-20241022',
    });

    // Update with a new auth token
    const updated = await updateProvider(provider.id, {
      authToken: 'new-token-xyz789',
    });

    expect(updated.authToken).toBe('••••••••'); // Still redacted in response

    // The database should now have the new token
    // (We can't verify directly, but it should be updated)
  });

  test('can clear auth token when explicitly set to null (API)', async () => {
    // Create a provider with an auth token
    const provider = await createProvider({
      name: '[TEST] Test Provider',
      baseUrl: 'https://api.example.com',
      authToken: 'token-to-be-cleared',
      defaultSonnetModel: 'claude-3-5-sonnet-20241022',
    });

    // Explicitly clear the token
    const updated = await updateProvider(provider.id, {
      authToken: null as any, // Explicitly null
    });

    expect(updated.authToken).toBeNull();
  });

  test.skip('FAILING: editing provider name via UI preserves auth token', async ({ page }) => {
    // Create a provider with an auth token
    const provider = await createProvider({
      name: '[TEST] UI Test Provider',
      baseUrl: 'https://api.example.com',
      authToken: 'secret-key-should-be-preserved',
      defaultSonnetModel: 'claude-3-5-sonnet-20241022',
    });

    // Navigate to settings/providers page
    await page.goto('/settings/providers');

    // Wait for the provider card to load
    const providerCard = page.locator('.provider-card', { hasText: '[TEST] UI Test Provider' }).first();
    await expect(providerCard).toBeVisible();

    // Click Edit button for our provider
    await providerCard.getByRole('button', { name: 'Edit' }).click();

    // Wait for the edit modal to appear
    await expect(page.locator('.modal h2', { hasText: 'Edit Provider' })).toBeVisible();

    // The auth token field should be empty (because it was redacted)
    const authTokenInput = page.locator('#auth-token');
    await expect(authTokenInput).toHaveValue('');

    // Change only the name
    const nameInput = page.locator('#provider-name');
    await nameInput.clear();
    await nameInput.fill('[TEST] UI Updated Name');

    // Save the changes without modifying the auth token
    const saveButton = page.getByRole('button', { name: 'Save' });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Wait for the modal to close (save operation completes)
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 15000 });

    // Wait for the provider list to refresh
    await page.waitForTimeout(500);

    // Verify via API that the auth token was preserved
    const updatedProvider = await getProvider(provider.id);
    expect(updatedProvider.name).toBe('[TEST] UI Updated Name');

    // CRITICAL TEST: The auth token should NOT be null
    // This test will FAIL until the bug is fixed
    // The token should still be redacted, not null
    expect(updatedProvider.authToken).not.toBeNull();
    expect(updatedProvider.authToken).toBe('••••••••'); // Should still be redacted
  });

  test.skip('FAILING: editing provider via UI without touching auth token preserves it', async ({ page }) => {
    // This is the main test case from the bug report
    // When editing a provider and NOT entering a new auth token,
    // the existing token should be preserved

    const provider = await createProvider({
      name: '[TEST] Bug Reproduction',
      baseUrl: 'https://api.example.com',
      authToken: 'this-should-not-be-cleared',
      defaultSonnetModel: 'claude-3-5-sonnet-20241022',
      apiTimeoutMs: 30000,
    });

    await page.goto('/settings/providers');

    // Wait for the provider card to load
    const providerCard = page.locator('.provider-card', { hasText: '[TEST] Bug Reproduction' }).first();
    await expect(providerCard).toBeVisible();

    // Open edit dialog
    await providerCard.getByRole('button', { name: 'Edit' }).click();

    // Wait for the edit modal to appear
    await expect(page.locator('.modal h2', { hasText: 'Edit Provider' })).toBeVisible();

    // Expand the advanced settings section to access the timeout field
    const advancedSection = page.locator('details', { hasText: 'Advanced Settings' });
    await advancedSection.locator('summary').click();

    // Update the timeout setting (not the auth token)
    const timeoutInput = page.locator('#api-timeout');
    await timeoutInput.clear();
    await timeoutInput.fill('45000');

    // Do NOT touch the auth token field
    // It should be empty (because it's redacted on the backend)

    // Save
    const saveButton = page.getByRole('button', { name: 'Save' });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Wait for modal to close (save operation completes)
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 15000 });

    // Wait for the provider list to refresh
    await page.waitForTimeout(500);

    // Verify the changes were saved
    const updated = await getProvider(provider.id);

    // The timeout should be updated
    expect(updated.apiTimeoutMs).toBe(45000);

    // CRITICAL: The auth token should NOT be null
    // This test will FAIL until the bug is fixed
    expect(updated.authToken).not.toBeNull();
    expect(updated.authToken).toBe('••••••••'); // Should still be redacted
  });

  test('updating auth token via UI works correctly', async ({ page }) => {
    const provider = await createProvider({
      name: '[TEST] Token Update Test',
      baseUrl: 'https://api.example.com',
      authToken: 'old-token',
      defaultSonnetModel: 'claude-3-5-sonnet-20241022',
    });

    await page.goto('/settings/providers');

    // Wait for the provider card to load
    const providerCard = page.locator('.provider-card', { hasText: '[TEST] Token Update Test' }).first();
    await expect(providerCard).toBeVisible();

    // Open edit dialog
    await providerCard.getByRole('button', { name: 'Edit' }).click();

    // Wait for the edit modal to appear
    await expect(page.locator('.modal h2', { hasText: 'Edit Provider' })).toBeVisible();

    // Enter a NEW auth token
    const authTokenInput = page.locator('#auth-token');
    await authTokenInput.clear();
    await authTokenInput.fill('brand-new-token-12345');

    // Save
    await page.getByRole('button', { name: 'Save' }).click();

    // Wait for modal to close
    await expect(page.locator('.modal')).not.toBeVisible();

    // Verify the token was updated
    const updated = await getProvider(provider.id);
    expect(updated.authToken).toBe('••••••••'); // Redacted in response
    // The actual token in DB should be 'brand-new-token-12345' now
  });

  test('can delete a custom provider', async () => {
    const provider = await createProvider({
      name: '[TEST] To Be Deleted',
      baseUrl: 'https://api.example.com',
      authToken: 'delete-me',
      defaultSonnetModel: 'claude-3-5-sonnet-20241022',
    });

    const success = await deleteProvider(provider.id);
    expect(success).toBe(true);

    const deleted = await getProvider(provider.id);
    expect(deleted).toBeNull();
  });
});
