/**
 * token-usage-cost.spec.ts
 * E2E tests for Token Usage & Cost Tracking (Section 16 of feature accounting).
 *
 * Covers:
 * 1. Configurable cost weights API (GET/PUT/DELETE /api/settings/token-weights)
 * 2. Token cost panel in conversation view
 * 3. Human-readable formatting (K, M suffixes)
 * 4. Per-conversation tracking
 * 5. Settings modal to customize token weights
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
// Category 2: Token Usage Panel — Basic Display (5 tests)
// ============================================================

test.describe('Token Usage Panel — Basic Display', () => {
  let projectId: string;
  let sessionId: string;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    await resetTokenWeights();
    const project = await seedProject('Token Test', '/tmp');
    projectId = project.id;
    const session = await seedSession(projectId, {
      prompt: 'Test token usage',
      startImmediately: false,
    });
    sessionId = session.id;
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
    await resetTokenWeights();
  });

  test('token usage panel is visible on conversation tab', async ({ page }) => {
    seedConversationTokens(sessionId, null, { inputTokens: 5000, outputTokens: 2000 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.token-usage-panel')).toBeVisible({ timeout: 10000 });
  });

  test('displays total token count', async ({ page }) => {
    // 15000 + 5000 = 20000 → formatTokenCount(20000) = "20.0K"
    seedConversationTokens(sessionId, null, { inputTokens: 15000, outputTokens: 5000 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.token-usage-panel .total-label')).toHaveText('20.0K', { timeout: 10000 });
  });

  test('displays "tokens" suffix', async ({ page }) => {
    seedConversationTokens(sessionId, null, { inputTokens: 5000, outputTokens: 2000 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.token-usage-panel .total-suffix')).toContainText('tokens', { timeout: 10000 });
  });

  test('displays context bar with correct percentage', async ({ page }) => {
    // (30000 + 20000) / 200000 × 100 = 25%
    seedConversationTokens(sessionId, null, {
      inputTokens: 30000,
      outputTokens: 20000,
      contextWindow: 200000,
    });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.context-pct')).toContainText('25%', { timeout: 10000 });
  });

  test('context bar shows critical color class at >90% usage', async ({ page }) => {
    // (100000 + 90000) / 200000 × 100 = 95% → critical
    seedConversationTokens(sessionId, null, {
      inputTokens: 100000,
      outputTokens: 90000,
      contextWindow: 200000,
    });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.context-bar-fill.critical')).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================
// Category 3: Token Usage Panel — Expand/Collapse & Breakdown (5 tests)
// ============================================================

test.describe('Token Usage Panel — Expand/Collapse & Breakdown', () => {
  let projectId: string;
  let sessionId: string;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    await resetTokenWeights();
    const project = await seedProject('Token Test', '/tmp');
    projectId = project.id;
    const session = await seedSession(projectId, {
      prompt: 'Test token breakdown',
      startImmediately: false,
    });
    sessionId = session.id;
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
    await resetTokenWeights();
  });

  test('expand button appears when cache tokens exist', async ({ page }) => {
    seedConversationTokens(sessionId, null, {
      inputTokens: 5000,
      outputTokens: 2000,
      cacheReadInputTokens: 3000,
      cacheCreationInputTokens: 1000,
    });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.token-usage-panel .toggle-details')).toBeVisible({ timeout: 10000 });
  });

  test('expand button hidden when no cache tokens', async ({ page }) => {
    seedConversationTokens(sessionId, null, { inputTokens: 5000, outputTokens: 2000 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.token-usage-panel .toggle-details')).not.toBeVisible({ timeout: 10000 });
  });

  test('clicking expand shows token breakdown', async ({ page }) => {
    seedConversationTokens(sessionId, null, {
      inputTokens: 5000,
      outputTokens: 2000,
      cacheReadInputTokens: 3000,
      cacheCreationInputTokens: 1000,
    });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await page.locator('.token-usage-panel .toggle-details').click();
    await expect(page.locator('.usage-details')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.usage-details .stat')).toHaveCount(4, { timeout: 10000 });
  });

  test('breakdown shows correct values for all 4 token types', async ({ page }) => {
    // input=15000 → "15.0K", output=5000 → "5.0K", cacheRead=8000 → "8.0K", cacheCreation=2000 → "2.0K"
    seedConversationTokens(sessionId, null, {
      inputTokens: 15000,
      outputTokens: 5000,
      cacheReadInputTokens: 8000,
      cacheCreationInputTokens: 2000,
    });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await page.locator('.token-usage-panel .toggle-details').click();
    await expect(page.locator('.usage-details')).toBeVisible({ timeout: 10000 });

    const stats = page.locator('.usage-details .stat');
    // Check labels
    await expect(stats.nth(0).locator('.stat-label')).toContainText('Input');
    await expect(stats.nth(1).locator('.stat-label')).toContainText('Output');
    await expect(stats.nth(2).locator('.stat-label')).toContainText('Cache Read');
    await expect(stats.nth(3).locator('.stat-label')).toContainText('Cache Creation');
    // Check values
    await expect(stats.nth(0).locator('.stat-value')).toHaveText('15.0K');
    await expect(stats.nth(1).locator('.stat-value')).toHaveText('5.0K');
    await expect(stats.nth(2).locator('.stat-value')).toHaveText('8.0K');
    await expect(stats.nth(3).locator('.stat-value')).toHaveText('2.0K');
  });

  test('clicking collapse hides breakdown', async ({ page }) => {
    seedConversationTokens(sessionId, null, {
      inputTokens: 5000,
      outputTokens: 2000,
      cacheReadInputTokens: 3000,
      cacheCreationInputTokens: 1000,
    });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    // Expand
    await page.locator('.token-usage-panel .toggle-details').click();
    await expect(page.locator('.usage-details')).toBeVisible({ timeout: 10000 });
    // Collapse
    await page.locator('.token-usage-panel .toggle-details').click();
    await expect(page.locator('.usage-details')).not.toBeVisible({ timeout: 10000 });
  });
});

// ============================================================
// Category 4: Token Cost Panel — BTE Display (5 tests)
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
// Category 5: Token Weights Modal (6 tests)
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
// Category 6: Human-Readable Formatting (4 tests)
// ============================================================

test.describe('Human-Readable Formatting', () => {
  let projectId: string;
  let sessionId: string;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    await resetTokenWeights();
    const project = await seedProject('Token Test', '/tmp');
    projectId = project.id;
    const session = await seedSession(projectId, {
      prompt: 'Test token formatting',
      startImmediately: false,
    });
    sessionId = session.id;
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
    await resetTokenWeights();
  });

  test('displays raw number for counts under 1000', async ({ page }) => {
    // 300 + 200 = 500 tokens → formatTokenCount(500) = "500"
    seedConversationTokens(sessionId, null, { inputTokens: 300, outputTokens: 200 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.token-usage-panel .total-label')).toHaveText('500', { timeout: 10000 });
  });

  test('displays K suffix for thousands', async ({ page }) => {
    // 10000 + 5000 = 15000 → formatTokenCount(15000) = "15.0K"
    seedConversationTokens(sessionId, null, { inputTokens: 10000, outputTokens: 5000 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.token-usage-panel .total-label')).toHaveText('15.0K', { timeout: 10000 });
  });

  test('displays decimal K for partial thousands', async ({ page }) => {
    // 1000 + 500 = 1500 → formatTokenCount(1500) = "1.5K"
    seedConversationTokens(sessionId, null, { inputTokens: 1000, outputTokens: 500 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.token-usage-panel .total-label')).toHaveText('1.5K', { timeout: 10000 });
  });

  test('displays M suffix for millions', async ({ page }) => {
    // 1000000 + 500000 = 1500000 → formatTokenCount(1500000) = "1.5M"
    seedConversationTokens(sessionId, null, { inputTokens: 1000000, outputTokens: 500000 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.token-usage-panel .total-label')).toHaveText('1.5M', { timeout: 10000 });
  });
});

// ============================================================
// Category 7: Per-Conversation Token Tracking (4 tests)
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

  test('token panel reflects active conversation tokens', async ({ page }) => {
    const conversations = await getConversations(sessionId);
    const convA = conversations[0]; // active conversation

    // Seed 10000 total on the active conversation → "10.0K"
    seedConversationTokens(sessionId, convA.id, { inputTokens: 6000, outputTokens: 4000 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.token-usage-panel .total-label')).toHaveText('10.0K', { timeout: 10000 });
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

// ============================================================
// Category 8: Edge Cases (3 tests)
// ============================================================

test.describe('Edge Cases', () => {
  let projectId: string;
  let sessionId: string;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    await resetTokenWeights();
    const project = await seedProject('Token Test', '/tmp');
    projectId = project.id;
    const session = await seedSession(projectId, {
      prompt: 'Test edge cases',
      startImmediately: false,
    });
    sessionId = session.id;
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
    await resetTokenWeights();
  });

  test('zero tokens shows zero', async ({ page }) => {
    // formatTokenCount(0) returns "0", NOT "-" (dash is only for null/undefined)
    seedConversationTokens(sessionId, null, { inputTokens: 0, outputTokens: 0 });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.token-usage-panel .total-label')).toHaveText('0', { timeout: 10000 });
  });

  test('context bar shows warning color at 70-90% usage', async ({ page }) => {
    // (100000 + 50000) / 200000 × 100 = 75% → warning class
    seedConversationTokens(sessionId, null, {
      inputTokens: 100000,
      outputTokens: 50000,
      contextWindow: 200000,
    });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.context-bar-fill.warning')).toBeVisible({ timeout: 10000 });
  });

  test('context bar shows normal color below 70%', async ({ page }) => {
    // (30000 + 20000) / 200000 × 100 = 25% → normal class
    seedConversationTokens(sessionId, null, {
      inputTokens: 30000,
      outputTokens: 20000,
      contextWindow: 200000,
    });
    await navigateAndWait(page, `/sessions/${sessionId}/conversation`);
    await expect(page.locator('.context-bar-fill.normal')).toBeVisible({ timeout: 10000 });
  });
});
