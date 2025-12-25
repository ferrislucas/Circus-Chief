import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Mock the sessions store
vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(),
}));

import TokenUsagePanel from './TokenUsagePanel.vue';
import { useSessionsStore } from '../stores/sessions.js';

describe('TokenUsagePanel', () => {
  let mockSessionsStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    mockSessionsStore = {
      currentSession: null,
      formattedTokens: { input: '0', output: '0', total: '0', cacheRead: '0', cacheCreation: '0' },
      isUsageUpdating: false,
    };

    vi.mocked(useSessionsStore).mockReturnValue(mockSessionsStore);
  });

  function mountComponent() {
    return mount(TokenUsagePanel, {
      global: {
        stubs: {},
      },
    });
  }

  describe('basic rendering', () => {
    it('renders the panel', () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.token-usage-panel').exists()).toBe(true);
    });

    it('displays token usage title', () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.usage-title').text()).toBe('Token Usage');
    });

    it('displays input, output, and total stats', () => {
      mockSessionsStore.formattedTokens = {
        input: '1.5K',
        output: '500',
        total: '2K',
        cacheRead: '0',
        cacheCreation: '0',
      };

      const wrapper = mountComponent();

      const stats = wrapper.findAll('.stat');
      expect(stats).toHaveLength(3);

      expect(wrapper.text()).toContain('Input');
      expect(wrapper.text()).toContain('Output');
      expect(wrapper.text()).toContain('Total');
      expect(wrapper.text()).toContain('1.5K');
      expect(wrapper.text()).toContain('500');
      expect(wrapper.text()).toContain('2K');
    });
  });

  describe('updating indicator', () => {
    it('does not show updating indicator when not updating', () => {
      mockSessionsStore.isUsageUpdating = false;

      const wrapper = mountComponent();

      expect(wrapper.find('.updating-indicator').exists()).toBe(false);
    });

    it('shows updating indicator when usage is updating', () => {
      mockSessionsStore.isUsageUpdating = true;

      const wrapper = mountComponent();

      expect(wrapper.find('.updating-indicator').exists()).toBe(true);
      expect(wrapper.findAll('.updating-indicator .dot')).toHaveLength(3);
    });
  });

  describe('show details button', () => {
    it('does not show toggle button when no details to show', () => {
      mockSessionsStore.currentSession = {
        id: 'session-1',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };

      const wrapper = mountComponent();

      expect(wrapper.find('.toggle-details').exists()).toBe(false);
    });

    it('shows toggle button when cache tokens exist', () => {
      mockSessionsStore.currentSession = {
        id: 'session-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 0,
      };

      const wrapper = mountComponent();

      expect(wrapper.find('.toggle-details').exists()).toBe(true);
      expect(wrapper.find('.toggle-details').text()).toBe('Show details');
    });

    it('toggles details on button click', async () => {
      mockSessionsStore.currentSession = {
        id: 'session-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 50,
        contextWindow: 200000,
      };
      mockSessionsStore.formattedTokens = {
        input: '1K',
        output: '500',
        total: '1.5K',
        cacheRead: '100',
        cacheCreation: '50',
      };

      const wrapper = mountComponent();

      // Initially details should be hidden
      expect(wrapper.find('.usage-details').exists()).toBe(false);

      // Click to show details
      await wrapper.find('.toggle-details').trigger('click');

      expect(wrapper.find('.usage-details').exists()).toBe(true);
      expect(wrapper.find('.toggle-details').text()).toBe('Hide details');

      // Click to hide details
      await wrapper.find('.toggle-details').trigger('click');

      expect(wrapper.find('.usage-details').exists()).toBe(false);
    });
  });

  describe('details section', () => {
    it('shows cache read and creation values', async () => {
      mockSessionsStore.currentSession = {
        id: 'session-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 100,
        contextWindow: 200000,
      };
      mockSessionsStore.formattedTokens = {
        input: '1K',
        output: '500',
        total: '1.5K',
        cacheRead: '200',
        cacheCreation: '100',
      };

      const wrapper = mountComponent();
      await wrapper.find('.toggle-details').trigger('click');

      expect(wrapper.text()).toContain('Cache Read');
      expect(wrapper.text()).toContain('200');
      expect(wrapper.text()).toContain('Cache Creation');
      expect(wrapper.text()).toContain('100');
    });

    it('shows context bar when tokens exist', async () => {
      mockSessionsStore.currentSession = {
        id: 'session-1',
        inputTokens: 10000,
        outputTokens: 5000,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 0,
        contextWindow: 200000,
      };

      const wrapper = mountComponent();
      await wrapper.find('.toggle-details').trigger('click');

      expect(wrapper.find('.context-bar').exists()).toBe(true);
      expect(wrapper.text()).toContain('Context Usage');
    });
  });

  describe('context bar styling', () => {
    it('shows normal style for low usage', async () => {
      mockSessionsStore.currentSession = {
        id: 'session-1',
        inputTokens: 50000,
        outputTokens: 10000,
        cacheReadInputTokens: 100,
        contextWindow: 200000,
      };

      const wrapper = mountComponent();
      await wrapper.find('.toggle-details').trigger('click');

      expect(wrapper.find('.context-bar-fill.normal').exists()).toBe(true);
    });

    it('shows warning style for 70-89% usage', async () => {
      mockSessionsStore.currentSession = {
        id: 'session-1',
        inputTokens: 140000,
        outputTokens: 10000,
        cacheReadInputTokens: 100,
        contextWindow: 200000,
      };

      const wrapper = mountComponent();
      await wrapper.find('.toggle-details').trigger('click');

      expect(wrapper.find('.context-bar-fill.warning').exists()).toBe(true);
    });

    it('shows critical style for 90%+ usage', async () => {
      mockSessionsStore.currentSession = {
        id: 'session-1',
        inputTokens: 180000,
        outputTokens: 10000,
        cacheReadInputTokens: 100,
        contextWindow: 200000,
      };

      const wrapper = mountComponent();
      await wrapper.find('.toggle-details').trigger('click');

      expect(wrapper.find('.context-bar-fill.critical').exists()).toBe(true);
    });
  });

  describe('formatted values', () => {
    it('displays formatted token values from store', () => {
      mockSessionsStore.formattedTokens = {
        input: '5.5K',
        output: '2.5K',
        total: '8K',
        cacheRead: '1K',
        cacheCreation: '500',
      };

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('5.5K');
      expect(wrapper.text()).toContain('2.5K');
      expect(wrapper.text()).toContain('8K');
    });
  });
});
