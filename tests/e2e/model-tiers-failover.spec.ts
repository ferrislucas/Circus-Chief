import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  createProvider,
  addProviderModel,
  cleanupProviders,
  waitForStatus,
  getSession,
  getAgentCallLogs,
  connectWebSocket,
  subscribeToSessionAndVerify,
  waitForWSMessage,
  navigateAndWait,
  openSessionOverlay,
  BASE_URL,
  API_URL,
  TEST_PREFIX,
} from './helpers';

/**
 * Critical session-execution failover journeys — Phase 2 of
 * model-tiers-e2e-coverage-plan.md (see the plan on canvas for full scope).
 *
 * Unlike model-tiers.spec.ts (which injects a synthetic `tier:failover`
 * WebSocket message because the cassette harness can't express a start-time
 * provider error), these tests exercise the REAL production path end to end:
 *
 *   browser/API -> tier resolution -> sessionTierFailover.js ->
 *   production adapter / query-param builder -> a SCRIPTED fake CLI process
 *   (e2eSpawnCapture.js Phase 1) -> real WebSocket broadcast ->
 *   real agent-call log -> real DB persistence.
 *
 * The fake CLI process is scripted per (providerId, modelId) via a JSON file
 * at E2E_AGENT_SPAWN_SCRIPT_FILE (queued outcomes: 'success', 'quota_error',
 * 'service_unavailable', 'overloaded', 'rate_limit', 'auth_error',
 * 'bad_request', 'cancelled', 'delayed_success', 'output_then_error' — see
 * e2eSpawnCapture.js for the full contract). No real provider credentials or
 * network calls are ever involved.
 *
 * REQUIRES the E2E server to be started with:
 *   E2E_AGENT_SPAWN_CAPTURE_FILE=<path>   observe what was actually spawned
 *   E2E_AGENT_SPAWN_SCRIPT_FILE=<path>    script per-member success/failure
 * and, for the cooldown-skip case:
 *   E2E_TIER_COOLDOWN_MS=<small ms>       a short, real cooldown window
 *
 * Example:
 *   E2E_AGENT_SPAWN_CAPTURE_FILE=/tmp/cc-capture.jsonl \
 *   E2E_AGENT_SPAWN_SCRIPT_FILE=/tmp/cc-script.json \
 *   E2E_TIER_COOLDOWN_MS=1500 \
 *   ./scripts/pw.sh test tests/e2e/model-tiers-failover.spec.ts
 *
 * Skipped entirely (not failed) when these env vars aren't configured —
 * mirrors the existing pattern in commit-attribution-settings.spec.ts.
 *
 * NOT covered here (left for a follow-up pass — see the plan's remaining
 * Phase 2 scenarios): cooldown-expiry via clock advance, 3-member routing
 * with a pre-cooled middle member, and Phases 3-5 (selector persistence
 * matrix, indirect execution paths, lifecycle/management journeys).
 */

test.describe.configure({ mode: 'serial' });

