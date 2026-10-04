import { describe, it, expect, beforeEach } from 'vitest';
import { modelProviders } from '../database.js';
import { resolveTierMemberProvider } from './sessionProvider.js';
import { TierIdentityError } from './tierIdentity.js';

// Item 1 centralization (red): tier-derived dispatch must resolve the provider
// through ONE strict rule — exact ownership or a typed error. A stale hint
// must never fall back to a different provider by model id, nor to SDK
// defaults. Non-tier paths keep the legacy `resolveProviderFromModel`
// fallback; this resolver is only for tier-derived pairs.
describe('resolveTierMemberProvider (strict tier identity)', () => {
  let providerA;
  let providerB;

  beforeEach(() => {
    providerA = modelProviders.create({ name: 'Strict Provider A', kind: 'anthropic' });
    providerB = modelProviders.create({ name: 'Strict Provider B', kind: 'openai' });
    modelProviders.addModel(providerA.id, { modelId: 'strict-model', displayName: 'S' });
  });

  it('returns the owning provider on an exact match', () => {
    const provider = resolveTierMemberProvider('strict-model', providerA.id);
    expect(provider?.id).toBe(providerA.id);
  });

  it('throws a typed error when the hint names a provider that does not own the model', () => {
    modelProviders.addModel(providerB.id, { modelId: 'strict-model', displayName: 'S' });
    let error = null;
    try {
      resolveTierMemberProvider('strict-model', 'no-such-provider');
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(TierIdentityError);
    // Must not have fallen back to providerB, which owns the same model id.
    expect(error.code).toBe('provider_missing');
  });

  it('throws when the hint provider exists but owns a different model', () => {
    modelProviders.addModel(providerB.id, { modelId: 'other-model', displayName: 'O' });
    expect(() => resolveTierMemberProvider('strict-model', providerB.id)).toThrow(TierIdentityError);
  });

  it('throws when the hint provider was deleted even though another provider owns the model id', () => {
    modelProviders.addModel(providerB.id, { modelId: 'strict-model', displayName: 'S' });
    const staleProviderId = providerA.id;
    modelProviders.delete(providerA.id);
    let error = null;
    try {
      resolveTierMemberProvider('strict-model', staleProviderId);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(TierIdentityError);
    expect(error.code).toBe('provider_missing');
  });

  it('throws for a missing hint instead of falling back to model-id lookup', () => {
    expect(() => resolveTierMemberProvider('strict-model', null)).toThrow(TierIdentityError);
  });
});
