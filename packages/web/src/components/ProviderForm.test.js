import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import ProviderForm from './ProviderForm.vue';
import { showsMuseProbeModelSection } from '../composables/useProviderForm.js';
import { useProvidersStore } from '../stores/providers.js';
import { useSettingsStore } from '../stores/settings.js';
import { useUiStore } from '../stores/ui.js';

describe('ProviderForm — Phase 5 kind selector', () => {
  let providersStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    providersStore = useProvidersStore();
    useUiStore();

    vi.spyOn(providersStore, 'fetchProviders').mockResolvedValue();
    vi.spyOn(providersStore, 'createProvider').mockResolvedValue({ id: 'new-p' });
    vi.spyOn(providersStore, 'updateProvider').mockResolvedValue({ id: 'p1' });
    vi.spyOn(providersStore, 'addModel').mockResolvedValue();
    vi.spyOn(providersStore, 'updateModel').mockResolvedValue();
    vi.spyOn(providersStore, 'removeModel').mockResolvedValue();
    vi.spyOn(providersStore, 'testConnection').mockResolvedValue({ success: true });
  });

  // Mounts the form closed, then opens it — this triggers the isOpen-watcher
  // inside useProviderForm so form state is properly initialized from props.
  async function mountAndOpen({ provider = null, builtInManage = false } = {}) {
    const wrapper = mount(ProviderForm, {
      props: { isOpen: false, provider, builtInManage },
    });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();
    await nextTick();
    return wrapper;
  }

  it('renders the compatibility selector with both options', async () => {
    const wrapper = await mountAndOpen();

    const select = wrapper.find('#provider-kind');
    expect(select.exists()).toBe(true);
    const options = select.findAll('option').map((o) => o.element.value);
    expect(options).toContain('anthropic');
    expect(options).toContain('openai');
  });

  it('defaults to anthropic and shows ANTHROPIC env-var hints', async () => {
    const wrapper = await mountAndOpen();

    expect(wrapper.find('#provider-kind').element.value).toBe('anthropic');
    expect(wrapper.html()).toContain('ANTHROPIC_BASE_URL');
    expect(wrapper.html()).toContain('ANTHROPIC_AUTH_TOKEN');
    expect(wrapper.html()).not.toContain('OPENAI_BASE_URL');
  });

  it('swaps env-var hint labels when openai is selected', async () => {
    const wrapper = await mountAndOpen();

    await wrapper.find('#provider-kind').setValue('openai');
    await nextTick();

    expect(wrapper.html()).toContain('OPENAI_BASE_URL');
    expect(wrapper.html()).toContain('OPENAI_API_KEY');
    expect(wrapper.html()).not.toContain('ANTHROPIC_BASE_URL');
  });

  it('disables the compatibility selector when editing an existing provider', async () => {
    const wrapper = await mountAndOpen({
      provider: {
        id: 'p1',
        name: 'Existing',
        kind: 'openai',
        baseUrl: null,
        authToken: null,
        apiTimeoutMs: null,
        additionalEnvVars: null,
        models: [],
      },
    });

    const select = wrapper.find('#provider-kind');
    expect(select.attributes('disabled')).toBeDefined();
    expect(select.element.value).toBe('openai');
    expect(wrapper.html()).toContain('Compatibility cannot be changed after creation');
  });

  it('does not show the disabled-note when creating a new provider', async () => {
    const wrapper = await mountAndOpen();

    expect(wrapper.find('#provider-kind').attributes('disabled')).toBeUndefined();
    expect(wrapper.html()).not.toContain('Compatibility cannot be changed after creation');
  });
});

