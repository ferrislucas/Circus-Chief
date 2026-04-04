import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  getSession,
  openSessionOverlay,
  API_URL,
} from './helpers';

/**
 * E2E tests for: Draft session model dropdown → PATCH sync
 *
 * Bug: When a user creates a draft session (via SessionTreeOverlay or API),
 * then changes the model dropdown before sending the first message, the session
 * starts with the wrong model. This happens because:
 *   1. handleFormSubmit() reads session.pendingModel instead of the UI dropdown value
 *   2. updateSessionModel() doesn't sync pendingModel for draft sessions
 *
 * These tests verify the UI-level fix: changing the model dropdown on a draft
 * session correctly updates both model and pendingModel on the server.
 */
test.describe('Draft session model dropdown sync', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Draft Model UI Test', '/tmp/test-draft-model-ui');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('changing model dropdown on draft session syncs both model and pendingModel', async ({ page }) => {
    // Use built-in model IDs that match the provider's actual models
    const initialModel = 'claude-sonnet-4-6';
    const targetModel = 'claude-opus-4-6';

    // Create a draft session with a known model
    const session = await seedSession(project.id, {
      prompt: 'Test prompt for model dropdown sync',
      model: initialModel,
      startImmediately: false,
      gitMode: 'none',
      gitBranch: 'main',
    });

    // Verify initial state
    const initialSession = await getSession(session.id);
    expect(initialSession.model).toBe(initialModel);
    expect(initialSession.pendingModel).toBe(initialModel);
    expect(initialSession.status).toBe('waiting');

    // Navigate to the session's conversation tab
    await page.goto(`/sessions/${session.id}/summary`);
    await page.waitForLoadState('networkidle');
    await openSessionOverlay(page);

    // Wait for the model selector to appear and be populated
    const modelSelect = page.locator('#model-select');
    await expect(modelSelect).toBeVisible({ timeout: 10000 });

    // Wait for the dropdown to have the initial model selected
    await page.waitForFunction(
      (expectedModel) => {
        const select = document.querySelector('#model-select') as HTMLSelectElement;
        return select && select.value === expectedModel;
      },
      initialModel,
      { timeout: 10000 }
    );

    // Verify the dropdown shows the creation model
    const initialValue = await modelSelect.inputValue();
    expect(initialValue).toBe(initialModel);

    // Check that the target model is available as an option
    const hasTarget = await page.evaluate((targetId) => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      return Array.from(select.options).some(opt => opt.value === targetId);
    }, targetModel);

    if (!hasTarget) {
      test.skip();
      return;
    }

    // Set up a promise to wait for the PATCH response
    const patchPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/sessions/') && resp.request().method() === 'PATCH',
      { timeout: 10000 }
    );

    // Change the model dropdown to opus
    await modelSelect.selectOption(targetModel);

    // Wait for the PATCH to complete
    await patchPromise;

    // Give a brief moment for the server to process
    await page.waitForTimeout(500);

    // Fetch the session via API and verify both fields were updated
    const updatedSession = await getSession(session.id);
    expect(updatedSession.model).toBe(targetModel);
    expect(updatedSession.pendingModel).toBe(targetModel);
  });

  test('model dropdown value persists after page reload on draft session', async ({ page }) => {
    const initialModel = 'claude-sonnet-4-6';
    const targetModel = 'claude-opus-4-6';

    // Create a draft session with a known model
    const session = await seedSession(project.id, {
      prompt: 'Test model persistence after reload',
      model: initialModel,
      startImmediately: false,
      gitMode: 'none',
      gitBranch: 'main',
    });

    // Navigate to the session
    await page.goto(`/sessions/${session.id}/summary`);
    await page.waitForLoadState('networkidle');
    await openSessionOverlay(page);

    const modelSelect = page.locator('#model-select');
    await expect(modelSelect).toBeVisible({ timeout: 10000 });

    // Wait for model to be initialized
    await page.waitForFunction(
      (expectedModel) => {
        const select = document.querySelector('#model-select') as HTMLSelectElement;
        return select && select.value === expectedModel;
      },
      initialModel,
      { timeout: 10000 }
    );

    // Check that the target model is available
    const hasTarget = await page.evaluate((targetId) => {
      const select = document.querySelector('#model-select') as HTMLSelectElement;
      return Array.from(select.options).some(opt => opt.value === targetId);
    }, targetModel);

    if (!hasTarget) {
      test.skip();
      return;
    }

    // Change model to opus and wait for PATCH
    const patchPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/sessions/') && resp.request().method() === 'PATCH',
      { timeout: 10000 }
    );
    await modelSelect.selectOption(targetModel);
    await patchPromise;
    await page.waitForTimeout(500);

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');
    await openSessionOverlay(page);

    // Wait for model selector to appear again
    const modelSelectAfterReload = page.locator('#model-select');
    await expect(modelSelectAfterReload).toBeVisible({ timeout: 10000 });

    // Wait for the dropdown to have the updated model
    await page.waitForFunction(
      (expectedModel) => {
        const select = document.querySelector('#model-select') as HTMLSelectElement;
        return select && select.value === expectedModel;
      },
      targetModel,
      { timeout: 10000 }
    );

    // Verify the model persisted after reload
    const valueAfterReload = await modelSelectAfterReload.inputValue();
    expect(valueAfterReload).toBe(targetModel);
  });
});
