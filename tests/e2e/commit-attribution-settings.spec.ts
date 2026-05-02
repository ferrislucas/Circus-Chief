import { test, expect } from '@playwright/test';
import { existsSync, rmSync, readFileSync } from 'fs';
import {
  addProviderModel,
  cleanupCreatedResources,
  cleanupProviders,
  createProvider,
  getProviders,
  navigateAndWait,
  seedProject,
  seedSession,
  updateProvider,
  waitForStatus,
  API_URL,
  BASE_URL,
  TEST_PREFIX,
} from './helpers';

const CLAUDE_ATTRIBUTION = 'Co-authored-by: Claude E2E <claude-e2e@example.com>';
const CODEX_ATTRIBUTION = 'Co-authored-by: Codex E2E <codex-e2e@example.com>';

test.describe.configure({ mode: 'serial' });

test.describe('Commit attribution provider settings', () => {
  test.beforeEach(async () => {
    await cleanupProviders();
    await cleanupCreatedResources();
    await resetBuiltInAttribution();
  });

  test.afterEach(async () => {
    await resetBuiltInAttribution();
    await cleanupProviders();
    await cleanupCreatedResources();
  });

  test('built-in providers show blank attribution by default and hide connection controls', async ({ page }) => {
    const anthropic = await builtInProvider('anthropic');
    const openai = await builtInProvider('openai');

    await expectBuiltInAttributionModal(page, anthropic.name, '');
    await closeModal(page);
    await expectBuiltInAttributionModal(page, openai.name, '');
  });

  test('built-in Anthropic override persists after reload and clears to null', async ({ page }) => {
    const anthropic = await builtInProvider('anthropic');

    await saveBuiltInAttribution(page, anthropic.name, CLAUDE_ATTRIBUTION);
    await page.reload();
    await expectBuiltInAttributionModal(page, anthropic.name, CLAUDE_ATTRIBUTION);

    await page.locator('#commit-attribution-override').fill('');
    await page.locator('.modal-footer .btn-primary').click();
    await expect(page.locator('.modal')).toBeHidden();

    const updated = await builtInProvider('anthropic');
    expect(updated.commitAttributionOverride).toBeNull();
  });

  test('built-in OpenAI override persists after reload and clears to null', async ({ page }) => {
    const openai = await builtInProvider('openai');

    await saveBuiltInAttribution(page, openai.name, CODEX_ATTRIBUTION);
    await page.reload();
    await expectBuiltInAttributionModal(page, openai.name, CODEX_ATTRIBUTION);

    await page.locator('#commit-attribution-override').fill('');
    await page.locator('.modal-footer .btn-primary').click();
    await expect(page.locator('.modal')).toBeHidden();

    const updated = await builtInProvider('openai');
    expect(updated.commitAttributionOverride).toBeNull();
  });

  test('custom Anthropic provider can set and clear attribution', async ({ page }) => {
    const provider = await createProvider({
      name: `${TEST_PREFIX}Attribution Anthropic`,
      kind: 'anthropic',
      baseUrl: 'https://anthropic.example.com',
      authToken: 'test-token',
    });

    await saveCustomAttribution(page, provider.name, CLAUDE_ATTRIBUTION);
    let updated = (await getProviders()).find((candidate: any) => candidate.id === provider.id);
    expect(updated.commitAttributionOverride).toBe(CLAUDE_ATTRIBUTION);

    await saveCustomAttribution(page, provider.name, '');
    updated = (await getProviders()).find((candidate: any) => candidate.id === provider.id);
    expect(updated.commitAttributionOverride).toBeNull();
  });

  test('custom OpenAI provider can set and clear attribution', async ({ page }) => {
    const provider = await createProvider({
      name: `${TEST_PREFIX}Attribution OpenAI`,
      kind: 'openai',
      baseUrl: 'https://openai.example.com/v1',
      authToken: 'test-token',
    });

    await saveCustomAttribution(page, provider.name, CODEX_ATTRIBUTION);
    let updated = (await getProviders()).find((candidate: any) => candidate.id === provider.id);
    expect(updated.commitAttributionOverride).toBe(CODEX_ATTRIBUTION);

    await saveCustomAttribution(page, provider.name, '');
    updated = (await getProviders()).find((candidate: any) => candidate.id === provider.id);
    expect(updated.commitAttributionOverride).toBeNull();
  });
});

