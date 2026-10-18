import { describe, expect, it } from 'vitest';
import { reconcileModelSelection, reconcileFormFields, describeSelectionProblem } from './modelSelectionReconciliation.js';

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

describe('reconcileFormFields', () => {
  it('adopts every field on first intake (no previous canonical)', () => {
    expect(reconcileFormFields({
      current: { mode: '', thinkingEnabled: false },
      previousCanonical: null,
      canonical: { mode: 'plan', thinkingEnabled: true },
    })).toEqual({ values: { mode: 'plan', thinkingEnabled: true }, conflicts: [], conflict: false });
  });

  it('adopts untouched fields so external non-model changes surface', () => {
    expect(reconcileFormFields({
      current: { mode: 'plan', thinkingEnabled: true },
      previousCanonical: { mode: 'plan', thinkingEnabled: true },
      canonical: { mode: 'code', thinkingEnabled: true },
    })).toEqual({ values: { mode: 'code', thinkingEnabled: true }, conflicts: [], conflict: false });
  });

  it('keeps user-edited fields and flags a conflict only when upstream also moved', () => {
    // Upstream moved the same field the user edited: keep mine, flag it.
    expect(reconcileFormFields({
      current: { mode: 'yolo', thinkingEnabled: true },
      previousCanonical: { mode: 'plan', thinkingEnabled: true },
      canonical: { mode: 'code', thinkingEnabled: true },
    })).toEqual({ values: { mode: 'yolo', thinkingEnabled: true }, conflicts: ['mode'], conflict: true });
    // Upstream static: keep mine silently, no false conflict.
    expect(reconcileFormFields({
      current: { mode: 'yolo', thinkingEnabled: true },
      previousCanonical: { mode: 'plan', thinkingEnabled: true },
      canonical: { mode: 'plan', thinkingEnabled: false },
    })).toEqual({ values: { mode: 'yolo', thinkingEnabled: false }, conflicts: [], conflict: false });
  });

  it('treats empty and null as the same unset value', () => {
    expect(reconcileFormFields({
      current: { gitBranch: '' },
      previousCanonical: { gitBranch: null },
      canonical: { gitBranch: 'feature/x' },
    })).toEqual({ values: { gitBranch: 'feature/x' }, conflicts: [], conflict: false });
  });
});

describe('describeSelectionProblem', () => {
  const catalog = {
    tiers: [{ id: 't-keep', name: 'Keep', members: [{ providerId: 'p-a', modelId: 'm-a', available: true }] }],
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

  it('flags a tier ref whose tier exists but has zero usable members', () => {
    const emptied = {
      ...catalog,
      tiers: [{ id: 't-empty', name: 'Emptied', members: [] }],
    };
    const problem = describeSelectionProblem({ model: 'tier::t-empty', providerId: null }, emptied);
    expect(problem).not.toBeNull();
    expect(problem.code).toBe('tier-unusable');

    const allUnavailable = {
      ...catalog,
      tiers: [{
        id: 't-dark',
        name: 'Dark',
        members: [{ providerId: 'p-a', modelId: 'm-a', available: false }],
      }],
    };
    expect(
      describeSelectionProblem({ model: 'tier::t-dark', providerId: null }, allUnavailable)
    ).toMatchObject({ code: 'tier-unusable' });
  });

  it('accepts a tier ref with at least one usable member', () => {
    const usable = {
      ...catalog,
      tiers: [{
        id: 't-live',
        name: 'Live',
        members: [{ providerId: 'p-a', modelId: 'm-a', available: true }],
      }],
    };
    expect(describeSelectionProblem({ model: 'tier::t-live', providerId: null }, usable)).toBeNull();
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
