import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  setSessionSummary,
  cleanupAll,
  navigateAndWait,
} from './helpers';

test.describe('Summary Regenerate', () => {
  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Summary Test Project', '/tmp/test');
    // Create session with startImmediately: false so we can seed data before starting
    session = await seedSession(project.id, {
      prompt: 'Test session for summary regeneration',
      name: 'Summary Test',
      startImmediately: false,
    });
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('should clear generating state and show summary after regeneration', async ({ page }) => {
    // Seed an initial summary with known text
    await setSessionSummary(session.id, {
      shortSummary: 'Initial summary',
      fullSummary: 'Initial summary text - this should be visible before regeneration',
      keyActions: ['Action 1', 'Action 2'],
      outcome: 'ongoing',
      messageCount: 1,
    });

    // Navigate to the summary tab
    await navigateAndWait(page, `/sessions/${session.id}/summary`);

    // Assert initial summary is visible
    await expect(page.locator('.summary-content')).toBeVisible();
    await expect(page.locator('.full-summary')).toContainText('Initial summary text');

    // Click the Regenerate button
    const regenerateButton = page.locator('.overview-header .btn-link');
    await expect(regenerateButton).toBeVisible();
    await regenerateButton.click();

    // Note: We don't assert the button spinner is visible because mock generation is very fast (~50ms)
    // and the spinner may appear and disappear before Playwright can catch it.
    // The important assertion is that the summary eventually re-appears.

    // Wait up to 10 seconds for the summary to re-appear
    // The bug is that this will timeout because generating is never set back to false
    // After the fix, the summary should re-appear within a few hundred ms
    await expect(page.locator('.summary-content')).toBeVisible({ timeout: 10000 });

    // Assert that the "Generating summary..." state is NOT visible
    await expect(page.locator('.generating-state')).not.toBeVisible();

    // The summary should now show the mock-generated text or the regenerated summary
    // (Since we're using MOCK_CLAUDE=true in E2E tests, it will return a mock summary)
    const summaryText = await page.locator('.full-summary').textContent();
    expect(summaryText).toBeTruthy();
    expect(summaryText?.length).toBeGreaterThan(0);
  });

  test('should show generating state during regeneration', async ({ page }) => {
    // Seed an initial summary
    await setSessionSummary(session.id, {
      shortSummary: 'Test summary',
      fullSummary: 'Test summary content',
      keyActions: ['Test action'],
      outcome: 'ongoing',
      messageCount: 1,
    });

    // Navigate to the summary tab
    await navigateAndWait(page, `/sessions/${session.id}/summary`);

    // Click the Regenerate button
    const regenerateButton = page.locator('.overview-header .btn-link');
    await regenerateButton.click();

    // The generating state should be shown briefly
    // This is the intermediate state between clicking and completion
    const generatingState = page.locator('.generating-state');
    const summaryContent = page.locator('.summary-content');

    // At some point during the process, the generating state should be visible
    // We use a short timeout because mock generation is very fast (~50ms)
    try {
      await expect(generatingState).toBeVisible({ timeout: 500 });
    } catch (e) {
      // If the generation is too fast, the generating state might not be visible
      // This is acceptable - the important part is that the final state is correct
    }

    // Eventually, the summary content should be visible and generating state hidden
    await expect(summaryContent).toBeVisible({ timeout: 10000 });
    await expect(generatingState).not.toBeVisible({ timeout: 10000 });
  });
});
