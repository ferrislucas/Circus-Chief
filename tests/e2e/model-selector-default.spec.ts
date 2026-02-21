import { test, expect } from '@playwright/test';

/**
 * E2E tests for model selector default behavior
 *
 * Bug: When opening a new conversation or switching conversations,
 * the model selector shows no model selected (blank/empty).
 *
 * Expected: Model selector should always show a selected model,
 * falling back to: session.model → project default → 'sonnet'
 */

test.describe('Model Selector Default Value', () => {
  let projectId: string;
  let baseUrl: string;

  test.beforeAll(async ({ request, baseURL }) => {
    baseUrl = baseURL || 'http://localhost:5000';

    // Create a test project
    const projectRes = await request.post(`${baseUrl}/api/projects`, {
      data: {
        name: 'Model Selector Test Project',
        workingDirectory: '/tmp/model-selector-test',
      },
    });
    expect(projectRes.ok()).toBeTruthy();
    const project = await projectRes.json();
    projectId = project.id;
    console.log('Created test project:', projectId);
  });

  test.afterAll(async ({ request }) => {
    // Clean up test project
    if (projectId) {
      await request.delete(`${baseUrl}/api/projects/${projectId}`);
      console.log('Deleted test project:', projectId);
    }
  });

  test('new session page should have model selector with a value', async ({ page }) => {
    // Navigate directly to new session page for our test project
    await page.goto(`/projects/${projectId}/sessions/new`);
    await page.waitForLoadState('networkidle');

    // Wait for the page to fully load
    await page.waitForTimeout(1000);

    // Take a screenshot for debugging
    await page.screenshot({ path: 'test-results/new-session-page.png', fullPage: true });

    // Find the model selector - it should be a select element with id="model-select"
    const modelSelect = page.locator('#model-select');
    const exists = await modelSelect.count() > 0;
    console.log('Model selector exists:', exists);

    if (exists) {
      // Get the current value
      const value = await modelSelect.inputValue();
      console.log('Model selector value:', JSON.stringify(value));

      // The value should NOT be empty
      expect(value, 'Model selector should have a value selected, not be empty').toBeTruthy();
      expect(value.length).toBeGreaterThan(0);
    } else {
      // Log all selects for debugging
      const selects = page.locator('select');
      const count = await selects.count();
      console.log(`Found ${count} select elements on page`);

      for (let i = 0; i < count; i++) {
        const select = selects.nth(i);
        const id = await select.getAttribute('id');
        const value = await select.inputValue().catch(() => 'N/A');
        console.log(`Select ${i}: id="${id}", value="${value}"`);
      }

      expect(exists, 'Model selector #model-select should exist').toBe(true);
    }
  });

  test('draft session conversation tab should have model selected', async ({ page, request }) => {
    // Create a draft session via API
    const sessionRes = await request.post(`${baseUrl}/api/projects/${projectId}/sessions`, {
      data: {
        prompt: 'Test prompt for model selector',
        name: 'Model Selector Test Session',
      },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    const sessionId = session.id;
    console.log('Created test session:', sessionId);

    // Navigate to the session's conversation tab
    await page.goto(`/sessions/${sessionId}/conversation`);
    await page.waitForLoadState('networkidle');

    // Wait for the page to fully load
    await page.waitForTimeout(1500);

    // Take a screenshot
    await page.screenshot({ path: 'test-results/session-conversation-tab.png', fullPage: true });

    // Find the model selector
    const modelSelect = page.locator('#model-select');
    const exists = await modelSelect.count() > 0;
    console.log('Model selector exists:', exists);

    if (exists) {
      const value = await modelSelect.inputValue();
      console.log('Model selector value:', JSON.stringify(value));

      // THE BUG: This assertion will fail if the model selector shows empty
      expect(value, 'Model selector should have a value, not be empty!').toBeTruthy();
      expect(value.length, 'Model selector value should not be empty string').toBeGreaterThan(0);
    } else {
      // Check if we're on a running session (model selector hidden when running)
      const runningState = page.locator('.running-state');
      if (await runningState.count() > 0) {
        console.log('Session is running - model selector hidden');
        test.skip();
        return;
      }

      // Check what's actually on the page
      const inputForm = page.locator('.input-form');
      console.log('Input form exists:', await inputForm.count() > 0);

      // Log all selects
      const selects = page.locator('select');
      const count = await selects.count();
      console.log(`Found ${count} select elements`);

      expect(exists, 'Model selector should exist on conversation tab').toBe(true);
    }

    // Clean up session
    await request.delete(`${baseUrl}/api/sessions/${sessionId}`);
  });

  test('inspect what value the model selector actually has', async ({ page, request }) => {
    // Create a draft session via API
    const sessionRes = await request.post(`${baseUrl}/api/projects/${projectId}/sessions`, {
      data: {
        prompt: 'Debug test prompt',
        name: 'Debug Session',
      },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    const sessionId = session.id;

    // Navigate to the session's conversation tab
    await page.goto(`/sessions/${sessionId}/conversation`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Take screenshot
    await page.screenshot({ path: 'test-results/debug-model-selector.png', fullPage: true });

    // Find model selector
    const modelSelect = page.locator('#model-select');
    if (await modelSelect.count() > 0) {
      const value = await modelSelect.inputValue();
      const selectedOption = await modelSelect.locator('option:checked').textContent();

      console.log('========================================');
      console.log('MODEL SELECTOR DEBUG INFO:');
      console.log('  Raw value:', JSON.stringify(value));
      console.log('  Value length:', value?.length || 0);
      console.log('  Value is truthy:', !!value);
      console.log('  Selected option text:', selectedOption);
      console.log('========================================');

      // List all options
      const options = await modelSelect.locator('option').all();
      console.log('All options:');
      for (const opt of options) {
        const optValue = await opt.getAttribute('value');
        const optText = await opt.textContent();
        console.log(`  - value="${optValue}", text="${optText}"`);
      }

      // This is the critical assertion
      if (!value || value.length === 0) {
        console.log('BUG CONFIRMED: Model selector has no value!');
      }

      expect(value, 'Model selector must have a value').toBeTruthy();
    }

    // Clean up
    await request.delete(`${baseUrl}/api/sessions/${sessionId}`);
  });
});
