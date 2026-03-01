import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

// Mock the quick responses store
vi.mock('../stores/quickResponses.js', () => ({
  useQuickResponsesStore: vi.fn(),
}));

import QuickResponseSettings from './QuickResponseSettings.vue';
import { useQuickResponsesStore } from '../stores/quickResponses.js';

// Create a stub for Teleport that renders the slot
const TeleportStub = defineComponent({
  name: 'Teleport',
  setup(_, { slots }) {
    return () => slots.default?.();
  },
});

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
      reorderResponses: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(useQuickResponsesStore).mockReturnValue(mockStore);
  });

  function mountComponent(props = {}) {
    return mount(QuickResponseSettings, {
      props: {
        isOpen: true,
        projectId: 'test-project',
        ...props,
      },
      global: {
        components: {
          Teleport: TeleportStub,
        },
        stubs: {
          QuickResponseDialog: true,
        },
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

  describe('reorder controls', () => {
    it('moveResponse function calls store.reorderResponses with correct project ID', async () => {
      mockStore.projectResponses = [
        { id: '1', label: 'Response 1', content: 'Content 1', autoSubmit: false, projectId: 'test-project' },
        { id: '2', label: 'Response 2', content: 'Content 2', autoSubmit: false, projectId: 'test-project' },
        { id: '3', label: 'Response 3', content: 'Content 3', autoSubmit: false, projectId: 'test-project' },
      ];

      const wrapper = mountComponent();
      const vm = wrapper.vm;

      // Move item at index 0 down (direction: 1)
      await vm.moveResponse('test-project', mockStore.projectResponses, 0, 1);

      expect(mockStore.reorderResponses).toHaveBeenCalledWith('test-project', ['2', '1', '3']);
    });

    it('moveResponse function calls store.reorderResponses with null for global responses', async () => {
      mockStore.globalResponses = [
        { id: 'g1', label: 'Global 1', content: 'Content 1', autoSubmit: false, projectId: null },
        { id: 'g2', label: 'Global 2', content: 'Content 2', autoSubmit: false, projectId: null },
      ];

      const wrapper = mountComponent();
      const vm = wrapper.vm;

      // Move item at index 0 down (direction: 1)
      await vm.moveResponse(null, mockStore.globalResponses, 0, 1);

      expect(mockStore.reorderResponses).toHaveBeenCalledWith(null, ['g2', 'g1']);
    });

    it('moveResponse function does not call store when moving out of bounds', async () => {
      mockStore.projectResponses = [
        { id: '1', label: 'Response 1', content: 'Content 1', autoSubmit: false, projectId: 'test-project' },
      ];

      const wrapper = mountComponent();
      const vm = wrapper.vm;

      // Try to move first item up (out of bounds)
      await vm.moveResponse('test-project', mockStore.projectResponses, 0, -1);

      expect(mockStore.reorderResponses).not.toHaveBeenCalled();
    });

    it('moveResponse function correctly swaps adjacent items', async () => {
      mockStore.projectResponses = [
        { id: '1', label: 'Response 1', content: 'Content 1', autoSubmit: false, projectId: 'test-project' },
        { id: '2', label: 'Response 2', content: 'Content 2', autoSubmit: false, projectId: 'test-project' },
        { id: '3', label: 'Response 3', content: 'Content 3', autoSubmit: false, projectId: 'test-project' },
      ];

      const wrapper = mountComponent();
      const vm = wrapper.vm;

      // Move item at index 1 up (direction: -1)
      await vm.moveResponse('test-project', mockStore.projectResponses, 1, -1);

      expect(mockStore.reorderResponses).toHaveBeenCalledWith('test-project', ['2', '1', '3']);
    });

    it('moveResponse function handles errors gracefully', async () => {
      mockStore.projectResponses = [
        { id: '1', label: 'Response 1', content: 'Content 1', autoSubmit: false, projectId: 'test-project' },
        { id: '2', label: 'Response 2', content: 'Content 2', autoSubmit: false, projectId: 'test-project' },
      ];

      mockStore.reorderResponses.mockRejectedValue(new Error('API Error'));

      const wrapper = mountComponent();
      const vm = wrapper.vm;

      // Should not throw, just log the error
      await expect(vm.moveResponse('test-project', mockStore.projectResponses, 0, 1)).resolves.not.toThrow();
    });
  });
});
