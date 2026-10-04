import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import ProjectSessionDefaults from './ProjectSessionDefaults.vue';

// Capture websocket subscriptions so tests can simulate server broadcasts
const wsHandlers = {};
vi.mock('../composables/useWebSocket.js', () => ({
  useWebSocket: () => ({
    on: vi.fn((type, cb) => {
      wsHandlers[type] = cb;
    }),
    off: vi.fn((type) => {
      delete wsHandlers[type];
    }),
    onReconnect: vi.fn(() => () => {}),
  }),
}));

vi.mock('../composables/useApi.js', () => ({
  api: {
    getProjectSessionDefaults: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

// Mock ModelSelector as a plain select driving v-model + v-model:provider-id
vi.mock('./ModelSelector.vue', () => ({
  default: {
    name: 'ModelSelector',
    template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="m-a">A</option><option value="m-local">Local</option><option value="m-remote">Remote</option></select>',
    props: ['modelValue', 'providerId'],
    emits: ['update:modelValue', 'update:providerId'],
  },
}));

const canonicalDefaults = {
  mode: null,
  thinkingEnabled: false,
  effortLevel: null,
  startImmediately: true,
  gitMode: null,
  gitBranch: null,
  model: 'm-a',
  providerId: 'p-a',
};

describe('ProjectSessionDefaults - model selection conflict', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    api.getProjectSessionDefaults.mockReset();
    api.getProjectSessionDefaults.mockResolvedValue({ ...canonicalDefaults });
  });

  async function mountAndEditModel() {
    const wrapper = mount(ProjectSessionDefaults, {
      props: { projectId: 'proj-1' },
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('.conflict-banner').exists()).toBe(false);

    // Local unsaved edit
    await wrapper.findComponent({ name: 'ModelSelector' }).find('select').setValue('m-local');
    await nextTick();
    return wrapper;
  }

  it('shows a conflict banner when defaults change under a local edit', async () => {
    const wrapper = await mountAndEditModel();

    wsHandlers['project:defaults_updated']({
      projectId: 'proj-1',
      defaults: { ...canonicalDefaults, model: 'm-remote', providerId: 'p-remote' },
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('.conflict-banner').exists()).toBe(true);
    // Local edit is preserved
    expect(wrapper.findComponent({ name: 'ModelSelector' }).props('modelValue')).toBe('m-local');
  });

  it('Use latest applies the canonical selection and clears the banner', async () => {
    const wrapper = await mountAndEditModel();

    wsHandlers['project:defaults_updated']({
      projectId: 'proj-1',
      defaults: { ...canonicalDefaults, model: 'm-remote', providerId: 'p-remote' },
    });
    await flushPromises();
    await nextTick();
    expect(wrapper.find('.conflict-banner').exists()).toBe(true);

    const buttons = wrapper.find('.conflict-banner').findAll('button');
    await buttons[0].trigger('click');
    await nextTick();

    expect(wrapper.findComponent({ name: 'ModelSelector' }).props('modelValue')).toBe('m-remote');
    expect(wrapper.find('.conflict-banner').exists()).toBe(false);
  });

  it('Keep mine dismisses the banner and preserves the local edit', async () => {
    const wrapper = await mountAndEditModel();

    wsHandlers['project:defaults_updated']({
      projectId: 'proj-1',
      defaults: { ...canonicalDefaults, model: 'm-remote', providerId: 'p-remote' },
    });
    await flushPromises();
    await nextTick();
    expect(wrapper.find('.conflict-banner').exists()).toBe(true);

    const buttons = wrapper.find('.conflict-banner').findAll('button');
    await buttons[1].trigger('click');
    await nextTick();

    expect(wrapper.find('.conflict-banner').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'ModelSelector' }).props('modelValue')).toBe('m-local');
  });

  it('shows no banner when canonical matches the local edit', async () => {
    const wrapper = await mountAndEditModel();

    wsHandlers['project:defaults_updated']({
      projectId: 'proj-1',
      defaults: { ...canonicalDefaults, model: 'm-local', providerId: 'p-a' },
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('.conflict-banner').exists()).toBe(false);
  });

  it('Keep mine cannot dismiss a conflict for a tier that no longer exists', async () => {
    const { useTiersStore } = await import('../stores/tiers.js');
    const { useProvidersStore } = await import('../stores/providers.js');
    // The selected tier was deleted from the catalog while editing.
    api.getProjectSessionDefaults.mockResolvedValue({
      ...canonicalDefaults,
      model: 'tier::t-gone',
      providerId: null,
    });

    const wrapper = mount(ProjectSessionDefaults, {
      props: { projectId: 'proj-1' },
    });
    await flushPromises();
    await nextTick();

    const tiersStore = useTiersStore();
    const providersStore = useProvidersStore();
    tiersStore.tiers = [];
    tiersStore.loaded = true;
    providersStore.providers = [];
    providersStore.loaded = true;
    await nextTick();

    // The invalid selection is visible even without a concurrent edit.
    expect(wrapper.find('.conflict-banner').exists()).toBe(true);
    expect(wrapper.vm.modelSelectionInvalid).toBe(true);

    // A concurrent canonical change raises a conflict; Keep mine must not
    // silently dismiss it while the kept tier does not exist.
    wsHandlers['project:defaults_updated']({
      projectId: 'proj-1',
      defaults: { ...canonicalDefaults, model: 'tier::t-other', providerId: null },
    });
    await flushPromises();
    await nextTick();

    const buttons = wrapper.find('.conflict-banner').findAll('button');
    await buttons[1].trigger('click');
    await nextTick();

    expect(wrapper.find('.conflict-banner').exists()).toBe(true);
    expect(wrapper.vm.modelSelectionInvalid).toBe(true);
  });

  it('surfaces an external non-model change after first load instead of dropping it', async () => {
    const wrapper = mount(ProjectSessionDefaults, {
      props: { projectId: 'proj-1' },
    });
    await flushPromises();
    await nextTick();
    expect(wrapper.find('#defaultMode').element.value).toBe('');

    wsHandlers['project:defaults_updated']({
      projectId: 'proj-1',
      defaults: { ...canonicalDefaults, mode: 'plan' },
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('#defaultMode').element.value).toBe('plan');
  });

  it('keeps a locally edited non-model field and flags a conflict when upstream also moves it', async () => {
    const wrapper = mount(ProjectSessionDefaults, {
      props: { projectId: 'proj-1' },
    });
    await flushPromises();
    await nextTick();

    await wrapper.find('#defaultMode').setValue('yolo');
    wsHandlers['project:defaults_updated']({
      projectId: 'proj-1',
      defaults: { ...canonicalDefaults, mode: 'plan' },
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('#defaultMode').element.value).toBe('yolo');
    expect(wrapper.find('.conflict-banner').exists()).toBe(true);
  });
});
