import { test, expect } from '@playwright/test';
import {
  cleanupProviders,
  createProvider,
  getProvider,
  updateProvider,
  deleteProvider,
  cleanupCreatedResources,
  seedProject,
  seedSession,
  addProviderModel,
  removeProviderModel,
  getProviders,
  navigateAndWait,
  API_URL,
  BASE_URL,
  TEST_PREFIX,
} from './helpers';

/**
 * E2E tests for model provider management
 *
 * These tests verify the full CRUD flow for model providers,
 * including API-level tests and UI interaction tests on the
 * Settings > Model Providers page.
 */
test.describe('Model Provider Management', () => {
  test.beforeEach(async () => {
    await cleanupProviders();
  });

  test.afterEach(async () => {
    await cleanupProviders();
  });

  // ============================================================
  // API-level tests
  // ============================================================

  test('can create a provider with auth token via API', async () => {
    const provider = await createProvider({
      name: `${TEST_PREFIX}Custom Provider`,
      baseUrl: 'https://api.example.com',
      authToken: 'test-secret-key-12345',
    });

    expect(provider).toBeTruthy();
    expect(provider.name).toBe(`${TEST_PREFIX}Custom Provider`);
    expect(provider.baseUrl).toBe('https://api.example.com');
    // Auth token should be redacted in response
    expect(provider.authToken).toBe('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022');
    // Models are managed via the separate /models endpoint
    expect(provider.models).toEqual([]);
  });

  test('preserves auth token when updating other fields (API)', async () => {
    // Create a provider with an auth token
    const provider = await createProvider({
      name: `${TEST_PREFIX}Original Name`,
      baseUrl: 'https://api.example.com',
      authToken: 'my-secret-token-abc123',
    });

    // Update only the name (don't include authToken in the payload)
    const updated = await updateProvider(provider.id, {
      name: `${TEST_PREFIX}Updated Name`,
    });

    expect(updated.name).toBe(`${TEST_PREFIX}Updated Name`);
    expect(updated.baseUrl).toBe('https://api.example.com');
    // Auth token should still be redacted
    expect(updated.authToken).toBe('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022');

    // Fetch again to verify persistence
    const fetched = await getProvider(provider.id);
    expect(fetched.authToken).toBe('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022');
  });

  test('updates auth token when explicitly provided (API)', async () => {
    const provider = await createProvider({
      name: `${TEST_PREFIX}Test Provider`,
      baseUrl: 'https://api.example.com',
      authToken: 'original-token',
    });

    const updated = await updateProvider(provider.id, {
      authToken: 'new-token-xyz789',
    });

    expect(updated.authToken).toBe('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022');
  });

  test('can clear auth token when explicitly set to null (API)', async () => {
    const provider = await createProvider({
      name: `${TEST_PREFIX}Test Provider`,
      baseUrl: 'https://api.example.com',
      authToken: 'token-to-be-cleared',
    });

    const updated = await updateProvider(provider.id, {
      authToken: null as any,
    });

    expect(updated.authToken).toBeNull();
  });

  test('can delete a custom provider (API)', async () => {
    const provider = await createProvider({
      name: `${TEST_PREFIX}To Be Deleted`,
      baseUrl: 'https://api.example.com',
      authToken: 'delete-me',
    });

    const success = await deleteProvider(provider.id);
    expect(success).toBe(true);

    const deleted = await getProvider(provider.id);
    expect(deleted).toBeNull();
  });

  // ============================================================
  // Provider Model Management (API)
  // ============================================================

  test('can manage models on a provider (API)', async () => {
    const provider = await createProvider({
      name: `${TEST_PREFIX}Model Management`,
      baseUrl: 'https://api.example.com',
      authToken: 'test-token',
    });

    // Add a sonnet model
    const sonnetModel = await addProviderModel(provider.id, {
      modelId: 'claude-3-5-sonnet-20241022',
      displayName: 'Claude 3.5 Sonnet',
      tier: 'sonnet',
    });

    expect(sonnetModel).toBeTruthy();
    expect(sonnetModel.modelId).toBe('claude-3-5-sonnet-20241022');
    expect(sonnetModel.tier).toBe('sonnet');

    // Add a haiku model
    const haikuModel = await addProviderModel(provider.id, {
      modelId: 'claude-3-haiku-20240307',
      displayName: 'Claude 3 Haiku',
      tier: 'haiku',
    });

    expect(haikuModel).toBeTruthy();

    // Verify both models are on the provider
    const fetchedProvider = await getProvider(provider.id);
    expect(fetchedProvider.models.length).toBe(2);

    // Remove the haiku model
    const removed = await removeProviderModel(provider.id, haikuModel.id);
    expect(removed).toBe(true);

    // Verify only one model remains
    const updatedProvider = await getProvider(provider.id);
    expect(updatedProvider.models.length).toBe(1);
    expect(updatedProvider.models[0].tier).toBe('sonnet');
  });
});

