import { test, expect } from '@playwright/test';
import {
  cleanupCreatedResources,
  cleanupProviders,
  createProvider,
  navigateAndWait,
  API_URL,
  BASE_URL,
  TEST_PREFIX,
} from './helpers';

test.describe('Provider kind immutability', () => {
  test.beforeEach(async () => {
    await cleanupProviders();
    await cleanupCreatedResources();
  });

  test.afterEach(async () => {
    await cleanupProviders();
    await cleanupCreatedResources();
  });

  test('existing provider compatibility is locked in UI and rejected by API', async ({ page }) => {
    const provider = await createProvider({
      name: `${TEST_PREFIX}Immutable OpenAI Provider`,
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      authToken: 'sk-placeholder',
    });

    await navigateAndWait(page, `${BASE_URL}/settings/providers`, {
      waitFor: '.provider-list',
      timeout: 15000,
    });

    const providerCard = page.locator('.provider-card', { hasText: provider.name });
    await providerCard.locator('button:has-text("Edit")').click();
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#provider-kind')).toBeDisabled();

    const response = await fetch(`${API_URL}/api/providers/${provider.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'anthropic' }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Unrecognized key');
  });
});
