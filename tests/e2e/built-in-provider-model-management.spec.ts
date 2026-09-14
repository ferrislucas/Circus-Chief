import { test, expect, Page } from '@playwright/test';
import {
  navigateAndWait,
  getProvider,
  removeProviderModel,
  BASE_URL,
} from './helpers';

/**
 * E2E tests for the "Built-in Provider Settings" modal (PR #1063 remediation,
 * Slice E1 -- FRD-built-in-model-choices.md §0 authoritative acceptance bar:
 * "End-to-end tests cover all three built-in providers, all picker contexts,
 * fresh-install defaults, upgrade behavior, restart persistence, and
 * historical-session continuity").
 *
 * This covers the blocking gap called out in the PR #1063 review: no E2E for
 * reorder / enable-disable / add-remove in the Built-in Provider Settings
 * modal, for any of the three built-in providers.
 *
 * Rather than mutating shared catalog rows (e.g. claude-opus-5, gpt-5.6-sol)
 * that other specs assert on -- risky under parallel test execution -- each
 * run adds two throwaway, uniquely-named model rows via the UI, exercises
 * reorder / enable-disable / remove on those rows only, and removes them
 * afterward. This also happens to exercise the Slice D stable-row-key fix
 * (reordering two just-added, still-unsaved rows) end-to-end through a real
 * save + modal-reopen cycle.
 */

const BUILT_IN_PROVIDERS = [
  { id: 'anthropic-default', name: 'Anthropic (Official)' },
  { id: 'openai-default', name: 'OpenAI (Official)' },
  { id: 'google-default', name: 'Google (Official)' },
];

async function openBuiltInProviderSettings(page: Page, providerName: string) {
  await navigateAndWait(page, `${BASE_URL}/settings/providers`, {
    waitFor: '.provider-list',
    timeout: 15000,
  });
  const card = page.locator('.provider-card', { hasText: providerName });
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.locator('button:has-text("Settings")').click();

  const modal = page.locator('.modal');
  await expect(modal).toBeVisible({ timeout: 5000 });
  await expect(modal.locator('h2')).toHaveText('Built-in Provider Settings');
  return modal;
}

async function saveAndWaitForClose(page: Page) {
  const modal = page.locator('.modal');
  await modal.locator('.btn-primary:has-text("Save")').click();
  await expect(modal).toBeHidden({ timeout: 10000 });
}

/** Row index (0-based, excluding the header row) whose display-name input currently shows `displayName`. */
async function findRowIndexByDisplayName(page: Page, displayName: string): Promise<number> {
  const inputs = page.locator('.col-display-name.model-input');
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    if ((await inputs.nth(i).inputValue()) === displayName) return i;
  }
  return -1;
}

function rowAt(page: Page, index: number) {
  return page.locator('.model-row:not(.model-row-header)').nth(index);
}

async function addModelRow(page: Page, modelId: string, displayName: string) {
  await page.locator('.add-model-btn').click();
  const inputs = page.locator('.col-model-id.model-input');
  const lastIndex = (await inputs.count()) - 1;
  await inputs.nth(lastIndex).fill(modelId);
  await page.locator('.col-display-name.model-input').nth(lastIndex).fill(displayName);
}

