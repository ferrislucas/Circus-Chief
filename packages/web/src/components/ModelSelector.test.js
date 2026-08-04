import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import ModelSelector from './ModelSelector.vue';
import { useProvidersStore } from '../stores/providers.js';
import { useTiersStore } from '../stores/tiers.js';
import { CLAUDE_MODELS, OPENAI_MODELS } from '@circuschief/shared';

// Use actual model data from the shared package. This suite was written
// against a fixed six-model Anthropic fixture; exclude claude-opus-5 (added
// as the new current default alongside Opus 4.8's reclassification to
// 'older') so the rendering/count assertions below keep testing generic
// ModelSelector behavior rather than tracking the live catalog's exact size.
const CLAUDE_MODELS_FIXTURE = CLAUDE_MODELS.filter((model) => model.id !== 'claude-opus-5');
const [fable, haiku, sonnet, opusLegacy, opus47, opus] = CLAUDE_MODELS_FIXTURE;
const optionValue = (providerId, modelId) => `${providerId}::${modelId}`;

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
        models: CLAUDE_MODELS_FIXTURE.map((model) => ({
          id: `anthropic-${model.id}`,
          modelId: model.id,
          displayName: model.name,
          providerId: 'anthropic',
        })),
      },
    ];

    // Mock the fetch method to prevent API calls
    vi.spyOn(providersStore, 'fetchProviders').mockResolvedValue();

    // Mock the tiers store fetch to prevent real API calls; individual tier
    // tests below override `tiersStore.tiers` directly before mounting.
    const tiersStore = useTiersStore();
    vi.spyOn(tiersStore, 'fetchTiers').mockResolvedValue();
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

    it('renders all six model options', () => {
      const wrapper = mountComponent();
      const options = wrapper.findAll('option');
      expect(options).toHaveLength(6);
    });

    it('displays model names in options', () => {
      const wrapper = mountComponent();
      const options = wrapper.findAll('option');
      expect(options[0].text()).toBe(fable.name);
      expect(options[1].text()).toBe(haiku.name);
      expect(options[2].text()).toBe(sonnet.name);
      expect(options[3].text()).toBe(opusLegacy.name);
      expect(options[4].text()).toBe(opus47.name);
      expect(options[5].text()).toBe(opus.name);
    });

    it('sets correct values for options', () => {
      const wrapper = mountComponent();
      const options = wrapper.findAll('option');
      expect(options[0].element.value).toBe(optionValue('anthropic', fable.id));
      expect(options[1].element.value).toBe(optionValue('anthropic', haiku.id));
      expect(options[2].element.value).toBe(optionValue('anthropic', sonnet.id));
      expect(options[3].element.value).toBe(optionValue('anthropic', opusLegacy.id));
      expect(options[4].element.value).toBe(optionValue('anthropic', opus47.id));
      expect(options[5].element.value).toBe(optionValue('anthropic', opus.id));
    });
  });

  describe('selected state', () => {
    it('marks sonnet as selected when modelValue is sonnet', () => {
      const wrapper = mountComponent({ modelValue: sonnet.id });
      const select = wrapper.find('select');
      expect(select.element.value).toBe(optionValue('anthropic', sonnet.id));
    });

    it('marks opus as selected when modelValue is opus', () => {
      const wrapper = mountComponent({ modelValue: opus.id });
      const select = wrapper.find('select');
      expect(select.element.value).toBe(optionValue('anthropic', opus.id));
    });

    it('marks haiku as selected when modelValue is haiku', () => {
      const wrapper = mountComponent({ modelValue: haiku.id });
      const select = wrapper.find('select');
      expect(select.element.value).toBe(optionValue('anthropic', haiku.id));
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

      await select.setValue(optionValue('anthropic', opus.id));
      await flushAll(wrapper);

      expect(onUpdateModelValue).toHaveBeenCalledWith(opus.id);
    });

    it('emits provider metadata when selection changes', async () => {
      const onModelSelected = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { onModelSelected }
      );

      await wrapper.find('select').setValue(optionValue('anthropic', opus.id));
      await flushAll(wrapper);

      expect(onModelSelected).toHaveBeenCalledWith({
        modelId: opus.id,
        providerId: 'anthropic',
        kind: 'anthropic',
      });
    });

    it('emits correct model id for each option', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const select = wrapper.find('select');

      // Changing to opus
      await select.setValue(optionValue('anthropic', opus.id));
      await flushAll(wrapper);
      expect(onUpdateModelValue).toHaveBeenCalledWith(opus.id);

      // Changing to haiku
      await select.setValue(optionValue('anthropic', haiku.id));
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

      await select.setValue(optionValue('anthropic', sonnet.id));
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
      expect(select.element.value).toBe(optionValue('anthropic', sonnet.id));

      // Change to opus
      await select.setValue(optionValue('anthropic', opus.id));
      await nextTick();

      select = wrapper.find('select');
      expect(select.element.value).toBe(optionValue('anthropic', opus.id));
    });

    it('emits update:modelValue immediately in form context', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const select = wrapper.find('select');

      await select.setValue(optionValue('anthropic', opus.id));
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
      expect(select.element.value).toBe(optionValue('anthropic', sonnet.id));
      wrapper1.unmount();

      // Test mounting with opus
      const wrapper2 = mountComponent({ modelValue: opus.id });
      await flushAll(wrapper2);
      select = wrapper2.find('select');
      expect(select.element.value).toBe(optionValue('anthropic', opus.id));
      wrapper2.unmount();

      // Test mounting with haiku
      const wrapper3 = mountComponent({ modelValue: haiku.id });
      await flushAll(wrapper3);
      select = wrapper3.find('select');
      expect(select.element.value).toBe(optionValue('anthropic', haiku.id));
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
      expect(select.element.value).toBe(optionValue('anthropic', sonnet.id));

      // Change to haiku
      await select.setValue(optionValue('anthropic', haiku.id));
      await flushAll(wrapper);

      // Should emit immediately
      expect(onUpdateModelValue).toHaveBeenCalledWith(haiku.id);

      // Visual feedback should be immediate
      select = wrapper.find('select');
      expect(select.element.value).toBe(optionValue('anthropic', haiku.id));
    });

    it('updates visual state and emits when user selects different options', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      await flushAll(wrapper);

      let select = wrapper.find('select');
      expect(select.element.value).toBe(optionValue('anthropic', sonnet.id));

      // Change to haiku - visual state should update immediately
      await select.setValue(optionValue('anthropic', haiku.id));
      await flushAll(wrapper);

      select = wrapper.find('select');
      expect(select.element.value).toBe(optionValue('anthropic', haiku.id));

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
      expect(select.element.value).toBe(optionValue('anthropic', opus.id));
    });
  });

  describe('allowEmpty prop', () => {
    it('renders an empty option when allowEmpty is true', () => {
      const wrapper = mountComponent({ allowEmpty: true, modelValue: '' });
      const options = wrapper.findAll('option');
      // 1 empty option + 6 model options
      expect(options).toHaveLength(7);
      expect(options[0].text()).toBe('Use system default');
      expect(options[0].element.value).toBe('');
    });

    it('does not render an empty option when allowEmpty is false (default)', () => {
      const wrapper = mountComponent({ modelValue: sonnet.id });
      const options = wrapper.findAll('option');
      expect(options).toHaveLength(6);
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
      await select.setValue(optionValue('anthropic', opus.id));
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
            { id: 'anthropic-sonnet', modelId: 'claude-sonnet-5', displayName: 'Sonnet 5', tier: 'sonnet' },
            { id: 'anthropic-opus-legacy', modelId: 'claude-opus-4-6', displayName: 'Opus 4.6', tier: 'opus' },
            { id: 'anthropic-opus', modelId: 'claude-opus-4-7', displayName: 'Opus 4.7', tier: 'opus' },
            { id: 'anthropic-opus-4-8', modelId: 'claude-opus-4-8', displayName: 'Opus 4.8', tier: 'opus' },
          ],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-5' });
      await flushAll(wrapper);

      const options = wrapper.findAll('option');

      // Built-in provider should show displayName
      expect(options).toHaveLength(5);
      expect(options[0].text()).toBe('Haiku 4.5');
      expect(options[1].text()).toBe('Sonnet 5');
      expect(options[2].text()).toBe('Opus 4.6');
      expect(options[3].text()).toBe('Opus 4.7');
      expect(options[4].text()).toBe('Opus 4.8');
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
            { id: 'anthropic-sonnet', modelId: 'claude-sonnet-5', displayName: 'Sonnet 5', tier: 'sonnet' },
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

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-5' });
      await flushAll(wrapper);

      const options = wrapper.findAll('option');

      // Built-in provider shows displayName
      expect(options[0].text()).toBe('Sonnet 5');

      // Custom provider shows modelId
      expect(options[1].text()).toBe('anthropic.claude-3-sonnet-20240229-v1:0');
    });
  });

  describe('enabled/disabled providers', () => {
    it('hides providers with enabled === false from the dropdown', async () => {
      const localProvidersStore = useProvidersStore();

      localProvidersStore.providers = [
        {
          id: 'anthropic-default',
          name: 'Anthropic (Official)',
          isBuiltIn: true,
          enabled: true,
          models: [
            { id: 'anthropic-sonnet', modelId: 'claude-sonnet-5', displayName: 'Sonnet 5', tier: 'sonnet' },
          ],
        },
        {
          id: 'openai-default',
          name: 'OpenAI (Official)',
          isBuiltIn: true,
          enabled: false,
          kind: 'openai',
          models: [
            { id: 'openai-gpt', modelId: 'gpt-5-codex', displayName: 'GPT-5 Codex', tier: 'custom' },
          ],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-5' });
      await flushAll(wrapper);

      const optgroups = wrapper.findAll('optgroup');
      expect(optgroups).toHaveLength(1);

      const options = wrapper.findAll('option');
      expect(options).toHaveLength(1);
      expect(options[0].element.value).toBe(optionValue('anthropic-default', 'claude-sonnet-5'));
    });

    it('shows providers again once re-enabled', async () => {
      const localProvidersStore = useProvidersStore();

      localProvidersStore.providers = [
        {
          id: 'anthropic-default',
          name: 'Anthropic (Official)',
          isBuiltIn: true,
          enabled: false,
          models: [
            { id: 'anthropic-sonnet', modelId: 'claude-sonnet-5', displayName: 'Sonnet 5', tier: 'sonnet' },
          ],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-5', allowEmpty: true });
      await flushAll(wrapper);

      // Disabled: only the empty option remains
      expect(wrapper.findAll('optgroup')).toHaveLength(0);

      localProvidersStore.providers = [
        {
          ...localProvidersStore.providers[0],
          enabled: true,
        },
      ];
      await flushAll(wrapper);

      expect(wrapper.findAll('optgroup')).toHaveLength(1);
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
            { id: 'anthropic-sonnet', modelId: 'claude-sonnet-5', displayName: 'Sonnet 5', tier: 'sonnet' },
          ],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-5' });
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
          models: [{ id: 'a-sonnet', modelId: 'claude-sonnet-5', displayName: 'Sonnet 5', tier: 'sonnet' }],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-5' });
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
          models: [{ id: 'a-sonnet', modelId: 'claude-sonnet-5', displayName: 'Sonnet 5', tier: 'sonnet' }],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-5' });
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
            { id: 'a-sonnet', modelId: 'claude-sonnet-5', displayName: 'Sonnet 5', tier: 'sonnet' },
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
      expect(select.element.value).toBe(optionValue('anthropic-default', 'claude-sonnet-5'));
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
            { id: 'a-sonnet', modelId: 'claude-sonnet-5', displayName: 'Sonnet 5', tier: 'sonnet' },
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

      expect(wrapper.find('select').element.value).toBe(optionValue('anthropic-default', 'claude-sonnet-5'));
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
          models: [{ id: 'a-sonnet', modelId: 'claude-sonnet-5', displayName: 'Sonnet 5', tier: 'sonnet' }],
        },
        {
          id: 'openai-prov',
          name: 'OpenAI',
          isBuiltIn: false,
          kind: 'openai',
          models: [{ id: 'o-gpt4o', modelId: 'gpt-4o', displayName: 'GPT-4o' }],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-5' });
      await flushAll(wrapper);

      const claudeOptGroup = wrapper.findAll('optgroup').find(
        (g) => g.attributes('data-agent-type') === 'claude-code'
      );
      const codexOptGroup = wrapper.findAll('optgroup').find(
        (g) => g.attributes('data-agent-type') === 'codex'
      );

      const claudeValues = claudeOptGroup.findAll('option').map((o) => o.element.value);
      const codexValues = codexOptGroup.findAll('option').map((o) => o.element.value);

      expect(claudeValues).toEqual([optionValue('anthropic-default', 'claude-sonnet-5')]);
      expect(codexValues).toEqual([optionValue('openai-prov', 'gpt-4o')]);
      expect(claudeValues).not.toContain(optionValue('openai-prov', 'gpt-4o'));
      expect(codexValues).not.toContain(optionValue('anthropic-default', 'claude-sonnet-5'));
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
            { id: 'openai-gpt-5-6-sol', modelId: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', tier: 'custom' },
          ],
        },
        {
          id: 'custom-openai',
          name: 'Custom OpenAI',
          isBuiltIn: false,
          kind: 'openai',
          models: [
            { id: 'custom-gpt-5-6-sol', modelId: 'gpt-5.6-sol', displayName: 'Custom GPT-5.6 Sol', tier: 'custom' },
          ],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'gpt-5.6-sol' });
      await flushAll(wrapper);

      const optgroups = wrapper.findAll('optgroup');
      expect(optgroups).toHaveLength(1);
      expect(optgroups[0].attributes('label')).toBe('Codex · Custom OpenAI');
      expect(wrapper.findAll('option')).toHaveLength(1);
      expect(wrapper.find('option').element.value).toBe(optionValue('custom-openai', 'gpt-5.6-sol'));
    });

    it('falls back to a visible duplicate option when the requested provider is hidden', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'openai-default',
          name: 'OpenAI (Official)',
          isBuiltIn: true,
          kind: 'openai',
          models: [
            { id: 'openai-gpt-5-6-sol', modelId: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', tier: 'custom' },
          ],
        },
        {
          id: 'custom-openai',
          name: 'Custom OpenAI',
          isBuiltIn: false,
          kind: 'openai',
          models: [
            { id: 'custom-gpt-5-6-sol', modelId: 'gpt-5.6-sol', displayName: 'Custom GPT-5.6 Sol', tier: 'custom' },
          ],
        },
      ];

      const wrapper = mountComponent({
        modelValue: 'gpt-5.6-sol',
        providerId: 'openai-default',
      });
      await flushAll(wrapper);

      const select = wrapper.find('select');
      expect(select.element.value).toBe(optionValue('custom-openai', 'gpt-5.6-sol'));
      expect(wrapper.attributes('data-model')).toBe('gpt-5.6-sol');
      expect(wrapper.attributes('data-provider-id')).toBe('custom-openai');
    });

    it('emits the resolved provider when mounted with a model but no provider', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'openai-default',
          name: 'OpenAI (Official)',
          isBuiltIn: true,
          kind: 'openai',
          models: [
            { id: 'openai-gpt-5-6-sol', modelId: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', tier: 'custom' },
          ],
        },
      ];

      const onUpdateProviderId = vi.fn();
      const wrapper = mountComponent(
        {
          modelValue: 'gpt-5.6-sol',
          providerId: null,
          allowEmpty: true,
        },
        { 'onUpdate:providerId': onUpdateProviderId }
      );
      await flushAll(wrapper);

      expect(wrapper.find('select').element.value).toBe(optionValue('openai-default', 'gpt-5.6-sol'));
      expect(onUpdateProviderId).toHaveBeenCalledWith('openai-default');
    });

    it('shows duplicate built-in and custom options when requested', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'openai-default',
          name: 'OpenAI (Official)',
          isBuiltIn: true,
          kind: 'openai',
          models: [
            { id: 'openai-gpt-5-6-sol', modelId: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', tier: 'custom' },
          ],
        },
        {
          id: 'custom-openai',
          name: 'Custom OpenAI',
          isBuiltIn: false,
          kind: 'openai',
          models: [
            { id: 'custom-gpt-5-6-sol', modelId: 'gpt-5.6-sol', displayName: 'Custom GPT-5.6 Sol', tier: 'custom' },
          ],
        },
      ];

      const wrapper = mountComponent({
        modelValue: 'gpt-5.6-sol',
        providerId: 'openai-default',
        hideBuiltInDuplicates: false,
      });
      await flushAll(wrapper);

      const options = wrapper.findAll('option');
      expect(options).toHaveLength(2);
      expect(options.map((option) => option.element.value)).toEqual([
        optionValue('openai-default', 'gpt-5.6-sol'),
        optionValue('custom-openai', 'gpt-5.6-sol'),
      ]);
      expect(options.map((option) => option.text())).toEqual([
        'GPT-5.6 Sol (OpenAI (Official))',
        'gpt-5.6-sol (Custom OpenAI)',
      ]);
    });

    it('selects and emits the requested provider for duplicate model ids', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'openai-default',
          name: 'OpenAI (Official)',
          isBuiltIn: true,
          kind: 'openai',
          models: [
            { id: 'openai-gpt-5-6-sol', modelId: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', tier: 'custom' },
          ],
        },
        {
          id: 'custom-openai',
          name: 'Custom OpenAI',
          isBuiltIn: false,
          kind: 'openai',
          models: [
            { id: 'custom-gpt-5-6-sol', modelId: 'gpt-5.6-sol', displayName: 'Custom GPT-5.6 Sol', tier: 'custom' },
          ],
        },
      ];

      const onUpdateModelValue = vi.fn();
      const onUpdateProviderId = vi.fn();
      const onModelSelected = vi.fn();
      const wrapper = mountComponent(
        {
          modelValue: 'gpt-5.6-sol',
          providerId: 'openai-default',
          hideBuiltInDuplicates: false,
        },
        { 'onUpdate:modelValue': onUpdateModelValue, 'onUpdate:providerId': onUpdateProviderId, onModelSelected }
      );
      await flushAll(wrapper);

      expect(wrapper.find('select').element.value).toBe(optionValue('openai-default', 'gpt-5.6-sol'));

      const select = wrapper.find('select');
      select.element.value = optionValue('custom-openai', 'gpt-5.6-sol');
      await select.trigger('change');
      await flushAll(wrapper);

      expect(onUpdateModelValue).toHaveBeenCalledWith('gpt-5.6-sol');
      expect(onUpdateProviderId).toHaveBeenCalledWith('custom-openai');
      expect(onModelSelected).toHaveBeenCalledWith({
        modelId: 'gpt-5.6-sol',
        providerId: 'custom-openai',
        kind: 'openai',
      });
    });
  });

  describe('retired built-in OpenAI model (gpt-5.5)', () => {
    it('does not render the built-in OpenAI gpt-5.5 option', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'openai-default',
          name: 'OpenAI (Official)',
          isBuiltIn: true,
          kind: 'openai',
          models: [
            { id: 'openai-gpt-5-5', modelId: 'gpt-5.5', displayName: 'GPT-5.5', tier: 'custom', enabled: false },
            { id: 'openai-gpt-5-6-sol', modelId: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', tier: 'custom' },
          ],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'gpt-5.6-sol' });
      await flushAll(wrapper);

      const values = wrapper.findAll('option').map((option) => option.element.value);
      expect(values).not.toContain(optionValue('openai-default', 'gpt-5.5'));
      expect(values).toContain(optionValue('openai-default', 'gpt-5.6-sol'));
    });

    it('keeps a custom provider gpt-5.5 option selectable', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'openai-default',
          name: 'OpenAI (Official)',
          isBuiltIn: true,
          kind: 'openai',
          models: [
            { id: 'openai-gpt-5-5', modelId: 'gpt-5.5', displayName: 'GPT-5.5', tier: 'custom', enabled: false },
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

      const wrapper = mountComponent({ modelValue: 'gpt-5.5', providerId: 'custom-openai' });
      await flushAll(wrapper);

      const values = wrapper.findAll('option').map((option) => option.element.value);
      expect(values).toContain(optionValue('custom-openai', 'gpt-5.5'));
      expect(values).not.toContain(optionValue('openai-default', 'gpt-5.5'));
    });

    it('does not emit a replacement model value for a persisted gpt-5.5 + openai-default pairing', async () => {
      const localProvidersStore = useProvidersStore();
      localProvidersStore.providers = [
        {
          id: 'openai-default',
          name: 'OpenAI (Official)',
          isBuiltIn: true,
          kind: 'openai',
          models: [
            { id: 'openai-gpt-5-5', modelId: 'gpt-5.5', displayName: 'GPT-5.5', tier: 'custom', enabled: false },
            { id: 'openai-gpt-5-6-sol', modelId: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', tier: 'custom' },
          ],
        },
      ];

      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        // A picker showing an existing session's stored model must be
        // sessionScoped to keep a disabled choice visible (FRD §0 / Plan
        // Phase 7): the exception is not "any picker whose value happens to
        // match", it's specifically the session that owns that value.
        { modelValue: 'gpt-5.5', providerId: 'openai-default', sessionScoped: true },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      await flushAll(wrapper);

      expect(onUpdateModelValue).not.toHaveBeenCalled();
      expect(wrapper.attributes('data-model')).toBe('gpt-5.5');
    });
  });

  describe('tier support', () => {
    function seedTiers(tiers) {
      const tiersStore = useTiersStore();
      tiersStore.tiers = tiers;
    }

    it('renders a "Model Tiers" optgroup when tiers with members exist', async () => {
      seedTiers([{ id: 'tier-1', name: 'High Priority', description: null, members: [{ id: 'm1' }] }]);

      const wrapper = mountComponent({ modelValue: sonnet.id });
      await flushAll(wrapper);

      const optgroups = wrapper.findAll('optgroup');
      const tierGroup = optgroups.find((g) => g.attributes('label') === 'Model Tiers');
      expect(tierGroup).toBeTruthy();
      expect(tierGroup.text()).toContain('High Priority');
    });

    it('does not render the tier optgroup when no tiers have members', async () => {
      seedTiers([{ id: 'tier-1', name: 'Empty Tier', description: null, members: [] }]);

      const wrapper = mountComponent({ modelValue: sonnet.id });
      await flushAll(wrapper);

      const optgroups = wrapper.findAll('optgroup');
      const tierGroup = optgroups.find((g) => g.attributes('label') === 'Model Tiers');
      expect(tierGroup).toBeFalsy();
    });

    it('does not render the tier optgroup when there are no tiers at all', async () => {
      seedTiers([]);

      const wrapper = mountComponent({ modelValue: sonnet.id });
      await flushAll(wrapper);

      const optgroups = wrapper.findAll('optgroup');
      const tierGroup = optgroups.find((g) => g.attributes('label') === 'Model Tiers');
      expect(tierGroup).toBeFalsy();
    });

    it('shows the tier description alongside the name in the option label', async () => {
      seedTiers([{ id: 'tier-1', name: 'High Priority', description: 'top models', members: [{ id: 'm1' }] }]);

      const wrapper = mountComponent({ modelValue: sonnet.id });
      await flushAll(wrapper);

      const option = wrapper.find('option[value="tier::tier-1"]');
      expect(option.exists()).toBe(true);
      expect(option.text()).toBe('High Priority — top models');
    });

    it('selects the tier option value directly (no provider::model encoding)', async () => {
      seedTiers([{ id: 'tier-1', name: 'High Priority', description: null, members: [{ id: 'm1' }] }]);

      const wrapper = mountComponent({ modelValue: 'tier::tier-1' });
      await flushAll(wrapper);

      const select = wrapper.find('select');
      expect(select.element.value).toBe('tier::tier-1');
    });

    it('emits update:modelValue with the tier ref and clears providerId when a tier is selected', async () => {
      seedTiers([{ id: 'tier-1', name: 'High Priority', description: null, members: [{ id: 'm1' }] }]);

      const onUpdateModelValue = vi.fn();
      const onUpdateProviderId = vi.fn();
      const onModelSelected = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue, 'onUpdate:providerId': onUpdateProviderId, onModelSelected }
      );
      await flushAll(wrapper);

      await wrapper.find('select').setValue('tier::tier-1');
      await flushAll(wrapper);

      expect(onUpdateModelValue).toHaveBeenCalledWith('tier::tier-1');
      expect(onUpdateProviderId).toHaveBeenCalledWith(null);
      expect(onModelSelected).toHaveBeenCalledWith({
        modelId: 'tier::tier-1',
        providerId: null,
        kind: null,
        tierId: 'tier-1',
      });
    });

    it('emits a concrete model selection when switching away from a tier', async () => {
      seedTiers([{ id: 'tier-1', name: 'High Priority', description: null, members: [{ id: 'm1' }] }]);

      const onUpdateModelValue = vi.fn();
      const onUpdateProviderId = vi.fn();
      const wrapper = mountComponent(
        { modelValue: 'tier::tier-1' },
        { 'onUpdate:modelValue': onUpdateModelValue, 'onUpdate:providerId': onUpdateProviderId }
      );
      await flushAll(wrapper);

      await wrapper.find('select').setValue(optionValue('anthropic', opus.id));
      await flushAll(wrapper);

      expect(onUpdateModelValue).toHaveBeenCalledWith(opus.id);
      expect(onUpdateProviderId).toHaveBeenCalledWith('anthropic');
    });

    it('does not emit again when re-selecting the same tier', async () => {
      seedTiers([{ id: 'tier-1', name: 'High Priority', description: null, members: [{ id: 'm1' }] }]);

      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: 'tier::tier-1' },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      await flushAll(wrapper);

      await wrapper.find('select').setValue('tier::tier-1');
      await flushAll(wrapper);

      expect(onUpdateModelValue).not.toHaveBeenCalled();
    });

    // Fix 8: a deleted/emptied tier ref must remain visibly identifiable as a
    // stale tier binding rather than silently presenting as an unrelated
    // concrete default model in an editable form.
    describe('stale tier ref', () => {
      it('keeps showing the tier chip when the bound tier no longer exists', async () => {
        seedTiers([]); // tier-1 was deleted

        const wrapper = mountComponent({ modelValue: 'tier::tier-1' });
        await flushAll(wrapper);

        const chip = wrapper.find('.tier-chip');
        expect(chip.exists()).toBe(true);
        expect(chip.text()).toContain('tier-1');
      });

      it('marks the chip as stale and surfaces the unknown-model badge for a deleted tier', async () => {
        // A non-empty tiers list that does NOT include tier-1 signals the
        // tiers store has genuinely loaded (as opposed to an empty array,
        // which is treated permissively as "not fetched yet") and tier-1 was
        // deleted.
        seedTiers([{ id: 'other-tier', name: 'Other Tier', description: null, members: [{ id: 'm1' }] }]);

        const wrapper = mountComponent({ modelValue: 'tier::tier-1' });
        await flushAll(wrapper);

        expect(wrapper.find('.tier-chip').classes()).toContain('tier-chip--stale');
        expect(wrapper.find('.unknown-model-badge').exists()).toBe(true);
      });

      it('keeps showing the tier chip when the bound tier still exists but was emptied of members', async () => {
        seedTiers([{ id: 'tier-1', name: 'High Priority', description: null, members: [] }]);

        const wrapper = mountComponent({ modelValue: 'tier::tier-1' });
        await flushAll(wrapper);

        const chip = wrapper.find('.tier-chip');
        expect(chip.exists()).toBe(true);
        expect(chip.text()).toContain('High Priority');
        expect(chip.classes()).toContain('tier-chip--stale');
      });

      it('does not mark a healthy, resolvable tier as stale', async () => {
        seedTiers([{ id: 'tier-1', name: 'High Priority', description: null, members: [{ id: 'm1' }] }]);

        const wrapper = mountComponent({ modelValue: 'tier::tier-1' });
        await flushAll(wrapper);

        const chip = wrapper.find('.tier-chip');
        expect(chip.exists()).toBe(true);
        expect(chip.classes()).not.toContain('tier-chip--stale');
        expect(wrapper.find('.unknown-model-badge').exists()).toBe(false);
      });
    });
  });

  describe('disabled-model visibility is gated by sessionScoped + providerId (Issue 2)', () => {
    beforeEach(() => {
      providersStore.providers = [
        {
          id: 'openai-default',
          name: 'OpenAI (Official)',
          isBuiltIn: true,
          kind: 'openai',
          models: [
            { id: 'openai-gpt-5-5', modelId: 'gpt-5.5', displayName: 'GPT-5.5', tier: 'custom', enabled: false },
            { id: 'openai-gpt-5-6-sol', modelId: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', tier: 'custom' },
          ],
        },
      ];
    });

    it('preserves a disabled stored value as a labelled, read-only option for non-session configuration', async () => {
      const wrapper = mountComponent({
        modelValue: 'gpt-5.5', providerId: 'openai-default', preserveCurrentValue: true,
      });
      await flushAll(wrapper);

      const option = wrapper.find(`option[value="${optionValue('openai-default', 'gpt-5.5')}"]`);
      expect(option.exists()).toBe(true);
      expect(option.element.disabled).toBe(true);
      expect(option.text()).toContain('currently set');
      expect(wrapper.find('.unknown-model-badge').exists()).toBe(false);
    });

    it('hides a disabled model whose modelId matches modelValue when sessionScoped is true but providerId does not match its owning provider', async () => {
      providersStore.providers.push({
        id: 'custom-openai',
        name: 'Custom OpenAI',
        isBuiltIn: false,
        kind: 'openai',
        models: [
          { id: 'custom-gpt-5-6-sol', modelId: 'gpt-5.6-sol', displayName: 'Custom Sol', tier: 'custom' },
        ],
      });

      const wrapper = mountComponent({ modelValue: 'gpt-5.5', providerId: 'custom-openai', sessionScoped: true });
      await flushAll(wrapper);

      const values = wrapper.findAll('option').map((option) => option.element.value);
      expect(values).not.toContain(optionValue('openai-default', 'gpt-5.5'));
    });

    it('shows and keeps selectable a disabled model whose modelId matches modelValue when sessionScoped is true and providerId matches', async () => {
      const wrapper = mountComponent({ modelValue: 'gpt-5.5', providerId: 'openai-default', sessionScoped: true });
      await flushAll(wrapper);

      const values = wrapper.findAll('option').map((option) => option.element.value);
      expect(values).toContain(optionValue('openai-default', 'gpt-5.5'));
      expect(wrapper.find('.unknown-model-badge').exists()).toBe(false);
    });

    // PR #1063 remediation, Slice E2: a session created via the API (or any
    // legacy session predating providerId tracking) stores only `model`, not
    // `providerId` -- session.providerId is null. The parent then passes
    // `providerId: null` through to ModelSelector. Session-scoped resolution
    // must still find the *actual* owning provider (here, OpenAI) from the
    // model id itself, not silently assume Anthropic.
    it('shows and keeps selectable a disabled non-Anthropic model when sessionScoped is true and providerId is not supplied', async () => {
      const wrapper = mountComponent({ modelValue: 'gpt-5.5', sessionScoped: true });
      await flushAll(wrapper);

      const values = wrapper.findAll('option').map((option) => option.element.value);
      expect(values).toContain(optionValue('openai-default', 'gpt-5.5'));
      expect(wrapper.find('.unknown-model-badge').exists()).toBe(false);
      expect(wrapper.attributes('data-model')).toBe('gpt-5.5');
    });
  });

  describe('orphaned (unknown) model id', () => {
    const ORPHAN = 'claude-sonnet-4-6';

    beforeEach(() => {
      // Catalog contains claude-sonnet-5 but NOT the retired claude-sonnet-4-6.
      providersStore.providers = [
        {
          id: 'anthropic-default',
          name: 'Anthropic (Official)',
          isBuiltIn: true,
          kind: 'anthropic',
          models: [
            { id: 'anthropic-haiku', modelId: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', tier: 'haiku' },
            { id: 'anthropic-sonnet', modelId: 'claude-sonnet-5', displayName: 'Sonnet 5', tier: 'sonnet' },
            { id: 'anthropic-opus', modelId: 'claude-opus-4-8', displayName: 'Opus 4.8', tier: 'opus' },
          ],
        },
      ];
    });

    it('renders the unknown-model badge when modelValue is not in the catalog', async () => {
      const wrapper = mountComponent({ modelValue: ORPHAN });
      await flushAll(wrapper);
      expect(wrapper.find('.unknown-model-badge').exists()).toBe(true);
    });

    it('does not render the badge for a valid modelValue', async () => {
      const wrapper = mountComponent({ modelValue: 'claude-sonnet-5' });
      await flushAll(wrapper);
      expect(wrapper.find('.unknown-model-badge').exists()).toBe(false);
    });

    it('does not render the badge for a null modelValue', async () => {
      const wrapper = mountComponent({ modelValue: null });
      await flushAll(wrapper);
      expect(wrapper.find('.unknown-model-badge').exists()).toBe(false);
    });

    it('does not silently emit a substitution for the orphaned value on mount', async () => {
      const onUpdateModelValue = vi.fn();
      mountComponent(
        { modelValue: ORPHAN },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      await flushAll();
      // The parent's stored orphaned id must NOT be silently overwritten with
      // the default; the user must choose a replacement explicitly.
      expect(onUpdateModelValue).not.toHaveBeenCalled();
    });

    it('still falls back to the default model for display only', async () => {
      const wrapper = mountComponent({ modelValue: ORPHAN });
      await flushAll(wrapper);
      const select = wrapper.find('select');
      // Default (sonnet) is shown purely so the dropdown isn't empty; the badge
      // flags that the stored value is actually an orphan.
      expect(select.element.value).toBe(optionValue('anthropic-default', 'claude-sonnet-5'));
    });

    it('lets the user pick a replacement, which clears the badge once the parent accepts it', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: ORPHAN },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      await flushAll(wrapper);
      expect(wrapper.find('.unknown-model-badge').exists()).toBe(true);

      await wrapper.find('select').setValue(optionValue('anthropic-default', 'claude-opus-4-8'));
      // Simulate the parent accepting the emitted value (v-model round-trip).
      await wrapper.setProps({ modelValue: 'claude-opus-4-8' });
      await flushAll(wrapper);

      expect(onUpdateModelValue).toHaveBeenCalledWith('claude-opus-4-8');
      expect(wrapper.find('.unknown-model-badge').exists()).toBe(false);
    });
  });

  describe('sessionScoped historical continuity for soft-removed models', () => {
    const REMOVED_MODEL_ID = 'claude-opus-4-6';

    beforeEach(() => {
      // The removed model is NOT part of the bulk providers payload -- the
      // server excludes soft-removed rows from GET /api/providers, same as a
      // real removal would.
      providersStore.providers = [
        {
          id: 'anthropic-default',
          name: 'Anthropic (Official)',
          isBuiltIn: true,
          kind: 'anthropic',
          models: [
            { id: 'anthropic-sonnet', modelId: 'claude-sonnet-5', displayName: 'Sonnet 5', tier: 'sonnet' },
            { id: 'anthropic-opus-4-8', modelId: 'claude-opus-4-8', displayName: 'Opus 4.8', tier: 'opus' },
          ],
        },
      ];
    });

    it('fetches a soft-removed stored value as a labelled, read-only option for non-session configuration', async () => {
      const fetchHistoricalModel = vi.spyOn(providersStore, 'fetchHistoricalModel');
      fetchHistoricalModel.mockResolvedValue({
        id: 'anthropic-opus', providerId: 'anthropic-default', modelId: REMOVED_MODEL_ID,
        displayName: 'Opus 4.6', tier: 'opus', enabled: false, removedAt: Date.now(),
      });
      const wrapper = mountComponent({
        modelValue: REMOVED_MODEL_ID, providerId: 'anthropic-default', preserveCurrentValue: true,
      });
      await flushAll(wrapper);

      expect(fetchHistoricalModel).toHaveBeenCalledWith('anthropic-default', REMOVED_MODEL_ID);
      const option = wrapper.find(`option[value="${optionValue('anthropic-default', REMOVED_MODEL_ID)}"]`);
      expect(option.exists()).toBe(true);
      expect(option.element.disabled).toBe(true);
      expect(option.text()).toContain('currently set');
      expect(wrapper.find('.unknown-model-badge').exists()).toBe(false);
    });

    it('fetches and merges the removed model when sessionScoped is true, clearing the unknown badge', async () => {
      vi.spyOn(providersStore, 'fetchHistoricalModel').mockResolvedValue({
        id: 'anthropic-opus',
        providerId: 'anthropic-default',
        modelId: REMOVED_MODEL_ID,
        displayName: 'Opus 4.6',
        tier: 'opus',
        enabled: false,
        removedAt: Date.now(),
      });

      const wrapper = mountComponent({ modelValue: REMOVED_MODEL_ID, providerId: 'anthropic-default', sessionScoped: true });
      await flushAll(wrapper);

      expect(providersStore.fetchHistoricalModel).toHaveBeenCalledWith('anthropic-default', REMOVED_MODEL_ID);
      expect(wrapper.find('.unknown-model-badge').exists()).toBe(false);
      const values = wrapper.findAll('option').map((option) => option.element.value);
      expect(values).toContain(optionValue('anthropic-default', REMOVED_MODEL_ID));
      expect(wrapper.attributes('data-model')).toBe(REMOVED_MODEL_ID);
    });

    it('does not fetch when the value already resolves among active models', async () => {
      const fetchHistoricalModel = vi.spyOn(providersStore, 'fetchHistoricalModel');
      const wrapper = mountComponent({ modelValue: 'claude-opus-4-8', providerId: 'anthropic-default', sessionScoped: true });
      await flushAll(wrapper);

      expect(fetchHistoricalModel).not.toHaveBeenCalled();
    });
  });
});
