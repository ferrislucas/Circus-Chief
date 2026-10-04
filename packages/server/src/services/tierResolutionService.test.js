import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveActiveModel,
  resolveAnyMember,
  findNextHealthyTierMember,
  resolveTierRefForContinue,
  getTierMembersResolved,
  evaluateTierMembers,
  markUnhealthy,
  isUnhealthy,
  clearUnhealthy,
  createTierCooldown,
} from './tierResolutionService.js';
import { modelTiers, modelProviders } from '../database.js';
import { buildTierRef } from '@circuschief/shared';
import { TierIdentityError } from './tierIdentity.js';

describe('tierResolutionService', () => {
  let providerA;
  let providerB;

  beforeEach(() => {
    providerA = modelProviders.create({ name: 'Provider A', kind: 'anthropic' });
    providerB = modelProviders.create({ name: 'Provider B', kind: 'openai' });
    // Register the model ids used throughout this suite so that the
    // model-existence filter (Issue 3) doesn't treat them as orphans.
    modelProviders.addModel(providerA.id, { modelId: 'model-a', displayName: 'Model A' });
    modelProviders.addModel(providerB.id, { modelId: 'model-b', displayName: 'Model B' });
  });

  describe('resolveActiveModel', () => {
    it('passes through a non-tier model unchanged', () => {
      const result = resolveActiveModel('claude-sonnet-5', { providerId: providerA.id });
      expect(result).toEqual({ model: 'claude-sonnet-5', providerId: providerA.id });
    });

    it('passes through null/undefined unchanged', () => {
      expect(resolveActiveModel(null)).toEqual({ model: null, providerId: null });
      expect(resolveActiveModel(undefined)).toEqual({ model: undefined, providerId: null });
    });

    it('resolves the first healthy member of a tier', () => {
      const tier = modelTiers.create({
        name: 'Tier',
        members: [
          { providerId: providerA.id, modelId: 'model-a', position: 0 },
          { providerId: providerB.id, modelId: 'model-b', position: 1 },
        ],
      });

      const result = resolveActiveModel(buildTierRef(tier.id));
      expect(result).toEqual({ model: 'model-a', providerId: providerA.id });
    });

    it('skips members in cooldown and returns the next healthy one', () => {
      const tier = modelTiers.create({
        name: 'Tier',
        members: [
          { providerId: providerA.id, modelId: 'model-a', position: 0 },
          { providerId: providerB.id, modelId: 'model-b', position: 1 },
        ],
      });

      markUnhealthy(providerA.id, 'model-a');

      const result = resolveActiveModel(buildTierRef(tier.id));
      expect(result).toEqual({ model: 'model-b', providerId: providerB.id });
    });

    it('returns null when all members are in cooldown', () => {
      const tier = modelTiers.create({
        name: 'Tier',
        members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
      });

      markUnhealthy(providerA.id, 'model-a');

      expect(resolveActiveModel(buildTierRef(tier.id))).toBeNull();
    });

    it('returns null for an empty tier', () => {
      const tier = modelTiers.create({ name: 'Empty' });
      expect(resolveActiveModel(buildTierRef(tier.id))).toBeNull();
    });

    it('returns null for a malformed tier ref', () => {
      expect(resolveActiveModel('tier::')).toBeNull();
    });

    it('filters out members whose provider was deleted', () => {
      const tier = modelTiers.create({
        name: 'Tier',
        members: [
          { providerId: providerA.id, modelId: 'model-a', position: 0 },
          { providerId: providerB.id, modelId: 'model-b', position: 1 },
        ],
      });

      modelProviders.delete(providerA.id);

      // FK cascade removes the member row entirely, so only model-b remains
      const result = resolveActiveModel(buildTierRef(tier.id));
      expect(result).toEqual({ model: 'model-b', providerId: providerB.id });
    });
  });

  describe('resolveAnyMember', () => {
    it('ignores cooldown while still rejecting an empty tier', () => {
      const tier = modelTiers.create({
        name: 'Structurally resolvable',
        members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
      });
      markUnhealthy(providerA.id, 'model-a');

      expect(resolveAnyMember(buildTierRef(tier.id))).toEqual({
        model: 'model-a',
        providerId: providerA.id,
      });

      const emptyTier = modelTiers.create({ name: 'Structurally empty' });
      expect(resolveAnyMember(buildTierRef(emptyTier.id))).toBeNull();
    });
  });

  describe('manual tier selection', () => {
    it('uses the first healthy member instead of a member in cooldown', () => {
      const tier = modelTiers.create({
        name: 'Manual selection cooldown tier',
        members: [
          { providerId: providerA.id, modelId: 'model-a', position: 0 },
          { providerId: providerB.id, modelId: 'model-b', position: 1 },
        ],
      });
      markUnhealthy(providerA.id, 'model-a');

      const selection = resolveTierRefForContinue(
        { model: 'model-a', resolvedModel: null, resolvedProviderId: null },
        buildTierRef(tier.id)
      );

      expect(selection).toMatchObject({
        effectiveModel: 'model-b',
        providerIdHint: providerB.id,
      });
    });
  });

  describe('findNextHealthyTierMember (Fix 5)', () => {
    let providerC;

    beforeEach(() => {
      providerC = modelProviders.create({ name: 'Provider C', kind: 'anthropic' });
      modelProviders.addModel(providerC.id, { modelId: 'model-c', displayName: 'Model C' });
    });

    function buildAbcTier() {
      return modelTiers.create({
        name: 'ABC Tier',
        members: [
          { providerId: providerA.id, modelId: 'model-a', position: 0 },
          { providerId: providerB.id, modelId: 'model-b', position: 1 },
          { providerId: providerC.id, modelId: 'model-c', position: 2 },
        ],
      });
    }

    it('names C when B fails, even though A (an earlier position) is healthy again', () => {
      const tier = buildAbcTier();
      const tierRef = buildTierRef(tier.id);

      // A failed earlier in this run and was cooled, but has since recovered
      // (cooldown cleared) — it must NOT be reconsidered once the loop has
      // moved past its position.
      clearUnhealthy(providerA.id, 'model-a');

      const next = findNextHealthyTierMember(tierRef, { modelId: 'model-b', providerId: providerB.id });
      expect(next).toMatchObject({ providerId: providerC.id, modelId: 'model-c', position: 2 });
    });

    it('skips a cooled-down candidate and returns the next healthy one after it', () => {
      const tier = buildAbcTier();
      const tierRef = buildTierRef(tier.id);
      markUnhealthy(providerB.id, 'model-b');

      // A fails; B (next in position) is in cooldown, so C is the real next attempt.
      const next = findNextHealthyTierMember(tierRef, { modelId: 'model-a', providerId: providerA.id });
      expect(next).toMatchObject({ providerId: providerC.id, modelId: 'model-c', position: 2 });
    });

    it('returns null when no member exists after the failed position', () => {
      const tier = buildAbcTier();
      const tierRef = buildTierRef(tier.id);

      const next = findNextHealthyTierMember(tierRef, { modelId: 'model-c', providerId: providerC.id });
      expect(next).toBeNull();
    });

    it('returns null for an invalid tier ref or an unrecognized failed member', () => {
      const tier = buildAbcTier();
      const tierRef = buildTierRef(tier.id);

      expect(findNextHealthyTierMember('tier::', { modelId: 'model-a', providerId: providerA.id })).toBeNull();
      expect(findNextHealthyTierMember(tierRef, { modelId: 'not-a-member', providerId: 'nope' })).toBeNull();
    });
  });

  describe('stale snapshot continuation (atomic identity)', () => {
    function buildPinnedSession() {
      const tier = modelTiers.create({
        name: 'Pinned Tier',
        members: [
          { providerId: providerA.id, modelId: 'model-a', position: 0 },
          { providerId: providerB.id, modelId: 'model-b', position: 1 },
        ],
      });
      const tierRef = buildTierRef(tier.id);
      return {
        tierRef,
        session: {
          model: tierRef,
          providerId: null,
          resolvedModel: 'model-a',
          resolvedProviderId: providerA.id,
        },
      };
    }

    it('rejects a snapshot whose provider was deleted even though the tier still resolves', () => {
      const { tierRef, session } = buildPinnedSession();
      modelProviders.delete(providerA.id);

      // The tier still has a healthy member — but the pinned pair is gone.
      // Continuation must fail with a typed identity error, never silently
      // reuse the stale snapshot or fall over to the surviving member.
      expect(() => resolveTierRefForContinue(session, null)).toThrow(TierIdentityError);
      try {
        resolveTierRefForContinue(session, null);
      } catch (error) {
        expect(error.code).toBe('provider_missing');
      }
      expect(tierRef).toBe(session.model);
    });

    it('rejects a snapshot whose provider was disabled even though the tier still resolves', () => {
      const { session } = buildPinnedSession();
      modelProviders.update(providerA.id, { enabled: false });

      expect(() => resolveTierRefForContinue(session, null)).toThrow(TierIdentityError);
      try {
        resolveTierRefForContinue(session, null);
      } catch (error) {
        expect(error.code).toBe('provider_disabled');
      }
    });

    it('rejects a snapshot whose model was removed even though the tier still resolves', () => {
      const { session } = buildPinnedSession();
      const modelRow = modelProviders.getById(providerA.id).models.find((m) => m.modelId === 'model-a');
      modelProviders.removeModel(modelRow.id);

      expect(() => resolveTierRefForContinue(session, null)).toThrow(TierIdentityError);
      try {
        resolveTierRefForContinue(session, null);
      } catch (error) {
        expect(error.code).toBe('model_missing');
      }
    });

    it('never dispatches a stale snapshot through a different provider owning the same model id', () => {
      modelProviders.addModel(providerA.id, { modelId: 'dupe-model', displayName: 'Dupe' });
      modelProviders.addModel(providerB.id, { modelId: 'dupe-model', displayName: 'Dupe' });
      const tier = modelTiers.create({
        name: 'Dupe Tier',
        members: [
          { providerId: providerA.id, modelId: 'dupe-model', position: 0 },
          { providerId: providerB.id, modelId: 'model-b', position: 1 },
        ],
      });
      const tierRef = buildTierRef(tier.id);
      const session = {
        model: tierRef,
        providerId: null,
        resolvedModel: 'dupe-model',
        resolvedProviderId: providerA.id,
      };
      modelProviders.delete(providerA.id);

      // providerB owns an identical model id, but the pinned identity
      // (providerA, dupe-model) is gone — this must throw rather than route
      // the conversation through providerB or fall back to SDK defaults.
      expect(() => resolveTierRefForContinue(session, null)).toThrow(TierIdentityError);
    });

    it('still reuses a snapshot whose exact pair remains valid', () => {
      const { session } = buildPinnedSession();
      expect(resolveTierRefForContinue(session, null)).toEqual({
        effectiveModel: 'model-a',
        providerIdHint: providerA.id,
        persist: {},
      });
    });
  });

  describe('getTierMembersResolved', () => {
    it('orders members by position', () => {
      const tier = modelTiers.create({
        name: 'Tier',
        members: [
          { providerId: providerB.id, modelId: 'model-b', position: 1 },
          { providerId: providerA.id, modelId: 'model-a', position: 0 },
        ],
      });

      const members = getTierMembersResolved(tier.id);
      expect(members.map((m) => m.modelId)).toEqual(['model-a', 'model-b']);
    });

    it('returns empty array for nonexistent tier', () => {
      expect(getTierMembersResolved('nonexistent')).toEqual([]);
    });

    it('excludes a member whose model was deleted from an otherwise-present provider (Issue 3)', () => {
      // providerA has two real models; build a tier with both as members.
      const extraModel = modelProviders.addModel(providerA.id, {
        modelId: 'model-a-extra',
        displayName: 'Model A Extra',
      });

      const tier = modelTiers.create({
        name: 'Tier',
        members: [
          { providerId: providerA.id, modelId: 'model-a', position: 0 },
          { providerId: providerA.id, modelId: 'model-a-extra', position: 1 },
        ],
      });

      // Delete only the second model — the provider itself still exists.
      modelProviders.removeModel(extraModel.id);

      const members = getTierMembersResolved(tier.id);
      expect(members.map((m) => m.modelId)).toEqual(['model-a']);
    });

    it('skips disabled members without changing persisted configuration', () => {
      const tier = modelTiers.create({
        name: 'Disabled First Member',
        members: [
          { providerId: providerA.id, modelId: 'model-a', position: 0 },
          { providerId: providerB.id, modelId: 'model-b', position: 1 },
        ],
      });
      modelProviders.update(providerA.id, { enabled: false });

      expect(resolveActiveModel(buildTierRef(tier.id))).toEqual({
        model: 'model-b', providerId: providerB.id,
      });
      expect(modelTiers.getByIdWithMembers(tier.id).members.map((member) => member.modelId)).toEqual([
        'model-a', 'model-b',
      ]);
    });

    it('excluding a deleted model also affects resolveActiveModel', () => {
      const extraModel = modelProviders.addModel(providerA.id, {
        modelId: 'model-a-extra',
        displayName: 'Model A Extra',
      });

      const tier = modelTiers.create({
        name: 'Tier',
        members: [
          { providerId: providerA.id, modelId: 'model-a-extra', position: 0 },
          { providerId: providerB.id, modelId: 'model-b', position: 1 },
        ],
      });

      modelProviders.removeModel(extraModel.id);

      const result = resolveActiveModel(buildTierRef(tier.id));
      expect(result).toEqual({ model: 'model-b', providerId: providerB.id });
    });
  });

  describe('cooldown Map behavior', () => {
    it('markUnhealthy / isUnhealthy / clearUnhealthy round-trip', () => {
      expect(isUnhealthy(providerA.id, 'model-a')).toBe(false);
      markUnhealthy(providerA.id, 'model-a', 10000);
      expect(isUnhealthy(providerA.id, 'model-a')).toBe(true);
      clearUnhealthy(providerA.id, 'model-a');
      expect(isUnhealthy(providerA.id, 'model-a')).toBe(false);
    });

    it('cooldown expires after the configured duration', () => {
      vi.useFakeTimers();
      try {
        markUnhealthy(providerA.id, 'model-a', 1000);
        expect(isUnhealthy(providerA.id, 'model-a')).toBe(true);
        vi.advanceTimersByTime(1001);
        expect(isUnhealthy(providerA.id, 'model-a')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    describe('E2E_TIER_COOLDOWN_MS override', () => {
      const originalOverride = process.env.E2E_TIER_COOLDOWN_MS;

      afterEach(() => {
        if (originalOverride === undefined) {
          delete process.env.E2E_TIER_COOLDOWN_MS;
        } else {
          process.env.E2E_TIER_COOLDOWN_MS = originalOverride;
        }
      });

      // Uses a direct Date.now() spy (rather than vi.useFakeTimers()) so these
      // cases only ever touch the one function this module actually calls —
      // no interaction with any other timer machinery.
      it('an explicit cooldownMs argument always wins over the env override', () => {
        process.env.E2E_TIER_COOLDOWN_MS = '999999';
        const nowSpy = vi.spyOn(Date, 'now');
        try {
          nowSpy.mockReturnValue(1_000_000);
          markUnhealthy(providerA.id, 'model-a', 500);
          nowSpy.mockReturnValue(1_000_501);
          expect(isUnhealthy(providerA.id, 'model-a')).toBe(false);
        } finally {
          nowSpy.mockRestore();
        }
      });

      it('uses the E2E_TIER_COOLDOWN_MS override when no explicit cooldownMs is given', () => {
        process.env.E2E_TIER_COOLDOWN_MS = '500';
        const nowSpy = vi.spyOn(Date, 'now');
        try {
          nowSpy.mockReturnValue(2_000_000);
          markUnhealthy(providerA.id, 'model-a');
          expect(isUnhealthy(providerA.id, 'model-a')).toBe(true);
          nowSpy.mockReturnValue(2_000_501);
          expect(isUnhealthy(providerA.id, 'model-a')).toBe(false);
        } finally {
          nowSpy.mockRestore();
        }
      });

      it('ignores an invalid override and falls back to the production default', () => {
        process.env.E2E_TIER_COOLDOWN_MS = 'not-a-number';
        const nowSpy = vi.spyOn(Date, 'now');
        try {
          nowSpy.mockReturnValue(3_000_000);
          markUnhealthy(providerA.id, 'model-a');
          nowSpy.mockReturnValue(3_000_000 + 1000);
          // Still well within the 5-minute production default.
          expect(isUnhealthy(providerA.id, 'model-a')).toBe(true);
        } finally {
          nowSpy.mockRestore();
        }
      });

      // Issue #26: the override must not take effect in production. The
      // Playwright harness boots the server with NODE_ENV=production
      // (start-server.sh) but sets VCR_MODE, so VCR presence — never active
      // in real use — is the E2E signal.
      describe('production gating', () => {
        const savedNodeEnv = process.env.NODE_ENV;
        const savedVcr = process.env.VCR_MODE;

        afterEach(() => {
          if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
          else process.env.NODE_ENV = savedNodeEnv;
          if (savedVcr === undefined) delete process.env.VCR_MODE;
          else process.env.VCR_MODE = savedVcr;
        });

        it('ignores E2E_TIER_COOLDOWN_MS in production without the test harness', () => {
          process.env.NODE_ENV = 'production';
          delete process.env.VCR_MODE;
          process.env.E2E_TIER_COOLDOWN_MS = '500';
          const nowSpy = vi.spyOn(Date, 'now');
          try {
            nowSpy.mockReturnValue(4_000_000);
            markUnhealthy(providerA.id, 'model-prod-gated');
            nowSpy.mockReturnValue(4_000_501);
            // 500ms override ignored — still within the 5-minute default.
            expect(isUnhealthy(providerA.id, 'model-prod-gated')).toBe(true);
          } finally {
            nowSpy.mockRestore();
          }
        });

        it('honors E2E_TIER_COOLDOWN_MS under the E2E harness (VCR_MODE set)', () => {
          process.env.NODE_ENV = 'production';
          process.env.VCR_MODE = 'replay';
          process.env.E2E_TIER_COOLDOWN_MS = '500';
          const nowSpy = vi.spyOn(Date, 'now');
          try {
            nowSpy.mockReturnValue(5_000_000);
            markUnhealthy(providerA.id, 'model-e2e-harness');
            expect(isUnhealthy(providerA.id, 'model-e2e-harness')).toBe(true);
            nowSpy.mockReturnValue(5_000_501);
            expect(isUnhealthy(providerA.id, 'model-e2e-harness')).toBe(false);
          } finally {
            nowSpy.mockRestore();
          }
        });
      });
    });
  });

  describe('resolveTierRefForContinue (Fix 2)', () => {
    it('passes through a plain concrete session with no explicit request', () => {
      const session = { model: 'claude-sonnet-5', resolvedModel: null, resolvedProviderId: null };
      expect(resolveTierRefForContinue(session, null)).toEqual({
        effectiveModel: 'claude-sonnet-5',
        providerIdHint: null,
        persist: {},
      });
    });

    it('an explicit concrete-model request always clears any stored tier snapshot', () => {
      const tier = modelTiers.create({
        name: 'Tier',
        members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
      });
      const session = {
        model: buildTierRef(tier.id),
        resolvedModel: 'model-a',
        resolvedProviderId: providerA.id,
      };

      const result = resolveTierRefForContinue(session, 'claude-opus-5');
      expect(result.effectiveModel).toBe('claude-opus-5');
      expect(result.providerIdHint).toBeNull();
      expect(result.persist).toEqual({
        model: 'claude-opus-5',
        providerId: null,
        resolvedModel: null,
        resolvedProviderId: null,
      });
    });

    it('reuses the stored snapshot when continuing the currently-bound tier with no explicit request', () => {
      const tier = modelTiers.create({
        name: 'Tier',
        members: [
          { providerId: providerA.id, modelId: 'model-a', position: 0 },
          { providerId: providerB.id, modelId: 'model-b', position: 1 },
        ],
      });
      const tierRef = buildTierRef(tier.id);
      const session = { model: tierRef, resolvedModel: 'model-b', resolvedProviderId: providerB.id };

      const result = resolveTierRefForContinue(session, null);
      expect(result).toEqual({
        effectiveModel: 'model-b',
        providerIdHint: providerB.id,
        persist: {},
      });
    });

    it('re-resolves live and backfills the snapshot when it is missing (legacy row)', () => {
      const tier = modelTiers.create({
        name: 'Tier',
        members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
      });
      const tierRef = buildTierRef(tier.id);
      const session = { model: tierRef, resolvedModel: null, resolvedProviderId: null };

      const result = resolveTierRefForContinue(session, null);
      expect(result).toEqual({
        effectiveModel: 'model-a',
        providerIdHint: providerA.id,
        persist: { resolvedModel: 'model-a', resolvedProviderId: providerA.id },
      });
    });

    it('switching from tier A to tier B ignores tier A\'s snapshot and resolves tier B live', () => {
      const tierA = modelTiers.create({
        name: 'Tier A',
        members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
      });
      const tierB = modelTiers.create({
        name: 'Tier B',
        members: [{ providerId: providerB.id, modelId: 'model-b', position: 0 }],
      });
      const session = {
        model: buildTierRef(tierA.id),
        resolvedModel: 'model-a',
        resolvedProviderId: providerA.id,
      };

      const tierBRef = buildTierRef(tierB.id);
      const result = resolveTierRefForContinue(session, tierBRef);
      expect(result).toEqual({
        effectiveModel: 'model-b',
        providerIdHint: providerB.id,
        persist: { model: tierBRef, resolvedModel: 'model-b', resolvedProviderId: providerB.id },
      });
    });

    it('rejects a newly selected tier when every member is in cooldown', () => {
      const tier = modelTiers.create({
        name: 'Tier',
        members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
      });
      markUnhealthy(providerA.id, 'model-a');
      const tierRef = buildTierRef(tier.id);
      const session = { model: 'claude-sonnet-5', resolvedModel: null, resolvedProviderId: null };

      expect(() => resolveTierRefForContinue(session, tierRef)).toThrow('currently healthy');
    });

    it('ignores cooldown when continuing a tier-bound session without a snapshot', () => {
      const tier = modelTiers.create({
        name: 'Tier',
        members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
      });
      markUnhealthy(providerA.id, 'model-a');
      const session = { model: buildTierRef(tier.id), resolvedModel: null, resolvedProviderId: null };

      expect(resolveTierRefForContinue(session, null)).toEqual({
        effectiveModel: 'model-a',
        providerIdHint: providerA.id,
        persist: { resolvedModel: 'model-a', resolvedProviderId: providerA.id },
      });
    });

    describe('same-tier re-selection reuses the snapshot (PRD E3 / D6)', () => {
      // The web client echoes session.model on a plain follow-up, and the
      // scheduled auto-send consumes pendingModel — both arrive as an explicit
      // tier-ref override that IS the current binding. That must behave like
      // the no-override path: snapshot reuse, no live resolution, persist: {}
      // (so modelChanged stays false and resume/context state is preserved).
      it('reuses the snapshot when the explicit tier request equals session.model, even after the tier was deleted', () => {
        const tier = modelTiers.create({
          name: 'Tier',
          members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
        });
        const tierRef = buildTierRef(tier.id);
        const session = { model: tierRef, resolvedModel: 'model-a', resolvedProviderId: providerA.id };

        modelTiers.delete(tier.id);

        expect(resolveTierRefForContinue(session, tierRef)).toEqual({
          effectiveModel: 'model-a',
          providerIdHint: providerA.id,
          persist: {},
        });
      });

      it('resolves the same tier live when there is no snapshot, refreshing the binding', () => {
        const tier = modelTiers.create({
          name: 'Tier',
          members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
        });
        const tierRef = buildTierRef(tier.id);
        const session = { model: tierRef, resolvedModel: null, resolvedProviderId: null };

        const result = resolveTierRefForContinue(session, tierRef);
        expect(result.effectiveModel).toBe('model-a');
        expect(result.persist).toEqual({
          model: tierRef,
          resolvedModel: 'model-a',
          resolvedProviderId: providerA.id,
        });
      });

      it('still throws for an explicit DIFFERENT unresolvable tier (genuine bad selection)', () => {
        const tierA = modelTiers.create({
          name: 'Tier A',
          members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
        });
        const tierB = modelTiers.create({ name: 'Tier B', members: [] });
        const session = {
          model: buildTierRef(tierA.id),
          resolvedModel: 'model-a',
          resolvedProviderId: providerA.id,
        };

        expect(() => resolveTierRefForContinue(session, buildTierRef(tierB.id))).toThrow(
          /no enabled configured members/
        );
      });
    });
  });

  describe('createTierCooldown (deterministic expiry)', () => {
    it('expires entries with injected time and isolates instances', () => {
      let now = 1_000;
      const cooldown = createTierCooldown({ now: () => now });

      cooldown.markUnhealthy('p', 'm', 500);
      expect(cooldown.isUnhealthy('p', 'm')).toBe(true);
      now += 499;
      expect(cooldown.isUnhealthy('p', 'm')).toBe(true);
      now += 2;
      expect(cooldown.isUnhealthy('p', 'm')).toBe(false);

      const other = createTierCooldown({ now: () => now });
      expect(other.isUnhealthy('p', 'm')).toBe(false);
      other.markUnhealthy('p', 'm', 500);
      expect(other.isUnhealthy('p', 'm')).toBe(true);
      other.clearUnhealthy('p', 'm');
      expect(other.isUnhealthy('p', 'm')).toBe(false);
    });
  });

  describe('getTierMembersResolved batched lookup', () => {
    it('resolves many members across few providers without one query per member', () => {
      for (let i = 0; i < 5; i += 1) {
        modelProviders.addModel(providerA.id, { modelId: `model-a${i}`, displayName: `A${i}` });
        modelProviders.addModel(providerB.id, { modelId: `model-b${i}`, displayName: `B${i}` });
      }
      const tier = modelTiers.create({
        name: 'Tier',
        members: [
          ...[0, 1, 2, 3, 4].map((i) => ({ providerId: providerA.id, modelId: `model-a${i}`, position: i * 2 })),
          ...[0, 1, 2, 3, 4].map((i) => ({ providerId: providerB.id, modelId: `model-b${i}`, position: i * 2 + 1 })),
        ],
      });

      const getByIdSpy = vi.spyOn(modelProviders, 'getById');
      getByIdSpy.mockClear();
      let members;
      try {
        members = getTierMembersResolved(tier.id);
      } finally {
        // Restore before asserting so a failure cannot leak the spy into
        // neighboring tests.
        const calls = getByIdSpy.mock.calls.length;
        getByIdSpy.mockRestore();
        // All ten members resolve in configured order with a batched provider
        // lookup — never one provider-with-models query per member.
        expect(members.map((m) => m.modelId)).toEqual([
          'model-a0', 'model-b0', 'model-a1', 'model-b1', 'model-a2',
          'model-b2', 'model-a3', 'model-b3', 'model-a4', 'model-b4',
        ]);
        expect(calls).toBe(0);
      }
    });

    it('keeps parity for disabled providers/models and missing records', () => {
      // A dangling member row (provider deleted after the tier was written)
      // cannot be inserted directly — member rows carry a provider FK — so
      // delete the provider after creating the tier.
      modelProviders.addModel(providerA.id, { modelId: 'model-off', displayName: 'Off' });
      const offRow = modelProviders.getModels(providerA.id).find((m) => m.modelId === 'model-off');
      modelProviders.updateModel(offRow.id, { enabled: false });
      const providerC = modelProviders.create({ name: 'Provider C', kind: 'anthropic' });
      modelProviders.addModel(providerC.id, { modelId: 'model-c', displayName: 'Model C' });
      const tier = modelTiers.create({
        name: 'Tier',
        members: [
          { providerId: providerA.id, modelId: 'model-a', position: 0 },
          { providerId: providerA.id, modelId: 'model-off', position: 1 },
          { providerId: providerA.id, modelId: 'model-gone', position: 2 },
          { providerId: providerC.id, modelId: 'model-c', position: 3 },
        ],
      });
      modelProviders.delete(providerC.id);

      modelProviders.update(providerB.id, { enabled: false });
      const tier2 = modelTiers.create({
        name: 'Tier 2',
        members: [{ providerId: providerB.id, modelId: 'model-b', position: 0 }],
      });

      expect(getTierMembersResolved(tier.id).map((m) => m.modelId)).toEqual(['model-a']);
      expect(getTierMembersResolved(tier2.id)).toEqual([]);
    });

    it('evaluates missing providers without database setup', () => {
      const members = [
        { providerId: 'p-a', modelId: 'm-a', position: 1 },
        { providerId: 'p-gone', modelId: 'm-a', position: 0 },
      ];
      const providersById = new Map([
        ['p-a', { id: 'p-a', enabled: true, models: [{ modelId: 'm-a', enabled: true }] }],
      ]);

      // The dangling member is filtered; ordering still follows position.
      expect(evaluateTierMembers(members, providersById).map((m) => m.modelId)).toEqual(['m-a']);
    });

    it('ignores the web display-layer unavailable flag: enabled is the single server predicate', () => {
      // `unavailable` has no provider_models column and no server writer —
      // only the web selector sets it (preserved-but-disabled display
      // marking). Server executability is decided by `enabled` alone.
      const members = [{ providerId: 'p-a', modelId: 'm-a', position: 0 }];
      const providersById = new Map([
        ['p-a', { id: 'p-a', enabled: true, models: [{ modelId: 'm-a', enabled: true, unavailable: true }] }],
      ]);

      expect(evaluateTierMembers(members, providersById).map((m) => m.modelId)).toEqual(['m-a']);
    });
  });
});
