import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resolveActiveModel,
  hasNextHealthyMember,
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
});
