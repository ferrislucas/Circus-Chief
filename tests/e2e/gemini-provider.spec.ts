import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import {
  cleanupCreatedResources,
  getProjectSessions,
  getProvider,
  getSessionMessages,
  navigateAndWait,
  seedProject,
  waitForStatus,
  API_URL,
  BASE_URL,
  TEST_PREFIX,
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

    await page.locator('#prompt textarea').first().fill(GEMINI_PROMPT);
    await page.locator('.btn-submit').click();

    // Wait for navigation to session detail
    await expect(page).toHaveURL(/\/sessions\//, { timeout: 15000 });

    // Verify session was created with correct agent type
    const sessions = await getProjectSessions(project.id);
    const session = sessions.find((s: any) => s.prompt === GEMINI_PROMPT);
    expect(session).toBeTruthy();
    expect(session.agentType).toBe('gemini');

    // Wait for session to complete (spawn capture provides mock response)
    await waitForStatus(session.id, 'waiting', 60000);

    // Verify messages were persisted
    const messages = await getSessionMessages(session.id);
    expect(
      messages.some((m: any) => m.role === 'assistant' && m.content.includes('E2E spawn capture response.'))
    ).toBe(true);
  });

  test('Gemini spawn includes GEMINI_CLI_TRUST_WORKSPACE env var', async () => {
    // This test only runs when E2E_AGENT_SPAWN_CAPTURE_FILE is set
    const captureFile = process.env.E2E_AGENT_SPAWN_CAPTURE_FILE;

    // Check if spawn capture is enabled by querying server info
    const infoRes = await fetch(`${API_URL}/api/server-info`);
    const info = await infoRes.json();
    const captureEnabled = Boolean(info.e2eSpawnCaptureEnabled && captureFile);

    test.skip(
      !captureEnabled,
      'Set E2E_AGENT_SPAWN_CAPTURE_FILE before starting the e2e server to enable spawn-capture launch assertions.'
    );

    const project = await seedProject('Gemini Trust Env Project', process.cwd());

    // Create and start a session with the built-in Gemini model
    const sessionResponse = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: GEMINI_PROMPT,
        model: 'gemini-2.5-flash',
        providerId: 'google-default',
        startImmediately: true,
        gitMode: 'none',
        gitBranch: 'main',
      }),
    });
    expect(sessionResponse.ok).toBe(true);
    const session = await sessionResponse.json();
    expect(session.agentType).toBe('gemini');

    // Wait for session to complete
    await waitForStatus(session.id, 'waiting', 60000);

    // Read the spawn capture file and verify GEMINI_CLI_TRUST_WORKSPACE is set
    expect(existsSync(captureFile!)).toBe(true);
    const captureContent = readFileSync(captureFile!, 'utf8');
    const lines = captureContent.trim().split('\n');

    // Find the Gemini spawn record
    const geminiRecord = lines
      .map((line: string) => JSON.parse(line))
      .find((record: any) => record.agentType === 'gemini');

    expect(geminiRecord).toBeTruthy();
    expect(geminiRecord.env.GEMINI_CLI_TRUST_WORKSPACE).toBe('true');
    expect(geminiRecord.options.outputFormat).toBe('stream-json');
  });
});
