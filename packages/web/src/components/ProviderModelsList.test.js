import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ProviderModelsList from './ProviderModelsList.vue';

/**
 * PR #1063 remediation, Slice D (Issue 4, nit): `ProviderModelsList` keyed its
 * `v-for` on `model._serverId || index`, mixing a stable identity (saved rows)
 * with a purely positional one (unsaved rows, which have no `_serverId` yet).
 *
 * Concretely: with two unsaved rows (both keyed by their array index) and one
 * saved row, reordering the two unsaved rows keeps the *key set* unchanged
 * (only which model sits at which key changes). Vue's keyed diff then treats
 * this as "no structural change" and patches each DOM node's props in place
 * *without moving any nodes* -- including whichever node currently has
 * keyboard focus. The result: the focused `<input>` silently starts
 * displaying a *different* model's data mid-edit, because the DOM node
 * followed the *position*, not the model it was created for.
 *
 * With a stable per-row key (`model._serverId || model._localKey`, assigned
 * once when a row is created), the key set is derived from model identity,
 * not position -- so reordering physically *moves* the matched DOM node
 * (carrying focus with it) rather than repainting it with another row's data.
 */
describe('ProviderModelsList row keys (Slice D)', () => {
  let attachedWrapper = null;

  afterEach(() => {
    attachedWrapper?.unmount();
    attachedWrapper = null;
  });

  it('keeps focus + typed value bound to the same unsaved row after it moves position', async () => {
    // Mirrors the shape useProviderForm's addLocalModel() produces: each
    // unsaved row carries a stable `_localKey` assigned once at creation.
    const savedModel = { _serverId: 'server-1', modelId: 'claude-opus-5', displayName: 'Opus 5', tier: 'opus', enabled: true };
    const unsavedA = { _localKey: 'local-key-a', modelId: '', displayName: '', tier: 'custom', enabled: true };
    const unsavedB = { _localKey: 'local-key-b', modelId: '', displayName: '', tier: 'custom', enabled: true };

    const container = document.createElement('div');
    document.body.appendChild(container);

    const wrapper = mount(ProviderModelsList, {
      props: { models: [savedModel, unsavedA, unsavedB] },
      attachTo: container,
    });
    attachedWrapper = wrapper;

    // Focus and type into unsavedA's modelId input (row index 1).
    const rowInputsBefore = wrapper.findAll('.col-model-id.model-input');
    const unsavedAInput = rowInputsBefore[1].element;
    unsavedAInput.focus();
    await rowInputsBefore[1].setValue('my-draft-model-id');
    expect(unsavedA.modelId).toBe('my-draft-model-id');
    expect(document.activeElement).toBe(unsavedAInput);

    // Move unsavedA down one slot (swap with unsavedB), exactly as
    // useProviderForm's moveLocalModel(1, 1) would via the parent re-passing
    // a reordered `models` array.
    await wrapper.setProps({ models: [savedModel, unsavedB, unsavedA] });

    // The element that currently has focus must still be showing unsavedA's
    // typed value -- i.e. focus (and the DOM node) followed the model to its
    // new position, rather than staying pinned to the old position and
    // silently being repainted with unsavedB's (empty) data.
    expect(document.activeElement).not.toBeNull();
    expect(document.activeElement.value).toBe('my-draft-model-id');

    container.remove();
  });
});
