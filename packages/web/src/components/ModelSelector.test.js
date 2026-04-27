import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import ModelSelector from './ModelSelector.vue';
import { useProvidersStore } from '../stores/providers.js';
import { CLAUDE_MODELS, OPENAI_MODELS } from '@circuschief/shared';

// Use actual model data from the shared package
const [haiku, sonnet, opusLegacy, opus] = CLAUDE_MODELS;

// Global helper to flush all async updates and force DOM re-render
async function flushAll(wrapper) {
  await flushPromises();
  await nextTick();
  if (wrapper && wrapper.vm) {
    await wrapper.vm.$nextTick?.();
  }
}

describe('ModelSelector', () => {
  let providersStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    providersStore = useProvidersStore();

    // Mock the providers store with a built-in Anthropic provider
    providersStore.providers = [
      {
        id: 'anthropic',
        name: 'Anthropic',
        isBuiltIn: true,
        models: CLAUDE_MODELS.map((model) => ({
          id: `anthropic-${model.id}`,
          modelId: model.id,
          displayName: model.name,
          providerId: 'anthropic',
        })),
      },
    ];

    // Mock the fetch method to prevent API calls
    vi.spyOn(providersStore, 'fetchProviders').mockResolvedValue();
  });

  const mountComponent = (props = {}, attrs = {}) => mount(ModelSelector, {
      props: {
        modelValue: sonnet.id,
        ...props,
      },
      attrs,
    });

  describe('rendering', () => {
    it('renders a select dropdown', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('select').exists()).toBe(true);
    });

    it('renders all four model options', () => {
      const wrapper = mountComponent();
      const options = wrapper.findAll('option');
      expect(options).toHaveLength(4);
    });

    it('displays model names in options', () => {
      const wrapper = mountComponent();
      const options = wrapper.findAll('option');
      expect(options[0].text()).toBe(haiku.name);
      expect(options[1].text()).toBe(sonnet.name);
      expect(options[2].text()).toBe(opusLegacy.name);
      expect(options[3].text()).toBe(opus.name);
    });

    it('sets correct values for options', () => {
      const wrapper = mountComponent();
      const options = wrapper.findAll('option');
      expect(options[0].element.value).toBe(haiku.id);
      expect(options[1].element.value).toBe(sonnet.id);
      expect(options[2].element.value).toBe(opusLegacy.id);
      expect(options[3].element.value).toBe(opus.id);
    });
  });

  describe('selected state', () => {
    it('marks sonnet as selected when modelValue is sonnet', () => {
      const wrapper = mountComponent({ modelValue: sonnet.id });
      const select = wrapper.find('select');
      expect(select.element.value).toBe(sonnet.id);
    });

    it('marks opus as selected when modelValue is opus', () => {
      const wrapper = mountComponent({ modelValue: opus.id });
      const select = wrapper.find('select');
      expect(select.element.value).toBe(opus.id);
    });

    it('marks haiku as selected when modelValue is haiku', () => {
      const wrapper = mountComponent({ modelValue: haiku.id });
      const select = wrapper.find('select');
      expect(select.element.value).toBe(haiku.id);
    });
  });

  describe('interactions', () => {
    it('emits update:modelValue when selection changes', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const select = wrapper.find('select');

      await select.setValue(opus.id);
      await flushAll(wrapper);

      expect(onUpdateModelValue).toHaveBeenCalledWith(opus.id);
    });

    it('emits correct model id for each option', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const select = wrapper.find('select');

      // Changing to opus
      await select.setValue(opus.id);
      await flushAll(wrapper);
      expect(onUpdateModelValue).toHaveBeenCalledWith(opus.id);

      // Changing to haiku
      await select.setValue(haiku.id);
      await flushAll(wrapper);
      expect(onUpdateModelValue).toHaveBeenCalledWith(haiku.id);

      expect(onUpdateModelValue).toHaveBeenCalledTimes(2);
    });

    it('does not emit when selecting the same model', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const select = wrapper.find('select');

      await select.setValue(sonnet.id);
      await flushAll(wrapper);

      expect(onUpdateModelValue).not.toHaveBeenCalled();
    });
  });

  describe('disabled state', () => {
    it('disables select when disabled prop is true', () => {
      const wrapper = mountComponent({ disabled: true });
      const select = wrapper.find('select');
      expect(select.element.disabled).toBe(true);
    });

    it('does not disable select when disabled prop is false', () => {
      const wrapper = mountComponent({ disabled: false });
      const select = wrapper.find('select');
      expect(select.element.disabled).toBe(false);
    });
  });

  describe('optimistic UI updates', () => {
    it('updates selection immediately on change (before async operation)', async () => {
      const wrapper = mountComponent({ modelValue: sonnet.id });
      let select = wrapper.find('select');

      // Initial value
      expect(select.element.value).toBe(sonnet.id);

      // Change to opus
      await select.setValue(opus.id);
      await nextTick();

      select = wrapper.find('select');
      expect(select.element.value).toBe(opus.id);
    });

    it('emits update:modelValue immediately in form context', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const select = wrapper.find('select');

      await select.setValue(opus.id);
      await flushAll(wrapper);

      expect(onUpdateModelValue).toHaveBeenCalledWith(opus.id);
      expect(onUpdateModelValue).toHaveBeenCalledTimes(1);
    });
  });

  describe('watch observer for external changes', () => {
    it('renders correct selected state when mounted with different modelValue props', async () => {
      // Test mounting with sonnet
      const wrapper1 = mountComponent({ modelValue: sonnet.id });
      await flushAll(wrapper1);
      let select = wrapper1.find('select');
      expect(select.element.value).toBe(sonnet.id);
      wrapper1.unmount();

      // Test mounting with opus
      const wrapper2 = mountComponent({ modelValue: opus.id });
      await flushAll(wrapper2);
      select = wrapper2.find('select');
      expect(select.element.value).toBe(opus.id);
      wrapper2.unmount();

      // Test mounting with haiku
      const wrapper3 = mountComponent({ modelValue: haiku.id });
      await flushAll(wrapper3);
      select = wrapper3.find('select');
      expect(select.element.value).toBe(haiku.id);
      wrapper3.unmount();
    });

  });

  describe('form context (v-model binding)', () => {
    it('works correctly with v-model in form context', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );

      let select = wrapper.find('select');

      // Initial state
      expect(select.element.value).toBe(sonnet.id);

      // Change to haiku
      await select.setValue(haiku.id);
      await flushAll(wrapper);

      // Should emit immediately
      expect(onUpdateModelValue).toHaveBeenCalledWith(haiku.id);

      // Visual feedback should be immediate
      select = wrapper.find('select');
      expect(select.element.value).toBe(haiku.id);
    });

    it('updates visual state and emits when user selects different options', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      await flushAll(wrapper);

      let select = wrapper.find('select');
      expect(select.element.value).toBe(sonnet.id);

      // Change to haiku - visual state should update immediately
      await select.setValue(haiku.id);
      await flushAll(wrapper);

      select = wrapper.find('select');
      expect(select.element.value).toBe(haiku.id);

      // Emit should have been called
      expect(onUpdateModelValue).toHaveBeenCalledWith(haiku.id);
    });
  });

  describe('default model behavior', () => {
    it('should respect modelValue when parent sets it after mount', async () => {
      // Simulate the race condition timeline:
      // 1. ModelSelector mounts with null
      // 2. Parent fetches defaults and sets model to 'opus'
      const onUpdateModelValue = vi.fn();

      // Mount with null initially
      const wrapper = mount(ModelSelector, {
        props: { modelValue: null },
        attrs: { 'onUpdate:modelValue': onUpdateModelValue },
      });
      await flushAll(wrapper);

      // Parent sets model from project defaults (simulating defaults fetch completing)
      await wrapper.setProps({ modelValue: opus.id });
      await flushAll(wrapper);

      // The select should show opus, not sonnet
      const select = wrapper.find('select');
      expect(select.element.value).toBe(opus.id);
    });
  });

  describe('allowEmpty prop', () => {
    it('renders an empty option when allowEmpty is true', () => {
      const wrapper = mountComponent({ allowEmpty: true, modelValue: '' });
      const options = wrapper.findAll('option');
      // 1 empty option + 4 model options
      expect(options).toHaveLength(5);
      expect(options[0].text()).toBe('Use system default');
      expect(options[0].element.value).toBe('');
    });

    it('does not render an empty option when allowEmpty is false (default)', () => {
      const wrapper = mountComponent({ modelValue: sonnet.id });
      const options = wrapper.findAll('option');
      expect(options).toHaveLength(4);
    });

    it('uses custom emptyLabel text', () => {
      const wrapper = mountComponent({ allowEmpty: true, emptyLabel: 'No model override', modelValue: '' });
      const options = wrapper.findAll('option');
      expect(options[0].text()).toBe('No model override');
    });

    it('keeps empty value selected when allowEmpty is true and modelValue is empty', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mount(ModelSelector, {
        props: { modelValue: '', allowEmpty: true },
        attrs: { 'onUpdate:modelValue': onUpdateModelValue },
      });
      await flushAll(wrapper);

      const select = wrapper.find('select');
      expect(select.element.value).toBe('');

      // Should NOT auto-select a default model
      expect(onUpdateModelValue).not.toHaveBeenCalled();
    });

    it('emits empty string when user selects the empty option', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mount(ModelSelector, {
        props: { modelValue: sonnet.id, allowEmpty: true },
        attrs: { 'onUpdate:modelValue': onUpdateModelValue },
      });
      await flushAll(wrapper);

      const select = wrapper.find('select');
      await select.setValue('');
      await flushAll(wrapper);

      expect(onUpdateModelValue).toHaveBeenCalledWith('');
    });

    it('allows selecting a concrete model when allowEmpty is true', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mount(ModelSelector, {
        props: { modelValue: '', allowEmpty: true },
        attrs: { 'onUpdate:modelValue': onUpdateModelValue },
      });
      await flushAll(wrapper);

      const select = wrapper.find('select');
      await select.setValue(opus.id);
      await flushAll(wrapper);

      expect(onUpdateModelValue).toHaveBeenCalledWith(opus.id);
    });
  });

  describe('selectClass prop', () => {
    it('uses default model-select class when selectClass is not provided', () => {
      const wrapper = mountComponent();
      const select = wrapper.find('select');
      expect(select.classes()).toContain('model-select');
    });

    it('uses custom class when selectClass is provided', () => {
      const wrapper = mountComponent({ selectClass: 'form-input' });
      const select = wrapper.find('select');
      expect(select.classes()).toContain('form-input');
      expect(select.classes()).not.toContain('model-select');
    });
  });

  describe('provider-based model display', () => {
    it('displays displayName for built-in provider models', async () => {
      const localProvidersStore = useProvidersStore();

      // Mock built-in Anthropic provider with models
      localProvidersStore.providers = [
        {
          id: 'anthropic-default',
          name: 'Anthropic (Official)',
          isBuiltIn: true,
          models: [
            { id: 'anthropic-haiku', modelId: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', tier: 'haiku' },
            { id: 'anthropic-sonnet', modelId: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', tier: 'sonnet' },
            { id: 'anthropic-opus-legacy', modelId: 'claude-opus-4-6', displayName: 'Opus 4.6', tier: 'opus' },
            { id: 'anthropic-opus', modelId: 'claude-opus-4-7', displayName: 'Opus 4.7', tier: 'opus' },
          ],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-4-6' });
      await flushAll(wrapper);

      const options = wrapper.findAll('option');

      // Built-in provider should show displayName
      expect(options[0].text()).toBe('Haiku 4.5');
      expect(options[1].text()).toBe('Sonnet 4.6');
      expect(options[2].text()).toBe('Opus 4.6');
      expect(options[3].text()).toBe('Opus 4.7');
    });

    it('displays modelId for custom provider models', async () => {
      const localProvidersStore = useProvidersStore();

      // Mock custom AWS Bedrock provider with models
      localProvidersStore.providers = [
        {
          id: 'aws-bedrock',
          name: 'AWS Bedrock',
          isBuiltIn: false,
          models: [
            { id: 'bedrock-opus', modelId: 'anthropic.claude-3-opus-20240229-v1:0', displayName: 'Opus', tier: 'opus' },
            { id: 'bedrock-sonnet', modelId: 'anthropic.claude-3-sonnet-20240229-v1:0', displayName: 'Sonnet', tier: 'sonnet' },
            { id: 'bedrock-haiku', modelId: 'anthropic.claude-3-haiku-20240307-v1:0', displayName: 'Haiku', tier: 'haiku' },
          ],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'anthropic.claude-3-sonnet-20240229-v1:0' });
      await flushAll(wrapper);

      const options = wrapper.findAll('option');

      // Custom provider should show modelId instead of displayName
      expect(options[0].text()).toBe('anthropic.claude-3-opus-20240229-v1:0');
      expect(options[1].text()).toBe('anthropic.claude-3-sonnet-20240229-v1:0');
      expect(options[2].text()).toBe('anthropic.claude-3-haiku-20240307-v1:0');
    });

    it('displays different formats for built-in vs custom providers in same dropdown', async () => {
      const localProvidersStore = useProvidersStore();

      // Mock both built-in and custom providers
      localProvidersStore.providers = [
        {
          id: 'anthropic-default',
          name: 'Anthropic (Official)',
          isBuiltIn: true,
          models: [
            { id: 'anthropic-sonnet', modelId: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', tier: 'sonnet' },
          ],
        },
        {
          id: 'aws-bedrock',
          name: 'AWS Bedrock',
          isBuiltIn: false,
          models: [
            { id: 'bedrock-sonnet', modelId: 'anthropic.claude-3-sonnet-20240229-v1:0', displayName: 'Sonnet', tier: 'sonnet' },
          ],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-4-6' });
      await flushAll(wrapper);

      const options = wrapper.findAll('option');

      // Built-in provider shows displayName
      expect(options[0].text()).toBe('Sonnet 4.6');

      // Custom provider shows modelId
      expect(options[1].text()).toBe('anthropic.claude-3-sonnet-20240229-v1:0');
    });
  });

  describe('agent-aware grouping (Phase 6)', () => {
    it('groups built-in Anthropic provider under a "Claude Code · ..." optgroup', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'anthropic-default',
          name: 'Anthropic (Official)',
          isBuiltIn: true,
          kind: 'anthropic',
          models: [
            { id: 'anthropic-sonnet', modelId: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', tier: 'sonnet' },
          ],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-4-6' });
      await flushAll(wrapper);

      const optgroups = wrapper.findAll('optgroup');
      expect(optgroups).toHaveLength(1);
      expect(optgroups[0].attributes('label')).toBe('Claude Code · Anthropic (Official)');
      expect(optgroups[0].attributes('data-agent-type')).toBe('claude-code');
    });

    it('renders "Codex · ..." optgroup for openai-kind providers, sorted after Claude Code', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'openai-prov',
          name: 'OpenAI',
          isBuiltIn: false,
          kind: 'openai',
          models: [{ id: 'o-gpt4o', modelId: 'gpt-4o', displayName: 'GPT-4o' }],
        },
        {
          id: 'anthropic-default',
          name: 'Anthropic',
          isBuiltIn: true,
          kind: 'anthropic',
          models: [{ id: 'a-sonnet', modelId: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', tier: 'sonnet' }],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-4-6' });
      await flushAll(wrapper);

      const labels = wrapper.findAll('optgroup').map((g) => g.attributes('label'));
      expect(labels).toEqual([
        'Claude Code · Anthropic',
        'Codex · OpenAI',
      ]);
    });

    it('renders built-in OpenAI provider as "Codex · OpenAI (Official)" with curated names', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'openai-default',
          name: 'OpenAI (Official)',
          isBuiltIn: true,
          kind: 'openai',
          models: OPENAI_MODELS.map((model) => ({
            id: model.seedId,
            modelId: model.id,
            displayName: model.name,
            tier: 'custom',
          })),
        },
      ];

      const wrapper = mountComponent({ modelValue: null });
      await flushAll(wrapper);

      const optgroups = wrapper.findAll('optgroup');
      expect(optgroups).toHaveLength(1);
      expect(optgroups[0].attributes('label')).toBe('Codex · OpenAI (Official)');
      expect(optgroups[0].attributes('data-agent-type')).toBe('codex');
      expect(wrapper.findAll('option').map((option) => option.text())).toEqual(
        OPENAI_MODELS.map((model) => model.name)
      );
    });

    it('orders built-in Anthropic before custom within the Claude Code group', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'custom-anthropic',
          name: 'Custom Anthropic',
          isBuiltIn: false,
          kind: 'anthropic',
          models: [{ id: 'ca-sonnet', modelId: 'custom-sonnet', displayName: 'Custom Sonnet', tier: 'sonnet' }],
        },
        {
          id: 'anthropic-default',
          name: 'Anthropic (Official)',
          isBuiltIn: true,
          kind: 'anthropic',
          models: [{ id: 'a-sonnet', modelId: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', tier: 'sonnet' }],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-4-6' });
      await flushAll(wrapper);

      const labels = wrapper.findAll('optgroup').map((g) => g.attributes('label'));
      expect(labels[0]).toContain('Anthropic (Official)');
      expect(labels[1]).toContain('Custom Anthropic');
    });

    it('resolves defaultModel to built-in Anthropic sonnet even when Codex providers exist', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'anthropic-default',
          name: 'Anthropic',
          isBuiltIn: true,
          kind: 'anthropic',
          models: [
            { id: 'a-haiku', modelId: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', tier: 'haiku' },
            { id: 'a-sonnet', modelId: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', tier: 'sonnet' },
          ],
        },
        {
          id: 'openai-prov',
          name: 'OpenAI',
          isBuiltIn: false,
          kind: 'openai',
          models: [{ id: 'o-gpt4o', modelId: 'gpt-4o', displayName: 'GPT-4o' }],
        },
      ];

      const onUpdateModelValue = vi.fn();
      const wrapper = mount(ModelSelector, {
        props: { modelValue: null },
        attrs: { 'onUpdate:modelValue': onUpdateModelValue },
      });
      await flushAll(wrapper);

      const select = wrapper.find('select');
      expect(select.element.value).toBe('claude-sonnet-4-6');
    });

    it('keeps Anthropic as the default when both official providers exist', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'anthropic-default',
          name: 'Anthropic (Official)',
          isBuiltIn: true,
          kind: 'anthropic',
          models: [
            { id: 'a-sonnet', modelId: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', tier: 'sonnet' },
          ],
        },
        {
          id: 'openai-default',
          name: 'OpenAI (Official)',
          isBuiltIn: true,
          kind: 'openai',
          models: OPENAI_MODELS.map((model) => ({
            id: model.seedId,
            modelId: model.id,
            displayName: model.name,
            tier: 'custom',
          })),
        },
      ];

      const wrapper = mountComponent({ modelValue: null });
      await flushAll(wrapper);

      expect(wrapper.find('select').element.value).toBe('claude-sonnet-4-6');
    });

    it('leaves defaultModel empty when only Codex providers exist', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'openai-prov',
          name: 'OpenAI',
          isBuiltIn: false,
          kind: 'openai',
          models: [{ id: 'o-gpt4o', modelId: 'gpt-4o', displayName: 'GPT-4o' }],
        },
      ];

      const onUpdateModelValue = vi.fn();
      const wrapper = mount(ModelSelector, {
        props: { modelValue: null },
        attrs: { 'onUpdate:modelValue': onUpdateModelValue },
      });
      await flushAll(wrapper);

      // No Anthropic providers → no silent default → parent is never told
      // "I picked gpt-4o for you".
      expect(onUpdateModelValue).not.toHaveBeenCalledWith('gpt-4o');
    });

    it('keeps Codex model IDs inside Codex optgroup and Claude IDs inside Claude Code optgroup', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'anthropic-default',
          name: 'Anthropic',
          isBuiltIn: true,
          kind: 'anthropic',
          models: [{ id: 'a-sonnet', modelId: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', tier: 'sonnet' }],
        },
        {
          id: 'openai-prov',
          name: 'OpenAI',
          isBuiltIn: false,
          kind: 'openai',
          models: [{ id: 'o-gpt4o', modelId: 'gpt-4o', displayName: 'GPT-4o' }],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-4-6' });
      await flushAll(wrapper);

      const claudeOptGroup = wrapper.findAll('optgroup').find(
        (g) => g.attributes('data-agent-type') === 'claude-code'
      );
      const codexOptGroup = wrapper.findAll('optgroup').find(
        (g) => g.attributes('data-agent-type') === 'codex'
      );

      const claudeValues = claudeOptGroup.findAll('option').map((o) => o.element.value);
      const codexValues = codexOptGroup.findAll('option').map((o) => o.element.value);

      expect(claudeValues).toEqual(['claude-sonnet-4-6']);
      expect(codexValues).toEqual(['gpt-4o']);
      expect(claudeValues).not.toContain('gpt-4o');
      expect(codexValues).not.toContain('claude-sonnet-4-6');
    });

    it('hides duplicate built-in OpenAI options when a custom provider owns the same model ID', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'openai-default',
          name: 'OpenAI (Official)',
          isBuiltIn: true,
          kind: 'openai',
          models: [
            { id: 'openai-gpt-5-5', modelId: 'gpt-5.5', displayName: 'GPT-5.5', tier: 'custom' },
          ],
        },
        {
          id: 'custom-openai',
          name: 'Custom OpenAI',
          isBuiltIn: false,
          kind: 'openai',
          models: [
            { id: 'custom-gpt-5-5', modelId: 'gpt-5.5', displayName: 'Custom GPT-5.5', tier: 'custom' },
          ],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'gpt-5.5' });
      await flushAll(wrapper);

      const optgroups = wrapper.findAll('optgroup');
      expect(optgroups).toHaveLength(1);
      expect(optgroups[0].attributes('label')).toBe('Codex · Custom OpenAI');
      expect(wrapper.findAll('option')).toHaveLength(1);
      expect(wrapper.find('option').element.value).toBe('gpt-5.5');
    });
  });
});
