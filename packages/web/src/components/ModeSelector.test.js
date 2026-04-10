import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import ModeSelector from './ModeSelector.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

const modes = [
  { value: 'plan', label: 'Plan' },
  { value: 'standard', label: 'Standard' },
  { value: 'yolo', label: 'YOLO' },
];

// Global helper to flush all async updates and force DOM re-render
async function flushAll(wrapper) {
  await flushPromises();
  await nextTick();
  if (wrapper && wrapper.vm) {
    await wrapper.vm.$nextTick?.();
  }
}

describe('ModeSelector', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mountComponent = (props = {}, attrs = {}) => mount(ModeSelector, {
      props: {
        modelValue: 'yolo',
        ...props,
      },
      attrs,
    });

  describe('rendering', () => {
    it('renders a select dropdown', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('select').exists()).toBe(true);
    });

    it('renders all three mode options', () => {
      const wrapper = mountComponent();
      const options = wrapper.findAll('option');
      expect(options).toHaveLength(3);
    });

    it('displays mode labels in options', () => {
      const wrapper = mountComponent();
      const options = wrapper.findAll('option');
      expect(options[0].text()).toBe('Plan');
      expect(options[1].text()).toBe('Standard');
      expect(options[2].text()).toBe('YOLO');
    });

    it('sets correct values for options', () => {
      const wrapper = mountComponent();
      const options = wrapper.findAll('option');
      expect(options[0].element.value).toBe('plan');
      expect(options[1].element.value).toBe('standard');
      expect(options[2].element.value).toBe('yolo');
    });
  });

  describe('selected state', () => {
    it('marks plan as selected when modelValue is plan', () => {
      const wrapper = mountComponent({ modelValue: 'plan' });
      const select = wrapper.find('select');
      expect(select.element.value).toBe('plan');
    });

    it('marks standard as selected when modelValue is standard', () => {
      const wrapper = mountComponent({ modelValue: 'standard' });
      const select = wrapper.find('select');
      expect(select.element.value).toBe('standard');
    });

    it('marks yolo as selected when modelValue is yolo', () => {
      const wrapper = mountComponent({ modelValue: 'yolo' });
      const select = wrapper.find('select');
      expect(select.element.value).toBe('yolo');
    });
  });

  describe('interactions', () => {
    it('emits update:modelValue when selection changes', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: 'yolo' },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const select = wrapper.find('select');

      await select.setValue('plan');
      await flushAll(wrapper);

      expect(onUpdateModelValue).toHaveBeenCalledWith('plan');
    });

    it('emits correct mode value for each option', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: 'yolo' },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const select = wrapper.find('select');

      // Change to plan
      await select.setValue('plan');
      await flushAll(wrapper);
      expect(onUpdateModelValue).toHaveBeenCalledWith('plan');

      // Change to standard
      await select.setValue('standard');
      await flushAll(wrapper);
      expect(onUpdateModelValue).toHaveBeenCalledWith('standard');

      expect(onUpdateModelValue).toHaveBeenCalledTimes(2);
    });

    it('does not emit when selecting the same mode', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: 'yolo' },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const select = wrapper.find('select');

      await select.setValue('yolo');
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
      const wrapper = mountComponent({ modelValue: 'yolo' });
      let select = wrapper.find('select');

      // Initial value
      expect(select.element.value).toBe('yolo');

      // Change to plan
      await select.setValue('plan');
      await nextTick();

      select = wrapper.find('select');
      expect(select.element.value).toBe('plan');
    });

    it('emits update:modelValue immediately in form context', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: 'yolo' },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const select = wrapper.find('select');

      await select.setValue('standard');
      await flushAll(wrapper);

      expect(onUpdateModelValue).toHaveBeenCalledWith('standard');
      expect(onUpdateModelValue).toHaveBeenCalledTimes(1);
    });
  });

  describe('session context with store updates', () => {
    it('updates store and maintains selection on success', async () => {
      const sessionsStore = useSessionsStore();
      const updateSessionModeSpy = vi.spyOn(sessionsStore, 'updateSessionMode').mockResolvedValue(undefined);

      // Set up the session store BEFORE creating the component
      sessionsStore.currentSession = {
        id: 'test-session',
        mode: 'yolo',
      };

      const wrapper = mountComponent({
        sessionId: 'test-session',
        modelValue: 'yolo',
      });

      await flushAll(wrapper);

      let select = wrapper.find('select');
      expect(select.element.value).toBe('yolo');

      // Change to plan
      await select.setValue('plan');
      await flushAll(wrapper);

      // Selection should be updated
      select = wrapper.find('select');
      expect(select.element.value).toBe('plan');

      // Wait for the store update to complete
      await flushAll(wrapper);

      // Store should have been called with the new mode
      expect(updateSessionModeSpy).toHaveBeenCalledWith('test-session', 'plan');

      updateSessionModeSpy.mockRestore();
    });

    it('calls store method with correct parameters on update', async () => {
      const sessionsStore = useSessionsStore();
      const updateSessionModeSpy = vi.spyOn(sessionsStore, 'updateSessionMode').mockResolvedValue(undefined);

      // Set up the session store BEFORE creating the component
      sessionsStore.currentSession = {
        id: 'test-session',
        mode: 'yolo',
      };

      const wrapper = mountComponent({
        sessionId: 'test-session',
        modelValue: 'yolo',
      });

      await flushAll(wrapper);

      const select = wrapper.find('select');

      // Change to standard
      await select.setValue('standard');
      await flushAll(wrapper);

      // Store method should have been called
      expect(updateSessionModeSpy).toHaveBeenCalledWith('test-session', 'standard');

      updateSessionModeSpy.mockRestore();
    });

    it('disables select while store update is in progress', async () => {
      const sessionsStore = useSessionsStore();
      let resolveUpdate;
      const updatePromise = new Promise(resolve => {
        resolveUpdate = resolve;
      });

      const updateSessionModeSpy = vi
        .spyOn(sessionsStore, 'updateSessionMode')
        .mockReturnValue(updatePromise);

      // Set up the session store BEFORE creating the component
      sessionsStore.currentSession = {
        id: 'test-session',
        mode: 'yolo',
      };

      const wrapper = mountComponent({
        sessionId: 'test-session',
        modelValue: 'yolo',
      });

      await flushAll(wrapper);

      let select = wrapper.find('select');
      expect(select.element.disabled).toBe(false);

      // Change to plan
      await select.setValue('plan');
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

      updateSessionModeSpy.mockRestore();
    });
  });

  describe('watch observer for external changes', () => {
    it('renders correct selected state when mounted with different modelValue props', async () => {
      // Test mounting with plan
      const wrapper1 = mountComponent({ modelValue: 'plan' });
      await flushAll(wrapper1);
      let select = wrapper1.find('select');
      expect(select.element.value).toBe('plan');
      wrapper1.unmount();

      // Test mounting with standard
      const wrapper2 = mountComponent({ modelValue: 'standard' });
      await flushAll(wrapper2);
      select = wrapper2.find('select');
      expect(select.element.value).toBe('standard');
      wrapper2.unmount();

      // Test mounting with yolo
      const wrapper3 = mountComponent({ modelValue: 'yolo' });
      await flushAll(wrapper3);
      select = wrapper3.find('select');
      expect(select.element.value).toBe('yolo');
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
        mode: 'yolo',
      };

      await flushAll(wrapper);

      let select = wrapper.find('select');
      expect(select.element.value).toBe('yolo');

      // Simulate session mode being updated in the store
      sessionsStore.currentSession.mode = 'plan';
      await flushAll(wrapper);

      select = wrapper.find('select');

      // Selection should sync with store change
      expect(select.element.value).toBe('plan');
    });
  });

  describe('form context (v-model binding)', () => {
    it('works correctly with v-model in form context', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: 'yolo' },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );

      let select = wrapper.find('select');

      // Initial state
      expect(select.element.value).toBe('yolo');

      // Change to standard
      await select.setValue('standard');
      await flushAll(wrapper);

      // Should emit immediately
      expect(onUpdateModelValue).toHaveBeenCalledWith('standard');

      // Visual feedback should be immediate
      select = wrapper.find('select');
      expect(select.element.value).toBe('standard');
    });

    it('updates visual state and emits when user selects different options', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: 'yolo' },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      await flushAll(wrapper);

      let select = wrapper.find('select');
      expect(select.element.value).toBe('yolo');

      // Change to plan - visual state should update immediately
      await select.setValue('plan');
      await flushAll(wrapper);

      select = wrapper.find('select');
      expect(select.element.value).toBe('plan');

      // Emit should have been called
      expect(onUpdateModelValue).toHaveBeenCalledWith('plan');
    });
  });
});
