import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resolveActiveModel,
  hasNextHealthyMember,
  findNextHealthyTierMember,
  resolveTierRefForContinue,
  getTierMembersResolved,
  markUnhealthy,
  isUnhealthy,
  clearUnhealthy,
} from './tierResolutionService.js';
import { modelTiers, modelProviders } from '../database.js';
import { buildTierRef } from '@circuschief/shared';

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

  describe('hasNextHealthyMember', () => {
    it('returns true when another healthy member exists', () => {
      const tier = modelTiers.create({
        name: 'Tier',
        members: [
          { providerId: providerA.id, modelId: 'model-a', position: 0 },
          { providerId: providerB.id, modelId: 'model-b', position: 1 },
        ],
      });

      const tierRef = buildTierRef(tier.id);
      expect(
        hasNextHealthyMember(tierRef, { excludeModelId: 'model-a', excludeProviderId: providerA.id })
      ).toBe(true);
    });

    it('returns false when no other healthy member exists', () => {
      const tier = modelTiers.create({
        name: 'Tier',
        members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
      });

      const tierRef = buildTierRef(tier.id);
      expect(
        hasNextHealthyMember(tierRef, { excludeModelId: 'model-a', excludeProviderId: providerA.id })
      ).toBe(false);
    });

    it('excludes cooled-down members from the healthy count', () => {
      const tier = modelTiers.create({
        name: 'Tier',
        members: [
          { providerId: providerA.id, modelId: 'model-a', position: 0 },
          { providerId: providerB.id, modelId: 'model-b', position: 1 },
        ],
      });
      markUnhealthy(providerB.id, 'model-b');

      const tierRef = buildTierRef(tier.id);
      expect(
        hasNextHealthyMember(tierRef, { excludeModelId: 'model-a', excludeProviderId: providerA.id })
      ).toBe(false);
    });

    it('returns false for an invalid tier ref', () => {
      expect(hasNextHealthyMember('tier::', { excludeModelId: 'x', excludeProviderId: 'y' })).toBe(false);
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

    it('returns null when the attempt cap prevents reaching a member that would otherwise be healthy', () => {
      const tier = buildAbcTier();
      const tierRef = buildTierRef(tier.id);

      // 2 attempts already used, cap is 2 — C exists and is healthy, but the
      // loop will never actually try it.
      const next = findNextHealthyTierMember(
        tierRef,
        { modelId: 'model-b', providerId: providerB.id },
        { attemptsUsed: 2, maxAttempts: 2 }
      );
      expect(next).toBeNull();
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

    it('throws a clear error when the requested tier has no healthy members', () => {
      const tier = modelTiers.create({
        name: 'Tier',
        members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
      });
      markUnhealthy(providerA.id, 'model-a');
      const tierRef = buildTierRef(tier.id);
      const session = { model: 'claude-sonnet-5', resolvedModel: null, resolvedProviderId: null };

      expect(() => resolveTierRefForContinue(session, tierRef)).toThrow(/no healthy members/);
    });

    it('throws a clear error when continuing a tier-bound session with no snapshot and no healthy members', () => {
      const tier = modelTiers.create({
        name: 'Tier',
        members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
      });
      markUnhealthy(providerA.id, 'model-a');
      const session = { model: buildTierRef(tier.id), resolvedModel: null, resolvedProviderId: null };

      expect(() => resolveTierRefForContinue(session, null)).toThrow(/no healthy members/);
    });
  });
});
