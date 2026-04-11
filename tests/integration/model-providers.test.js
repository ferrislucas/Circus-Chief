/**
 * Model Provider Integration Tests
 *
 * Tests the model provider CRUD API endpoints without Playwright.
 * Converted from tests/e2e/model-providers.spec.ts.
 * Covers: create, read, update, delete, list, auth token redaction,
 * auth token preservation on partial update, and model management.
 */
import { describe, it, expect } from 'vitest';
import {
  apiFetch,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
} from './setup.js';

const TEST_PREFIX = '[TEST]';

// ============================================================
// Provider Helpers
// ============================================================

/**
 * Create a provider via the API.
 */
async function createProvider(provider) {
  const response = await apiFetch('/api/providers', {
    method: 'POST',
    body: JSON.stringify(provider),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to create provider (${response.status}): ${err}`);
  }
  return response.json();
}

/**
 * Get a provider by ID.
 */
async function getProvider(id) {
  const response = await apiFetch(`/api/providers/${id}`);
  if (!response.ok) return null;
  return response.json();
}

/**
 * Update a provider.
 */
async function updateProvider(id, updates) {
  const response = await apiFetch(`/api/providers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to update provider (${response.status}): ${err}`);
  }
  return response.json();
}

/**
 * Delete a provider.
 */
async function deleteProvider(id) {
  const response = await apiFetch(`/api/providers/${id}`, { method: 'DELETE' });
  return response.ok;
}

/**
 * Get all providers.
 */
async function getProviders() {
  return apiGet('/api/providers');
}

/**
 * Cleanup test providers.
 */
async function cleanupProviders() {
  const providers = await getProviders();
  if (!Array.isArray(providers)) return;
  for (const provider of providers) {
    if (provider.name && provider.name.startsWith(TEST_PREFIX) && !provider.isBuiltIn) {
      await deleteProvider(provider.id);
    }
  }
}

// ============================================================
// Model Helpers
// ============================================================

/**
 * Add a model to a provider.
 */
async function addProviderModel(providerId, model) {
  const response = await apiFetch(`/api/providers/${providerId}/models`, {
    method: 'POST',
    body: JSON.stringify(model),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to add model (${response.status}): ${err}`);
  }
  return response.json();
}

/**
 * Get models for a provider.
 */
async function getProviderModels(providerId) {
  return apiGet(`/api/providers/${providerId}/models`);
}

/**
 * Update a provider model.
 */
async function updateProviderModel(providerId, modelRowId, data) {
  const response = await apiFetch(`/api/providers/${providerId}/models/${modelRowId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to update model (${response.status}): ${err}`);
  }
  return response.json();
}

/**
 * Remove a provider model.
 */
async function removeProviderModel(providerId, modelRowId) {
  const response = await apiFetch(`/api/providers/${providerId}/models/${modelRowId}`, {
    method: 'DELETE',
  });
  return response.ok;
}

// ============================================================
// Provider CRUD Tests
// ============================================================

describe('Model Provider API - CRUD', () => {
  afterEach(async () => {
    await cleanupProviders();
  });

  it('can create a provider', async () => {
    const provider = await createProvider({
      name: `${TEST_PREFIX} Test Provider`,
      baseUrl: 'https://api.example.com',
      authToken: 'test-token-123',
    });

    expect(provider).toBeTruthy();
    expect(provider.id).toBeTruthy();
    expect(provider.name).toBe(`${TEST_PREFIX} Test Provider`);
    expect(provider.baseUrl).toBe('https://api.example.com');
    // Auth token should be redacted in response
    expect(provider.authToken).toBe('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022');
  });

  it('redacts auth token in create response', async () => {
    const provider = await createProvider({
      name: `${TEST_PREFIX} Redacted Test`,
      baseUrl: 'https://api.example.com',
      authToken: 'my-secret-key-12345',
    });

    // Auth token should be redacted in the response
    expect(provider.authToken).toBe('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022');
  });

  it('can read a provider back', async () => {
    const provider = await createProvider({
      name: `${TEST_PREFIX} Read Test`,
      baseUrl: 'https://api.example.com',
      authToken: 'read-token',
    });

    const fetched = await getProvider(provider.id);
    expect(fetched).toBeTruthy();
    expect(fetched.name).toBe(`${TEST_PREFIX} Read Test`);
    expect(fetched.baseUrl).toBe('https://api.example.com');
  });

  it('returns null for non-existent provider', async () => {
    const fetched = await getProvider('non-existent-id');
    expect(fetched).toBeNull();
  });

  it('can update a provider', async () => {
    const provider = await createProvider({
      name: `${TEST_PREFIX} Update Test`,
      baseUrl: 'https://api.example.com',
      authToken: 'original-token',
    });

    const updated = await updateProvider(provider.id, {
      name: `${TEST_PREFIX} Updated Name`,
      baseUrl: 'https://updated.example.com',
    });

    expect(updated.name).toBe(`${TEST_PREFIX} Updated Name`);
    expect(updated.baseUrl).toBe('https://updated.example.com');

    // Verify persistence
    const fetched = await getProvider(provider.id);
    expect(fetched.name).toBe(`${TEST_PREFIX} Updated Name`);
  });

  it('can delete a provider', async () => {
    const provider = await createProvider({
      name: `${TEST_PREFIX} To Be Deleted`,
      baseUrl: 'https://api.example.com',
      authToken: 'delete-me',
    });

    const success = await deleteProvider(provider.id);
    expect(success).toBe(true);

    const deleted = await getProvider(provider.id);
    expect(deleted).toBeNull();
  });

  it('lists all providers', async () => {
    const providers = [];
    for (let i = 0; i < 3; i++) {
      providers.push(await createProvider({
        name: `${TEST_PREFIX} List Test ${i}`,
        baseUrl: `https://api${i}.example.com`,
        authToken: `token-${i}`,
      }));
    }

    const allProviders = await getProviders();
    const testProviders = allProviders.filter((p) => p.name?.startsWith(TEST_PREFIX));
    expect(testProviders.length).toBe(3);
  });
});

