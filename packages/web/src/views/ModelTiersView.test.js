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

  it('keeps unavailable members in a name-only edit and marks them as unavailable', async () => {
    const providersStore = useProvidersStore();
    const tiersStore = useTiersStore();
    providersStore.providers = [
      { id: 'enabled-provider', name: 'Enabled', enabled: true, models: [{ modelId: 'ready', enabled: true }] },
      { id: 'disabled-provider', name: 'Disabled', enabled: false, models: [{ modelId: 'paused', enabled: true }] },
    ];
    tiersStore.loaded = true;
    tiersStore.tiers = [{
      id: 'tier-1', name: 'Configured tier', description: null,
      members: [
        { id: 'member-1', providerId: 'enabled-provider', modelId: 'ready', position: 0, available: true },
        {
          id: 'member-2', providerId: 'disabled-provider', modelId: 'paused', position: 1,
          available: false, unavailabilityReason: 'provider_disabled',
        },
      ],
    }];
    const updateTier = vi.spyOn(tiersStore, 'updateTier').mockResolvedValue(undefined);

    const wrapper = mount(ModelTiersView, { global: { plugins: [tiersStore.$pinia] } });
    await wrapper.findAll('.btn-ghost').find((button) => button.text() === 'Edit').trigger('click');
    expect(wrapper.text()).toContain('Unavailable: provider disabled');

    await wrapper.get('#tier-name').setValue('Renamed tier');
    await wrapper.find('.modal-actions .btn-primary').trigger('click');

    expect(updateTier).toHaveBeenCalledWith('tier-1', {
      name: 'Renamed tier',
      description: null,
      members: [
        { providerId: 'enabled-provider', modelId: 'ready', position: 0 },
        { providerId: 'disabled-provider', modelId: 'paused', position: 1 },
      ],
    });
  });
});
