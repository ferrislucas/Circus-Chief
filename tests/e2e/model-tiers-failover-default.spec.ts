import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupCreatedResources,
  createProvider,
  addProviderModel,
  cleanupProviders,
  getSession,
  getAgentCallLogs,
  connectWebSocket,
  subscribeToSessionAndVerify,
  assertNoWSMessage,
  API_URL,
  TEST_PREFIX,
} from './helpers';
import { createTierViaApi, deleteTierViaApi } from './tier-test-helpers';

/**
 * Tier-failover contract that runs in the STANDARD pipeline (Fix #1).
 *
 * Unlike model-tiers-failover.spec.ts — whose scripted-CLI journeys require
 * the E2E server to be started with E2E_AGENT_SPAWN_CAPTURE_FILE +
 * E2E_AGENT_SPAWN_SCRIPT_FILE (and skip otherwise) — every test in this file
 * is API-assertable with no harness: tier flag persistence, tier-bound draft
 * pinning (binding stored, no advance, no TIER_FAILOVER signal), and tier-ref
 * validation at session creation.
 *
 * This file intentionally contains zero `test.skip` gates: it must EXECUTE
 * under a plain `./scripts/pw.sh test` run. The scripted execution journeys
 * (start-time failover, §5.1 next-turn advance, §5.2 same-turn retry, FR0
 * execution pinning) stay in model-tiers-failover.spec.ts behind the capture
 * gate — see docs/e2e-testing.md for how to run them.
 */

test.describe('Model Tiers failover — default-pipeline contract (no harness)', () => {
  const createdTierIds: string[] = [];

  test.beforeEach(async () => {
    await cleanupProviders();
    await cleanupCreatedResources();
  });

  test.afterEach(async () => {
    for (const id of createdTierIds.splice(0)) {
      await deleteTierViaApi(id);
    }
    await cleanupProviders();
    await cleanupCreatedResources();
  });

  test('executes in the standard pipeline with no spawn-capture harness', async () => {
    // Proves this suite runs (not skips) under a plain `./scripts/pw.sh test`
    // invocation: server-info answers, and the capture flag is irrelevant to
    // every assertion in this file.
    const response = await fetch(`${API_URL}/api/server-info`);
    expect(response.ok).toBe(true);
  });

  test('autoFailoverEnabled defaults on and persists through PATCH (FR0 flag plumbing)', async () => {
    const tier = await createTierViaApi({
      name: `${TEST_PREFIX}Flag Default Tier`,
      members: [],
    });
    createdTierIds.push(tier.id);
    expect(tier.autoFailoverEnabled).toBe(true);

    const turnedOff = await patchTierViaApi(tier.id, { autoFailoverEnabled: false });
    expect(turnedOff.autoFailoverEnabled).toBe(false);
    expect((await getTierViaApi(tier.id)).autoFailoverEnabled).toBe(false);

    const turnedOn = await patchTierViaApi(tier.id, { autoFailoverEnabled: true });
    expect(turnedOn.autoFailoverEnabled).toBe(true);
    expect((await getTierViaApi(tier.id)).autoFailoverEnabled).toBe(true);
  });

  test('tier-bound draft session stays pinned: binding stored, no failover signal', async () => {
    const { tier, sessionId } = await seedTierBoundDraft(true);

    const session = await getSession(sessionId);
    expect(session.status).toBe('waiting');
    expect(session.model).toBe(`tier::${tier.id}`);

    // No advance happened (nothing ran) and no failover was announced or
    // logged: the pinning contract the execution journeys build on.
    const logs = await getAgentCallLogs({ sessionId, callType: 'tierFailover' });
    expect(logs).toHaveLength(0);

    const ws = await connectWebSocket();
    try {
      await subscribeToSessionAndVerify(ws, sessionId);
      await assertNoWSMessage(ws, 'tier:failover', 1500);
    } finally {
      ws.close();
    }
  });

  test('flag-off tier draft session stays pinned: no advance, no event (FR0)', async () => {
    const { tier, sessionId } = await seedTierBoundDraft(false);
    expect(tier.autoFailoverEnabled).toBe(false);

    const session = await getSession(sessionId);
    expect(session.status).toBe('waiting');
    expect(session.model).toBe(`tier::${tier.id}`);

    const logs = await getAgentCallLogs({ sessionId, callType: 'tierFailover' });
    expect(logs).toHaveLength(0);

    const ws = await connectWebSocket();
    try {
      await subscribeToSessionAndVerify(ws, sessionId);
      await assertNoWSMessage(ws, 'tier:failover', 1500);
    } finally {
      ws.close();
    }
  });

  test('unknown or malformed tier refs are rejected at session creation', async () => {
    const project = await seedProject('Tier Ref Validation Project', process.cwd());

    for (const model of ['tier::does-not-exist-0000', 'tier::']) {
      const response = await fetch(`${API_URL}/api/projects/${project.id}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Tier ref validation probe',
          model,
          startImmediately: false,
          gitMode: 'current',
          gitBranch: 'main',
          autoRescheduleEnabled: false,
        }),
      });
      expect(response.status).toBe(400);
    }
  });

  async function seedTierBoundDraft(flagOn: boolean): Promise<{ tier: any; sessionId: string }> {
    const providerA = await createProvider({ name: `${TEST_PREFIX}Default Provider A`, kind: 'anthropic' });
    await addProviderModel(providerA.id, { modelId: 'def-model-a', displayName: 'Default Model A' });
    const providerB = await createProvider({ name: `${TEST_PREFIX}Default Provider B`, kind: 'anthropic' });
    await addProviderModel(providerB.id, { modelId: 'def-model-b', displayName: 'Default Model B' });

    const tier = await createTierViaApi({
      name: `${TEST_PREFIX}Default Tier`,
      autoFailoverEnabled: flagOn,
      members: [
        { providerId: providerA.id, modelId: 'def-model-a', position: 0 },
        { providerId: providerB.id, modelId: 'def-model-b', position: 1 },
      ],
    });
    createdTierIds.push(tier.id);

    const project = await seedProject('Tier Default Draft Project', process.cwd());
    const session = await seedSession(project.id, {
      prompt: 'Tier default draft e2e',
      model: `tier::${tier.id}`,
      startImmediately: false,
    });
    return { tier, sessionId: session.id };
  }
});

// ── File-local helpers (get/patch are only used by this spec; create/delete
// are shared via ./tier-test-helpers) ────────────────────────────────────────

async function getTierViaApi(id: string) {
  const response = await fetch(`${API_URL}/api/tiers/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch tier (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

async function patchTierViaApi(id: string, data: Record<string, unknown>) {
  const response = await fetch(`${API_URL}/api/tiers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`Failed to patch tier (${response.status}): ${await response.text()}`);
  }
  return response.json();
}
