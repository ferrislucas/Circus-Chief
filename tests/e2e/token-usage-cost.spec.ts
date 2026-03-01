/**
 * token-usage-cost.spec.ts
 * E2E tests for Token Cost Tracking (Section 16 of feature accounting).
 *
 * Covers:
 * 1. Configurable cost weights API (GET/PUT/DELETE /api/settings/token-weights)
 * 2. Token cost panel in conversation view
 * 3. Per-conversation tracking
 * 4. Settings modal to customize token weights
 */

import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedConversation,
  getConversations,
  navigateAndWait,
  cleanupCreatedResources,
  resetTokenWeights,
  updateTokenWeights,
  getTokenWeights,
  seedConversationTokens,
  getAPIURL,
} from './helpers';

const DEFAULT_WEIGHTS = { input: 1.0, output: 5.0, cacheRead: 0.1, cacheCreation: 1.25 };

// All token-weight tests share a global settings row — run serially to avoid cross-test contamination.
test.describe.configure({ mode: 'serial' });

// ============================================================
// Category 1: Token Weights API — CRUD & Validation (7 tests)
// ============================================================

test.describe('Token Weights API — CRUD & Validation', () => {
  test.afterEach(async () => {
    await resetTokenWeights();
  });

  test('GET /settings/token-weights returns default weights', async () => {
    const weights = await getTokenWeights();
    expect(weights).toMatchObject(DEFAULT_WEIGHTS);
  });

  test('PUT /settings/token-weights updates all weights', async () => {
    const newWeights = { input: 2.0, output: 10.0, cacheRead: 0.2, cacheCreation: 2.5 };
    const result = await updateTokenWeights(newWeights);
    expect(result).toMatchObject(newWeights);
  });

  test('PUT /settings/token-weights persists across requests', async () => {
    const newWeights = { input: 2.0, output: 10.0, cacheRead: 0.2, cacheCreation: 2.5 };
    await updateTokenWeights(newWeights);
    const result = await getTokenWeights();
    expect(result).toMatchObject(newWeights);
  });

  test('PUT /settings/token-weights rejects negative values', async () => {
    const API_URL = getAPIURL();
    const response = await fetch(`${API_URL}/api/settings/token-weights`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: -1, output: 5.0, cacheRead: 0.1, cacheCreation: 1.25 }),
    });
    expect(response.status).toBe(400);
  });

  test('PUT /settings/token-weights rejects non-numeric values', async () => {
    const API_URL = getAPIURL();
    const response = await fetch(`${API_URL}/api/settings/token-weights`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'abc', output: 5.0, cacheRead: 0.1, cacheCreation: 1.25 }),
    });
    expect(response.status).toBe(400);
  });

  test('DELETE /settings/token-weights resets to defaults', async () => {
    await updateTokenWeights({ input: 2.0, output: 10.0, cacheRead: 0.2, cacheCreation: 2.5 });
    const result = await resetTokenWeights();
    expect(result).toMatchObject(DEFAULT_WEIGHTS);
  });

  test('DELETE followed by GET returns defaults', async () => {
    await updateTokenWeights({ input: 2.0, output: 10.0, cacheRead: 0.2, cacheCreation: 2.5 });
    await resetTokenWeights();
    const result = await getTokenWeights();
    expect(result).toMatchObject(DEFAULT_WEIGHTS);
  });
});

// ============================================================
// Category 2: Token Cost Panel — BTE Display (5 tests)
// ============================================================

