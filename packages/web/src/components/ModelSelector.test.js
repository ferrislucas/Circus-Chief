import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import ModelSelector from './ModelSelector.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useProvidersStore } from '../stores/providers.js';
import { useUiStore } from '../stores/ui.js';
import { CLAUDE_MODELS } from '@claudetools/shared';

// Use actual model data from the shared package
const [haiku, sonnet, opus] = CLAUDE_MODELS;

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
    vi.spyOn(providersStore, 'fetchProvidersWithModels').mockResolvedValue();
  });

  const mountComponent = (props = {}, attrs = {}) => {
    return mount(ModelSelector, {
      props: {
        modelValue: sonnet.id,
        ...props,
      },
      attrs,
    });
  };

  describe('rendering', () => {
    it('renders a select dropdown', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('select').exists()).toBe(true);
    });

    it('renders all three model options', () => {
      const wrapper = mountComponent();
      const options = wrapper.findAll('option');
      expect(options).toHaveLength(3);
    });

    it('displays model names in options', () => {
      const wrapper = mountComponent();
      const options = wrapper.findAll('option');
      expect(options[0].text()).toBe(haiku.name);
      expect(options[1].text()).toBe(sonnet.name);
      expect(options[2].text()).toBe(opus.name);
    });

    it('sets correct values for options', () => {
      const wrapper = mountComponent();
      const options = wrapper.findAll('option');
      expect(options[0].element.value).toBe(haiku.id);
      expect(options[1].element.value).toBe(sonnet.id);
      expect(options[2].element.value).toBe(opus.id);
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

  describe('session context with store updates', () => {
    it('updates store and maintains selection on success', async () => {
      const sessionsStore = useSessionsStore();
      const updateSessionModelSpy = vi.spyOn(sessionsStore, 'updateSessionModel').mockResolvedValue(undefined);

      // Set up the session store BEFORE creating the component
      sessionsStore.currentSession = {
        id: 'test-session',
        model: sonnet.id,
      };

      const wrapper = mountComponent({
        sessionId: 'test-session',
        modelValue: sonnet.id,
      });

      await flushAll(wrapper);

      let select = wrapper.find('select');
      expect(select.element.value).toBe(sonnet.id);

      // Change to opus
      await select.setValue(opus.id);
      await flushAll(wrapper);

      // Selection should be updated
      select = wrapper.find('select');
      expect(select.element.value).toBe(opus.id);

      // Wait for the store update to complete
      await flushAll(wrapper);

      // Store should have been called with the new model
      expect(updateSessionModelSpy).toHaveBeenCalledWith('test-session', opus.id);

      updateSessionModelSpy.mockRestore();
    });

    it('calls store method with correct parameters on update', async () => {
      const sessionsStore = useSessionsStore();
      const updateSessionModelSpy = vi.spyOn(sessionsStore, 'updateSessionModel').mockResolvedValue(undefined);

      // Set up the session store BEFORE creating the component
      sessionsStore.currentSession = {
        id: 'test-session',
        model: sonnet.id,
      };

      const wrapper = mountComponent({
        sessionId: 'test-session',
        modelValue: sonnet.id,
      });

      await flushAll(wrapper);

      const select = wrapper.find('select');

      // Change to opus
      await select.setValue(opus.id);
      await flushAll(wrapper);

      // Store method should have been called
      expect(updateSessionModelSpy).toHaveBeenCalledWith('test-session', opus.id);

      updateSessionModelSpy.mockRestore();
    });

    it('disables select while store update is in progress', async () => {
      const sessionsStore = useSessionsStore();
      let resolveUpdate;
      const updatePromise = new Promise(resolve => {
        resolveUpdate = resolve;
      });

      const updateSessionModelSpy = vi
        .spyOn(sessionsStore, 'updateSessionModel')
        .mockReturnValue(updatePromise);

      // Set up the session store BEFORE creating the component
      sessionsStore.currentSession = {
        id: 'test-session',
        model: sonnet.id,
      };

      const wrapper = mountComponent({
        sessionId: 'test-session',
        modelValue: sonnet.id,
      });

      await flushAll(wrapper);

      let select = wrapper.find('select');
      expect(select.element.disabled).toBe(false);

      // Change to opus
      await select.setValue(opus.id);
      await flushAll(wrapper);

      // Re-query select to check disabled state
      select = wrapper.find('select');

      // Select should be disabled while updating
      expect(select.element.disabled).toBe(true);

      // Resolve the update
      resolveUpdate();
      await flushAll(wrapper);

      // Re-query select after update completes
      select = wrapper.find('select');

      // Select should be enabled again
      expect(select.element.disabled).toBe(false);

      updateSessionModelSpy.mockRestore();
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

    it('syncs selected value when session store updates', async () => {
      const sessionsStore = useSessionsStore();

      const wrapper = mountComponent({
        sessionId: 'test-session',
        modelValue: undefined,
      });

      sessionsStore.currentSession = {
        id: 'test-session',
        model: sonnet.id,
      };

      await flushAll(wrapper);

      let select = wrapper.find('select');
      expect(select.element.value).toBe(sonnet.id);

      // Simulate session model being updated in the store
      sessionsStore.currentSession.model = opus.id;
      await flushAll(wrapper);

      select = wrapper.find('select');

      // Selection should sync with store change
      expect(select.element.value).toBe(opus.id);
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

  describe('provider-based model display', () => {
    it('displays displayName for built-in provider models', async () => {
      const providersStore = useProvidersStore();

      // Mock built-in Anthropic provider with models
      providersStore.providers = [
        {
          id: 'anthropic-default',
          name: 'Anthropic (Official)',
          isBuiltIn: true,
          isDefault: true,
          models: [
            { id: 'anthropic-haiku', modelId: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', tier: 'haiku' },
            { id: 'anthropic-sonnet', modelId: 'claude-sonnet-4-5-20250929', displayName: 'Sonnet 4.5', tier: 'sonnet' },
            { id: 'anthropic-opus', modelId: 'claude-opus-4-5-20251101', displayName: 'Opus 4.5', tier: 'opus' },
          ],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-4-5-20250929' });
      await flushAll(wrapper);

      const options = wrapper.findAll('option');

      // Built-in provider should show displayName
      expect(options[0].text()).toBe('Haiku 4.5');
      expect(options[1].text()).toBe('Sonnet 4.5');
      expect(options[2].text()).toBe('Opus 4.5');
    });

    it('displays modelId for custom provider models', async () => {
      const providersStore = useProvidersStore();

      // Mock custom AWS Bedrock provider with models
      providersStore.providers = [
        {
          id: 'aws-bedrock',
          name: 'AWS Bedrock',
          isBuiltIn: false,
          isDefault: false,
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
      const providersStore = useProvidersStore();

      // Mock both built-in and custom providers
      providersStore.providers = [
        {
          id: 'anthropic-default',
          name: 'Anthropic (Official)',
          isBuiltIn: true,
          isDefault: true,
          models: [
            { id: 'anthropic-sonnet', modelId: 'claude-sonnet-4-5-20250929', displayName: 'Sonnet 4.5', tier: 'sonnet' },
          ],
        },
        {
          id: 'aws-bedrock',
          name: 'AWS Bedrock',
          isBuiltIn: false,
          isDefault: false,
          models: [
            { id: 'bedrock-sonnet', modelId: 'anthropic.claude-3-sonnet-20240229-v1:0', displayName: 'Sonnet', tier: 'sonnet' },
          ],
        },
      ];

      const wrapper = mountComponent({ modelValue: 'claude-sonnet-4-5-20250929' });
      await flushAll(wrapper);

      const options = wrapper.findAll('option');

      // Built-in provider shows displayName
      expect(options[0].text()).toBe('Sonnet 4.5');

      // Custom provider shows modelId
      expect(options[1].text()).toBe('anthropic.claude-3-sonnet-20240229-v1:0');
    });
  });
});