// ============================================================
// Auth Token Handling Tests
// ============================================================

describe('Model Provider API - Auth Token Handling', () => {
  afterEach(async () => {
    await cleanupProviders();
  });

  it('preserves auth token when updating other fields', async () => {
    // Create a provider with an auth token
    const provider = await createProvider({
      name: `${TEST_PREFIX} Token Preserve`,
      baseUrl: 'https://api.example.com',
      authToken: 'my-secret-token-abc123',
    });

    // Verify token is redacted in create response
    expect(provider.authToken).toBe('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022');

    // Update only the name (don't include authToken in the payload)
    const updated = await updateProvider(provider.id, {
      name: `${TEST_PREFIX} Updated Name`,
    });

    expect(updated.name).toBe(`${TEST_PREFIX} Updated Name`);
    // Auth token should still be redacted (meaning it was preserved)
    expect(updated.authToken).toBe('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022');

    // Fetch again and verify
    const fetched = await getProvider(provider.id);
    expect(fetched.authToken).toBe('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022');
  });

  it('updates auth token when explicitly provided', async () => {
    const provider = await createProvider({
      name: `${TEST_PREFIX} Token Update`,
      baseUrl: 'https://api.example.com',
      authToken: 'original-token',
    });

    // Update with a new auth token
    const updated = await updateProvider(provider.id, {
      authToken: 'new-token-xyz789',
    });

    // Still redacted in response
    expect(updated.authToken).toBe('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022');
  });

  it('can clear auth token when explicitly set to null', async () => {
    const provider = await createProvider({
      name: `${TEST_PREFIX} Token Clear`,
      baseUrl: 'https://api.example.com',
      authToken: 'token-to-be-cleared',
    });

    // Explicitly clear the token
    const updated = await updateProvider(provider.id, {
      authToken: null,
    });

    expect(updated.authToken).toBeNull();
  });

  it('redacts auth token in list response', async () => {
    await createProvider({
      name: `${TEST_PREFIX} List Redacted`,
      baseUrl: 'https://api.example.com',
      authToken: 'secret-token-for-list',
    });

    const allProviders = await getProviders();
    const testProvider = allProviders.find((p) => p.name === `${TEST_PREFIX} List Redacted`);
    expect(testProvider).toBeTruthy();
    // Token should be redacted in list response
    expect(testProvider.authToken).toBe('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022');
  });
});

// ============================================================
// Provider Model Management Tests
// ============================================================

describe('Model Provider API - Model Management', () => {
  let providerId;

  beforeEach(async () => {
    await cleanupProviders();
    const provider = await createProvider({
      name: `${TEST_PREFIX} Model Test`,
      baseUrl: 'https://api.example.com',
      authToken: 'test-token',
    });
    providerId = provider.id;
  });

  afterEach(async () => {
    await cleanupProviders();
  });

  it('starts with empty models list', async () => {
    const models = await getProviderModels(providerId);
    expect(models).toEqual([]);
  });

  it('can add a model to a provider', async () => {
    const model = await addProviderModel(providerId, {
      modelId: 'claude-3-5-sonnet-20241022',
      displayName: 'Claude 3.5 Sonnet',
      tier: 'sonnet',
    });

    expect(model).toBeTruthy();
    expect(model.modelId).toBe('claude-3-5-sonnet-20241022');
    expect(model.displayName).toBe('Claude 3.5 Sonnet');
    expect(model.tier).toBe('sonnet');
  });

  it('can list models for a provider', async () => {
    await addProviderModel(providerId, {
      modelId: 'claude-3-5-sonnet-20241022',
      displayName: 'Claude 3.5 Sonnet',
      tier: 'sonnet',
    });
    await addProviderModel(providerId, {
      modelId: 'claude-3-haiku-20240307',
      displayName: 'Claude 3 Haiku',
      tier: 'haiku',
    });

    const models = await getProviderModels(providerId);
    expect(models.length).toBe(2);
    const tiers = models.map((m) => m.tier);
    expect(tiers).toContain('sonnet');
    expect(tiers).toContain('haiku');
  });

  it('can update a model', async () => {
    const model = await addProviderModel(providerId, {
      modelId: 'claude-3-5-sonnet-20241022',
      displayName: 'Claude 3.5 Sonnet',
      tier: 'sonnet',
    });

    const updated = await updateProviderModel(providerId, model.id, {
      displayName: 'Updated Sonnet Name',
      tier: 'custom',
    });

    expect(updated.displayName).toBe('Updated Sonnet Name');
    expect(updated.tier).toBe('custom');
  });

  it('can remove a model from a provider', async () => {
    const model = await addProviderModel(providerId, {
      modelId: 'claude-3-5-sonnet-20241022',
      displayName: 'Claude 3.5 Sonnet',
      tier: 'sonnet',
    });

    const success = await removeProviderModel(providerId, model.id);
    expect(success).toBe(true);

    const models = await getProviderModels(providerId);
    expect(models.length).toBe(0);
  });

  it('returns 404 when adding model to non-existent provider', async () => {
    const response = await apiFetch('/api/providers/non-existent-id/models', {
      method: 'POST',
      body: JSON.stringify({
        modelId: 'claude-3-5-sonnet-20241022',
        displayName: 'Test',
        tier: 'sonnet',
      }),
    });
    expect(response.status).toBe(404);
  });
});
