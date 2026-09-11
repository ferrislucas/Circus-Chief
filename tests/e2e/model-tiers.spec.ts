import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  createProvider,
  addProviderModel,
  cleanupProviders,
  navigateAndWait,
  openSessionOverlay,
  BASE_URL,
  API_URL,
  TEST_PREFIX,
} from './helpers';

/**
 * E2E tests for Model Tiers (Issue 1 — review-fix remediation plan).
 *
 * Scope (per the amended DoD — see model-tiers-review-fixes-1-2-4.md, option A):
 *   - Model Tiers settings tab renders.
 *   - Tier CRUD (create / rename / add-member / delete) via the UI.
 *   - Reordering members persists the new order.
 *   - ModelSelector: selecting a tier stores the `tier::<id>` sentinel and is
 *     mutually exclusive with a concrete model.
 *   - The failover *notice* (toast) renders when a `TIER_FAILOVER` WebSocket
 *     message arrives — the message is injected via `page.routeWebSocket`
 *     rather than provoking a real provider outage (the cassette harness
 *     cannot express a start-time provider error deterministically). Actual
 *     failover *behavior* (AC3–AC6) is covered by the server integration
 *     suite (`sessionTierFailover.test.js`), not here.
 *
 * Run in isolation: ./scripts/pw.sh test tests/e2e/model-tiers.spec.ts
 */

// Tiers are global (not project-scoped) and `cleanupProviders()` sweeps every
// TEST_PREFIX-named provider for the whole file — run serially so concurrent
// tests don't delete each other's fixtures mid-test (mirrors settings.spec.ts).
test.describe.configure({ mode: 'serial' });

