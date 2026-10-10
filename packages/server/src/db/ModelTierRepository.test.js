import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelTierRepository } from './ModelTierRepository.js';
import { ProviderRepository } from './ProviderRepository.js';
import { MAX_TIER_MEMBERS, MAX_TIER_DESCRIPTION_LENGTH } from '@circuschief/shared';

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

    it('rejects more than MAX_TIER_MEMBERS members at the repository boundary', () => {
      const members = Array.from({ length: MAX_TIER_MEMBERS + 1 }, (_, index) => ({
        providerId: providerA.id,
        modelId: `cap-model-${index}`,
        position: index,
      }));
      expectMemberError(() => repo.create({ name: 'Too Many Members', members }), 'at most 50 members');

      const tier = repo.create({ name: 'Capped Tier', members: [] });
      expectMemberError(() => repo.update(tier.id, { members }), 'at most 50 members');
    });

    it('rejects an overlong description at the repository boundary', () => {
      const overlong = 'x'.repeat(MAX_TIER_DESCRIPTION_LENGTH + 1);
      expectMemberError(
        () => repo.create({ name: 'Long Description', description: overlong }),
        'at most 2000 characters'
      );

      const tier = repo.create({ name: 'Describable Tier' });
      expectMemberError(
        () => repo.update(tier.id, { description: overlong }),
        'at most 2000 characters'
      );
    });

    it('accepts a description at exactly the limit', () => {
      const atLimit = 'x'.repeat(MAX_TIER_DESCRIPTION_LENGTH);
      const tier = repo.create({ name: 'Limit Description', description: atLimit });
      expect(tier.description).toBe(atLimit);
    });
  });

  // Issue #29: tier names are trimmed and unique case-insensitively at the
  // repository boundary (SQLite UNIQUE is BINARY collation, so the schema
  // alone would admit 'Dup' alongside 'dup').
  describe('name normalization', () => {
    function expectTierError(fn, statusCode, messagePart) {
      try {
        fn();
      } catch (error) {
        expect(error.statusCode).toBe(statusCode);
        if (messagePart) expect(error.message).toContain(messagePart);
        return;
      }
      throw new Error('Expected tier validation to throw');
    }

    it('trims tier names on create and update', () => {
      const tier = repo.create({ name: '  Padded Tier  ' });
      expect(tier.name).toBe('Padded Tier');

      const updated = repo.update(tier.id, { name: '  Still Padded  ' });
      expect(updated.name).toBe('Still Padded');
    });

    it('rejects blank names', () => {
      expectTierError(() => repo.create({ name: '   ' }), 400, 'non-empty');

      const tier = repo.create({ name: 'Not Blank' });
      expectTierError(() => repo.update(tier.id, { name: '  ' }), 400, 'non-empty');
    });

    it('rejects case-insensitive duplicate names with 409', () => {
      repo.create({ name: 'Case Tier' });
      expectTierError(() => repo.create({ name: 'case tier' }), 409, 'already exists');
      expectTierError(() => repo.create({ name: '  CASE TIER ' }), 409, 'already exists');
    });

    it('rejects renaming onto another tier name case-insensitively', () => {
      const tier = repo.create({ name: 'First Tier' });
      repo.create({ name: 'Second Tier' });
      expectTierError(() => repo.update(tier.id, { name: 'second tier' }), 409, 'already exists');
    });

    it('allows renaming a tier to a case-variant of its own name', () => {
      const tier = repo.create({ name: 'Own Tier' });
      const updated = repo.update(tier.id, { name: 'OWN TIER' });
      expect(updated.name).toBe('OWN TIER');
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
