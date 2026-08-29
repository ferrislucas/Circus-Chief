import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ModelTiersView from './ModelTiersView.vue';
import { useProvidersStore } from '../stores/providers.js';
import { useTiersStore } from '../stores/tiers.js';

describe('ModelTiersView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('only offers executable models when adding tier members', async () => {
    const providersStore = useProvidersStore();
    const tiersStore = useTiersStore();
    vi.spyOn(providersStore, 'fetchProviders').mockResolvedValue(undefined);
    vi.spyOn(tiersStore, 'fetchTiers').mockResolvedValue(undefined);
    providersStore.providers = [
      {
        id: 'enabled-provider', name: 'Enabled', enabled: true,
        models: [
          { modelId: 'ready', displayName: 'Ready', enabled: true },
          { modelId: 'disabled', displayName: 'Disabled', enabled: false },
          { modelId: 'unavailable', displayName: 'Unavailable', unavailable: true },
        ],
      },
      {
        id: 'disabled-provider', name: 'Disabled provider', enabled: false,
        models: [{ modelId: 'hidden', displayName: 'Hidden', enabled: true }],
      },
    ];

    const wrapper = mount(ModelTiersView, { global: { plugins: [useTiersStore().$pinia] } });
    await wrapper.get('button.btn-primary').trigger('click');
    await flushPromises();

    const options = wrapper.findAll('.member-select option').map((option) => option.text());
    expect(options).toContain('Ready');
    expect(options).not.toContain('Disabled');
    expect(options).not.toContain('Unavailable');
    expect(options).not.toContain('Hidden');
    expect(wrapper.find('.member-select').html()).not.toContain('Disabled provider');
  });
});
