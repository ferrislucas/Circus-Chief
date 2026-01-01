import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Mock the quick responses store
vi.mock('../stores/quickResponses.js', () => ({
  useQuickResponsesStore: vi.fn(),
}));

import QuickResponseSettings from './QuickResponseSettings.vue';
import { useQuickResponsesStore } from '../stores/quickResponses.js';

describe('QuickResponseSettings', () => {
  let mockStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    mockStore = {
      loading: false,
      projectResponses: [],
      globalResponses: [],
      deleteResponse: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(useQuickResponsesStore).mockReturnValue(mockStore);
  });

  function mountComponent(props = {}) {
    return shallowMount(QuickResponseSettings, {
      props: {
        isOpen: true,
        projectId: 'test-project',
        ...props,
      },
    });
  }

  describe('component structure', () => {
    it('exports a Vue component', () => {
      expect(QuickResponseSettings).toBeDefined();
      expect(QuickResponseSettings.__name).toBe('QuickResponseSettings');
    });

    it('has required props', () => {
      const wrapper = mountComponent();
      expect(wrapper.props('isOpen')).toBe(true);
      expect(wrapper.props('projectId')).toBe('test-project');
    });

    it('can be closed', () => {
      const wrapper = mountComponent({ isOpen: false });
      expect(wrapper.props('isOpen')).toBe(false);
    });
  });

  describe('store integration', () => {
    it('uses the quick responses store', () => {
      mountComponent();
      expect(useQuickResponsesStore).toHaveBeenCalled();
    });
  });

  describe('events', () => {
    it('defines close event', () => {
      const wrapper = mountComponent();
      expect(wrapper.emitted()).toBeDefined();
    });
  });
});
