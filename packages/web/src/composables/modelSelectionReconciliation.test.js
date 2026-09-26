import { describe, expect, it } from 'vitest';
import { reconcileModelSelection } from './modelSelectionReconciliation.js';

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
