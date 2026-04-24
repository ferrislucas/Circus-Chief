import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import SessionFormOptions from './SessionFormOptions.vue';
import { useProvidersStore } from '../stores/providers.js';
import { __resetCapabilityCache } from '../composables/useModelInfo.js';
import { api } from '../composables/useApi.js';

async function flushAll(wrapper) {
  await flushPromises();
  await nextTick();
  if (wrapper?.vm) await wrapper.vm.$nextTick?.();
  await flushPromises();
}

describe('SessionFormOptions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    __resetCapabilityCache();

    const providersStore = useProvidersStore();
    providersStore.providers = [
      {
        id: 'anthropic-default',
        name: 'Anthropic',
        isBuiltIn: true,
        kind: 'anthropic',
        models: [
          { id: 'a-sonnet', modelId: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', tier: 'sonnet' },
        ],
      },
      {
        id: 'openai-prov',
        name: 'OpenAI',
        isBuiltIn: false,
        kind: 'openai',
        models: [
          { id: 'o-gpt4o', modelId: 'gpt-4o', displayName: 'GPT-4o' },
        ],
      },
    ];
    vi.spyOn(providersStore, 'fetchProviders').mockResolvedValue();

    vi.spyOn(api, 'getAgents').mockResolvedValue([
      { agentType: 'claude-code', capabilities: { streaming: true, thinking: true, toolUse: true, resume: true } },
      { agentType: 'codex', capabilities: { streaming: true, thinking: false, toolUse: false, resume: false } },
    ]);
  });

  function mountForm(props = {}) {
    return mount(SessionFormOptions, {
      props: {
        mode: 'yolo',
        model: 'claude-sonnet-4-6',
        effortLevel: 'medium',
        thinkingEnabled: true,
        startImmediately: true,
        ...props,
      },
    });
  }

  it('enables the thinking toggle for Anthropic (Claude Code) models', async () => {
    const wrapper = mountForm({ model: 'claude-sonnet-4-6' });
    await flushAll(wrapper);

    const thinkingInput = wrapper.find('input[type="checkbox"]');
    expect(thinkingInput.element.disabled).toBe(false);
  });

  it('disables the thinking toggle and effort selector when a Codex model is selected', async () => {
    const wrapper = mountForm({ model: 'gpt-4o' });
    await flushAll(wrapper);

    const thinkingInput = wrapper.find('input[type="checkbox"]');
    expect(thinkingInput.element.disabled).toBe(true);

    // Effort selector is disabled via its own `disabled` prop.
    const effortSelect = wrapper.find('select.effort-select, .effort-selector-wrapper select');
    expect(effortSelect.element.disabled).toBe(true);
  });

  it('re-enables the thinking toggle after switching back to an Anthropic model', async () => {
    const wrapper = mountForm({ model: 'gpt-4o' });
    await flushAll(wrapper);

    let thinkingInput = wrapper.find('input[type="checkbox"]');
    expect(thinkingInput.element.disabled).toBe(true);

    await wrapper.setProps({ model: 'claude-sonnet-4-6' });
    await flushAll(wrapper);

    thinkingInput = wrapper.find('input[type="checkbox"]');
    expect(thinkingInput.element.disabled).toBe(false);
  });

  it('shows an "Agent: Codex" badge only when a Codex model is selected', async () => {
    const wrapper = mountForm({ model: 'claude-sonnet-4-6' });
    await flushAll(wrapper);
    expect(wrapper.find('[data-agent-badge="codex"]').exists()).toBe(false);

    await wrapper.setProps({ model: 'gpt-4o' });
    await flushAll(wrapper);
    expect(wrapper.find('[data-agent-badge="codex"]').exists()).toBe(true);
  });
});
