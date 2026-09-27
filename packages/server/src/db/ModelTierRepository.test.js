import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelTierRepository } from './ModelTierRepository.js';
import { ProviderRepository } from './ProviderRepository.js';

describe('ModelTierRepository', () => {
  let repo;
  let providerRepo;
  let providerA;
  let providerB;

  beforeEach(() => {
    repo = new ModelTierRepository();
    providerRepo = new ProviderRepository();
    providerA = providerRepo.create({ name: 'Provider A', kind: 'anthropic' });
    providerB = providerRepo.create({ name: 'Provider B', kind: 'openai' });
  });

  describe('create', () => {
    it('creates a tier with no members', () => {
      const tier = repo.create({ name: 'Empty Tier' });
      expect(tier.id).toBeDefined();
      expect(tier.name).toBe('Empty Tier');
      expect(tier.description).toBeNull();
      expect(tier.members).toEqual([]);
    });

    it('creates a tier with members in position order', () => {
      const tier = repo.create({
        name: 'High Priority',
        description: 'top models',
        members: [
          { providerId: providerA.id, modelId: 'model-a', position: 0 },
          { providerId: providerB.id, modelId: 'model-b', position: 1 },
        ],
      });

      expect(tier.members).toHaveLength(2);
      expect(tier.members[0].modelId).toBe('model-a');
      expect(tier.members[0].providerId).toBe(providerA.id);
      expect(tier.members[1].modelId).toBe('model-b');
    });

    it('enforces unique tier name', () => {
      repo.create({ name: 'Dup' });
      expect(() => repo.create({ name: 'Dup' })).toThrow();
    });
  });

  describe('getAllWithMembers / getByIdWithMembers', () => {
    it('returns all tiers with members', () => {
      repo.create({ name: 'Tier 1', members: [{ providerId: providerA.id, modelId: 'm1', position: 0 }] });
      repo.create({ name: 'Tier 2' });

      const all = repo.getAllWithMembers();
      expect(all).toHaveLength(2);
      const tier1 = all.find((t) => t.name === 'Tier 1');
      expect(tier1.members).toHaveLength(1);
    });

    it('loads all tiers and ordered members with one query', () => {
      repo.create({ name: 'Tier A', members: [{ providerId: providerA.id, modelId: 'a1', position: 1 }] });
      repo.create({ name: 'Tier B', members: [{ providerId: providerB.id, modelId: 'b0', position: 0 }] });
      const prepare = vi.spyOn(repo.db, 'prepare');

      const all = repo.getAllWithMembers();

      expect(prepare).toHaveBeenCalledTimes(1);
      expect(all.map((tier) => tier.name)).toEqual(['Tier A', 'Tier B']);
      expect(all.map((tier) => tier.members[0].modelId)).toEqual(['a1', 'b0']);
    });

    it('returns null for missing tier', () => {
      expect(repo.getByIdWithMembers('nonexistent')).toBeNull();
    });
  });

  describe('update', () => {
    it('updates name and description without touching members', () => {
      const tier = repo.create({
        name: 'Original',
        members: [{ providerId: providerA.id, modelId: 'm1', position: 0 }],
      });

      const updated = repo.update(tier.id, { name: 'Renamed' });
      expect(updated.name).toBe('Renamed');
      expect(updated.members).toHaveLength(1);
    });

    it('replaces members atomically when members provided', () => {
      const tier = repo.create({
        name: 'Tier',
        members: [{ providerId: providerA.id, modelId: 'm1', position: 0 }],
      });

      const updated = repo.update(tier.id, {
        members: [
          { providerId: providerB.id, modelId: 'm2', position: 0 },
          { providerId: providerA.id, modelId: 'm3', position: 1 },
        ],
      });

      expect(updated.members).toHaveLength(2);
      expect(updated.members[0].modelId).toBe('m2');
      expect(updated.members[1].modelId).toBe('m3');
    });

    it('preserves order after reordering members', () => {
      const tier = repo.create({
        name: 'Tier',
        members: [
          { providerId: providerA.id, modelId: 'm1', position: 0 },
          { providerId: providerB.id, modelId: 'm2', position: 1 },
        ],
      });

      // Swap order
      const updated = repo.update(tier.id, {
        members: [
          { providerId: providerB.id, modelId: 'm2', position: 0 },
          { providerId: providerA.id, modelId: 'm1', position: 1 },
        ],
      });

      expect(updated.members.map((m) => m.modelId)).toEqual(['m2', 'm1']);
    });

    it('returns null for missing tier', () => {
      expect(repo.update('nonexistent', { name: 'x' })).toBeNull();
    });
  });

  describe('member validation', () => {
    function expectMemberError(fn, messagePart) {
      try {
        fn();
      } catch (error) {
        expect(error.statusCode).toBe(400);
        if (messagePart) expect(error.message).toContain(messagePart);
        return;
      }
      throw new Error('Expected member validation to throw');
    }

    it('rejects duplicate provider/model pairs instead of a raw UNIQUE error', () => {
      expectMemberError(() => repo.create({
        name: 'Dup Pair',
        members: [
          { providerId: providerA.id, modelId: 'm1', position: 0 },
          { providerId: providerA.id, modelId: 'm1', position: 1 },
        ],
      }), 'Duplicate tier member');
    });

    it('rejects duplicate positions instead of a raw UNIQUE error', () => {
      expectMemberError(() => repo.create({
        name: 'Dup Position',
        members: [
          { providerId: providerA.id, modelId: 'm1', position: 0 },
          { providerId: providerB.id, modelId: 'm2', position: 0 },
        ],
      }), 'Duplicate tier member position');
    });

    it('rejects empty providerId and modelId', () => {
      expectMemberError(() => repo.create({
        name: 'Empty Provider',
        members: [{ providerId: '', modelId: 'm1', position: 0 }],
      }), 'providerId');
      expectMemberError(() => repo.create({
        name: 'Empty Model',
        members: [{ providerId: providerA.id, modelId: '', position: 0 }],
      }), 'modelId');
    });

    it('rejects tier-ref modelIds', () => {
      expectMemberError(() => repo.create({
        name: 'Tier Ref Member',
        members: [{ providerId: providerA.id, modelId: 'tier::other', position: 0 }],
      }), 'tier::');
    });

    it('rejects negative positions', () => {
      expectMemberError(() => repo.create({
        name: 'Negative Position',
        members: [{ providerId: providerA.id, modelId: 'm1', position: -1 }],
      }), 'position');
    });

    it('defaults a missing position to array order instead of colliding on 0', () => {
      const tier = repo.create({
        name: 'Missing Positions',
        members: [
          { providerId: providerA.id, modelId: 'm1' },
          { providerId: providerB.id, modelId: 'm2' },
        ],
      });
      expect(tier.members.map((m) => m.position)).toEqual([0, 1]);
    });

    it('validates replacement members on update', () => {
      const tier = repo.create({
        name: 'Tier',
        members: [{ providerId: providerA.id, modelId: 'm1', position: 0 }],
      });
      expectMemberError(() => repo.update(tier.id, {
        members: [
          { providerId: providerB.id, modelId: 'm2', position: 0 },
          { providerId: providerB.id, modelId: 'm2', position: 1 },
        ],
      }), 'Duplicate tier member');
    });
  });

  describe('delete', () => {
    it('cascades to members', () => {
      const tier = repo.create({
        name: 'ToDelete',
        members: [{ providerId: providerA.id, modelId: 'm1', position: 0 }],
      });

      repo.delete(tier.id);
      expect(repo.getByIdWithMembers(tier.id)).toBeNull();
    });
  });

  describe('findTiersReferencingProvider / findTiersReferencingModel', () => {
    it('finds tiers referencing a provider', () => {
      repo.create({ name: 'Tier A', members: [{ providerId: providerA.id, modelId: 'm1', position: 0 }] });
      repo.create({ name: 'Tier B', members: [{ providerId: providerB.id, modelId: 'm2', position: 0 }] });

      const referencing = repo.findTiersReferencingProvider(providerA.id);
      expect(referencing).toHaveLength(1);
      expect(referencing[0].name).toBe('Tier A');
    });

    it('finds tiers referencing a specific model', () => {
      repo.create({ name: 'Tier A', members: [{ providerId: providerA.id, modelId: 'm1', position: 0 }] });

      const referencing = repo.findTiersReferencingModel(providerA.id, 'm1');
      expect(referencing).toHaveLength(1);

      const none = repo.findTiersReferencingModel(providerA.id, 'nonexistent-model');
      expect(none).toHaveLength(0);
    });
  });

  describe('provider cascade delete', () => {
    it('removes members when the owning provider is deleted', () => {
      const tier = repo.create({
        name: 'Tier',
        members: [
          { providerId: providerA.id, modelId: 'm1', position: 0 },
          { providerId: providerB.id, modelId: 'm2', position: 1 },
        ],
      });

      providerRepo.delete(providerA.id);

      const reloaded = repo.getByIdWithMembers(tier.id);
      expect(reloaded.members).toHaveLength(1);
      expect(reloaded.members[0].providerId).toBe(providerB.id);
    });
  });
});
