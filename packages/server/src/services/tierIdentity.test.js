import { describe, it, expect, beforeEach } from 'vitest';
import { modelProviders } from '../database.js';
import {
  TierIdentityError,
  validateExactTierMember,
  isExactTierMemberValid,
} from './tierIdentity.js';

// Item 1 (red): `{ providerId, modelId }` is one atomic identity. Validation
// must inspect BOTH halves and never resolve a stale pair through a different
// provider that happens to own the same model id.
describe('tierIdentity.validateExactTierMember', () => {
  let providerA;
  let providerB;

  beforeEach(() => {
    providerA = modelProviders.create({ name: 'Identity Provider A', kind: 'anthropic' });
    providerB = modelProviders.create({ name: 'Identity Provider B', kind: 'openai' });
  });

  it('accepts an exact, enabled provider/model pair', () => {
    modelProviders.addModel(providerA.id, { modelId: 'identity-model', displayName: 'M' });
    expect(validateExactTierMember(providerA.id, 'identity-model')).toEqual({
      providerId: providerA.id,
      modelId: 'identity-model',
    });
    expect(isExactTierMemberValid(providerA.id, 'identity-model')).toBe(true);
  });

  it('rejects a pair whose provider no longer exists', () => {
    modelProviders.addModel(providerA.id, { modelId: 'identity-model', displayName: 'M' });
    modelProviders.delete(providerA.id);
    let error = null;
    try {
      validateExactTierMember(providerA.id, 'identity-model');
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(TierIdentityError);
    expect(error.code).toBe('provider_missing');
    expect(isExactTierMemberValid(providerA.id, 'identity-model')).toBe(false);
  });

  it('rejects a pair whose provider is disabled', () => {
    modelProviders.addModel(providerA.id, { modelId: 'identity-model', displayName: 'M' });
    modelProviders.update(providerA.id, { enabled: false });
    let error = null;
    try {
      validateExactTierMember(providerA.id, 'identity-model');
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(TierIdentityError);
    expect(error.code).toBe('provider_disabled');
  });

  it('rejects a pair whose model was removed', () => {
    const model = modelProviders.addModel(providerA.id, { modelId: 'identity-model', displayName: 'M' });
    modelProviders.removeModel(model.id);
    let error = null;
    try {
      validateExactTierMember(providerA.id, 'identity-model');
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(TierIdentityError);
    expect(error.code).toBe('model_missing');
  });

  it('rejects a pair whose model was disabled', () => {
    const model = modelProviders.addModel(providerA.id, { modelId: 'identity-model', displayName: 'M' });
    modelProviders.updateModel(model.id, { enabled: false });
    let error = null;
    try {
      validateExactTierMember(providerA.id, 'identity-model');
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(TierIdentityError);
    expect(error.code).toBe('model_disabled');
  });

  it('treats duplicate model ids as distinct atomic identities', () => {
    modelProviders.addModel(providerA.id, { modelId: 'shared-model', displayName: 'M' });
    modelProviders.addModel(providerB.id, { modelId: 'shared-model', displayName: 'M' });

    // Deleting provider A must invalidate (A, shared-model) even though
    // provider B still owns the same model id — validation must never
    // resolve the stale pair through the surviving provider.
    modelProviders.delete(providerA.id);

    let error = null;
    try {
      validateExactTierMember(providerA.id, 'shared-model');
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(TierIdentityError);
    expect(error.code).toBe('provider_missing');

    // The surviving provider's own identity is unaffected.
    expect(validateExactTierMember(providerB.id, 'shared-model')).toEqual({
      providerId: providerB.id,
      modelId: 'shared-model',
    });
  });

  it('rejects a model id that only exists under a different provider', () => {
    modelProviders.addModel(providerB.id, { modelId: 'other-provider-model', displayName: 'M' });
    let error = null;
    try {
      validateExactTierMember(providerA.id, 'other-provider-model');
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(TierIdentityError);
    expect(error.code).toBe('model_missing');
  });
});
