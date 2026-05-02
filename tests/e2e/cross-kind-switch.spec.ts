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
    authToken: 'sk-placeholder',
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

test.describe('Cross-kind model switching', () => {
  test.beforeEach(async () => {
    await cleanupProviders();
    await cleanupCreatedResources();
  });

  test.afterEach(async () => {
    await cleanupProviders();
    await cleanupCreatedResources();
  });

  test('API blocks cross-kind continuation but permits same-kind model changes', async () => {
    await seedOpenAIProvider('gpt-4o-cross-kind-api');
    const project = await seedProject('Cross Kind API Project', process.cwd());

    const claudeSession = await seedSession(project.id, {
      prompt: 'Claude root',
      model: 'claude-sonnet-4-5-20250929',
      startImmediately: false,
    });
    const codexSession = await seedSession(project.id, {
      prompt: 'Codex root',
      model: 'gpt-4o-cross-kind-api',
      startImmediately: false,
    });

    let response = await sendMessage(claudeSession.id, 'blocked', 'gpt-4o-cross-kind-api');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'CROSS_KIND_MODEL_SWITCH',
      message: expect.stringContaining('Claude Code'),
    });
    expect((await getSession(claudeSession.id)).agentType).toBe('claude-code');

    response = await sendMessage(claudeSession.id, 'Cross-kind E2E same-kind Claude continuation.', 'claude-haiku-4-5-20251001');
    expect(response.status).toBe(200);

    response = await sendMessage(codexSession.id, 'blocked reverse', 'claude-haiku-4-5-20251001');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'CROSS_KIND_MODEL_SWITCH',
      message: expect.stringContaining('Codex'),
    });
    expect((await getSession(codexSession.id)).agentType).toBe('codex');

    response = await sendMessage(codexSession.id, 'Cross-kind E2E same-kind Codex continuation.', 'gpt-4o-cross-kind-api');
    expect(response.status).toBe(200);
  });

  test('UI shows the human-readable cross-kind error', async ({ page }) => {
    await seedOpenAIProvider('gpt-4o-cross-kind-ui');
    const project = await seedProject('Cross Kind UI Project', process.cwd());
    const session = await seedSession(project.id, {
      prompt: 'Claude UI root',
      model: 'claude-sonnet-4-5-20250929',
      startImmediately: false,
    });

    // Seed user + assistant messages so the session is non-draft (has
    // responses). This ensures the UI routes through handleSend →
    // POST /:id/message where the cross-kind guard lives, rather than
    // the draft-start path which has no cross-kind check.
    await waitForSessionToExist(session.id);
    await seedUserMessage(session.id, 'Claude UI root');
    await seedAssistantMessage(session.id, 'Claude UI response');

    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}`, {
      waitFor: '[data-testid="session-detail"][data-ready="true"]',
      loadState: 'domcontentloaded',
    });
    const overlay = await openSessionOverlay(page);
    await overlay.locator('#model-select').selectOption('gpt-4o-cross-kind-ui');
    await overlay.locator('textarea').first().fill('This should be rejected.');
    await overlay.locator('.btn-send-full').click();

    await expect(page.locator('.toast-message')).toContainText('Cannot switch agent kind mid-session');
  });
});
