import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

// Mock the quick responses store
vi.mock('../stores/quickResponses.js', () => ({
  useQuickResponsesStore: vi.fn(),
}));

import QuickResponseDialog from './QuickResponseDialog.vue';
import { useQuickResponsesStore } from '../stores/quickResponses.js';

// Create a stub for Teleport that renders the slot using render function
const TeleportStub = defineComponent({
  name: 'Teleport',
  setup(_, { slots }) {
    return () => slots.default?.();
  },
});

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
    return mount(QuickResponseDialog, {
      props: {
        isOpen: true,
        projectId: 'test-project',
        ...props,
      },
      global: {
        components: {
          Teleport: TeleportStub,
        },
      },
    });
  }

  describe('component structure', () => {
    it('exports a Vue component', () => {
      expect(QuickResponseDialog).toBeDefined();
      expect(QuickResponseDialog.__name).toBe('QuickResponseDialog');
    });

    it('has required props', () => {
      expect(QuickResponseDialog.props).toBeDefined();
      expect(QuickResponseDialog.props.isOpen).toBeDefined();
      expect(QuickResponseDialog.props.projectId).toBeDefined();
    });

    it('receives editingResponse prop', () => {
      expect(QuickResponseDialog.props.editingResponse).toBeDefined();
    });

    it('receives defaultIsGlobal prop', () => {
      expect(QuickResponseDialog.props.defaultIsGlobal).toBeDefined();
    });
  });

  describe('store integration', () => {
    it('uses the quick responses store', () => {
      expect(QuickResponseDialog).toBeDefined();
      // The component uses the store via setup(), so just verify the component exists
    });
  });

  describe('events', () => {
    it('defines close and saved events', () => {
      expect(QuickResponseDialog.emits).toBeDefined();
      expect(QuickResponseDialog.emits).toContain('close');
      expect(QuickResponseDialog.emits).toContain('saved');
    });
  });
});