test.describe('Commit attribution launch behavior', () => {
  test.describe.configure({ timeout: 120000 });

  let captureEnabled = false;

  test.beforeAll(async () => {
    const response = await fetch(`${API_URL}/api/server-info`);
    const info = await response.json();
    captureEnabled = Boolean(info.e2eSpawnCaptureEnabled && process.env.E2E_AGENT_SPAWN_CAPTURE_FILE);
  });

  test.beforeEach(async () => {
    test.skip(!captureEnabled, 'Set E2E_AGENT_SPAWN_CAPTURE_FILE before starting the e2e server to enable spawn-capture launch assertions.');
    await cleanupProviders();
    await cleanupCreatedResources();
    await resetBuiltInAttribution();
    clearCaptureFile();
  });

  test.afterEach(async () => {
    await resetBuiltInAttribution();
    await cleanupProviders();
    await cleanupCreatedResources();
    clearCaptureFile();
  });

  test('built-in Anthropic blank attribution does not pass commit attribution env', async () => {
    const project = await seedProject('Claude Blank Attribution Project', process.cwd());
    const session = await seedSession(project.id, {
      prompt: 'Claude blank attribution e2e',
      model: 'claude-haiku-4-5-20251001',
      startImmediately: true,
    });

    await waitForStatus(session.id, 'waiting', 60000);
    const spawn = await waitForSpawn('claude-code');
    expect(spawn.args).not.toContain('--settings');
    expect(spawn.env?.CIRCUSCHIEF_COMMIT_ATTRIBUTION).toBeUndefined();
  });

  test('built-in Anthropic override passes commit attribution env', async () => {
    const anthropic = await builtInProvider('anthropic');
    await updateProvider(anthropic.id, { commitAttributionOverride: CLAUDE_ATTRIBUTION });

    const project = await seedProject('Claude Built In Attribution Project', process.cwd());
    const session = await seedSession(project.id, {
      prompt: 'Claude built-in attribution e2e',
      model: 'claude-haiku-4-5-20251001',
      startImmediately: true,
    });

    await waitForStatus(session.id, 'waiting', 60000);
    expectAttributionEnv(await waitForSpawn('claude-code'), CLAUDE_ATTRIBUTION);
  });

  test('custom Anthropic provider override passes commit attribution env', async () => {
    const provider = await createProvider({
      name: `${TEST_PREFIX}Launch Anthropic`,
      kind: 'anthropic',
      baseUrl: 'https://anthropic-launch.example.com',
      authToken: 'test-token',
      commitAttributionOverride: CLAUDE_ATTRIBUTION,
    });
    await addProviderModel(provider.id, {
      modelId: 'claude-e2e-attribution-model',
      displayName: 'Claude E2E Attribution',
      tier: 'custom',
    });

    const project = await seedProject('Claude Custom Attribution Project', process.cwd());
    const session = await seedSession(project.id, {
      prompt: 'Claude custom attribution e2e',
      model: 'claude-e2e-attribution-model',
      startImmediately: true,
    });

    await waitForStatus(session.id, 'waiting', 60000);
    expectAttributionEnv(await waitForSpawn('claude-code'), CLAUDE_ATTRIBUTION);
  });

  test('built-in OpenAI blank attribution does not pass commit attribution env or native config', async () => {
    const project = await seedProject('Codex Blank Attribution Project', process.cwd());
    const session = await seedSession(project.id, {
      prompt: 'Codex blank attribution e2e',
      model: await firstBuiltInOpenAIModel(),
      startImmediately: true,
    });

    await waitForStatus(session.id, 'waiting', 60000);
    const spawn = await waitForSpawn('codex');
    expect(spawn.args.some((arg: string) => arg.startsWith('commit_attribution='))).toBe(false);
    expect(spawn.env?.CIRCUSCHIEF_COMMIT_ATTRIBUTION).toBeUndefined();
  });

  test('built-in OpenAI override passes commit attribution env without native config', async () => {
    const openai = await builtInProvider('openai');
    await updateProvider(openai.id, { commitAttributionOverride: CODEX_ATTRIBUTION });

    const project = await seedProject('Codex Built In Attribution Project', process.cwd());
    const session = await seedSession(project.id, {
      prompt: 'Codex built-in attribution e2e',
      model: await firstBuiltInOpenAIModel(),
      startImmediately: true,
    });

    await waitForStatus(session.id, 'waiting', 60000);
    expectAttributionEnv(await waitForSpawn('codex'), CODEX_ATTRIBUTION);
  });

  test('custom OpenAI provider override passes commit attribution env without native config', async () => {
    const provider = await createProvider({
      name: `${TEST_PREFIX}Launch OpenAI`,
      kind: 'openai',
      baseUrl: 'https://openai-launch.example.com/v1',
      authToken: 'test-token',
      commitAttributionOverride: CODEX_ATTRIBUTION,
    });
    await addProviderModel(provider.id, {
      modelId: 'gpt-e2e-attribution',
      displayName: 'GPT E2E Attribution',
      tier: 'custom',
    });

    const project = await seedProject('Codex Custom Attribution Project', process.cwd());
    const session = await seedSession(project.id, {
      prompt: 'Codex custom attribution e2e',
      model: 'gpt-e2e-attribution',
      startImmediately: true,
    });

    await waitForStatus(session.id, 'waiting', 60000);
    expectAttributionEnv(await waitForSpawn('codex'), CODEX_ATTRIBUTION);
  });
});

