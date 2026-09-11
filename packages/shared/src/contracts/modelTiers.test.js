import { describe, it, expect } from 'vitest';
import {
  TIER_REF_PREFIX,
  isTierRef,
  parseTierRef,
  buildTierRef,
  TierMember,
  CreateTierRequest,
  UpdateTierRequest,
  TierResponse,
  TierListResponse,
} from './modelTiers.js';

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID2 = '123e4567-e89b-12d3-a456-426614174001';
const UUID3 = '123e4567-e89b-12d3-a456-426614174002';

describe('Model Tier Contracts', () => {
  describe('tier ref helpers', () => {
    it('exposes the expected prefix', () => {
      expect(TIER_REF_PREFIX).toBe('tier::');
    });

    describe('isTierRef', () => {
      it('returns true for a tier ref string', () => {
        expect(isTierRef('tier::abc')).toBe(true);
      });

      it('returns false for a non-tier string', () => {
        expect(isTierRef('claude-sonnet-5')).toBe(false);
      });

      it('returns false for non-string values', () => {
        expect(isTierRef(null)).toBe(false);
        expect(isTierRef(undefined)).toBe(false);
        expect(isTierRef(42)).toBe(false);
        expect(isTierRef({})).toBe(false);
      });
    });

    describe('parseTierRef', () => {
      it('extracts the tier id from a tier ref', () => {
        expect(parseTierRef('tier::my-tier-id')).toBe('my-tier-id');
      });

      it('returns null for a non-tier string', () => {
        expect(parseTierRef('claude-sonnet-5')).toBe(null);
      });

      it('returns null when the tier ref has no id', () => {
        expect(parseTierRef('tier::')).toBe(null);
      });

      it('returns null for nullish values', () => {
        expect(parseTierRef(null)).toBe(null);
        expect(parseTierRef(undefined)).toBe(null);
      });
    });

    describe('buildTierRef', () => {
      it('builds a tier ref sentinel from an id', () => {
        expect(buildTierRef('abc')).toBe('tier::abc');
      });

      it('round-trips with parseTierRef', () => {
        const ref = buildTierRef('round-trip');
        expect(isTierRef(ref)).toBe(true);
        expect(parseTierRef(ref)).toBe('round-trip');
      });
    });
  });

  describe('TierMember', () => {
    it('accepts a valid member', () => {
      const result = TierMember.safeParse({
        providerId: UUID,
        modelId: 'claude-sonnet-5',
        position: 0,
      });
      expect(result.success).toBe(true);
    });

    it('accepts a non-uuid providerId (built-in providers use fixed ids)', () => {
      const result = TierMember.safeParse({
        providerId: 'anthropic-default',
        modelId: 'claude-sonnet-5',
        position: 0,
      });
      expect(result.success).toBe(true);
    });

    it('rejects an empty providerId', () => {
      const result = TierMember.safeParse({
        providerId: '',
        modelId: 'claude-sonnet-5',
        position: 0,
      });
      expect(result.success).toBe(false);
    });

    it('rejects an empty modelId', () => {
      const result = TierMember.safeParse({
        providerId: UUID,
        modelId: '',
        position: 0,
      });
      expect(result.success).toBe(false);
    });

    it('rejects a non-integer position', () => {
      const result = TierMember.safeParse({
        providerId: UUID,
        modelId: 'claude-sonnet-5',
        position: 1.5,
      });
      expect(result.success).toBe(false);
    });

    it('rejects a negative position', () => {
      const result = TierMember.safeParse({
        providerId: UUID,
        modelId: 'claude-sonnet-5',
        position: -1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CreateTierRequest', () => {
    it('accepts a valid create request', () => {
      const result = CreateTierRequest.safeParse({
        name: 'Fast tier',
        description: 'A tier of fast models',
        members: [{ providerId: UUID, modelId: 'claude-sonnet-5', position: 0 }],
      });
      expect(result.success).toBe(true);
    });

    it('accepts a null description', () => {
      const result = CreateTierRequest.safeParse({
        name: 'Fast tier',
        description: null,
        members: [],
      });
      expect(result.success).toBe(true);
    });

    it('accepts an omitted description', () => {
      const result = CreateTierRequest.safeParse({
        name: 'Fast tier',
        members: [],
      });
      expect(result.success).toBe(true);
    });

    it('rejects an empty name', () => {
      const result = CreateTierRequest.safeParse({
        name: '',
        members: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects a name over 100 characters', () => {
      const result = CreateTierRequest.safeParse({
        name: 'a'.repeat(101),
        members: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing members', () => {
      const result = CreateTierRequest.safeParse({ name: 'Fast tier' });
      expect(result.success).toBe(false);
    });

    it('rejects duplicate provider/model pairs', () => {
      const result = CreateTierRequest.safeParse({
        name: 'Duplicate tier',
        members: [
          { providerId: UUID, modelId: 'same-model', position: 0 },
          { providerId: UUID, modelId: 'same-model', position: 1 },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects gapped, duplicate, and out-of-order positions', () => {
      for (const members of [
        [
          { providerId: UUID, modelId: 'model-a', position: 0 },
          { providerId: UUID2, modelId: 'model-b', position: 2 },
        ],
        [
          { providerId: UUID, modelId: 'model-a', position: 0 },
          { providerId: UUID2, modelId: 'model-b', position: 0 },
        ],
        [
          { providerId: UUID, modelId: 'model-a', position: 1 },
          { providerId: UUID2, modelId: 'model-b', position: 0 },
        ],
      ]) {
        expect(CreateTierRequest.safeParse({ name: 'Malformed tier', members }).success).toBe(false);
      }
    });

    it('accepts an unlimited member list larger than ten', () => {
      const members = Array.from({ length: 11 }, (_, position) => ({
        providerId: `provider-${position}`,
        modelId: `model-${position}`,
        position,
      }));
      expect(CreateTierRequest.safeParse({ name: 'Long tier', members }).success).toBe(true);
    });
  });

  describe('UpdateTierRequest', () => {
    it('accepts a partial update', () => {
      const result = UpdateTierRequest.safeParse({ name: 'Renamed tier' });
      expect(result.success).toBe(true);
    });

    it('accepts an empty object', () => {
      const result = UpdateTierRequest.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts updated members', () => {
      const result = UpdateTierRequest.safeParse({
        members: [{ providerId: UUID, modelId: 'claude-sonnet-5', position: 0 }],
      });
      expect(result.success).toBe(true);
    });

    it('rejects unknown keys (strict)', () => {
      const result = UpdateTierRequest.safeParse({ unknown: true });
      expect(result.success).toBe(false);
    });

    it('rejects an empty name', () => {
      const result = UpdateTierRequest.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('TierResponse', () => {
    const now = Date.now();

    it('accepts a valid tier response', () => {
      const result = TierResponse.safeParse({
        id: UUID,
        name: 'Fast tier',
        description: null,
        members: [
          {
            id: UUID2,
            tierId: UUID,
            providerId: UUID3,
            modelId: 'claude-sonnet-5',
            position: 0,
            createdAt: now,
            available: true,
            providerEnabled: true,
            modelEnabled: true,
            unavailabilityReason: null,
          },
        ],
        createdAt: now,
        updatedAt: now,
      });
      expect(result.success).toBe(true);
    });

    it('rejects a missing member field', () => {
      const result = TierResponse.safeParse({
        id: UUID,
        name: 'Fast tier',
        description: null,
        members: [
          {
            id: UUID2,
            tierId: UUID,
            providerId: UUID3,
            modelId: 'claude-sonnet-5',
            // position missing
            createdAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('TierListResponse', () => {
    const now = Date.now();

    it('accepts an empty list', () => {
      const result = TierListResponse.safeParse([]);
      expect(result.success).toBe(true);
    });

    it('accepts a list of tier responses', () => {
      const result = TierListResponse.safeParse([
        {
          id: UUID,
          name: 'Fast tier',
          description: 'desc',
          members: [],
          createdAt: now,
          updatedAt: now,
        },
      ]);
      expect(result.success).toBe(true);
    });

    it('rejects a non-array value', () => {
      const result = TierListResponse.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
