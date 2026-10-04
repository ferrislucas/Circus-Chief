import { describe, expect, it } from 'vitest';
import { reconcileModelSelection, describeSelectionProblem } from './modelSelectionReconciliation.js';

describe('reconcileModelSelection', () => {
  it('updates only an untouched provider/model pair and preserves unrelated edits in the owning form', () => {
    const form = { prompt: 'Unsaved prompt', branch: 'feature/local', mode: 'plan', model: 'tier::high', providerId: null };
    const result = reconcileModelSelection({
      current: form,
      previousCanonical: { model: 'tier::high', providerId: null },
      canonical: { model: 'gpt-5', providerId: 'openai' },
    });

    expect(result).toEqual({ model: 'gpt-5', providerId: 'openai', conflict: false });
    expect(form).toMatchObject({ prompt: 'Unsaved prompt', branch: 'feature/local', mode: 'plan' });
  });

  it('does not overwrite a concurrently edited model selection', () => {
    expect(reconcileModelSelection({
      current: { model: 'claude-local', providerId: 'anthropic' },
      previousCanonical: { model: 'tier::high', providerId: null },
      canonical: { model: 'gpt-5', providerId: 'openai' },
    })).toEqual({ model: 'claude-local', providerId: 'anthropic', conflict: true });
  });
});

describe('describeSelectionProblem', () => {
  const catalog = {
    tiers: [{ id: 't-keep', name: 'Keep', members: [] }],
    tiersLoaded: true,
    providers: [
      {
        id: 'p-a',
        enabled: true,
        models: [
          { modelId: 'm-a', enabled: true },
          { modelId: 'm-off', enabled: false },
        ],
      },
      { id: 'p-off', enabled: false, models: [{ modelId: 'm-b', enabled: true }] },
    ],
    providersLoaded: true,
  };

  it('accepts an empty selection (inherit / system default)', () => {
    expect(describeSelectionProblem({ model: '', providerId: null }, catalog)).toBeNull();
  });

  it('accepts an existing tier ref', () => {
    expect(describeSelectionProblem({ model: 'tier::t-keep', providerId: null }, catalog)).toBeNull();
  });

  it('flags a tier ref whose tier no longer exists', () => {
    const problem = describeSelectionProblem({ model: 'tier::t-gone', providerId: null }, catalog);
    expect(problem).toMatchObject({ code: 'tier-missing' });
  });

  it('accepts an enabled provider/model pair', () => {
    expect(describeSelectionProblem({ model: 'm-a', providerId: 'p-a' }, catalog)).toBeNull();
  });

  it('flags a missing provider', () => {
    expect(describeSelectionProblem({ model: 'm-a', providerId: 'p-gone' }, catalog)).toMatchObject({
      code: 'provider-missing',
    });
  });

  it('flags a disabled provider', () => {
    expect(describeSelectionProblem({ model: 'm-b', providerId: 'p-off' }, catalog)).toMatchObject({
      code: 'provider-disabled',
    });
  });

  it('flags a missing or disabled model', () => {
    expect(describeSelectionProblem({ model: 'm-gone', providerId: 'p-a' }, catalog)).toMatchObject({
      code: 'model-missing',
    });
    expect(describeSelectionProblem({ model: 'm-off', providerId: 'p-a' }, catalog)).toMatchObject({
      code: 'model-disabled',
    });
  });

  it('treats a concrete model without a provider hint as unjudgeable, not invalid', () => {
    expect(describeSelectionProblem({ model: 'm-a', providerId: null }, catalog)).toBeNull();
  });

  it('treats an unloaded catalog as unjudgeable, not invalid', () => {
    expect(
      describeSelectionProblem(
        { model: 'tier::t-gone', providerId: null },
        { ...catalog, tiersLoaded: false }
      )
    ).toBeNull();
    expect(
      describeSelectionProblem(
        { model: 'm-gone', providerId: 'p-gone' },
        { ...catalog, providersLoaded: false }
      )
    ).toBeNull();
  });
});
