import { test, expect } from '@playwright/test';
import {
  cleanupCreatedResources,
  getProjectSessions,
  getSessionMessages,
  navigateAndWait,
  seedProject,
  waitForStatus,
  API_URL,
  BASE_URL,
} from './helpers';

test.describe('Gemini provider flow', () => {
  test.describe.configure({ timeout: 120000 });

  const GEMINI_PROMPT = 'Gemini E2E smoke: reply with exactly "Gemini E2E response."';

  test.beforeEach(async () => {
    await cleanupCreatedResources();
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('Built-in Google provider model can start a Gemini session', async ({ page }) => {
    const project = await seedProject('Gemini Provider Project', process.cwd());

    // Verify the built-in Google provider exists
    const providersResponse = await fetch(`${API_URL}/api/providers`);
    const providers = await providersResponse.json();
    const googleProvider = providers.find((p: any) => p.id === 'google-default');
    expect(googleProvider).toBeTruthy();
    expect(googleProvider.kind).toBe('google');
    expect(googleProvider.isBuiltIn).toBe(true);

    // Navigate to session creation form
    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/sessions/new`, {
      waitFor: '#model-select',
      timeout: 15000,
    });

    // Verify the Gemini model shows up in the select under a "Gemini" optgroup
    const geminiOptionKey = `google-default::gemini-2.5-flash`;
    const hasGeminiOption = await page.locator('#model-select').evaluate(
      (select: HTMLSelectElement, { expectedKey }: { expectedKey: string }) => {
        return Array.from(select.querySelectorAll('optgroup')).some((group) => (
          group.label.includes('Gemini') &&
          Array.from(group.querySelectorAll('option')).some((option) => option.value === expectedKey)
        ));
      },
      { expectedKey: geminiOptionKey }
    );
    expect(hasGeminiOption).toBe(true);

    // Select the Gemini model and submit the form
    await page.locator('#model-select').selectOption(geminiOptionKey);

    await page.locator('textarea#prompt').fill(GEMINI_PROMPT);
    await page.locator('.btn-submit').click();

    // Wait for navigation to session detail
    await expect(page).toHaveURL(/\/sessions\/[a-f0-9-]+(?:\/chat)?$/, { timeout: 15000 });
    const sessionId = page.url().match(/\/sessions\/([^/?#]+)/)?.[1];
    expect(sessionId).toBeTruthy();

    // Verify session was created with correct agent type
    const sessions = await getProjectSessions(project.id);
    const session = sessions.find((s: any) => s.id === sessionId);
    expect(session).toBeTruthy();
    expect(session.agentType).toBe('gemini');

    // Wait for session to complete (VCR replays cassette in normal test runs)
    await waitForStatus(session.id, 'waiting', 60000);

    // Verify agentType persists through the full execution cycle
    const persisted = await getProjectSessions(project.id);
    expect(persisted.find((s: any) => s.id === session.id)?.agentType).toBe('gemini');

    // Verify messages were persisted
    const messages = await getSessionMessages(session.id);
    expect(
      messages.some((m: any) => m.role === 'assistant' && m.content.includes('Gemini E2E response.'))
    ).toBe(true);
  });
});
