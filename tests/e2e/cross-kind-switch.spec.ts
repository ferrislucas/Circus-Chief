import { test, expect } from '@playwright/test';
import { createTierViaApi, deleteTierViaApi } from './tier-test-helpers';
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

async function seedXAIProvider(modelId: string) {
  const provider = await createProvider({
    name: `${TEST_PREFIX}Cross Kind xAI`,
    kind: 'xai',
    baseUrl: null,
    authToken: null,
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
// cleanupProviders() preserves. Gemini is an in-place switch, same as Codex.
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

  test('API allows in-scope cross-kind continuation, including Gemini and a Codex-first tier', async () => {
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

    // Into Gemini from a started Codex session, and back out to Claude.
    const geminiOutSession = await seedSession(project.id, {
      prompt: 'Gemini switch root',
      model: 'gpt-4o-cross-kind-api',
      startImmediately: false,
    });
    await seedUserMessage(geminiOutSession.id, 'Gemini switch root');
    await seedAssistantMessage(geminiOutSession.id, 'Gemini switch prior response');
    const geminiPatch = await patchSessionModel(geminiOutSession.id, GEMINI_MODEL);
    expect(geminiPatch.status).toBe(200);
    const moved = await getSession(geminiOutSession.id);
    expect(moved.model).toBe(GEMINI_MODEL);
    expect(moved.agentType).toBe('gemini');

    const geminiSession = await seedSession(project.id, {
      prompt: 'Gemini root',
      model: GEMINI_MODEL,
      startImmediately: false,
    });
    expect((await getSession(geminiSession.id)).agentType).toBe('gemini');
    await seedUserMessage(geminiSession.id, 'Gemini root');
    await seedAssistantMessage(geminiSession.id, 'Gemini prior response');
    response = await sendMessage(geminiSession.id, 'leave gemini', 'claude-haiku-4-5-20251001');
    expect(response.status).toBe(200);
    await expect.poll(async () => (await getSession(geminiSession.id)).agentType, { timeout: 10000 }).toBe('claude-code');
    expect((await getSession(geminiSession.id)).model).toBe('claude-haiku-4-5-20251001');

    const tier = await createTierViaApi({
      name: `${TEST_PREFIX} Codex-first tier`,
      members: [{ providerId: openaiProvider.id, modelId: 'gpt-4o-cross-kind-api', position: 0 }],
    });
    try {
      const tierSession = await claudeSession('Tier PATCH root');
      await seedUserMessage(tierSession.id, 'Tier PATCH root');
      await seedAssistantMessage(tierSession.id, 'Tier PATCH prior response');
      const tierPatch = await patchSessionModel(tierSession.id, `tier::${tier.id}`);
      expect(tierPatch.status).toBe(200);
      const bound = await getSession(tierSession.id);
      expect(bound.model).toBe(`tier::${tier.id}`);
      expect(bound.agentType).toBe('codex');
      expect(bound.providerId).toBeNull();
    } finally {
      await deleteTierViaApi(tier.id);
    }
  });

  test('API PATCH persists a Claude → Grok switch on a started session, re-deriving agentType and provider', async () => {
    const xaiProvider = await seedXAIProvider('grok-cross-kind-api');
    const project = await seedProject('Cross Kind Grok API Project', process.cwd());

    // Seed a started session (user + assistant transcript) with
    // startImmediately: false, so the started-session guard is the path
    // under test — not the draft path.
    const session = await seedSession(project.id, {
      prompt: 'Grok PATCH root',
      model: 'claude-sonnet-5',
      startImmediately: false,
    });
    await seedUserMessage(session.id, 'Grok PATCH root');
    await seedAssistantMessage(session.id, 'Grok PATCH prior response');

    // PATCH (not send): an accepted send would start a real turn, and its
    // async completion could race the agentType assertion. PATCH persists
    // agentType and providerId synchronously in the response.
    const patchResponse = await patchSessionModel(session.id, 'grok-cross-kind-api');
    expect(patchResponse.status).toBe(200);
    const switched = await patchResponse.json();
    expect(switched.model).toBe('grok-cross-kind-api');
    expect(switched.agentType).toBe('grok-build');
    expect(switched.providerId).toBe(xaiProvider.id);

    // The persisted row agrees.
    const stored = await getSession(session.id);
    expect(stored.model).toBe('grok-cross-kind-api');
    expect(stored.agentType).toBe('grok-build');
    expect(stored.providerId).toBe(xaiProvider.id);
  });

  test('UI confirms in-scope switches, including Gemini', async ({ page }) => {
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

    // Gemini confirms with the same from/to sentence, then the session follows it.
    await overlay.locator('#model-select').selectOption('Gemini 2.5 Pro');
    await expect
      .poll(async () => (await getSession(session.id)).agentType, { timeout: 10000 })
      .toBe('gemini');
    expect(dialogs).toHaveLength(2);
    expect(dialogs[1]).toContain('Switch from Codex to Gemini');
    expect((await getSession(session.id)).model).toBe(GEMINI_MODEL);
  });
});
