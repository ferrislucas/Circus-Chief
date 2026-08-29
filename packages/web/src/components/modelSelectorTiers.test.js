import { describe, expect, it, vi } from 'vitest';

import {
  tierDisplayName,
  tierDisplayTitle,
  tierIsStale,
  tierSupportsProviderKinds,
} from './modelSelectorTiers.js';

describe('model selector tier helpers', () => {
  const providersStore = {
    getById: vi.fn((id) => ({
      anthropic: { kind: 'anthropic' },
      codex: { kind: 'openai' },
      legacy: {},
    })[id]),
  };

  it('only exposes non-empty tiers whose members match the allowed provider kinds', () => {
    expect(tierSupportsProviderKinds({ members: [] }, providersStore)).toBe(false);
    expect(tierSupportsProviderKinds(
      { members: [{ providerId: 'anthropic' }] },
      providersStore
    )).toBe(true);
    expect(tierSupportsProviderKinds(
      { members: [{ providerId: 'anthropic' }, { providerId: 'legacy' }] },
      providersStore,
      ['anthropic']
    )).toBe(true);
    expect(tierSupportsProviderKinds(
      { members: [{ providerId: 'anthropic' }, { providerId: 'codex' }] },
      providersStore,
      ['anthropic']
    )).toBe(false);
    expect(tierSupportsProviderKinds(
      { members: [{ providerId: 'missing' }] },
      providersStore,
      ['anthropic']
    )).toBe(false);
  });

  it('uses the tier name when available and the id after deletion', () => {
    const tiersStore = { getById: vi.fn((id) => id === 'healthy' ? { name: 'Healthy' } : null) };

    expect(tierDisplayName('tier::healthy', tiersStore)).toBe('Healthy');
    expect(tierDisplayName('tier::deleted', tiersStore)).toBe('deleted');
  });

  it('treats tier refs permissively before loading and as stale after loading', () => {
    expect(tierIsStale('tier::saved', { tiers: [] }, [])).toBe(false);
    expect(tierIsStale('tier::saved', { tiers: [{}] }, [{ id: 'saved' }])).toBe(false);
    expect(tierIsStale('tier::saved', { tiers: [{}] }, [{ id: 'other' }])).toBe(true);
  });

  it('describes unresolved, stale, singular, and plural tier bindings', () => {
    const tiersStore = {
      getById: vi.fn((id) => ({
        one: { name: 'Primary', members: [{}] },
        many: { name: 'Fallbacks', members: [{}, {}] },
        empty: { name: 'Empty' },
      })[id]),
    };

    expect(tierDisplayTitle('tier::missing', tiersStore, false)).toBe('Tier: missing');
    expect(tierDisplayTitle('tier::missing', tiersStore, true)).toContain('no longer available');
    expect(tierDisplayTitle('tier::one', tiersStore, false)).toBe('Model tier "Primary" — 1 member');
    expect(tierDisplayTitle('tier::many', tiersStore, false)).toBe('Model tier "Fallbacks" — 2 members');
    expect(tierDisplayTitle('tier::empty', tiersStore, false)).toBe('Model tier "Empty" — 0 members');
  });
});
