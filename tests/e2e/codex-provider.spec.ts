import { test, expect } from '@playwright/test';
import {
  addProviderModel,
  cleanupCreatedResources,
  cleanupProviders,
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

test.describe('Codex provider flow', () => {
  test.describe.configure({ timeout: 120000 });

  const CODEX_PROMPT = 'Codex E2E smoke: reply with exactly "Codex E2E response."';

  test.beforeEach(async () => {
    await cleanupProviders();
    await cleanupCreatedResources();
  });

  test.afterEach(async () => {
    await cleanupProviders();
    await cleanupCreatedResources();
  });

  test('OpenAI-compatible provider model can start a Codex session', async ({ page }) => {
    const project = await seedProject('Codex Provider Project', process.cwd());
    const providerName = `${TEST_PREFIX}OpenAI E2E Provider`;

    await navigateAndWait(page, `${BASE_URL}/settings/providers`, {
      waitFor: '.provider-list',
      timeout: 15000,
    });

    await page.locator('button:has-text("Add Provider")').click();
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();

    await modal.locator('#provider-name').fill(providerName);
    await modal.locator('#provider-kind').selectOption('openai');
    await modal.locator('#base-url').fill('http://127.0.0.1:9/v1');
    await modal.locator('#auth-token').fill('sk-e2e-placeholder');

    await modal.locator('button:has-text("Test Connection")').click();
    await expect(modal.locator('.test-result.failure')).toContainText('Connection error.');

    await modal.locator('.add-model-btn').click();
    // Wait for the model row input to appear (Vue re-render after add)
    const modelIdInput = modal.locator('.model-row .col-model-id.model-input').first();
    await expect(modelIdInput).toBeVisible();
    await modelIdInput.fill('gpt-4o');
    await modal.locator('.model-row .col-display-name.model-input').first().fill('GPT-4o');
    await modal.locator('.model-row .tier-select').first().selectOption('custom');

    await modal.locator('.modal-footer .btn-primary').click();
    await expect(modal).toBeHidden({ timeout: 10000 });

    const providersResponse = await fetch(`${API_URL}/api/providers`);
    const providers = await providersResponse.json();
    const provider = providers.find((p: any) => p.name === providerName);
    expect(provider).toBeTruthy();
    expect(provider.kind).toBe('openai');

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/sessions/new`, {
      waitFor: '#model-select',
      timeout: 15000,
    });

    const hasCodexOption = await page.locator('#model-select').evaluate((select: HTMLSelectElement, expectedName) => {
      return Array.from(select.querySelectorAll('optgroup')).some((group) => (
        group.label === `Codex · ${expectedName}` &&
        Array.from(group.querySelectorAll('option')).some((option) => option.value === 'gpt-4o')
      ));
    }, providerName);
    expect(hasCodexOption).toBe(true);

    await page.locator('#model-select').selectOption('gpt-4o');
    await expect(page.locator('[data-agent-badge="codex"]')).toHaveCount(0);
    await expect(
      page.locator('.thinking-toggle').filter({ hasText: 'Enable Thinking' }).locator('input')
    ).toBeDisabled();

    await page.locator('#prompt textarea').first().fill(CODEX_PROMPT);
    await page.locator('.btn-submit').click();

    await expect(page).toHaveURL(/\/sessions\//, { timeout: 15000 });
    const sessions = await getProjectSessions(project.id);
    const session = sessions.find((s: any) => s.prompt === CODEX_PROMPT || s.name?.includes('Codex'));
    expect(session).toBeTruthy();
    expect(session.agentType).toBe('codex');

    await waitForStatus(session.id, 'waiting', 60000);
    const persisted = await getProjectSessions(project.id);
    expect(persisted.find((s: any) => s.id === session.id)?.agentType).toBe('codex');

    const messages = await getSessionMessages(session.id);
    expect(messages.some((m: any) => m.role === 'assistant' && m.content.includes('Codex E2E response.'))).toBe(true);
  });
});
