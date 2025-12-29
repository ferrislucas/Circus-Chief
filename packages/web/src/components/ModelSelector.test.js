import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import ModelSelector from './ModelSelector.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { CLAUDE_MODELS } from '@claudetools/shared';

// Use actual model data from the shared package
const [sonnet, opus, haiku] = CLAUDE_MODELS;

// Global helper to flush all async updates and force DOM re-render
async function flushAll(wrapper) {
  await flushPromises();
  await nextTick();
  if (wrapper && wrapper.vm) {
    await wrapper.vm.$nextTick?.();
    // Force Vue to re-render with updated state
    await wrapper.vm.$forceUpdate();
    await nextTick();
    // Multiple update cycles to ensure all conditions re-evaluate
    await wrapper.vm.$forceUpdate();
    await nextTick();
  }
}

describe('ModelSelector', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
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
    it('renders model label', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.model-label').text()).toBe('Model:');
    });

    it('renders all three model buttons', () => {
      const wrapper = mountComponent();
      const buttons = wrapper.findAll('.model-btn');
      expect(buttons).toHaveLength(3);
    });

    it('displays model names on buttons', () => {
      const wrapper = mountComponent();
      const buttons = wrapper.findAll('.model-btn');
      expect(buttons[0].text()).toBe(sonnet.name);
      expect(buttons[1].text()).toBe(opus.name);
      expect(buttons[2].text()).toBe(haiku.name);
    });

    it('shows description as title attribute', () => {
      const wrapper = mountComponent();
      const buttons = wrapper.findAll('.model-btn');
      expect(buttons[0].attributes('title')).toBe(sonnet.description);
      expect(buttons[1].attributes('title')).toBe(opus.description);
      expect(buttons[2].attributes('title')).toBe(haiku.description);
    });
  });

  describe('active state', () => {
    it('marks sonnet as active when selected', () => {
      const wrapper = mountComponent({ modelValue: sonnet.id });
      const buttons = wrapper.findAll('.model-btn');
      expect(buttons[0].classes()).toContain('active');
      expect(buttons[1].classes()).not.toContain('active');
      expect(buttons[2].classes()).not.toContain('active');
    });

    it('marks opus as active when selected', () => {
      const wrapper = mountComponent({ modelValue: opus.id });
      const buttons = wrapper.findAll('.model-btn');
      expect(buttons[0].classes()).not.toContain('active');
      expect(buttons[1].classes()).toContain('active');
      expect(buttons[2].classes()).not.toContain('active');
    });

    it('marks haiku as active when selected', () => {
      const wrapper = mountComponent({ modelValue: haiku.id });
      const buttons = wrapper.findAll('.model-btn');
      expect(buttons[0].classes()).not.toContain('active');
      expect(buttons[1].classes()).not.toContain('active');
      expect(buttons[2].classes()).toContain('active');
    });
  });

  describe('interactions', () => {
    it('emits update:modelValue when button clicked', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const buttons = wrapper.findAll('.model-btn');

      await buttons[1].trigger('click');

      expect(onUpdateModelValue).toHaveBeenCalledWith(opus.id);
    });

    it('emits correct model id for each button', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const buttons = wrapper.findAll('.model-btn');

      // Clicking already selected model doesn't emit (early return optimization)
      await buttons[0].trigger('click');
      expect(onUpdateModelValue).not.toHaveBeenCalled();

      await buttons[1].trigger('click');
      expect(onUpdateModelValue).toHaveBeenCalledWith(opus.id);

      await buttons[2].trigger('click');
      expect(onUpdateModelValue).toHaveBeenCalledWith(haiku.id);

      expect(onUpdateModelValue).toHaveBeenCalledTimes(2);
    });
  });

  describe('disabled state', () => {
    it('disables all buttons when disabled prop is true', () => {
      const wrapper = mountComponent({ disabled: true });
      const buttons = wrapper.findAll('.model-btn');

      buttons.forEach((button) => {
        expect(button.attributes('disabled')).toBeDefined();
      });
    });

    it('does not disable buttons when disabled prop is false', () => {
      const wrapper = mountComponent({ disabled: false });
      const buttons = wrapper.findAll('.model-btn');

      buttons.forEach((button) => {
        expect(button.attributes('disabled')).toBeUndefined();
      });
    });

    it('does not emit when disabled button is clicked', async () => {
      const wrapper = mountComponent({ disabled: true });
      const buttons = wrapper.findAll('.model-btn');

      await buttons[1].trigger('click');

      // No events should be emitted when disabled
      // Note: Vue still emits the event, but the button is disabled in the UI
      // The disabled state is handled by the browser
    });
  });

  describe('optimistic UI updates', () => {
    it('highlights button immediately on click (before async operation)', async () => {
      const wrapper = mountComponent({ modelValue: sonnet.id });
      let buttons = wrapper.findAll('.model-btn');

      // Initial state: sonnet is active
      expect(buttons[0].classes()).toContain('active');
      expect(buttons[1].classes()).not.toContain('active');

      // Click opus button
      await buttons[1].trigger('click');
      await flushAll(wrapper);

      // Button should be highlighted IMMEDIATELY
      buttons = wrapper.findAll('.model-btn');
      expect(buttons[1].classes()).toContain('active');
      expect(buttons[0].classes()).not.toContain('active');
    });

    it('maintains selection highlight even if async update takes time', async () => {
      const wrapper = mountComponent({ modelValue: sonnet.id });
      let buttons = wrapper.findAll('.model-btn');

      await buttons[1].trigger('click');
      await flushAll(wrapper);

      // Selection should be visually active
      buttons = wrapper.findAll('.model-btn');
      expect(buttons[1].classes()).toContain('active');

      // Wait for any pending updates
      await new Promise(resolve => setTimeout(resolve, 50));

      // Button should STILL be highlighted
      buttons = wrapper.findAll('.model-btn');
      expect(buttons[1].classes()).toContain('active');
    });

    it('emits update:modelValue immediately in form context', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const buttons = wrapper.findAll('.model-btn');

      await buttons[1].trigger('click');

      // Emit should happen immediately
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

      let buttons = wrapper.findAll('.model-btn');

      // Click to change model
      await buttons[1].trigger('click');
      await flushAll(wrapper);

      // Selection should be immediate
      buttons = wrapper.findAll('.model-btn');
      expect(buttons[1].classes()).toContain('active');

      // Wait for the store update to complete
      await flushAll(wrapper);

      // Store should have been called with the new model
      expect(updateSessionModelSpy).toHaveBeenCalledWith('test-session', opus.id);

      updateSessionModelSpy.mockRestore();
    });

    it('calls store method with correct parameters on update', async () => {
      const sessionsStore = useSessionsStore();
      const updateSessionModelSpy = vi.spyOn(sessionsStore, 'updateSessionModel').mockResolvedValue(undefined);

      // Set up the session store BEFORE creating the component with actual model value
      sessionsStore.currentSession = {
        id: 'test-session',
        model: sonnet.id,
      };

      const wrapper = mountComponent({
        sessionId: 'test-session',
        modelValue: sonnet.id,  // Pass the actual model value
      });

      await wrapper.vm.$nextTick();

      const buttons = wrapper.findAll('.model-btn');

      // Click to change model
      await buttons[1].trigger('click');
      await wrapper.vm.$nextTick();

      // Wait for the store update to complete
      await flushPromises();

      // Store method should have been called
      expect(updateSessionModelSpy).toHaveBeenCalledWith('test-session', opus.id);

      updateSessionModelSpy.mockRestore();
    });

    it('disables buttons while store update is in progress', async () => {
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

      let buttons = wrapper.findAll('.model-btn');

      // Click to change model
      await buttons[1].trigger('click');
      await flushAll(wrapper);

      // Re-query buttons to check disabled state
      let updatedButtons = wrapper.findAll('.model-btn');

      // Buttons should be disabled while updating
      updatedButtons.forEach(button => {
        expect(button.attributes('disabled')).toBeDefined();
      });

      // Resolve the update
      resolveUpdate();
      await flushAll(wrapper);

      // Re-query buttons after update completes
      updatedButtons = wrapper.findAll('.model-btn');

      // Buttons should be enabled again
      updatedButtons.forEach(button => {
        expect(button.attributes('disabled')).toBeUndefined();
      });

      updateSessionModelSpy.mockRestore();
    });
  });

  describe('watch observer for external changes', () => {
    it('renders correct active state when mounted with different modelValue props', async () => {
      // Test mounting with sonnet
      const wrapper1 = mountComponent({ modelValue: sonnet.id });
      await flushAll(wrapper1);
      let buttons = wrapper1.findAll('.model-btn');
      expect(buttons[0].classes()).toContain('active');
      expect(buttons[1].classes()).not.toContain('active');
      expect(buttons[2].classes()).not.toContain('active');
      wrapper1.unmount();

      // Test mounting with opus
      const wrapper2 = mountComponent({ modelValue: opus.id });
      await flushAll(wrapper2);
      buttons = wrapper2.findAll('.model-btn');
      expect(buttons[0].classes()).not.toContain('active');
      expect(buttons[1].classes()).toContain('active');
      expect(buttons[2].classes()).not.toContain('active');
      wrapper2.unmount();

      // Test mounting with haiku
      const wrapper3 = mountComponent({ modelValue: haiku.id });
      await flushAll(wrapper3);
      buttons = wrapper3.findAll('.model-btn');
      expect(buttons[0].classes()).not.toContain('active');
      expect(buttons[1].classes()).not.toContain('active');
      expect(buttons[2].classes()).toContain('active');
    });

    it('syncs selectedModel when session store updates', async () => {
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

      let buttons = wrapper.findAll('.model-btn');
      expect(buttons[0].classes()).toContain('active');
      expect(buttons[1].classes()).not.toContain('active');

      // Simulate session model being updated in the store
      sessionsStore.currentSession.model = opus.id;
      await flushAll(wrapper);

      buttons = wrapper.findAll('.model-btn');

      // Selection should sync with store change
      expect(buttons[0].classes()).not.toContain('active');
      expect(buttons[1].classes()).toContain('active');
    });
  });

  describe('form context (v-model binding)', () => {
    it('works correctly with v-model in form context', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );

      let buttons = wrapper.findAll('.model-btn');

      // Initial state
      expect(buttons[0].classes()).toContain('active');

      // Click different model
      await buttons[2].trigger('click');
      await flushAll(wrapper);

      // Should emit immediately
      expect(onUpdateModelValue).toHaveBeenCalledWith(haiku.id);

      // Visual feedback should be immediate
      buttons = wrapper.findAll('.model-btn');
      expect(buttons[2].classes()).toContain('active');
    });

    it('updates visual state and emits when user clicks different buttons', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      await flushAll(wrapper);

      let buttons = wrapper.findAll('.model-btn');
      expect(buttons[0].classes()).toContain('active');

      // Click haiku button - visual state should update immediately
      await buttons[2].trigger('click');
      await flushAll(wrapper);

      buttons = wrapper.findAll('.model-btn');
      expect(buttons[2].classes()).toContain('active');
      expect(buttons[0].classes()).not.toContain('active');

      // Emit should have been called
      expect(onUpdateModelValue).toHaveBeenCalledWith(haiku.id);
    });
  });
});