describe('ProviderForm — usage probe model section (meta only)', () => {
  let providersStore;
  let settingsStore;

  const metaProvider = (models) => ({
    id: 'meta-default',
    name: 'Meta (Official)',
    kind: 'meta',
    isBuiltIn: true,
    baseUrl: null,
    authToken: null,
    apiTimeoutMs: null,
    additionalEnvVars: null,
    models,
  });

  const metaModels = () => [
    { id: 'meta-muse-spark-1-3', modelId: 'muse-spark-1.3', displayName: 'Muse Spark 1.3', tier: 'custom', enabled: true },
    { id: 'meta-muse-spark-1-3-contributor', modelId: 'muse-spark-1.3-contributor', displayName: 'Muse Spark 1.3 Contributor', tier: 'custom', enabled: true },
  ];

  beforeEach(() => {
    setActivePinia(createPinia());
    providersStore = useProvidersStore();
    settingsStore = useSettingsStore();
    useUiStore();

    vi.spyOn(providersStore, 'fetchProviders').mockResolvedValue();
    vi.spyOn(providersStore, 'updateProvider').mockResolvedValue({ id: 'meta-default' });
    vi.spyOn(providersStore, 'addModel').mockResolvedValue();
    vi.spyOn(providersStore, 'updateModel').mockResolvedValue();
    vi.spyOn(providersStore, 'removeModel').mockResolvedValue();
    vi.spyOn(providersStore, 'reorderModels').mockResolvedValue();
    vi.spyOn(settingsStore, 'fetchMuseProbeSettings').mockResolvedValue({ probeModel: 'muse-spark-1.3' });
    vi.spyOn(settingsStore, 'updateMuseProbeSettings').mockResolvedValue({ probeModel: 'muse-spark-1.3' });
  });

  async function mountMetaManage({ models = metaModels(), storedProbeModel = 'muse-spark-1.3' } = {}) {
    settingsStore.fetchMuseProbeSettings.mockResolvedValue({ probeModel: storedProbeModel });
    const wrapper = mount(ProviderForm, {
      props: { isOpen: false, provider: metaProvider(models), builtInManage: true },
    });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();
    await nextTick();
    await flushPromises();
    return wrapper;
  }

  it('guards the section to built-in meta providers only', () => {
    expect(showsMuseProbeModelSection({ isBuiltIn: true, kind: 'meta' })).toBe(true);
    expect(showsMuseProbeModelSection({ isBuiltIn: true, kind: 'anthropic' })).toBe(false);
    expect(showsMuseProbeModelSection({ isBuiltIn: true, kind: 'openai' })).toBe(false);
    expect(showsMuseProbeModelSection({ isBuiltIn: true, kind: 'google' })).toBe(false);
    expect(showsMuseProbeModelSection({ isBuiltIn: false, kind: 'meta' })).toBe(false);
    expect(showsMuseProbeModelSection(null)).toBe(false);
  });

  it('renders the probe section below the models list for the meta provider', async () => {
    const wrapper = await mountMetaManage();

    const section = wrapper.find('.probe-model-section');
    expect(section.exists()).toBe(true);
    expect(section.text()).toContain('Usage probe model');
    expect(section.text()).toContain('each probe runs one micro-turn');
    const options = wrapper.findAll('input[name="probe-model"]');
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.element.value)).toEqual(['muse-spark-1.3', 'muse-spark-1.3-contributor']);
  });

  it('preselects the stored probe model', async () => {
    const wrapper = await mountMetaManage({ storedProbeModel: 'muse-spark-1.3-contributor' });

    const checked = wrapper.findAll('input[name="probe-model"]').filter((o) => o.element.checked);
    expect(checked.map((o) => o.element.value)).toEqual(['muse-spark-1.3-contributor']);
  });

  it('preselects the default when nothing is stored', async () => {
    const wrapper = await mountMetaManage({ storedProbeModel: '' });

    const checked = wrapper.findAll('input[name="probe-model"]').filter((o) => o.element.checked);
    expect(checked.map((o) => o.element.value)).toEqual(['muse-spark-1.3']);
  });

  it.each(['anthropic', 'openai', 'google'])('renders no probe section for %s providers', async (kind) => {
    const wrapper = mount(ProviderForm, {
      props: {
        isOpen: true,
        provider: {
          id: 'p1', name: 'Existing', kind, isBuiltIn: true,
          baseUrl: null, authToken: null, apiTimeoutMs: null, additionalEnvVars: null, models: [],
        },
        builtInManage: true,
      },
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('.probe-model-section').exists()).toBe(false);
    expect(wrapper.html()).not.toContain('Usage probe model');
    expect(wrapper.html()).not.toContain('micro-turn');
  });

  it('falls back to the default on save when the stored model was disabled', async () => {
    const models = metaModels().map((model) => (model.modelId === 'muse-spark-1.3-contributor'
      ? { ...model, enabled: false }
      : model));
    const wrapper = await mountMetaManage({ models, storedProbeModel: 'muse-spark-1.3-contributor' });

    const checked = wrapper.findAll('input[name="probe-model"]').filter((o) => o.element.checked);
    expect(checked.map((o) => o.element.value)).toEqual(['muse-spark-1.3']);

    await wrapper.find('.btn-primary').trigger('click');
    await flushPromises();

    expect(settingsStore.updateMuseProbeSettings).toHaveBeenCalledWith({ probeModel: 'muse-spark-1.3' });
  });

  it('persists the selected probe model on save', async () => {
    const wrapper = await mountMetaManage({ storedProbeModel: 'muse-spark-1.3' });

    await wrapper.find('input[name="probe-model"][value="muse-spark-1.3-contributor"]').setValue();
    await wrapper.find('.btn-primary').trigger('click');
    await flushPromises();

    expect(settingsStore.updateMuseProbeSettings).toHaveBeenCalledWith({ probeModel: 'muse-spark-1.3-contributor' });
  });
});
