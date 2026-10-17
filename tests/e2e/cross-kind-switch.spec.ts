import { test, expect } from '@playwright/test';
import {
  addProviderModel,
  cleanupCreatedResources,
  cleanupProviders,
  createProvider,
  getSession,
  navigateAndWait,
  openSessionOverlay,
  seedAssistantMessage,
  seedProject,
  seedSession,
  seedUserMessage,
  waitForSessionToExist,
  API_URL,
  BASE_URL,
  TEST_PREFIX,
} from './helpers';

async function seedOpenAIProvider(modelId: string) {
  const provider = await createProvider({
    name: `${TEST_PREFIX}Cross Kind OpenAI`,
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    authToken: '[REDACTED]',
  });
  await addProviderModel(provider.id, {
    modelId,
    displayName: modelId,
    tier: 'custom',
  });
  return provider;
}

async function sendMessage(sessionId: string, content: string, model: string | null = null) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, model }),
  });
  return response;
}

async function patchSessionModel(sessionId: string, model: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });
  return response;
}

// Gemini models come from the built-in google-default provider, which
// cleanupProviders() preserves. Gemini is deliberately excluded from
// in-place cross-kind switching, so it is the blocking-path fixture.
const GEMINI_MODEL = 'gemini-2.5-pro';

test.describe('Cross-kind model switching', () => {
  test.beforeEach(async () => {
    await cleanupProviders();
    await cleanupCreatedResources();
  });

  test.afterEach(async () => {
    await cleanupProviders();
    await cleanupCreatedResources();
  });

  test('API allows in-scope cross-kind continuation, re-derives agentType, and still blocks gemini', async () => {
    const openaiProvider = await seedOpenAIProvider('gpt-4o-cross-kind-api');
    const project = await seedProject('Cross Kind API Project', process.cwd());

    // NOTE: every accepted send starts a real turn (which fails fast under
    // VCR replay with no cassette), so each send below uses a dedicated
    // session — a second send to the same session would race its prior turn
    // instead of exercising the guard.
    async function claudeSession(prompt: string) {
      return seedSession(project.id, {
        prompt,
        model: 'claude-sonnet-5',
        startImmediately: false,
      });
    }

    // Same-kind continuation still succeeds.
    let response = await sendMessage(
      (await claudeSession('Same-kind root')).id,
      'Cross-kind E2E same-kind Claude continuation.',
      'claude-haiku-4-5-20251001'
    );
    expect(response.status).toBe(200);

    // In-scope claude-code -> codex continuation now succeeds in place
    // instead of being rejected with CROSS_KIND_MODEL_SWITCH.
    response = await sendMessage(
      (await claudeSession('Claude to Codex root')).id,
      'Cross-kind E2E claude to codex.',
      'gpt-4o-cross-kind-api'
    );
    expect(response.status).toBe(200);

    // Reverse direction (codex -> claude-code) succeeds too.
    const codexSession = await seedSession(project.id, {
      prompt: 'Codex to Claude root',
      model: 'gpt-4o-cross-kind-api',
      startImmediately: false,
    });
    response = await sendMessage(codexSession.id, 'Cross-kind E2E codex to claude.', 'claude-haiku-4-5-20251001');
    expect(response.status).toBe(200);

    // PATCH on a started session persists an allowed switch and re-derives
    // agentType + provider (FR2). Seed transcript first so the
    // started-session path — not the draft path — is exercised.
    const patchSession = await claudeSession('PATCH switch root');
    await seedUserMessage(patchSession.id, 'PATCH switch root');
    await seedAssistantMessage(patchSession.id, 'PATCH switch prior response');
    const patchResponse = await patchSessionModel(patchSession.id, 'gpt-4o-cross-kind-api');
    expect(patchResponse.status).toBe(200);
    const switched = await getSession(patchSession.id);
    expect(switched.model).toBe('gpt-4o-cross-kind-api');
    expect(switched.agentType).toBe('codex');
    expect(switched.providerId).toBe(openaiProvider.id);

    // Gemini stays rejected: into gemini from a codex session ... (a fresh
    // session keeps agentType deterministically 'codex' for the assertions).
    const geminiOutSession = await seedSession(project.id, {
      prompt: 'Blocked gemini root',
      model: 'gpt-4o-cross-kind-api',
      startImmediately: false,
    });
    await seedUserMessage(geminiOutSession.id, 'Blocked gemini root');
    await seedAssistantMessage(geminiOutSession.id, 'Blocked gemini prior response');
    response = await sendMessage(geminiOutSession.id, 'blocked gemini', GEMINI_MODEL);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'CROSS_KIND_MODEL_SWITCH',
      message: expect.stringContaining('Gemini'),
    });
    expect((await getSession(geminiOutSession.id)).agentType).toBe('codex');

    // ... via PATCH on a started session (no mutation) ...
    const geminiPatch = await patchSessionModel(geminiOutSession.id, GEMINI_MODEL);
    expect(geminiPatch.status).toBe(400);
    const unmoved = await getSession(geminiOutSession.id);
    expect(unmoved.agentType).toBe('codex');

    // ... and out of gemini to a claude-code model.
    const geminiSession = await seedSession(project.id, {
      prompt: 'Gemini root',
      model: GEMINI_MODEL,
      startImmediately: false,
    });
    expect((await getSession(geminiSession.id)).agentType).toBe('gemini');
    response = await sendMessage(geminiSession.id, 'blocked from gemini', 'claude-haiku-4-5-20251001');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'CROSS_KIND_MODEL_SWITCH',
      message: expect.stringContaining('Gemini'),
    });
    expect((await getSession(geminiSession.id)).agentType).toBe('gemini');
  });

  test('UI confirms in-scope switches and surfaces the gemini rejection', async ({ page }) => {
    await seedOpenAIProvider('gpt-4o-cross-kind-ui');
    const project = await seedProject('Cross Kind UI Project', process.cwd());
    const session = await seedSession(project.id, {
      prompt: 'Claude UI root',
      model: 'claude-sonnet-5',
      startImmediately: false,
    });

    // Seed user + assistant messages so the session is non-draft (has
    // responses). This ensures the UI routes through the started-session
    // switch flow with confirmation, rather than the draft-start path.
    await waitForSessionToExist(session.id);
    await seedUserMessage(session.id, 'Claude UI root');
    await seedAssistantMessage(session.id, 'Claude UI response');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}`, {
      waitFor: '[data-testid="session-detail"][data-ready="true"]',
      loadState: 'domcontentloaded',
    });
    const overlay = await openSessionOverlay(page);

    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });

    // In-scope claude-code -> codex switch asks for confirmation, then
    // persists: the session follows the new kind.
    await overlay.locator('#model-select').selectOption('gpt-4o-cross-kind-ui');
    await expect
      .poll(async () => (await getSession(session.id)).agentType, { timeout: 10000 })
      .toBe('codex');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toContain('Switch from Claude Code to Codex');
    expect((await getSession(session.id)).model).toBe('gpt-4o-cross-kind-ui');

    // Gemini switches skip confirmation because the backend still rejects
    // them: the picker surfaces the human-readable error and rolls back.
    await overlay.locator('#model-select').selectOption('Gemini 2.5 Pro');
    await expect(page.locator('.toast-message')).toContainText('Cannot switch agent kind mid-session');
    expect(dialogs).toHaveLength(1);
    const reverted = await getSession(session.id);
    expect(reverted.agentType).toBe('codex');
    expect(reverted.model).toBe('gpt-4o-cross-kind-ui');
  });
});