test.describe('Built-in Provider Settings modal (Slice E1)', () => {
  // Every case in this matrix mutates the *shared* built-in provider rows
  // (there is no per-test-run TEST_PREFIX scoping for built-in providers).
  // Serialize within this file so the three provider flows -- and their
  // save/reopen cycles -- never interleave with each other.
  test.describe.configure({ mode: 'serial' });

  test('adds model rows when crypto.randomUUID is unavailable', async ({ page }) => {
    // localhost is normally a trustworthy context, so explicitly reproduce the
    // browser API surface seen when Circus Chief is opened from an insecure LAN
    // origin. Install this before navigation so application code never observes
    // randomUUID during this test.
    await page.addInitScript(() => {
      Object.defineProperty(Crypto.prototype, 'randomUUID', {
        configurable: true,
        value: undefined,
      });
    });

    const modal = await openBuiltInProviderSettings(page, BUILT_IN_PROVIDERS[0].name);
    const modelRows = modal.locator('.model-row:not(.model-row-header)');
    const initialRowCount = await modelRows.count();

    await modal.locator('.add-model-btn').click();
    await modal.locator('.add-model-btn').click();

    await expect(modelRows).toHaveCount(initialRowCount + 2);
    await expect(modelRows.nth(initialRowCount).locator('.col-model-id.model-input')).toBeEditable();
    await expect(modelRows.nth(initialRowCount + 1).locator('.col-model-id.model-input')).toBeEditable();
    await expect(modal.locator('.error-message')).toHaveCount(0);
  });

  for (const providerMeta of BUILT_IN_PROVIDERS) {
    test(`${providerMeta.name}: add, reorder, enable/disable, and remove model rows persist across modal reopen`, async ({ page }) => {
      const runTag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const modelIdA = `zz-e2e-test-a-${runTag}`;
      const modelIdB = `zz-e2e-test-b-${runTag}`;
      const displayNameA = `E2E Test A ${runTag}`;
      const displayNameB = `E2E Test B ${runTag}`;

      try {
        // ── Add two new rows, reorder them (while still unsaved), and save ──
        await openBuiltInProviderSettings(page, providerMeta.name);
        await addModelRow(page, modelIdA, displayNameA);
        await addModelRow(page, modelIdB, displayNameB);

        // B was added after A, so B is currently the last row. Move it up
        // once so B precedes A -- this reorders two rows that have never
        // been saved (no _serverId yet), which is exactly the scenario
        // Slice D's stable `_localKey` fix targets.
        const bIndexBeforeMove = await findRowIndexByDisplayName(page, displayNameB);
        expect(bIndexBeforeMove).toBeGreaterThan(0);
        await rowAt(page, bIndexBeforeMove).locator('.move-model-btn[title="Move model up"]').click();

        // Verify no value bleed immediately after the client-side reorder
        // (before saving): B's row must show B's own data, A's row A's own.
        const bIndexAfterMove = await findRowIndexByDisplayName(page, displayNameB);
        const aIndexAfterMove = await findRowIndexByDisplayName(page, displayNameA);
        expect(bIndexAfterMove).toBe(bIndexBeforeMove - 1);
        expect(aIndexAfterMove).toBe(bIndexBeforeMove);
        await expect(rowAt(page, bIndexAfterMove).locator('.col-model-id.model-input')).toHaveValue(modelIdB);
        await expect(rowAt(page, aIndexAfterMove).locator('.col-model-id.model-input')).toHaveValue(modelIdA);

        await saveAndWaitForClose(page);

        // ── Reopen: reorder must have persisted (B before A) ──
        await openBuiltInProviderSettings(page, providerMeta.name);
        const bIndexReopened = await findRowIndexByDisplayName(page, displayNameB);
        const aIndexReopened = await findRowIndexByDisplayName(page, displayNameA);
        expect(bIndexReopened, 'row B should exist after reopening the modal').toBeGreaterThanOrEqual(0);
        expect(aIndexReopened, 'row A should exist after reopening the modal').toBeGreaterThanOrEqual(0);
        expect(bIndexReopened).toBeLessThan(aIndexReopened);

        // Cross-check via a fresh API round-trip (not just the in-memory store).
        const providerAfterAdd = await getProvider(providerMeta.id);
        const rowAAfterAdd = providerAfterAdd.models.find((m: any) => m.modelId === modelIdA);
        const rowBAfterAdd = providerAfterAdd.models.find((m: any) => m.modelId === modelIdB);
        expect(rowAAfterAdd, 'row A should be present via the API after save').toBeTruthy();
        expect(rowBAfterAdd, 'row B should be present via the API after save').toBeTruthy();
        expect(rowBAfterAdd.sortOrder).toBeLessThan(rowAAfterAdd.sortOrder);
        expect(rowAAfterAdd.enabled).toBe(true);

        // ── Disable row A, save, reopen: must show unchecked + persist ──
        const aIndexForDisable = await findRowIndexByDisplayName(page, displayNameA);
        await rowAt(page, aIndexForDisable).locator('.model-enabled input[type="checkbox"]').uncheck();
        await saveAndWaitForClose(page);

        await openBuiltInProviderSettings(page, providerMeta.name);
        const aIndexAfterDisable = await findRowIndexByDisplayName(page, displayNameA);
        await expect(rowAt(page, aIndexAfterDisable)).toHaveClass(/is-disabled/);
        await expect(rowAt(page, aIndexAfterDisable).locator('.model-enabled input[type="checkbox"]')).not.toBeChecked();

        const providerAfterDisable = await getProvider(providerMeta.id);
        expect(providerAfterDisable.models.find((m: any) => m.modelId === modelIdA).enabled).toBe(false);

        // ── Re-enable row A, save, reopen: must show checked + persist ──
        await rowAt(page, aIndexAfterDisable).locator('.model-enabled input[type="checkbox"]').check();
        await saveAndWaitForClose(page);

        await openBuiltInProviderSettings(page, providerMeta.name);
        const aIndexAfterReenable = await findRowIndexByDisplayName(page, displayNameA);
        await expect(rowAt(page, aIndexAfterReenable).locator('.model-enabled input[type="checkbox"]')).toBeChecked();

        const providerAfterReenable = await getProvider(providerMeta.id);
        expect(providerAfterReenable.models.find((m: any) => m.modelId === modelIdA).enabled).toBe(true);

        // ── Remove (soft-remove) row B, save, reopen: must disappear from the active list ──
        const bIndexForRemove = await findRowIndexByDisplayName(page, displayNameB);
        await rowAt(page, bIndexForRemove).locator('.remove-model-btn').click();
        await saveAndWaitForClose(page);

        await openBuiltInProviderSettings(page, providerMeta.name);
        expect(await findRowIndexByDisplayName(page, displayNameB)).toBe(-1);
        // Row A (never removed) must remain unaffected by removing row B.
        expect(await findRowIndexByDisplayName(page, displayNameA)).toBeGreaterThanOrEqual(0);

        const providerAfterRemove = await getProvider(providerMeta.id);
        expect(providerAfterRemove.models.some((m: any) => m.modelId === modelIdB)).toBe(false);
        expect(providerAfterRemove.models.some((m: any) => m.modelId === modelIdA)).toBe(true);
      } finally {
        // Clean up the throwaway rows so they don't linger in the shared
        // built-in provider catalog for later test runs.
        const finalState = await getProvider(providerMeta.id);
        const leftoverA = finalState?.models?.find((m: any) => m.modelId === modelIdA);
        const leftoverB = finalState?.models?.find((m: any) => m.modelId === modelIdB);
        if (leftoverA) await removeProviderModel(providerMeta.id, leftoverA.id);
        if (leftoverB) await removeProviderModel(providerMeta.id, leftoverB.id);
      }
    });
  }
});