// ============================================================
// UI Tests - Settings > Model Providers page
// ============================================================

test.describe('Model Provider UI - Settings Page', () => {
  test.beforeEach(async () => {
    await cleanupProviders();
  });

  test.afterEach(async () => {
    await cleanupProviders();
  });

  test('displays built-in providers on the settings page', async ({ page }) => {
    await navigateAndWait(page, `${BASE_URL}/settings/providers`, {
      waitFor: '.provider-list',
      timeout: 15000,
    });

    // Should show at least one built-in provider (Anthropic default)
    const providerCards = page.locator('.provider-card');
    const count = await providerCards.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Built-in providers should have the badge
    const builtInBadge = page.locator('.built-in-badge');
    await expect(builtInBadge.first()).toBeVisible({ timeout: 5000 });
  });

  test('can create a provider via the UI', async ({ page }) => {
    await navigateAndWait(page, `${BASE_URL}/settings/providers`, {
      waitFor: '.provider-list',
      timeout: 15000,
    });

    // Count existing providers
    const initialCount = await page.locator('.provider-card').count();

    // Click "Add Provider" button
    await page.locator('button:has-text("Add Provider")').click();

    // Wait for the modal to appear
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill in the form
    await page.locator('#provider-name').fill(`${TEST_PREFIX}UI Created Provider`);
    await page.locator('#base-url').fill('https://ui-test.example.com');
    await page.locator('#auth-token').fill('ui-test-token');

    // Submit the form
    await page.locator('.modal button[type="submit"]').click();

    // Wait for the modal to close
    await expect(modal).toBeHidden({ timeout: 10000 });

    // Wait for the provider list to update
    await page.waitForTimeout(1000);

    // Verify the new provider appears in the list
    const providerCards = page.locator('.provider-card');
    await expect(providerCards).toHaveCount(initialCount + 1, { timeout: 10000 });

    // Verify via API that it was created
    const providers = await getProviders();
    const newProvider = providers.find((p: any) => p.name === `${TEST_PREFIX}UI Created Provider`);
    expect(newProvider).toBeTruthy();
    expect(newProvider.baseUrl).toBe('https://ui-test.example.com');
  });

  test('can edit a provider via the UI', async ({ page }) => {
    // Create a provider via API first
    const provider = await createProvider({
      name: `${TEST_PREFIX}UI Edit Test`,
      baseUrl: 'https://before-edit.example.com',
      authToken: 'edit-test-token',
    });

    await navigateAndWait(page, `${BASE_URL}/settings/providers`, {
      waitFor: '.provider-list',
      timeout: 15000,
    });

    // Find the provider card and click Edit
    const providerCard = page.locator('.provider-card', {
      hasText: `${TEST_PREFIX}UI Edit Test`,
    });
    await expect(providerCard).toBeVisible({ timeout: 10000 });
    await providerCard.locator('button:has-text("Edit")').click();

    // Wait for the modal to appear
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Update the base URL
    const baseUrlInput = page.locator('#base-url');
    await baseUrlInput.clear();
    await baseUrlInput.fill('https://after-edit.example.com');

    // Submit
    await page.locator('.modal button[type="submit"]').click();
    await expect(modal).toBeHidden({ timeout: 10000 });

    // Wait for update
    await page.waitForTimeout(1000);

    // Verify via API
    const updated = await getProvider(provider.id);
    expect(updated.baseUrl).toBe('https://after-edit.example.com');
  });

  test('can delete a provider via the UI', async ({ page }) => {
    // Create a provider via API first
    const provider = await createProvider({
      name: `${TEST_PREFIX}UI Delete Test`,
      baseUrl: 'https://delete-test.example.com',
      authToken: 'delete-test-token',
    });

    await navigateAndWait(page, `${BASE_URL}/settings/providers`, {
      waitFor: '.provider-list',
      timeout: 15000,
    });

    // Find the provider card and click Delete
    const providerCard = page.locator('.provider-card', {
      hasText: `${TEST_PREFIX}UI Delete Test`,
    });
    await expect(providerCard).toBeVisible({ timeout: 10000 });

    // Set up dialog handler to accept the confirmation
    page.on('dialog', (dialog) => dialog.accept());

    await providerCard.locator('button:has-text("Delete")').click();

    // Wait for the provider to be removed
    await expect(
      page.locator('.provider-card', { hasText: `${TEST_PREFIX}UI Delete Test` })
    ).toBeHidden({ timeout: 10000 });

    // Verify via API
    const deleted = await getProvider(provider.id);
    expect(deleted).toBeNull();
  });

  test('shows redacted auth token in provider list', async ({ page }) => {
    await createProvider({
      name: `${TEST_PREFIX}Redacted UI Test`,
      baseUrl: 'https://redacted.example.com',
      authToken: 'super-secret-token-12345',
    });

    await navigateAndWait(page, `${BASE_URL}/settings/providers`, {
      waitFor: '.provider-list',
      timeout: 15000,
    });

    // Find the provider card
    const providerCard = page.locator('.provider-card', {
      hasText: `${TEST_PREFIX}Redacted UI Test`,
    });
    await expect(providerCard).toBeVisible({ timeout: 10000 });

    // The auth token should NOT be visible in plain text
    const cardText = await providerCard.textContent();
    expect(cardText).not.toContain('super-secret-token-12345');
  });
});