test.describe('Model Tiers failover (scripted CLI, Phase 2)', () => {
  let captureEnabled = false;
  let captureFile = '';
  let scriptFile = '';
  const createdTierIds: string[] = [];

  test.beforeAll(async () => {
    const response = await fetch(`${API_URL}/api/server-info`);
    const info = await response.json();
    captureFile = process.env.E2E_AGENT_SPAWN_CAPTURE_FILE || '';
    scriptFile = process.env.E2E_AGENT_SPAWN_SCRIPT_FILE || '';
    captureEnabled = Boolean(info.e2eSpawnCaptureEnabled && captureFile && scriptFile);
  });

  test.beforeEach(async () => {
    test.skip(
      !captureEnabled,
      'Set E2E_AGENT_SPAWN_CAPTURE_FILE and E2E_AGENT_SPAWN_SCRIPT_FILE before starting the e2e server to enable scripted failover journeys.'
    );
    clearCaptureFile();
    writeScript({});
    await cleanupProviders();
    await cleanupCreatedResources();
  });

  test.afterEach(async () => {
    for (const id of createdTierIds.splice(0)) {
      await deleteTierViaApi(id);
    }
    await cleanupProviders();
    await cleanupCreatedResources();
    clearCaptureFile();
    writeScript({});
  });

  test('cross-provider quota failure fails over, snapshots the successful member, and surfaces a real notice + log', async ({ page }) => {
    const providerA = await createProvider({ name: `${TEST_PREFIX}Failover Provider A`, kind: 'anthropic' });
    await addProviderModel(providerA.id, { modelId: 'fo-model-a', displayName: 'Failover Model A' });
    const providerB = await createProvider({
      name: `${TEST_PREFIX}Failover Provider B`,
      kind: 'openai',
      baseUrl: 'https://failover-b.example.test/v1',
      authToken: 'test-token',
    });
    await addProviderModel(providerB.id, { modelId: 'fo-model-b', displayName: 'Failover Model B' });

    const tier = await createTierViaApi({
      name: `${TEST_PREFIX}Cross-Provider Tier`,
      members: [
        { providerId: providerA.id, modelId: 'fo-model-a', position: 0 },
        { providerId: providerB.id, modelId: 'fo-model-b', position: 1 },
      ],
    });
    createdTierIds.push(tier.id);

    // A generous delay on the first (failing) member gives the test time to
    // navigate + open the overlay AND subscribe a raw WebSocket before the
    // scripted failure fires, so the *real* tier:failover broadcast (not an
    // injected one) can be observed by both.
    writeScript({
      queues: {
        [`${providerA.id}::fo-model-a`]: [{ type: 'quota_error', delayMs: 8000 }],
        [`${providerB.id}::fo-model-b`]: ['success'],
      },
    });

    const project = await seedProject('Tier Failover Cross-Provider Project', process.cwd());
    const session = await seedSession(project.id, {
      prompt: 'Tier failover cross-provider e2e',
      model: `tier::${tier.id}`,
      startImmediately: true,
    });

    // Observe the real (non-injected) toast in the UI.
    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    const ws = await connectWebSocket();
    await subscribeToSessionAndVerify(ws, session.id);
    const failoverPromise = waitForWSMessage(ws, 'tier:failover', 15000);

    const failoverEvent = await failoverPromise;
    expect(failoverEvent.tierRef).toBe(`tier::${tier.id}`);
    expect(failoverEvent.fromModel).toBe('fo-model-a');
    expect(failoverEvent.toModel).toBe('fo-model-b');

    const toast = page.locator('.toast.toast-info');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast.locator('.toast-message')).toContainText('fo-model-a');
    await expect(toast.locator('.toast-message')).toContainText('fo-model-b');

    await waitForStatus(session.id, 'waiting', 15000);
    const finalSession = await waitForResolvedModel(session.id);
    expect(finalSession.model).toBe(`tier::${tier.id}`);
    expect(finalSession.resolvedModel).toBe('fo-model-b');
    expect(finalSession.resolvedProviderId).toBe(providerB.id);

    // No raw tier sentinel ever reached a spawned process.
    const records = await waitForCaptureRecords(2);
    expect(records.map((r: any) => r.providerId)).toEqual([providerA.id, providerB.id]);
    expect(records.map((r: any) => r.modelId)).toEqual(['fo-model-a', 'fo-model-b']);
    expect(records.map((r: any) => r.agentType)).toEqual(['claude-code', 'codex']);
    expect(JSON.stringify(records)).not.toContain('tier::');

    const logs = await getAgentCallLogs({ sessionId: session.id, callType: 'tierFailover' });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].metadata?.fromModel ?? logs[0].fromModel).toBe('fo-model-a');
    expect(logs[0].metadata?.toModel ?? logs[0].toModel).toBe('fo-model-b');

    ws.close();
  });

  test('a second new session on the same tier skips the still-cooled member', async () => {
    test.skip(
      !process.env.E2E_TIER_COOLDOWN_MS,
      'Set E2E_TIER_COOLDOWN_MS (e.g. 1500) before starting the e2e server for a deterministic, short cooldown window.'
    );
    const cooldownMs = Number(process.env.E2E_TIER_COOLDOWN_MS);

    const providerA = await createProvider({ name: `${TEST_PREFIX}Cooldown Provider A`, kind: 'anthropic' });
    await addProviderModel(providerA.id, { modelId: 'cd-model-a', displayName: 'Cooldown Model A' });
    const providerB = await createProvider({
      name: `${TEST_PREFIX}Cooldown Provider B`,
      kind: 'openai',
      baseUrl: 'https://cooldown-b.example.test/v1',
      authToken: 'test-token',
    });
    await addProviderModel(providerB.id, { modelId: 'cd-model-b', displayName: 'Cooldown Model B' });

    const tier = await createTierViaApi({
      name: `${TEST_PREFIX}Cooldown Tier`,
      members: [
        { providerId: providerA.id, modelId: 'cd-model-a', position: 0 },
        { providerId: providerB.id, modelId: 'cd-model-b', position: 1 },
      ],
    });
    createdTierIds.push(tier.id);

    writeScript({
      queues: {
        [`${providerA.id}::cd-model-a`]: ['service_unavailable', 'success'],
        [`${providerB.id}::cd-model-b`]: ['success', 'success'],
      },
    });

    const project = await seedProject('Tier Cooldown Project', process.cwd());
    const firstSession = await seedSession(project.id, {
      prompt: 'Tier cooldown first session e2e',
      model: `tier::${tier.id}`,
      startImmediately: true,
    });
    await waitForStatus(firstSession.id, 'waiting', 15000);
    await waitForCaptureRecords(2);

    const secondSession = await seedSession(project.id, {
      prompt: 'Tier cooldown second session e2e',
      model: `tier::${tier.id}`,
      startImmediately: true,
    });
    await waitForStatus(secondSession.id, 'waiting', 15000);
    const finalSecond = await waitForResolvedModel(secondSession.id);

    // Member A is still cooling down: the second session must go straight to
    // B in a single attempt, with no failover event for THIS session.
    expect(finalSecond.resolvedModel).toBe('cd-model-b');
    expect(finalSecond.resolvedProviderId).toBe(providerB.id);

    const records = await waitForCaptureRecords(3);
    const secondSessionRecords = records.filter((r: any) => r.sessionId === secondSession.id);
    expect(secondSessionRecords).toHaveLength(1);
    expect(secondSessionRecords[0].providerId).toBe(providerB.id);

    const failoverLogs = await getAgentCallLogs({ sessionId: secondSession.id, callType: 'tierFailover' });
    expect(failoverLogs).toHaveLength(0);

    // Sanity: cooldown window is short enough that this test isn't relying on
    // the production 5-minute default (would make the assertion meaningless).
    expect(cooldownMs).toBeLessThan(5 * 60 * 1000);
  });

  test('exhausting every tier member leaves the session in a terminal error state (no hang)', async () => {
    const providerA = await createProvider({ name: `${TEST_PREFIX}Exhaustion Provider A`, kind: 'anthropic' });
    await addProviderModel(providerA.id, { modelId: 'ex-model-a', displayName: 'Exhaustion Model A' });
    const providerB = await createProvider({
      name: `${TEST_PREFIX}Exhaustion Provider B`,
      kind: 'openai',
      baseUrl: 'https://exhaustion-b.example.test/v1',
      authToken: 'test-token',
    });
    await addProviderModel(providerB.id, { modelId: 'ex-model-b', displayName: 'Exhaustion Model B' });

    const tier = await createTierViaApi({
      name: `${TEST_PREFIX}Exhaustion Tier`,
      members: [
        { providerId: providerA.id, modelId: 'ex-model-a', position: 0 },
        { providerId: providerB.id, modelId: 'ex-model-b', position: 1 },
      ],
    });
    createdTierIds.push(tier.id);

    writeScript({
      queues: {
        [`${providerA.id}::ex-model-a`]: ['quota_error'],
        [`${providerB.id}::ex-model-b`]: ['rate_limit'],
      },
    });

    const project = await seedProject('Tier Exhaustion Project', process.cwd());
    const session = await seedSession(project.id, {
      prompt: 'Tier exhaustion e2e',
      model: `tier::${tier.id}`,
      startImmediately: true,
    });

    const finalSession = await waitForStatus(session.id, 'error', 15000);
    expect(finalSession.status).toBe('error');

    const records = await waitForCaptureRecords(2);
    expect(records.map((r: any) => r.providerId)).toEqual([providerA.id, providerB.id]);
  });

  test('an auth error on a single-member tier does not fail over (single attempt, terminal error)', async () => {
    const provider = await createProvider({ name: `${TEST_PREFIX}Auth Provider`, kind: 'anthropic' });
    await addProviderModel(provider.id, { modelId: 'auth-model-a', displayName: 'Auth Model A' });

    const tier = await createTierViaApi({
      name: `${TEST_PREFIX}Auth Tier`,
      members: [{ providerId: provider.id, modelId: 'auth-model-a', position: 0 }],
    });
    createdTierIds.push(tier.id);

    writeScript({ queues: { [`${provider.id}::auth-model-a`]: ['auth_error'] } });

    const project = await seedProject('Tier Auth Error Project', process.cwd());
    const session = await seedSession(project.id, {
      prompt: 'Tier auth error e2e',
      model: `tier::${tier.id}`,
      startImmediately: true,
    });

    await waitForStatus(session.id, 'error', 15000);

    const records = await waitForCaptureRecords(1);
    expect(records).toHaveLength(1);

    const failoverLogs = await getAgentCallLogs({ sessionId: session.id, callType: 'tierFailover' });
    expect(failoverLogs).toHaveLength(0);
  });

  test('assistant output followed by a service error does not trigger failover (no rotation)', async () => {
    const providerA = await createProvider({ name: `${TEST_PREFIX}MidConvo Provider A`, kind: 'anthropic' });
    await addProviderModel(providerA.id, { modelId: 'mc-model-a', displayName: 'MidConvo Model A' });
    const providerB = await createProvider({
      name: `${TEST_PREFIX}MidConvo Provider B`,
      kind: 'openai',
      baseUrl: 'https://midconvo-b.example.test/v1',
      authToken: 'test-token',
    });
    await addProviderModel(providerB.id, { modelId: 'mc-model-b', displayName: 'MidConvo Model B' });

    const tier = await createTierViaApi({
      name: `${TEST_PREFIX}MidConvo Tier`,
      members: [
        { providerId: providerA.id, modelId: 'mc-model-a', position: 0 },
        { providerId: providerB.id, modelId: 'mc-model-b', position: 1 },
      ],
    });
    createdTierIds.push(tier.id);

    writeScript({
      queues: {
        [`${providerA.id}::mc-model-a`]: [{ type: 'output_then_error', delayMs: 15, failDelayMs: 60 }],
      },
    });

    const project = await seedProject('Tier MidConvo Project', process.cwd());
    const session = await seedSession(project.id, {
      prompt: 'Tier mid-conversation error e2e',
      model: `tier::${tier.id}`,
      startImmediately: true,
    });

    // Turn ended with an error after producing output — falls through to the
    // existing error/auto-reschedule handling, not tier failover.
    await waitForStatus(session.id, 'error', 15000);

    const records = await waitForCaptureRecords(1);
    expect(records).toHaveLength(1);
    expect(records[0].providerId).toBe(providerA.id);

    const failoverLogs = await getAgentCallLogs({ sessionId: session.id, callType: 'tierFailover' });
    expect(failoverLogs).toHaveLength(0);
  });

  test('single-member tier success and concrete-model regression both start normally under spawn capture', async () => {
    const provider = await createProvider({ name: `${TEST_PREFIX}Single Member Provider`, kind: 'anthropic' });
    await addProviderModel(provider.id, { modelId: 'single-model-a', displayName: 'Single Model A' });

    const tier = await createTierViaApi({
      name: `${TEST_PREFIX}Single Member Tier`,
      members: [{ providerId: provider.id, modelId: 'single-model-a', position: 0 }],
    });
    createdTierIds.push(tier.id);

    writeScript({ queues: { [`${provider.id}::single-model-a`]: ['success'] } });

    const project = await seedProject('Tier Single Member Project', process.cwd());
    const tierSession = await seedSession(project.id, {
      prompt: 'Tier single-member success e2e',
      model: `tier::${tier.id}`,
      startImmediately: true,
    });
    await waitForStatus(tierSession.id, 'waiting', 15000);
    const finalTierSession = await waitForResolvedModel(tierSession.id);
    expect(finalTierSession.resolvedModel).toBe('single-model-a');

    const concreteSession = await seedSession(project.id, {
      prompt: 'Concrete model regression e2e',
      model: 'claude-haiku-4-5-20251001',
      startImmediately: true,
    });
    const finalConcreteSession = await waitForStatus(concreteSession.id, 'waiting', 15000);
    expect(finalConcreteSession.model).toBe('claude-haiku-4-5-20251001');

    const records = await waitForCaptureRecords(2);
    expect(records.map((r: any) => r.modelId)).toEqual(
      expect.arrayContaining(['single-model-a', 'claude-haiku-4-5-20251001'])
    );
  });
});

