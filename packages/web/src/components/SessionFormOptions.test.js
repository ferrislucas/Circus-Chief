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
      { agentType: 'claude-code', capabilities: { streaming: true, thinking: true, reasoningEffort: true, toolUse: true, resume: true } },
      { agentType: 'codex', capabilities: { streaming: true, thinking: false, reasoningEffort: true, toolUse: true, resume: false } },
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

  it('enables thinking and effort controls for Anthropic (Claude Code) models after capabilities load', async () => {
    const wrapper = mountForm({ model: 'claude-sonnet-4-6' });
    await flushAll(wrapper);

    const thinkingInput = wrapper.find('input[type="checkbox"]');
    expect(thinkingInput.element.disabled).toBe(false);

    const effortSelect = wrapper.find('select.effort-select, .effort-selector-wrapper select');
    expect(effortSelect.element.disabled).toBe(false);
  });

  it('keeps thinking disabled but enables effort when a Codex model is selected after capabilities load', async () => {
    const wrapper = mountForm({ model: 'gpt-4o' });
    await flushAll(wrapper);

    const thinkingInput = wrapper.find('input[type="checkbox"]');
    expect(thinkingInput.element.disabled).toBe(true);

    const effortSelect = wrapper.find('select.effort-select, .effort-selector-wrapper select');
    expect(effortSelect.element.disabled).toBe(false);
  });

  it('keeps Codex controls conservative before capability fetch resolves', async () => {
    __resetCapabilityCache();
    let resolveAgents;
    api.getAgents.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAgents = resolve;
    }));

    const wrapper = mountForm({ model: 'gpt-4o' });
    await nextTick();

    let thinkingInput = wrapper.find('input[type="checkbox"]');
    let effortSelect = wrapper.find('select.effort-select, .effort-selector-wrapper select');
    expect(thinkingInput.element.disabled).toBe(true);
    expect(effortSelect.element.disabled).toBe(true);

    resolveAgents([
      { agentType: 'claude-code', capabilities: { streaming: true, thinking: true, reasoningEffort: true, toolUse: true, resume: true } },
      { agentType: 'codex', capabilities: { streaming: true, thinking: false, reasoningEffort: true, toolUse: true, resume: false } },
    ]);
    await flushAll(wrapper);

    thinkingInput = wrapper.find('input[type="checkbox"]');
    effortSelect = wrapper.find('select.effort-select, .effort-selector-wrapper select');
    expect(thinkingInput.element.disabled).toBe(true);
    expect(effortSelect.element.disabled).toBe(false);
  });

  it('keeps both controls disabled when capabilities fail to load', async () => {
    __resetCapabilityCache();
    api.getAgents.mockRejectedValueOnce(new Error('network down'));

    const wrapper = mountForm({ model: 'gpt-4o' });
    await flushAll(wrapper);

    const thinkingInput = wrapper.find('input[type="checkbox"]');
    const effortSelect = wrapper.find('select.effort-select, .effort-selector-wrapper select');
    expect(thinkingInput.element.disabled).toBe(true);
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

  it('keeps effort enabled and disables only thinking when switching from Claude to Codex', async () => {
    const wrapper = mountForm({ model: 'claude-sonnet-4-6' });
    await flushAll(wrapper);

    await wrapper.setProps({ model: 'gpt-4o' });
    await flushAll(wrapper);

    const thinkingInput = wrapper.find('input[type="checkbox"]');
    const effortSelect = wrapper.find('select.effort-select, .effort-selector-wrapper select');
    expect(thinkingInput.element.disabled).toBe(true);
    expect(effortSelect.element.disabled).toBe(false);
  });

  it('disables thinking and effort independently for agents without either capability', async () => {
    __resetCapabilityCache();
    api.getAgents.mockResolvedValueOnce([
      { agentType: 'claude-code', capabilities: { streaming: true, thinking: false, reasoningEffort: false, toolUse: true, resume: true } },
      { agentType: 'codex', capabilities: { streaming: true, thinking: false, reasoningEffort: true, toolUse: true, resume: false } },
    ]);

    const wrapper = mountForm({ model: 'claude-sonnet-4-6' });
    await flushAll(wrapper);

    const thinkingInput = wrapper.find('input[type="checkbox"]');
    const effortSelect = wrapper.find('select.effort-select, .effort-selector-wrapper select');
    expect(thinkingInput.element.disabled).toBe(true);
    expect(effortSelect.element.disabled).toBe(true);
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
