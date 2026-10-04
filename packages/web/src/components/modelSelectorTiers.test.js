import { describe, expect, it, vi } from 'vitest';

import {
  isTierSelectable,
  normalizeModelProviderPair,
  resolveDefaultModelId,
  tierDisplayName,
  tierDisplayTitle,
  tierIsStale,
  tierSupportsProviderKinds,
} from './modelSelectorTiers.js';

describe('model selector tier helpers', () => {
  const providersStore = {
    providers: [
      { id: 'anthropic', kind: 'anthropic' },
      { id: 'codex', kind: 'openai' },
      { id: 'legacy' },
    ],
    getById: vi.fn((id) => ({
      anthropic: { kind: 'anthropic' },
      codex: { kind: 'openai' },
      legacy: {},
    })[id]),
  };

  it('only exposes non-empty tiers whose members match the allowed provider kinds', () => {
    expect(tierSupportsProviderKinds({ members: [] }, providersStore)).toBe(false);
    expect(tierSupportsProviderKinds(
      { members: [{ providerId: 'anthropic', available: true }] },
      providersStore
    )).toBe(true);
    expect(tierSupportsProviderKinds(
      { members: [{ providerId: 'anthropic', available: true }, { providerId: 'legacy', available: true }] },
      providersStore,
      ['anthropic']
    )).toBe(true);
    expect(tierSupportsProviderKinds(
      { members: [{ providerId: 'anthropic', available: true }, { providerId: 'codex', available: true }] },
      providersStore,
      ['anthropic']
    )).toBe(true);
    expect(tierSupportsProviderKinds(
      { members: [{ providerId: 'missing', available: true }] },
      providersStore,
      ['anthropic']
    )).toBe(false);
  });

  it('omits tiers whose persisted members are all unavailable', () => {
    expect(tierSupportsProviderKinds(
      { members: [{ providerId: 'anthropic', available: false }] },
      providersStore
    )).toBe(false);
    expect(tierSupportsProviderKinds(
      {
        members: [
          { providerId: 'anthropic', available: false },
          { providerId: 'codex', available: true },
        ],
      },
      providersStore
    )).toBe(true);
  });

  it('uses the tier name when available and the id after deletion', () => {
    const tiersStore = { getById: vi.fn((id) => id === 'healthy' ? { name: 'Healthy' } : null) };

    expect(tierDisplayName('tier::healthy', tiersStore)).toBe('Healthy');
    expect(tierDisplayName('tier::deleted', tiersStore)).toBe('deleted');
  });

  it('treats tier refs permissively before loading and as stale after an empty loaded result', () => {
    expect(tierIsStale('tier::saved', { loaded: false, tiers: [] }, [])).toBe(false);
    expect(tierIsStale('tier::saved', { loaded: true, tiers: [] }, [])).toBe(true);
    expect(tierIsStale('tier::saved', { loaded: true, tiers: [{}] }, [{ id: 'saved' }])).toBe(false);
    expect(tierIsStale('tier::saved', { loaded: true, tiers: [{}] }, [{ id: 'other' }])).toBe(true);
  });

  it('judges selectability by usable members, honoring the kind filter', () => {
    const providers = [
      { id: 'anthropic', kind: 'anthropic' },
      { id: 'codex', kind: 'openai' },
    ];
    // Exists but zero usable members → not selectable.
    expect(isTierSelectable({ id: 't', members: [] }, { providers })).toBe(false);
    expect(isTierSelectable(
      { id: 't', members: [{ providerId: 'anthropic', available: false }] },
      { providers }
    )).toBe(false);
    // ≥1 usable member → selectable.
    expect(isTierSelectable(
      { id: 't', members: [{ providerId: 'anthropic', available: true }] },
      { providers }
    )).toBe(true);
    // Kind filter applies to usable members only.
    expect(isTierSelectable(
      {
        id: 't',
        members: [
          { providerId: 'anthropic', available: true },
          { providerId: 'codex', available: true },
        ],
      },
      { providers, allowedProviderKinds: ['openai'] }
    )).toBe(true);
    expect(isTierSelectable(
      { id: 't', members: [{ providerId: 'anthropic', available: true }] },
      { providers, allowedProviderKinds: ['openai'] }
    )).toBe(false);
    // Unknown provider id fails closed under a kind filter (cannot prove fit).
    expect(isTierSelectable(
      { id: 't', members: [{ providerId: 'ghost', available: true }] },
      { providers, allowedProviderKinds: ['anthropic'] }
    )).toBe(false);
    // ...but stays selectable for unrestricted pickers (server `available` holds).
    expect(isTierSelectable(
      { id: 't', members: [{ providerId: 'ghost', available: true }] },
      { providers }
    )).toBe(true);
  });

  it('normalizes tier pairs to a null provider hint and preserves concrete pairs', () => {
    expect(normalizeModelProviderPair('tier::t-high', 'p-abc')).toEqual({ model: 'tier::t-high', providerId: null });
    expect(normalizeModelProviderPair('tier::t-high', null)).toEqual({ model: 'tier::t-high', providerId: null });
    expect(normalizeModelProviderPair('gpt-5', 'p-openai')).toEqual({ model: 'gpt-5', providerId: 'p-openai' });
    expect(normalizeModelProviderPair('gpt-5', undefined)).toEqual({ model: 'gpt-5', providerId: null });
    expect(normalizeModelProviderPair(null, 'p-openai')).toEqual({ model: null, providerId: 'p-openai' });
  });

  it('resolves the default model like the selector fallback', () => {
    expect(resolveDefaultModelId([])).toBeNull();
    expect(resolveDefaultModelId([{ id: 'x', kind: 'openai', enabled: true, models: [{ modelId: 'gpt-5' }] }])).toBeNull();
    const providers = [
      {
        id: 'custom', kind: 'anthropic', enabled: true,
        models: [{ modelId: 'custom-a', enabled: true }],
      },
      {
        id: 'built-in', kind: 'anthropic', isBuiltIn: true, enabled: true,
        models: [
          { modelId: 'opus-id', tier: 'opus', enabled: true },
          { modelId: 'sonnet-id', tier: 'sonnet', enabled: true },
        ],
      },
    ];
    // Built-in preferred, sonnet-tier model preferred within it.
    expect(resolveDefaultModelId(providers)).toBe('sonnet-id');
    // Disabled providers never qualify.
    expect(resolveDefaultModelId([{ id: 'off', kind: 'anthropic', enabled: false, models: [{ modelId: 'm' }] }])).toBeNull();
    // Legacy providers without a kind still group as Claude Code.
    expect(resolveDefaultModelId([{ id: 'legacy', models: [{ modelId: 'm-legacy' }] }])).toBe('m-legacy');
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