test.describe('Token Cost Panel — BTE Display', () => {
  let projectId: string;
  let sessionId: string;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    await resetTokenWeights();
    const project = await seedProject('Token Test', '/tmp');
    projectId = project.id;
    const session = await seedSession(projectId, {
      prompt: 'Test BTE cost display',
      startImmediately: false,
    });
    sessionId = session.id;
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
    await resetTokenWeights();
  });

  test('cost panel is visible when tokens have non-zero cost', async ({ page }) => {
    seedConversationTokens(sessionId, null, { inputTokens: 5000, outputTokens: 2000 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.token-cost-panel')).toBeVisible({ timeout: 10000 });
  });

  test('cost panel is hidden when cost is zero', async ({ page }) => {
    // Seed all-zero tokens → BTE = 0 → v-if="hasNonZeroCost" is false → panel hidden
    seedConversationTokens(sessionId, null, { inputTokens: 0, outputTokens: 0 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.token-cost-panel')).not.toBeVisible({ timeout: 10000 });
  });

  test('displays BTE value in collapsed view', async ({ page }) => {
    // input=10000, output=2000 → BTE = 10000×1.0 + 2000×5.0 = 20000 → "20.0K"
    seedConversationTokens(sessionId, null, { inputTokens: 10000, outputTokens: 2000 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.token-cost-panel .cost-value')).toHaveText('20.0K', { timeout: 10000 });
  });

  test('clicking cost display expands breakdown', async ({ page }) => {
    seedConversationTokens(sessionId, null, { inputTokens: 10000, outputTokens: 2000 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await page.locator('.token-cost-panel .cost-display').click();
    await expect(page.locator('.token-breakdown')).toBeVisible({ timeout: 10000 });
  });

  test('expanded breakdown shows weight multipliers', async ({ page }) => {
    // Verify ×1, ×5, ×0.1, ×1.25 weight labels are shown
    seedConversationTokens(sessionId, null, {
      inputTokens: 10000,
      outputTokens: 2000,
      cacheReadInputTokens: 5000,
      cacheCreationInputTokens: 1000,
    });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await page.locator('.token-cost-panel .cost-display').click();
    await expect(page.locator('.token-breakdown')).toBeVisible({ timeout: 10000 });

    const weights = page.locator('.token-breakdown .token-weight');
    await expect(weights.nth(0)).toContainText('×1');
    await expect(weights.nth(1)).toContainText('×5');
    await expect(weights.nth(2)).toContainText('×0.1');
    await expect(weights.nth(3)).toContainText('×1.25');
  });
});

// ============================================================
// Category 3: Token Weights Modal (6 tests)
// ============================================================

test.describe('Token Weights Modal', () => {
  let projectId: string;
  let sessionId: string;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    await resetTokenWeights();
    const project = await seedProject('Token Test', '/tmp');
    projectId = project.id;
    const session = await seedSession(projectId, {
      prompt: 'Test token weights modal',
      startImmediately: false,
    });
    sessionId = session.id;
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
    await resetTokenWeights();
  });

  async function openWeightsModal(page: any) {
    // Reset weights to guard against parallel test interference (another test may have modified weights)
    await resetTokenWeights();
    // Seed tokens so the cost panel is visible (BTE > 0)
    seedConversationTokens(sessionId, null, { inputTokens: 10000, outputTokens: 2000 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    // Expand cost panel to reveal the gear/settings button
    await page.locator('.token-cost-panel .cost-display').click();
    await expect(page.locator('.token-breakdown')).toBeVisible({ timeout: 10000 });
    // Click the settings gear button
    await page.locator('.token-cost-panel .settings-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 10000 });
  }

  test('gear button opens token weights modal', async ({ page }) => {
    await openWeightsModal(page);
    await expect(page.locator('.modal .modal-header h2')).toContainText('Token Cost Weights');
  });

  test('modal displays current weights in input fields', async ({ page }) => {
    await openWeightsModal(page);
    await expect(page.locator('#input-weight')).toHaveValue('1');
    await expect(page.locator('#output-weight')).toHaveValue('5');
    await expect(page.locator('#cache-read-weight')).toHaveValue('0.1');
    await expect(page.locator('#cache-creation-weight')).toHaveValue('1.25');
  });

  test('modal shows computed hints', async ({ page }) => {
    await openWeightsModal(page);
    const hints = page.locator('.modal .hint');
    await expect(hints.nth(0)).toContainText('base rate');
    await expect(hints.nth(1)).toContainText('5.0× input');
    await expect(hints.nth(2)).toContainText('90% discount');
    await expect(hints.nth(3)).toContainText('25% premium');
  });

  test('saving updated weights via modal updates API', async ({ page }) => {
    await openWeightsModal(page);
    const outputInput = page.locator('#output-weight');
    // Use triple-click to select all then type to ensure Vue v-model.number picks up the change
    await outputInput.click({ clickCount: 3 });
    await outputInput.pressSequentially('10');
    // Tab away to trigger change/blur event and ensure v-model.number propagation
    await outputInput.press('Tab');
    // Wait for Vue's v-model.number to propagate the change and enable the Save button (hasChanges = true)
    await expect(page.locator('.modal .btn.btn-primary')).toBeEnabled({ timeout: 5000 });
    await page.locator('.modal .btn.btn-primary').click();
    // Modal should close
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 10000 });
    // Verify API has updated weight
    const weights = await getTokenWeights();
    expect(weights.output).toBe(10);
  });

  test('reset to defaults restores default weights', async ({ page }) => {
    // Set custom weights first
    await updateTokenWeights({ input: 2.0, output: 10.0, cacheRead: 0.2, cacheCreation: 2.5 });
    await openWeightsModal(page);
    // Click "Reset to Defaults" (first .btn-secondary)
    await page.locator('.modal .btn.btn-secondary').first().click();
    // Modal should close
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 10000 });
    // Verify API has default weights
    const weights = await getTokenWeights();
    expect(weights).toMatchObject(DEFAULT_WEIGHTS);
  });

  test('cancel closes modal without saving', async ({ page }) => {
    await openWeightsModal(page);
    const originalWeights = await getTokenWeights();
    // Change a weight using triple-click + type to ensure Vue v-model.number propagation
    const outputInput = page.locator('#output-weight');
    await outputInput.click({ clickCount: 3 });
    await outputInput.pressSequentially('99');
    await outputInput.press('Tab');
    // Click Cancel (last .btn-secondary)
    await page.locator('.modal .btn.btn-secondary').last().click();
    // Modal should close
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 10000 });
    // API weights should be unchanged
    const weights = await getTokenWeights();
    expect(weights.output).toBe(originalWeights.output);
  });
});

// ============================================================
// Category 4: Per-Conversation Token Tracking (3 tests)
// ============================================================

test.describe('Per-Conversation Token Tracking', () => {
  let projectId: string;
  let sessionId: string;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    await resetTokenWeights();
    const project = await seedProject('Token Test', '/tmp');
    projectId = project.id;
    const session = await seedSession(projectId, {
      prompt: 'Test per-conversation tracking',
      startImmediately: false,
    });
    sessionId = session.id;
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
    await resetTokenWeights();
  });

  test('different conversations have independent token counts via API', async () => {
    const conversations = await getConversations(sessionId);
    const convA = conversations[0];
    const convB = await seedConversation(sessionId, 'Conv B');

    // Seed different token counts for each conversation
    seedConversationTokens(sessionId, convA.id, { inputTokens: 6000, outputTokens: 4000 });
    seedConversationTokens(sessionId, convB.id, { inputTokens: 30000, outputTokens: 20000 });

    // Verify via API that each conversation has its own token values
    const updatedConvs = await getConversations(sessionId);
    const updatedA = updatedConvs.find((c: any) => c.id === convA.id);
    const updatedB = updatedConvs.find((c: any) => c.id === convB.id);

    expect(updatedA.inputTokens).toBe(6000);
    expect(updatedA.outputTokens).toBe(4000);
    expect(updatedB.inputTokens).toBe(30000);
    expect(updatedB.outputTokens).toBe(20000);
  });

  test('BTE calculation uses active conversation tokens', async ({ page }) => {
    // Explicitly reset weights to defaults and verify to guard against cross-test contamination
    await resetTokenWeights();
    const weights = await getTokenWeights();
    expect(weights).toMatchObject({ input: 1.0, output: 5.0, cacheRead: 0.1, cacheCreation: 1.25 });

    const conversations = await getConversations(sessionId);
    const convA = conversations[0];

    // input=5000, output=1000 → BTE = 5000×1.0 + 1000×5.0 = 10000 → "10.0K" (with default weights)
    seedConversationTokens(sessionId, convA.id, { inputTokens: 5000, outputTokens: 1000 });
    // Full page load ensures Pinia store initializes fresh and fetches current (default) weights from API
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    // Wait for settings to be fetched before asserting BTE (TokenCostPanel fetches on mount)
    await page.waitForTimeout(500);
    await expect(page.locator('.token-cost-panel .cost-value')).toHaveText('10.0K', { timeout: 10000 });
  });

  test('cost panel BTE updates with custom weights', async ({ page }) => {
    // Set output weight to 10 before navigating and verify via API
    await updateTokenWeights({ input: 1.0, output: 10.0, cacheRead: 0.1, cacheCreation: 1.25 });
    const verifiedWeights = await getTokenWeights();
    expect(verifiedWeights.output).toBe(10);

    const conversations = await getConversations(sessionId);
    const convA = conversations[0];

    // input=5000, output=1000 → BTE = 5000×1.0 + 1000×10.0 = 15000 → "15.0K"
    seedConversationTokens(sessionId, convA.id, { inputTokens: 5000, outputTokens: 1000 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    // Wait for the settings store to fetch custom weights from API before asserting
    await page.waitForTimeout(500);
    await expect(page.locator('.token-cost-panel .cost-value')).toHaveText('15.0K', { timeout: 10000 });
  });
});