// ── File-local helpers ──────────────────────────────────────────────────────

function clearCaptureFile() {
  if (captureFileSafe() && existsSync(captureFileSafe())) rmSync(captureFileSafe());
}

function captureFileSafe(): string {
  return process.env.E2E_AGENT_SPAWN_CAPTURE_FILE || '';
}

function writeScript(script: Record<string, unknown>) {
  const scriptFile = process.env.E2E_AGENT_SPAWN_SCRIPT_FILE;
  if (scriptFile) writeFileSync(scriptFile, JSON.stringify(script));
}

function readCaptureRecords(): any[] {
  const filePath = captureFileSafe();
  if (!filePath || !existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitForCaptureRecords(count: number, timeout = 10000): Promise<any[]> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const records = readCaptureRecords();
    if (records.length >= count) return records;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${count} captured spawn attempt(s); saw ${readCaptureRecords().length}`);
}

/**
 * `waitForStatus(..., 'waiting', ...)` can observe the session the instant
 * its status flips to 'waiting' — which happens (via handleTurnCompletion)
 * slightly BEFORE `snapshotSuccessfulMember` persists `resolvedModel` /
 * `resolvedProviderId` back in the tier-failover loop (see
 * sessionTierFailover.js#runSessionWithTierFailover). Poll past that brief
 * gap instead of asserting against a single snapshot.
 */
async function waitForResolvedModel(sessionId: string, timeout = 5000): Promise<any> {
  const deadline = Date.now() + timeout;
  let last: any;
  while (Date.now() < deadline) {
    last = await getSession(sessionId);
    if (last?.resolvedModel) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return last;
}

async function createTierViaApi(data: {
  name: string;
  description?: string | null;
  members?: Array<{ providerId: string; modelId: string; position: number }>;
}) {
  const response = await fetch(`${API_URL}/api/tiers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`Failed to create tier (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

async function deleteTierViaApi(id: string) {
  await fetch(`${API_URL}/api/tiers/${id}`, { method: 'DELETE' }).catch(() => {});
}