// ============================================================
// Provider model selection in session context
// ============================================================

test.describe('Model Provider - Session Model Selection', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupProviders();
    await cleanupCreatedResources();
    project = await seedProject('Provider Session Test', '/tmp/test-provider-session');
  });

  test.afterEach(async () => {
    await cleanupProviders();
    await cleanupCreatedResources();
  });

  test('session model selector includes custom provider models', async ({ page }) => {
    // Create a custom provider with a model
    const provider = await createProvider({
      name: `${TEST_PREFIX}Session Model Provider`,
      baseUrl: 'https://custom-api.example.com',
      authToken: 'custom-token',
    });

    const model = await addProviderModel(provider.id, {
      modelId: 'custom-model-v1',
      displayName: 'Custom Model V1',
      tier: 'custom',
    });

    // Create a draft session
    const session = await seedSession(project.id, {
      prompt: 'Test custom model selection',
      startImmediately: false,
      gitMode: 'none',
      gitBranch: 'main',
    });

    // Navigate to the session
    await page.goto(`${BASE_URL}/sessions/${session.id}/summary`);
    await page.waitForLoadState('networkidle');

    // Open the session chat overlay
    const handle = page.locator('[data-testid="session-chat-handle"]');
    await handle.waitFor({ state: 'visible', timeout: 10000 });
    await handle.click();
    const overlay = page.locator('.session-chat-overlay');
    await overlay.waitFor({ state: 'visible', timeout: 10000 });
    await overlay.locator('.overlay-header').waitFor({ state: 'visible', timeout: 10000 });

    // Check if the custom model appears in the model selector
    const modelSelect = page.locator('#model-select');
    await expect(modelSelect).toBeVisible({ timeout: 10000 });

    // Check if our custom model is available as an option
    const hasCustomModel = await page.evaluate((modelId) => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      return Array.from(select.options).some(opt => opt.value === modelId);
    }, model.modelId);

    // The custom model should be available in the dropdown
    expect(hasCustomModel).toBe(true);
  });
});
