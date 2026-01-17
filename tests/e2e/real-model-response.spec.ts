import { test, expect } from '@playwright/test';

/**
 * Integration test that verifies real model responses without mocking.
 * This test hits a live server and waits for an actual Claude response.
 */
test.describe('Real Model Response Integration', () => {
  // Extended timeout for real LLM responses (can take 30-60+ seconds)
  test.describe.configure({ timeout: 180000 });

  const BASE_URL = 'http://100.71.110.113:5005';
  const PROJECT_ID = 'f299073d-6db2-453e-9b6a-f4279fd625fb';

  test('creates session and receives model response with random color', async ({ page }) => {
    // Navigate to the sessions list for the project
    await page.goto(`${BASE_URL}/projects/${PROJECT_ID}/sessions`);

    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Click "New Session" to create a new session
    await page.click('text=New Session');

    // Wait for the new session form to appear
    await expect(page).toHaveURL(`${BASE_URL}/projects/${PROJECT_ID}/sessions/new`, {
      timeout: 10000,
    });

    // Fill in the prompt asking for a random color
    const prompt = 'Respond with only a single random color name (e.g., "blue", "crimson", "chartreuse"). Nothing else, just the color name.';
    await page.fill('textarea#prompt', prompt);

    // Ensure "Start Immediately" is checked so we get "Start Session" button
    const startImmediatelyCheckbox = page.locator('input[type="checkbox"]').filter({ has: page.locator('~ .toggle-slider') }).nth(1);
    const isChecked = await startImmediatelyCheckbox.isChecked();
    if (!isChecked) {
      await startImmediatelyCheckbox.check();
    }

    // Submit the form to start the session
    await page.click('button:has-text("Start Session")');

    // Wait for redirect to session detail page (UUID format, not "new")
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, { timeout: 30000 });

    const url = page.url();
    const sessionIdMatch = url.match(/\/sessions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
    const sessionId = sessionIdMatch ? sessionIdMatch[1] : null;
    expect(sessionId).toBeTruthy();

    console.log(`Session created with ID: ${sessionId}`);

    // Poll the API to wait for the session to reach "waiting" status
    // This means the model has FINISHED responding, not just started
    await expect(async () => {
      const response = await fetch(`${BASE_URL}/api/sessions/${sessionId}`);
      const session = await response.json();
      console.log(`Session status: ${session.status}`);
      expect(session.status).toBe('waiting');
    }).toPass({ timeout: 120000, intervals: [1000] });

    console.log('Session reached "waiting" status - model finished responding');

    // Now that the model has finished, verify the conversation is still visible
    // Wait a moment for any UI updates to settle
    await page.waitForTimeout(1000);

    // The user message should still be visible
    const userMessage = page.locator('.message.message-user .message-content');
    await expect(userMessage.first()).toBeVisible({ timeout: 10000 });
    console.log('User message is visible');

    // The assistant message should be visible with the full response
    const assistantMessage = page.locator('.message.message-assistant .message-content');
    await expect(assistantMessage.first()).toBeVisible({ timeout: 10000 });

    // Get the text content of the assistant's response
    const responseText = await assistantMessage.first().textContent();

    // Verify the response is not empty and contains some text
    expect(responseText).toBeTruthy();
    expect(responseText!.trim().length).toBeGreaterThan(0);

    // Log the full response
    console.log(`Model responded with: "${responseText?.trim()}"`);

    // Verify the input form is visible (indicating it's the user's turn)
    const inputForm = page.locator('form.input-form');
    await expect(inputForm).toBeVisible({ timeout: 5000 });
    console.log('Input form is visible - conversation turn returned to user');
  });
});
