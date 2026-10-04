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

  // Issue #24: a provider list that is present but carries no models (e.g. a
  // create-response snapshot, or models stripped upstream) must trigger a
  // refetch — otherwise the member picker renders an empty model list.
  it('refetches providers on mount when providers are present but model-less', async () => {
    const providersStore = useProvidersStore();
    const tiersStore = useTiersStore();
    providersStore.providers = [{ id: 'model-less', name: 'Model-less', enabled: true, models: [] }];
    tiersStore.loaded = true;
    const fetchProviders = vi.spyOn(providersStore, 'fetchProviders').mockResolvedValue(undefined);

    mount(ModelTiersView, { global: { plugins: [tiersStore.$pinia] } });
    await flushPromises();

    expect(fetchProviders).toHaveBeenCalled();
  });

  it('does not refetch providers on mount when models are present', async () => {
    const providersStore = useProvidersStore();
    const tiersStore = useTiersStore();
    providersStore.providers = [{
      id: 'with-models', name: 'With models', enabled: true,
      models: [{ modelId: 'ready', displayName: 'Ready', enabled: true }],
    }];
    tiersStore.loaded = true;
    const fetchProviders = vi.spyOn(providersStore, 'fetchProviders').mockResolvedValue(undefined);

    mount(ModelTiersView, { global: { plugins: [tiersStore.$pinia] } });
    await flushPromises();

    expect(fetchProviders).not.toHaveBeenCalled();
  });

  // Issue #24: a provider disabled mid-edit (e.g. by another client) must
  // reconcile onto the in-edit member rows — flagged, never silently kept
  // as healthy, and never dropped from the proposal.
  it('reconciles in-edit member availability when a provider is disabled mid-edit', async () => {
    const providersStore = useProvidersStore();
    const tiersStore = useTiersStore();
    providersStore.providers = [{
      id: 'mid-edit-provider', name: 'Mid-edit', enabled: true,
      models: [{ modelId: 'mid-edit-model', displayName: 'Mid-edit model', enabled: true }],
    }];
    tiersStore.loaded = true;
    tiersStore.tiers = [{
      id: 'tier-mid-edit', name: 'Mid-edit tier', description: null,
      members: [{
        id: 'member-1', providerId: 'mid-edit-provider', modelId: 'mid-edit-model',
        position: 0, available: true, unavailabilityReason: null,
      }],
    }];
    const updateTier = vi.spyOn(tiersStore, 'updateTier').mockResolvedValue(undefined);

    const wrapper = mount(ModelTiersView, { global: { plugins: [tiersStore.$pinia] } });
    await wrapper.findAll('.btn-ghost').find((button) => button.text() === 'Edit').trigger('click');
    expect(wrapper.text()).not.toContain('Unavailable:');

    providersStore.providers = [{
      id: 'mid-edit-provider', name: 'Mid-edit', enabled: false,
      models: [{ modelId: 'mid-edit-model', displayName: 'Mid-edit model', enabled: true }],
    }];
    await flushPromises();

    expect(wrapper.text()).toContain('Unavailable: provider disabled');

    await wrapper.find('.modal-actions .btn-primary').trigger('click');
    expect(updateTier).toHaveBeenCalledWith('tier-mid-edit', {
      name: 'Mid-edit tier',
      description: null,
      members: [{ providerId: 'mid-edit-provider', modelId: 'mid-edit-model', position: 0 }],
    });
  });

  // Issue #23: the tier modal is an accessible dialog — role/aria-modal,
  // labelled reorder controls, initial focus, Escape to close, Tab trapped.
  it('exposes the tier modal as a labelled dialog and focuses the name field', async () => {
    const providersStore = useProvidersStore();
    const tiersStore = useTiersStore();
    providersStore.providers = [{
      id: 'p', name: 'P', enabled: true,
      models: [{ modelId: 'm', displayName: 'M', enabled: true }],
    }];
    tiersStore.loaded = true;
    tiersStore.tiers = [{
      id: 'tier-a11y', name: 'A11y tier', description: null,
      members: [
        { id: 'm1', providerId: 'p', modelId: 'm', position: 0, available: true, unavailabilityReason: null },
        { id: 'm2', providerId: 'p', modelId: 'm', position: 1, available: true, unavailabilityReason: null },
      ],
    }];

    // Attached so .focus() reaches document.activeElement under jsdom.
    const wrapper = mount(ModelTiersView, {
      attachTo: document.body,
      global: { plugins: [tiersStore.$pinia] },
    });
    try {
      await wrapper.findAll('.btn-ghost').find((button) => button.text() === 'Edit').trigger('click');
      await flushPromises();

      const dialog = wrapper.get('[role="dialog"]');
      expect(dialog.attributes('aria-modal')).toBe('true');
      expect(dialog.attributes('aria-labelledby')).toBeTruthy();

      const labels = wrapper.findAll('.member-controls .btn-icon').map((b) => b.attributes('aria-label'));
      expect(labels).toContain('Move m down');
      expect(labels).toContain('Move m up');
      expect(labels.some((label) => label.startsWith('Remove m'))).toBe(true);

      expect(document.activeElement).toBe(wrapper.get('#tier-name').element);
    } finally {
      wrapper.unmount();
    }
  });

  it('closes the tier modal on Escape', async () => {
    const providersStore = useProvidersStore();
    const tiersStore = useTiersStore();
    providersStore.providers = [];
    tiersStore.loaded = true;
    tiersStore.tiers = [];
    vi.spyOn(providersStore, 'fetchProviders').mockResolvedValue(undefined);

    const wrapper = mount(ModelTiersView, { global: { plugins: [tiersStore.$pinia] } });
    await wrapper.get('button.btn-primary').trigger('click');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    await wrapper.get('.modal-overlay').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('traps Tab inside the tier modal', async () => {
    const providersStore = useProvidersStore();
    const tiersStore = useTiersStore();
    providersStore.providers = [];
    tiersStore.loaded = true;
    tiersStore.tiers = [];
    vi.spyOn(providersStore, 'fetchProviders').mockResolvedValue(undefined);

    // Attached so .focus() reaches document.activeElement under jsdom.
    const wrapper = mount(ModelTiersView, {
      attachTo: document.body,
      global: { plugins: [tiersStore.$pinia] },
    });
    try {
      await wrapper.get('button.btn-primary').trigger('click');
      await flushPromises();

      const dialog = wrapper.get('[role="dialog"]');
      const controls = dialog.findAll('input, select, textarea, button')
        .map((c) => c.element)
        .filter((el) => !el.disabled);
      expect(controls.length).toBeGreaterThan(1);

      controls[controls.length - 1].focus();
      await wrapper.get('.modal-overlay').trigger('keydown', { key: 'Tab', shiftKey: false });
      expect(document.activeElement).toBe(controls[0]);

      controls[0].focus();
      await wrapper.get('.modal-overlay').trigger('keydown', { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(controls[controls.length - 1]);
    } finally {
      wrapper.unmount();
    }
  });
});
