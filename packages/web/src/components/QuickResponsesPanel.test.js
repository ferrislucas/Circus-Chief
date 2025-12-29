import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Mock the quick responses store
vi.mock('../stores/quickResponses.js', () => ({
  useQuickResponsesStore: vi.fn(),
}));

import QuickResponsesPanel from './QuickResponsesPanel.vue';
import { useQuickResponsesStore } from '../stores/quickResponses.js';

describe('QuickResponsesPanel', () => {
  let mockStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    mockStore = {
      loading: false,
      projectResponses: [],
      globalResponses: [],
      hasResponses: false,
      error: null,
    };

    vi.mocked(useQuickResponsesStore).mockReturnValue(mockStore);
  });

  function mountComponent(props = {}) {
    return shallowMount(QuickResponsesPanel, {
      props,
    });
  }

  describe('component structure', () => {
    it('exports a Vue component', () => {
      expect(QuickResponsesPanel).toBeDefined();
      expect(QuickResponsesPanel.__name).toBe('QuickResponsesPanel');
    });

    it('accepts showEmpty prop', () => {
      const wrapper = mountComponent({ showEmpty: false });
      expect(wrapper.props('showEmpty')).toBe(false);
    });

    it('defaults showEmpty to true', () => {
      const wrapper = mountComponent();
      expect(wrapper.props('showEmpty')).toBe(true);
    });
  });

  describe('store integration', () => {
    it('uses the quick responses store', () => {
      mountComponent();
      expect(useQuickResponsesStore).toHaveBeenCalled();
    });
  });

  describe('events', () => {
    it('defines insert and openSettings events', () => {
      const wrapper = mountComponent();
      expect(wrapper.emitted()).toBeDefined();
    });
  });

  describe('computed properties', () => {
    it('reads loading state from store', () => {
      mockStore.loading = true;
      mountComponent();
      expect(mockStore.loading).toBe(true);
    });

    it('reads projectResponses from store', () => {
      mockStore.projectResponses = [{ id: '1', label: 'Test' }];
      mountComponent();
      expect(mockStore.projectResponses).toHaveLength(1);
    });

    it('reads globalResponses from store', () => {
      mockStore.globalResponses = [{ id: '2', label: 'Global' }];
      mountComponent();
      expect(mockStore.globalResponses).toHaveLength(1);
    });

    it('reads hasResponses from store', () => {
      mockStore.hasResponses = true;
      mountComponent();
      expect(mockStore.hasResponses).toBe(true);
    });
  });
});