async function expectBuiltInAttributionModal(page: any, providerName: string, expectedValue: string) {
  await navigateAndWait(page, `${BASE_URL}/settings/providers`, {
    waitFor: '.provider-list',
    timeout: 15000,
  });
  await page.locator('.provider-card').filter({ hasText: providerName }).locator('button:has-text("Settings")').click();

  const modal = page.locator('.modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('h2')).toHaveText('Commit Attribution');
  await expect(modal.locator('#commit-attribution-override')).toHaveValue(expectedValue);
  await expect(modal.locator('#provider-name')).toHaveCount(0);
  await expect(modal.locator('#base-url')).toHaveCount(0);
  await expect(modal.locator('#auth-token')).toHaveCount(0);
  await expect(modal.locator('#api-timeout')).toHaveCount(0);
  await expect(modal.locator('.add-model-btn')).toHaveCount(0);
  await expect(modal.locator('.remove-env-btn')).toHaveCount(0);
  await expect(modal.locator('button:has-text("Test Connection")')).toHaveCount(0);
  await expect(modal.locator('button:has-text("Delete")')).toHaveCount(0);
}

async function saveBuiltInAttribution(page: any, providerName: string, value: string) {
  await expectBuiltInAttributionModal(page, providerName, '');
  await page.locator('#commit-attribution-override').fill(value);
  await page.locator('.modal-footer .btn-primary').click();
  await expect(page.locator('.modal')).toBeHidden();
}

async function saveCustomAttribution(page: any, providerName: string, value: string) {
  await navigateAndWait(page, `${BASE_URL}/settings/providers`, {
    waitFor: '.provider-list',
    timeout: 15000,
  });
  await page.locator('.provider-card').filter({ hasText: providerName }).locator('button:has-text("Edit")').click();

  const modal = page.locator('.modal');
  await expect(modal).toBeVisible();
  await modal.locator('#commit-attribution-override').fill(value);
  await modal.locator('.modal-footer .btn-primary').click();
  await expect(modal).toBeHidden();
}

async function closeModal(page: any) {
  await page.locator('.modal .close-btn').click();
  await expect(page.locator('.modal')).toBeHidden();
}

async function resetBuiltInAttribution() {
  const providers = await getProviders();
  await Promise.all(
    providers
      .filter((provider: any) => provider.isBuiltIn)
      .map((provider: any) => updateProvider(provider.id, { commitAttributionOverride: null }))
  );
}

async function builtInProvider(kind: 'anthropic' | 'openai') {
  const provider = (await getProviders()).find((candidate: any) => (
    candidate.isBuiltIn && candidate.kind === kind
  ));
  expect(provider).toBeTruthy();
  return provider;
}

async function firstBuiltInOpenAIModel() {
  const provider = await builtInProvider('openai');
  return provider.models?.[0]?.modelId || 'gpt-5.5';
}

function clearCaptureFile() {
  const filePath = process.env.E2E_AGENT_SPAWN_CAPTURE_FILE;
  if (filePath && existsSync(filePath)) rmSync(filePath);
}

async function waitForSpawn(agentType: 'claude-code' | 'codex') {
  const timeoutAt = Date.now() + 10000;
  while (Date.now() < timeoutAt) {
    const records = readCaptureRecords();
    const record = records.find((candidate: any) => candidate.agentType === agentType);
    if (record) return record;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for captured ${agentType} spawn`);
}

function readCaptureRecords() {
  const filePath = process.env.E2E_AGENT_SPAWN_CAPTURE_FILE;
  if (!filePath || !existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function expectAttributionEnv(spawn: any, attribution: string) {
  expect(spawn.env?.CIRCUSCHIEF_COMMIT_ATTRIBUTION).toBe(attribution);
  expect(spawn.args).not.toContain('--settings');
  expect(spawn.args.some((arg: string) => arg.startsWith('commit_attribution='))).toBe(false);
}
