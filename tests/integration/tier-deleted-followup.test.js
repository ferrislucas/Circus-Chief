/**
 * Integration: follow-up messages on a session whose bound Model Tier was
 * deleted (or emptied) — the PR #1048 review's High Issue 1.
 *
 * Contract (PRD Acceptance Criterion #7, Edge Case E3, Decision D6): a plain
 * follow-up must be ACCEPTED and continue on the last active concrete model
 * (the session's resolved_model snapshot), or degrade to the server default
 * when no snapshot exists — never a 400 TIER_UNRESOLVABLE / "tier does not
 * exist" brick with no path back from the chat box.
 *
 * These tests exercise the real HTTP endpoint (`POST /api/sessions/:id/message`)
 * with the two payload shapes that occur in practice:
 *   1. no `model` field (an API caller),
 *   2. `model` echoing `session.model` — what the web client sends, because
 *      ConversationTab initializes its picker from session.model, which for a
 *      tier-bound session IS the `tier::<id>` sentinel.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  apiFetch,
  seedProject,
  seedSession,
  getSession,
  updateSessionStatus,
} from './setup.js';
import { initDatabase, closeDatabase, sessions, modelProviders, modelTiers } from '../../packages/server/src/database.js';
import { buildTierRef } from '@circuschief/shared';

describe('Follow-up on a session bound to a deleted tier (PRD E3/D6)', () => {
  let project;
  let provider;
  let tier;
  let tierRef;
  let session;

  beforeEach(async () => {
    await initDatabase();
    project = await seedProject('Tier Deletion Project', '/tmp/tier-deletion-test');

    provider = modelProviders.create({
      name: 'Tier Deletion Provider',
      kind: 'anthropic',
    });
    modelProviders.addModel(provider.id, { modelId: 'claude-tier-del', displayName: 'Tier Del Model' });

    tier = modelTiers.create({
      name: 'Doomed Tier',
      members: [{ providerId: provider.id, modelId: 'claude-tier-del', position: 0 }],
    });
    tierRef = buildTierRef(tier.id);

    session = await seedSession(project.id, {
      prompt: 'Initial prompt',
      name: 'Tier Deletion Session',
      startImmediately: false,
    });
    // Bind the session to the tier with a concrete snapshot from a prior
    // successful turn, in the state a follow-up arrives in.
    sessions.update(session.id, {
      model: tierRef,
      resolvedModel: 'claude-tier-del',
      resolvedProviderId: provider.id,
      status: 'waiting',
    });
  });

  afterEach(async () => {
    try { modelTiers.delete(tier.id); } catch { /* noop */ }
    try { modelProviders.delete(provider.id); } catch { /* noop */ }
    await closeDatabase();
  });

  const postFollowUp = (body) =>
    apiFetch(`/api/sessions/${session.id}/message`, {
      method: 'POST',
      body: JSON.stringify({ content: 'Follow-up after tier deletion', ...body }),
    });

  it('accepts a follow-up with no model field (API caller shape)', async () => {
    modelTiers.delete(tier.id);

    const response = await postFollowUp({});
    expect(response.status).not.toBe(400);
    expect([200, 201]).toContain(response.status);

    // The turn was accepted; the binding degraded to the snapshot's concrete model.
    const updated = await getSession(session.id);
    expect(updated.model).toBe('claude-tier-del');
    expect(updated.providerId).toBe(provider.id);
  });

  it('accepts a follow-up whose model echoes session.model (web client shape)', async () => {
    modelTiers.delete(tier.id);

    const response = await postFollowUp({ model: tierRef });
    expect(response.status).not.toBe(400);
    expect([200, 201]).toContain(response.status);

    const updated = await getSession(session.id);
    expect(updated.model).toBe('claude-tier-del');
  });

  it('accepts a follow-up with no snapshot at all, degrading to the server default', async () => {
    sessions.update(session.id, { resolvedModel: null, resolvedProviderId: null });
    modelTiers.delete(tier.id);

    const response = await postFollowUp({});
    expect(response.status).not.toBe(400);
    expect([200, 201]).toContain(response.status);

    const updated = await getSession(session.id);
    expect(updated.model ?? null).toBeNull();
  });

  it('still rejects a follow-up selecting a DIFFERENT unresolvable tier', async () => {
    const otherTier = modelTiers.create({ name: 'Other Empty Tier', members: [] });

    const response = await postFollowUp({ model: buildTierRef(otherTier.id) });
    expect(response.status).toBe(400);
    // Rejected by the write-time tier validation (validateModelId) — a
    // genuinely NEW selection of a broken tier stays a 400; only the
    // session's OWN stale binding is tolerated.
    const body = await response.json();
    expect(body.error).toMatch(/tier .* does not exist or has no enabled members/);

    modelTiers.delete(otherTier.id);
  });
});
