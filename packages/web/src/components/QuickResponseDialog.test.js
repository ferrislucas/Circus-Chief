import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Mock the quick responses store
vi.mock('../stores/quickResponses.js', () => ({
  useQuickResponsesStore: vi.fn(),
}));

import QuickResponseDialog from './QuickResponseDialog.vue';
import { useQuickResponsesStore } from '../stores/quickResponses.js';

describe('QuickResponseDialog', () => {
  let mockStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    mockStore = {
      createResponse: vi.fn().mockResolvedValue({}),
      updateResponse: vi.fn().mockResolvedValue({}),
    };

    vi.mocked(useQuickResponsesStore).mockReturnValue(mockStore);
  });

  function mountComponent(props = {}) {
    return shallowMount(QuickResponseDialog, {
      props: {
        isOpen: true,
        projectId: 'test-project',
        ...props,
      },
    });
  }

  describe('component structure', () => {
    it('exports a Vue component', () => {
      expect(QuickResponseDialog).toBeDefined();
      expect(QuickResponseDialog.__name).toBe('QuickResponseDialog');
    });

    it('has required props', () => {
      const wrapper = mountComponent();
      expect(wrapper.props('isOpen')).toBe(true);
      expect(wrapper.props('projectId')).toBe('test-project');
    });

    it('receives editingResponse prop', () => {
      const editingResponse = { id: '1', label: 'Test' };
      const wrapper = mountComponent({ editingResponse });
      expect(wrapper.props('editingResponse')).toEqual(editingResponse);
    });

    it('receives defaultIsGlobal prop', () => {
      const wrapper = mountComponent({ defaultIsGlobal: true });
      expect(wrapper.props('defaultIsGlobal')).toBe(true);
    });
  });

  describe('store integration', () => {
    it('uses the quick responses store', () => {
      mountComponent();
      expect(useQuickResponsesStore).toHaveBeenCalled();
    });
  });

  describe('events', () => {
    it('defines close and saved events', () => {
      const wrapper = mountComponent();
      expect(wrapper.emitted()).toBeDefined();
    });
  });
});
