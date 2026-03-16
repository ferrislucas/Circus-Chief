import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import EffortLevelSelector from './EffortLevelSelector.vue';

// Mock the sessions store
vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(),
}));

// Mock the UI store
vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(),
}));

import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

describe('EffortLevelSelector', () => {
  let mockSessionsStore;
  let mockUiStore;

  beforeEach(() => {
    setActivePinia(createPinia());

    mockSessionsStore = {
      currentSession: null,
      updateSession: vi.fn().mockResolvedValue({}),
    };
    useSessionsStore.mockReturnValue(mockSessionsStore);

    mockUiStore = {
      error: vi.fn(),
    };
    useUiStore.mockReturnValue(mockUiStore);
  });

  describe('rendering', () => {
    it('renders select element with correct options', () => {
      const wrapper = mount(EffortLevelSelector, {
        props: {
          modelValue: 'medium',
        },
      });

      const select = wrapper.find('select');
      expect(select.exists()).toBe(true);

      const options = select.findAll('option');
      expect(options).toHaveLength(5);
      expect(options[0].text()).toBe('Auto Effort');
      expect(options[0].attributes('value')).toBe('auto');
      expect(options[1].text()).toBe('Low Effort');
      expect(options[1].attributes('value')).toBe('low');
      expect(options[2].text()).toBe('Medium Effort');
      expect(options[2].attributes('value')).toBe('medium');
      expect(options[3].text()).toBe('High Effort');
      expect(options[3].attributes('value')).toBe('high');
      expect(options[4].text()).toBe('Max Effort');
      expect(options[4].attributes('value')).toBe('max');
    });

    it('selects correct option based on modelValue prop', async () => {
      const wrapper = mount(EffortLevelSelector, {
        props: {
          modelValue: 'high',
        },
      });

      await nextTick();

      const select = wrapper.find('select');
      expect(select.element.value).toBe('high');
    });

    it('selects auto when modelValue is null', async () => {
      const wrapper = mount(EffortLevelSelector, {
        props: {
          modelValue: null,
        },
      });

      await nextTick();

      const select = wrapper.find('select');
      expect(select.element.value).toBe('auto');
    });

    it('is disabled when disabled prop is true', () => {
      const wrapper = mount(EffortLevelSelector, {
        props: {
          modelValue: 'medium',
          disabled: true,
        },
      });

      const select = wrapper.find('select');
      expect(select.attributes('disabled')).toBeDefined();
    });

    it('is not disabled by default', () => {
      const wrapper = mount(EffortLevelSelector, {
        props: {
          modelValue: 'medium',
        },
      });

      const select = wrapper.find('select');
      expect(select.attributes('disabled')).toBeUndefined();
    });
  });

  describe('v-model support (standalone mode)', () => {
    it('does not emit when value does not change', async () => {
      const wrapper = mount(EffortLevelSelector, {
        props: {
          modelValue: 'medium',
        },
      });

      const select = wrapper.find('select');
      await select.setValue('medium');

      expect(wrapper.emitted('update:modelValue')).toBeFalsy();
    });
  });

  describe('session mode (with sessionId prop)', () => {
    it('uses session effortLevel from store', async () => {
      mockSessionsStore.currentSession = {
        id: 'session-123',
        effortLevel: 'max',
      };

      const wrapper = mount(EffortLevelSelector, {
        props: {
          sessionId: 'session-123',
        },
      });

      await nextTick();

      const select = wrapper.find('select');
      expect(select.element.value).toBe('max');
    });

    it('defaults to auto when session has no effortLevel', async () => {
      mockSessionsStore.currentSession = {
        id: 'session-123',
        effortLevel: null,
      };

      const wrapper = mount(EffortLevelSelector, {
        props: {
          sessionId: 'session-123',
        },
      });

      await nextTick();

      const select = wrapper.find('select');
      expect(select.element.value).toBe('auto');
    });

    it('calls updateSession on store when selection changes', async () => {
      mockSessionsStore.currentSession = {
        id: 'session-123',
        effortLevel: 'low',
      };

      const wrapper = mount(EffortLevelSelector, {
        props: {
          sessionId: 'session-123',
        },
      });

      await nextTick();

      const select = wrapper.find('select');
      await select.setValue('high');
      await flushPromises();

      expect(mockSessionsStore.updateSession).toHaveBeenCalledWith('session-123', {
        effortLevel: 'high',
      });
    });

    it('converts auto to null when calling updateSession', async () => {
      mockSessionsStore.currentSession = {
        id: 'session-123',
        effortLevel: 'high',
      };

      const wrapper = mount(EffortLevelSelector, {
        props: {
          sessionId: 'session-123',
        },
      });

      await nextTick();

      const select = wrapper.find('select');
      await select.setValue('auto');
      await flushPromises();

      expect(mockSessionsStore.updateSession).toHaveBeenCalledWith('session-123', {
        effortLevel: null,
      });
    });
  });

  describe('reactivity', () => {
    it('updates selected value when modelValue prop changes', async () => {
      const wrapper = mount(EffortLevelSelector, {
        props: {
          modelValue: 'low',
        },
      });

      await nextTick();

      let select = wrapper.find('select');
      expect(select.element.value).toBe('low');

      await wrapper.setProps({ modelValue: 'max' });
      await nextTick();

      select = wrapper.find('select');
      expect(select.element.value).toBe('max');
    });
  });
});
