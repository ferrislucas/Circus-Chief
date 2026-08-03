import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  openSessionOverlay,
  cleanupCreatedResources,
  API_URL,
  getProviders,
  waitForSessionToExist,
  waitForSessionStatus,
} from './helpers';
import { API_READY } from './timeouts';

/**
 * E2E tests for OpenAI and Gemini built-in catalog lifecycle defaults
 * (PR #1063 remediation, Slice E2/E3 -- FRD-built-in-model-choices.md §0:
 * "Every model classified as older or legacy... is disabled by default" and
 * "Fresh installs seed all researched current and older choices, with every
 * older choice disabled by default").
 *
 * The equivalent Anthropic coverage already exists in opus-5-model.spec.ts.
 * This file closes the review's stated gap: "no OpenAI/Gemini lifecycle
 * defaults" were covered end-to-end.
 */

async function waitForSessionReady(sessionId: string) {
  await waitForSessionToExist(sessionId, API_READY);
  await waitForSessionStatus(sessionId, 'waiting', API_READY);
}

test.describe('OpenAI built-in catalog lifecycle defaults', () => {
  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('OpenAI Lifecycle Defaults Test', '/tmp/openai-lifecycle-test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('providers API: current OpenAI models are enabled by default; older models (including retired gpt-5.5) are disabled by default', async () => {
    const providers = await getProviders();
    const builtIn = providers.find((p: any) => p.id === 'openai-default');
    expect(builtIn, 'Built-in OpenAI provider should exist').toBeTruthy();

    const byModelId = new Map(builtIn.models.map((m: any) => [m.modelId, m]));

    for (const currentId of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
      const model = byModelId.get(currentId);
      expect(model, `${currentId} should exist`).toBeTruthy();
      expect(model.lifecycle).toBe('current');
      expect(model.enabled).toBe(true);
    }

    for (const olderId of ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.5']) {
      const model = byModelId.get(olderId);
      expect(model, `${olderId} should exist (valid/resolvable, just hidden from new selection)`).toBeTruthy();
      expect(model.lifecycle).toBe('older');
      expect(model.enabled).toBe(false);
    }
  });

  test('a fresh draft session model selector only offers current-lifecycle OpenAI models; gpt-5.5 is hidden by default', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test OpenAI lifecycle defaults in model selector',
      startImmediately: false,
      gitMode: 'current',
      gitBranch: 'main',
    });
    await waitForSessionReady(session.id);

    await page.goto(`/sessions/${session.id}/summary`);
    await page.waitForLoadState('domcontentloaded');
    await openSessionOverlay(page);

    const modelSelect = page.locator('#model-select');
    await expect(modelSelect).toBeVisible({ timeout: 10000 });
    await page.waitForFunction(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      return select && select.options.length >= 3;
    }, { timeout: 10000 });

    const optionValues = await page.evaluate(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      return Array.from(select.options).map((opt) => opt.value);
    });

    for (const currentId of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
      expect(optionValues.some((v) => v.endsWith(`::${currentId}`)), `${currentId} should be offered`).toBe(true);
    }
    for (const olderId of ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.5']) {
      expect(optionValues.some((v) => v.endsWith(`::${olderId}`)), `${olderId} should be hidden by default`).toBe(false);
    }
  });

  test('an existing session already using the retired gpt-5.5 keeps showing and selecting it (AC7 historical continuity)', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Existing session pinned to retired gpt-5.5',
      model: 'gpt-5.5',
      startImmediately: false,
      gitMode: 'current',
      gitBranch: 'main',
    });
    await waitForSessionReady(session.id);

    await page.goto(`/sessions/${session.id}/summary`);
    await page.waitForLoadState('domcontentloaded');
    await openSessionOverlay(page);

    const modelSelect = page.locator('#model-select');
    await expect(modelSelect).toBeVisible({ timeout: 10000 });

    await page.waitForFunction(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      return select && select.value.endsWith('::gpt-5.5');
    }, { timeout: 10000 });

    const selectedValue = await modelSelect.inputValue();
    expect(selectedValue.endsWith('::gpt-5.5')).toBe(true);

    // The session must remain fully functional with its disabled model --
    // confirm the API still reports it, no "unknown model" state.
    const fetched = await fetch(`${API_URL}/api/sessions/${session.id}`).then((r) => r.json());
    expect(fetched.model).toBe('gpt-5.5');
  });
});

test.describe('Gemini built-in catalog lifecycle defaults', () => {
  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Gemini Lifecycle Defaults Test', '/tmp/gemini-lifecycle-test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('providers API: every current Gemini model is enabled by default (O1: no older Gemini models in the researched catalog today)', async () => {
    const providers = await getProviders();
    const builtIn = providers.find((p: any) => p.id === 'google-default');
    expect(builtIn, 'Built-in Google provider should exist').toBeTruthy();

    const byModelId = new Map(builtIn.models.map((m: any) => [m.modelId, m]));
    for (const currentId of ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
      const model = byModelId.get(currentId);
      expect(model, `${currentId} should exist`).toBeTruthy();
      expect(model.lifecycle).toBe('current');
      expect(model.enabled).toBe(true);
    }
  });

  test('a fresh draft session model selector offers all three current Gemini models by default', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test Gemini lifecycle defaults in model selector',
      startImmediately: false,
      gitMode: 'current',
      gitBranch: 'main',
    });
    await waitForSessionReady(session.id);

    await page.goto(`/sessions/${session.id}/summary`);
    await page.waitForLoadState('domcontentloaded');
    await openSessionOverlay(page);

    const modelSelect = page.locator('#model-select');
    await expect(modelSelect).toBeVisible({ timeout: 10000 });
    await page.waitForFunction(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      return select && select.options.length >= 3;
    }, { timeout: 10000 });

    const optionValues = await page.evaluate(() => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      return Array.from(select.options).map((opt) => opt.value);
    });

    for (const currentId of ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
      expect(optionValues.some((v) => v.endsWith(`::${currentId}`)), `${currentId} should be offered`).toBe(true);
    }
  });
});
