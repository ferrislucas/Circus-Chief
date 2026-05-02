import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import ProviderForm from './ProviderForm.vue';
import { useProvidersStore } from '../stores/providers.js';
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
  async function mountAndOpen({ provider = null } = {}) {
    const wrapper = mount(ProviderForm, {
      props: { isOpen: false, provider },
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
