import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  checkContinuationDispatchKind,
  isTierFailoverLiftable,
} from './sessionAgentGuard.js';
import { projects, sessions, messages, modelProviders, modelTiers } from '../database.js';
import { buildTierRef } from '@circuschief/shared';
import { markUnhealthy, clearUnhealthy } from './tierResolutionService.js';

/**
 * RED (plan Phase 3): pins the §5.1 cross-kind lift for tier-driven
 * continuations. `isTierFailoverLiftable` does not exist yet, so this file
 * fails at import until Phase 4 implements it (same pattern as
 * sessionAgentGuard.crossKindAllowlist.test.js).
 *
 * Lift rule: an established session advancing OFF a cooled snapshot of its
 * OWN tier binding may cross agent kinds iff both sides are in
 * { claude-code, codex, muse }. Gemini anywhere stays blocked (NG3), and so
 * does every non-advance candidate (uncooled snapshot, flag off, explicit
 * different-tier selection).
 */
describe('tier-failover lift (§5.1)', () => {
  let project;
  let anthropicProvider;
  let openaiProvider;
  let googleProvider;
  let tier;
  let tierRef;

  const CLAUDE_MODEL = 'claude-lift';
  const GPT_MODEL = 'gpt-lift';
  const GEMINI_MODEL = 'gemini-lift';

  beforeEach(() => {
    project = projects.create('Lift Test Project', '/tmp/lift-test');

    anthropicProvider = modelProviders.create({ name: 'Anthropic Lift', kind: 'anthropic' });
    modelProviders.addModel(anthropicProvider.id, { modelId: CLAUDE_MODEL, displayName: 'Claude Lift' });

    openaiProvider = modelProviders.create({ name: 'OpenAI Lift', kind: 'openai' });
    modelProviders.addModel(openaiProvider.id, { modelId: GPT_MODEL, displayName: 'GPT Lift' });

    googleProvider = modelProviders.create({ name: 'Google Lift', kind: 'google' });
    modelProviders.addModel(googleProvider.id, { modelId: GEMINI_MODEL, displayName: 'Gemini Lift' });

    tier = modelTiers.create({
      name: 'Lift Tier',
      members: [
        { providerId: anthropicProvider.id, modelId: CLAUDE_MODEL, position: 0 },
        { providerId: openaiProvider.id, modelId: GPT_MODEL, position: 1 },
      ],
    });
    tierRef = buildTierRef(tier.id);
  });

  afterEach(() => {
    clearUnhealthy(anthropicProvider.id, CLAUDE_MODEL);
    try { modelTiers.delete(tier.id); } catch { /* noop */ }
    try { modelProviders.delete(googleProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(openaiProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(anthropicProvider.id); } catch { /* noop */ }
    try { projects.delete(project.id); } catch { /* noop */ }
  });

  function createEstablishedTierSession() {
    const row = sessions.create(project.id, 'Lift Session', 'prompt');
    sessions.update(row.id, {
      model: tierRef,
      agentType: 'claude-code',
      resolvedModel: CLAUDE_MODEL,
      resolvedProviderId: anthropicProvider.id,
    });
    messages.create(row.id, 'user', 'hi');
    messages.create(row.id, 'assistant', 'hello');
    return sessions.getById(row.id);
  }

  describe('isTierFailoverLiftable', () => {
    it('lifts claude-code → codex', () => {
      expect(isTierFailoverLiftable('claude-code', GPT_MODEL, openaiProvider.id)).toBe(true);
    });

    it('lifts codex → claude-code', () => {
      expect(isTierFailoverLiftable('codex', CLAUDE_MODEL, anthropicProvider.id)).toBe(true);
    });

    it('blocks any switch involving gemini, either direction', () => {
      expect(isTierFailoverLiftable('claude-code', GEMINI_MODEL, googleProvider.id)).toBe(false);
      expect(isTierFailoverLiftable('gemini', GPT_MODEL, openaiProvider.id)).toBe(false);
    });

    it('rejects tier-ref candidates', () => {
      expect(isTierFailoverLiftable('claude-code', tierRef, null)).toBe(false);
    });

    it('allows same-kind candidates', () => {
      expect(isTierFailoverLiftable('claude-code', CLAUDE_MODEL, anthropicProvider.id)).toBe(true);
    });
  });

  describe('checkContinuationDispatchKind lift', () => {
    it('lifts CROSS_KIND for a cooled-snapshot advance on an established session', () => {
      const session = createEstablishedTierSession();
      markUnhealthy(anthropicProvider.id, CLAUDE_MODEL);
      const candidate = { effectiveModel: GPT_MODEL, providerIdHint: openaiProvider.id };
      expect(checkContinuationDispatchKind(session, session.id, null, candidate)).toBeNull();
    });

    it('keeps the block when the snapshot is not cooled', () => {
      const session = createEstablishedTierSession();
      const candidate = { effectiveModel: GPT_MODEL, providerIdHint: openaiProvider.id };
      expect(checkContinuationDispatchKind(session, session.id, null, candidate)?.error)
        .toBe('CROSS_KIND_MODEL_SWITCH');
    });

    it('keeps the block when the tier disabled automatic failover', () => {
      const session = createEstablishedTierSession();
      modelTiers.update(tier.id, { autoFailoverEnabled: false });
      markUnhealthy(anthropicProvider.id, CLAUDE_MODEL);
      const candidate = { effectiveModel: GPT_MODEL, providerIdHint: openaiProvider.id };
      expect(checkContinuationDispatchKind(session, session.id, null, candidate)?.error)
        .toBe('CROSS_KIND_MODEL_SWITCH');
    });

    it('keeps the block for a gemini advance', () => {
      const geminiTier = modelTiers.create({
        name: 'Gemini Lift Tier',
        members: [
          { providerId: anthropicProvider.id, modelId: CLAUDE_MODEL, position: 0 },
          { providerId: googleProvider.id, modelId: GEMINI_MODEL, position: 1 },
        ],
      });
      try {
        const row = sessions.create(project.id, 'Gemini Lift Session', 'prompt');
        sessions.update(row.id, {
          model: buildTierRef(geminiTier.id),
          agentType: 'claude-code',
          resolvedModel: CLAUDE_MODEL,
          resolvedProviderId: anthropicProvider.id,
        });
        messages.create(row.id, 'user', 'hi');
        messages.create(row.id, 'assistant', 'hello');
        const session = sessions.getById(row.id);
        markUnhealthy(anthropicProvider.id, CLAUDE_MODEL);
        const candidate = { effectiveModel: GEMINI_MODEL, providerIdHint: googleProvider.id };
        expect(checkContinuationDispatchKind(session, session.id, null, candidate)?.error)
          .toBe('CROSS_KIND_MODEL_SWITCH');
      } finally {
        try { modelTiers.delete(geminiTier.id); } catch { /* noop */ }
      }
    });

    it('keeps the block for an explicit different-tier selection', () => {
      const session = createEstablishedTierSession();
      const otherTier = modelTiers.create({
        name: 'Other Lift Tier',
        members: [{ providerId: openaiProvider.id, modelId: GPT_MODEL, position: 0 }],
      });
      try {
        const candidate = { effectiveModel: GPT_MODEL, providerIdHint: openaiProvider.id };
        expect(
          checkContinuationDispatchKind(session, session.id, buildTierRef(otherTier.id), candidate)?.error
        ).toBe('CROSS_KIND_MODEL_SWITCH');
      } finally {
        try { modelTiers.delete(otherTier.id); } catch { /* noop */ }
      }
    });
  });
});