async function createTierViaApi(data: {
  name: string;
  description?: string | null;
  members?: Array<{ providerId: string; modelId: string; position: number }>;
}) {
  const response = await fetch(`${API_URL}/api/tiers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`Failed to create tier (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

async function deleteTierViaApi(id: string) {
  await fetch(`${API_URL}/api/tiers/${id}`, { method: 'DELETE' }).catch(() => {});
}

async function getTiersViaApi(): Promise<any[]> {
  const response = await fetch(`${API_URL}/api/tiers`);
  if (!response.ok) return [];
  return response.json();
}

test.describe('Model Tiers', () => {
  const createdTierIds: string[] = [];

  test.afterEach(async () => {
    for (const id of createdTierIds.splice(0)) {
      await deleteTierViaApi(id);
    }
    await cleanupProviders();
    await cleanupCreatedResources();
  });

  test.describe('Settings tab', () => {
    test('renders the Model Tiers view at /settings/tiers', async ({ page }) => {
      await navigateAndWait(page, `${BASE_URL}/settings/tiers`);

      await expect(page.locator('a.tab[href="/settings/tiers"]')).toHaveClass(/active/);
      await expect(page.locator('.model-tiers-view h2')).toHaveText('Model Tiers');
      await expect(page.locator('.model-tiers-view button.btn-primary')).toContainText('New Tier');
    });
  });

  test.describe('Tier CRUD', () => {
    test('create, add a member, rename, add a second member, and delete a tier', async ({ page }) => {
      const provider = await createProvider({ name: `${TEST_PREFIX}Tier CRUD Provider` });
      await addProviderModel(provider.id, { modelId: 'tier-crud-model-a', displayName: 'Tier CRUD Model A' });
      await addProviderModel(provider.id, { modelId: 'tier-crud-model-b', displayName: 'Tier CRUD Model B' });

      await navigateAndWait(page, `${BASE_URL}/settings/tiers`);

      // ── Create ──────────────────────────────────────────────────────────
      await page.locator('.model-tiers-view button.btn-primary', { hasText: 'New Tier' }).click();
      const createModal = page.locator('.modal-overlay .modal');
      await expect(createModal).toBeVisible();

      const tierName = `${TEST_PREFIX}CRUD Tier`;
      await createModal.locator('#tier-name').fill(tierName);
      await createModal.locator('.member-select').selectOption(`${provider.id}::tier-crud-model-a`);
      await createModal.locator('button.btn-secondary', { hasText: 'Add' }).click();
      await expect(createModal.locator('.member-edit-row')).toHaveCount(1);

      await createModal.locator('button.btn-primary', { hasText: 'Create tier' }).click();
      await expect(createModal).not.toBeVisible();

      const tierCard = page.locator('.tier-card', { hasText: tierName });
      await expect(tierCard).toBeVisible();
      await expect(tierCard.locator('.member-row')).toHaveCount(1);
      await expect(tierCard.locator('.member-model')).toHaveText('tier-crud-model-a');

      const createdTiers = await getTiersViaApi();
      const created = createdTiers.find((t) => t.name === tierName);
      expect(created).toBeTruthy();
      createdTierIds.push(created.id);

      // ── Rename + add a second member ─────────────────────────────────────
      await tierCard.locator('button.btn-ghost', { hasText: 'Edit' }).click();
      const editModal = page.locator('.modal-overlay .modal');
      await expect(editModal).toBeVisible();

      const renamedName = `${tierName} Renamed`;
      await editModal.locator('#tier-name').fill(renamedName);
      await editModal.locator('.member-select').selectOption(`${provider.id}::tier-crud-model-b`);
      await editModal.locator('button.btn-secondary', { hasText: 'Add' }).click();
      await expect(editModal.locator('.member-edit-row')).toHaveCount(2);

      await editModal.locator('button.btn-primary', { hasText: 'Save changes' }).click();
      await expect(editModal).not.toBeVisible();

      const renamedCard = page.locator('.tier-card', { hasText: renamedName });
      await expect(renamedCard).toBeVisible();
      await expect(renamedCard.locator('.member-row')).toHaveCount(2);

      // ── Delete ────────────────────────────────────────────────────────────
      await renamedCard.locator('button.btn-danger-ghost', { hasText: 'Delete' }).click();
      const confirmModal = page.locator('.modal.modal-sm');
      await expect(confirmModal).toBeVisible();
      await confirmModal.locator('button.btn-danger', { hasText: 'Delete' }).click();

      await expect(page.locator('.tier-card', { hasText: renamedName })).toHaveCount(0);
      // Deleted via the UI — no need for the afterEach API cleanup pass.
      createdTierIds.length = 0;
    });

    test('creates a tier from built-in (non-uuid) providers via the UI', async ({ page }) => {
      // Regression for Issue 1 of the review-remediation plan: built-in
      // providers are seeded with fixed, non-UUID ids ("anthropic-default",
      // "openai-default" — see seedBaselineData.js). Building the PRD's
      // headline tier (Opus -> OpenAI) from these built-ins used to fail
      // with a 400 "Invalid uuid" because CreateTierRequest required a UUID
      // providerId. Use the current seeded OpenAI model because retired
      // built-in OpenAI ids are intentionally hidden from new-selection UI.
      // This exercises the real UI end-to-end with no custom createProvider()
      // fixture involved.
      await navigateAndWait(page, `${BASE_URL}/settings/tiers`);

      await page.locator('.model-tiers-view button.btn-primary', { hasText: 'New Tier' }).click();
      const createModal = page.locator('.modal-overlay .modal');
      await expect(createModal).toBeVisible();

      const tierName = `${TEST_PREFIX}Built-in Tier`;
      await createModal.locator('#tier-name').fill(tierName);

      await createModal.locator('.member-select').selectOption('anthropic-default::claude-opus-5');
      await createModal.locator('button.btn-secondary', { hasText: 'Add' }).click();
      await expect(createModal.locator('.member-edit-row')).toHaveCount(1);

      await createModal.locator('.member-select').selectOption('openai-default::gpt-5.6-sol');
      await createModal.locator('button.btn-secondary', { hasText: 'Add' }).click();
      await expect(createModal.locator('.member-edit-row')).toHaveCount(2);

      await createModal.locator('button.btn-primary', { hasText: 'Create tier' }).click();
      // A 400 from the API would leave the modal open with an error message —
      // asserting it closes proves the built-in provider ids were accepted.
      await expect(createModal).not.toBeVisible();

      const tierCard = page.locator('.tier-card', { hasText: tierName });
      await expect(tierCard).toBeVisible();
      await expect(tierCard.locator('.member-row')).toHaveCount(2);
      await expect(tierCard.locator('.member-provider').first()).toHaveText('Anthropic (Official)');

      const createdTiers = await getTiersViaApi();
      const created = createdTiers.find((t) => t.name === tierName);
      expect(created).toBeTruthy();
      expect(created.members.map((m: any) => m.providerId)).toEqual([
        'anthropic-default',
        'openai-default',
      ]);
      createdTierIds.push(created.id);
    });
  });

  test.describe('Reorder members', () => {
    test('moving a member up persists the new order', async ({ page }) => {
      const provider = await createProvider({ name: `${TEST_PREFIX}Reorder Provider` });
      await addProviderModel(provider.id, { modelId: 'reorder-model-a', displayName: 'Reorder Model A' });
      await addProviderModel(provider.id, { modelId: 'reorder-model-b', displayName: 'Reorder Model B' });

      const tier = await createTierViaApi({
        name: `${TEST_PREFIX}Reorder Tier`,
        members: [
          { providerId: provider.id, modelId: 'reorder-model-a', position: 0 },
          { providerId: provider.id, modelId: 'reorder-model-b', position: 1 },
        ],
      });
      createdTierIds.push(tier.id);

      await navigateAndWait(page, `${BASE_URL}/settings/tiers`);
      const tierCard = page.locator('.tier-card', { hasText: tier.name });
      await expect(tierCard.locator('.member-row').nth(0).locator('.member-model')).toHaveText('reorder-model-a');

      await tierCard.locator('button.btn-ghost', { hasText: 'Edit' }).click();
      const modal = page.locator('.modal-overlay .modal');
      await expect(modal).toBeVisible();
      await expect(modal.locator('.member-edit-row').nth(0).locator('.member-model')).toHaveText('reorder-model-a');

      // Move the second member ("B") up so it becomes first.
      await modal.locator('.member-edit-row').nth(1).locator('button.btn-icon[title="Move up"]').click();
      await expect(modal.locator('.member-edit-row').nth(0).locator('.member-model')).toHaveText('reorder-model-b');

      await modal.locator('button.btn-primary', { hasText: 'Save changes' }).click();
      await expect(modal).not.toBeVisible();

      // Persisted server-side
      const tiersAfterSave = await getTiersViaApi();
      const updated = tiersAfterSave.find((t) => t.id === tier.id);
      expect(updated.members[0].modelId).toBe('reorder-model-b');
      expect(updated.members[1].modelId).toBe('reorder-model-a');

      // Persisted in the UI after a reload
      await page.reload();
      await page.waitForLoadState('networkidle');
      const reloadedCard = page.locator('.tier-card', { hasText: tier.name });
      await expect(reloadedCard.locator('.member-row').nth(0).locator('.member-model')).toHaveText('reorder-model-b');
      await expect(reloadedCard.locator('.member-row').nth(1).locator('.member-model')).toHaveText('reorder-model-a');
    });
  });

  test.describe('ModelSelector tier sentinel', () => {
    test('selecting a tier stores the tier::<id> sentinel and is mutually exclusive with a concrete model', async ({ page }) => {
      const provider = await createProvider({ name: `${TEST_PREFIX}Selector Provider` });
      await addProviderModel(provider.id, { modelId: 'selector-model-a', displayName: 'Selector Model A' });

      const tier = await createTierViaApi({
        name: `${TEST_PREFIX}Selector Tier`,
        members: [{ providerId: provider.id, modelId: 'selector-model-a', position: 0 }],
      });
      createdTierIds.push(tier.id);

      const project = await seedProject('Tier Selector Test', '/tmp/test-tier-selector');
      await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/sessions/new`);

      const modelSelect = page.locator('#model-select');
      await expect(modelSelect).toBeVisible({ timeout: 10000 });

      // Wait for the tier option to be present before selecting it (tiers load async).
      await page.waitForFunction(
        (tierId) => {
          const select = document.querySelector('#model-select') as HTMLSelectElement | null;
          return !!select && Array.from(select.options).some((opt) => opt.value === `tier::${tierId}`);
        },
        tier.id,
        { timeout: 10000 }
      );

      await modelSelect.selectOption(`tier::${tier.id}`);

      // Sentinel value stored on the <select>.
      await expect(modelSelect).toHaveValue(`tier::${tier.id}`);

      // Tier chip rendered; no concrete provider is associated with a tier selection.
      const tierChip = page.locator('.model-selector .tier-chip');
      await expect(tierChip).toBeVisible();
      await expect(tierChip).toContainText(tier.name);
      await expect(page.locator('.model-selector')).toHaveAttribute('data-provider-id', '');

      // Switching to a concrete model clears the tier chip (mutual exclusivity).
      const concreteOptionValue = `${provider.id}::selector-model-a`;
      await modelSelect.selectOption(concreteOptionValue);
      await expect(tierChip).toHaveCount(0);
      await expect(modelSelect).toHaveValue(concreteOptionValue);
      await expect(page.locator('.model-selector')).toHaveAttribute('data-provider-id', provider.id);
    });
  });

  test.describe('Failover notice UI', () => {
    test('shows a toast when a TIER_FAILOVER WebSocket message arrives for the active session', async ({ page }) => {
      const project = await seedProject('Tier Failover Notice Test', '/tmp/test-tier-failover-notice');
      const session = await seedSession(project.id, {
        prompt: 'Tier failover notice test prompt',
        startImmediately: false,
        gitMode: 'current',
        gitBranch: 'main',
      });

      // Intercept the app's WebSocket: pass real traffic through unmodified
      // (both directions forward automatically once connectToServer() is
      // called and no onMessage override is installed), but keep a handle
      // so the test can push a synthetic server->page message later.
      let wsRoute: any;
      await page.routeWebSocket('/ws', (ws) => {
        wsRoute = ws;
        ws.connectToServer();
      });

      await page.goto(`/sessions/${session.id}/summary`);
      await page.waitForLoadState('networkidle');
      await openSessionOverlay(page);

      // Wait for the routed WS connection (and its subscribe:session send) to be established.
      await expect.poll(() => !!wsRoute, { timeout: 10000 }).toBe(true);
      await page.waitForTimeout(300);

      wsRoute!.send(
        JSON.stringify({
          type: 'tier:failover',
          sessionId: session.id,
          tierRef: 'tier::mock-tier-id',
          tierName: 'Mock Tier',
          fromModel: 'mock-model-a',
          fromProviderId: 'mock-provider-a',
          toModel: 'mock-model-b',
          toProviderId: 'mock-provider-b',
          reason: 'Error: 529 Service overloaded',
          timestamp: Date.now(),
        })
      );

      const toast = page.locator('.toast.toast-info');
      await expect(toast).toBeVisible({ timeout: 5000 });
      await expect(toast.locator('.toast-message')).toContainText('mock-model-a');
      await expect(toast.locator('.toast-message')).toContainText('mock-model-b');
      await expect(toast.locator('.toast-message')).toContainText('Mock Tier');
    });
  });
});
