import { describe, it, expect, vi } from 'vitest';
import { modelProviders, modelTiers } from './index.js';
import { ProviderRepository } from './ProviderRepository.js';
import { resolveInitialAgentTypeFromModel } from './session-helpers.js';

describe('session-helpers resolveInitialAgentTypeFromModel', () => {
  it('resolves a 10-member tier with a constant small number of queries (no per-member N+1)', () => {
    const providers = new ProviderRepository();
    const providerA = providers.create({ name: 'Provider A', kind: 'anthropic' });
    const providerB = providers.create({ name: 'Provider B', kind: 'openai' });
    for (let i = 0; i < 5; i += 1) {
      providers.addModel(providerA.id, { modelId: `a-${i}`, displayName: `A ${i}` });
      providers.addModel(providerB.id, { modelId: `b-${i}`, displayName: `B ${i}` });
    }
    const members = Array.from({ length: 10 }, (_, i) => (
      i % 2 === 0
        ? { providerId: providerA.id, modelId: `a-${i / 2}`, position: i }
        : { providerId: providerB.id, modelId: `b-${(i - 1) / 2}`, position: i }
    ));
    const tier = modelTiers.create({ name: 'Big Tier', members });

    const prepare = vi.spyOn(modelProviders.db, 'prepare');
    prepare.mockClear();

    expect(resolveInitialAgentTypeFromModel(`tier::${tier.id}`)).toBe('claude-code');
    // Tier load + batched provider/model load + agent-type derivation must
    // stay constant no matter how many members the tier has (2 queries per
    // member before the fix: ~20+ prepares for this tier).
    expect(prepare).toHaveBeenCalledTimes(6);
    prepare.mockRestore();
  });

  it('resolves across providers from the first enabled member', () => {
    const providers = new ProviderRepository();
    const providerA = providers.create({ name: 'Provider A', kind: 'anthropic' });
    const providerB = providers.create({ name: 'Provider B', kind: 'openai' });
    providers.addModel(providerA.id, { modelId: 'a-0', displayName: 'A 0' });
    providers.addModel(providerB.id, { modelId: 'b-0', displayName: 'B 0' });
    const tier = modelTiers.create({
      name: 'Codex First',
      members: [
        { providerId: providerB.id, modelId: 'b-0', position: 0 },
        { providerId: providerA.id, modelId: 'a-0', position: 1 },
      ],
    });

    expect(resolveInitialAgentTypeFromModel(`tier::${tier.id}`)).toBe('codex');
  });
});
