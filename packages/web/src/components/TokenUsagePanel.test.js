import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

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
      // Issue #175 - Conversation-level token tracking
      contextPercentage: 0,
      conversationTokens: null,
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

    it('renders compact view with token count and context bar', () => {
      mockSessionsStore.formattedTokens = {
        input: '1K',
        output: '500',
        total: '1.5K',
        cacheRead: '0',
        cacheCreation: '0',
      };
      mockSessionsStore.contextPercentage = 10;

      const wrapper = mountComponent();

      expect(wrapper.find('.usage-compact').exists()).toBe(true);
      expect(wrapper.find('.compact-tokens').exists()).toBe(true);
      expect(wrapper.find('.context-bar-compact').exists()).toBe(true);
    });

    it('displays total token count', () => {
      mockSessionsStore.formattedTokens = {
        input: '1.5K',
        output: '500',
        total: '2K',
        cacheRead: '0',
        cacheCreation: '0',
      };

      const wrapper = mountComponent();

      expect(wrapper.find('.total-label').text()).toBe('2K');
      expect(wrapper.find('.total-suffix').text()).toBe('tokens');
    });
  });

  describe('context bar', () => {
    it('always shows context bar in compact view', () => {
      mockSessionsStore.contextPercentage = 25;

      const wrapper = mountComponent();

      expect(wrapper.find('.context-bar-compact').exists()).toBe(true);
      expect(wrapper.find('.context-bar-track-compact').exists()).toBe(true);
      expect(wrapper.find('.context-bar-fill').exists()).toBe(true);
    });

    it('shows context percentage', () => {
      mockSessionsStore.contextPercentage = 25;

      const wrapper = mountComponent();

      expect(wrapper.find('.context-pct').text()).toBe('25%');
    });

    it('sets context bar width from percentage', () => {
      mockSessionsStore.contextPercentage = 50;

      const wrapper = mountComponent();

      const fill = wrapper.find('.context-bar-fill');
      expect(fill.attributes('style')).toContain('width: 50%');
    });

    it('shows normal style for low usage (under 70%)', () => {
      mockSessionsStore.contextPercentage = 30;

      const wrapper = mountComponent();

      expect(wrapper.find('.context-bar-fill.normal').exists()).toBe(true);
    });

    it('shows warning style for 70-89% usage', () => {
      mockSessionsStore.contextPercentage = 75;

      const wrapper = mountComponent();

      expect(wrapper.find('.context-bar-fill.warning').exists()).toBe(true);
    });

    it('shows critical style for 90%+ usage', () => {
      mockSessionsStore.contextPercentage = 95;

      const wrapper = mountComponent();

      expect(wrapper.find('.context-bar-fill.critical').exists()).toBe(true);
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

  describe('details toggle button', () => {
    it('does not show toggle button when no cache tokens', () => {
      mockSessionsStore.currentSession = {
        id: 'session-1',
        inputTokens: 1000,
        outputTokens: 500,
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
    });

    it('toggles details on button click', async () => {
      mockSessionsStore.currentSession = {
        id: 'session-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 50,
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
      await flushAll(wrapper);

      expect(wrapper.find('.usage-details').exists()).toBe(true);

      // Click to hide details
      await wrapper.find('.toggle-details').trigger('click');
      await flushAll(wrapper);

      expect(wrapper.find('.usage-details').exists()).toBe(false);
    });
  });

  describe('details section', () => {
    it('shows input, output, cache read and cache creation values', async () => {
      mockSessionsStore.currentSession = {
        id: 'session-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 100,
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
      await flushAll(wrapper);

      expect(wrapper.text()).toContain('Input');
      expect(wrapper.text()).toContain('Output');
      expect(wrapper.text()).toContain('Cache Read');
      expect(wrapper.text()).toContain('Cache Creation');
      expect(wrapper.text()).toContain('1K');
      expect(wrapper.text()).toContain('500');
      expect(wrapper.text()).toContain('200');
      expect(wrapper.text()).toContain('100');
    });
  });

  // Issue #175 - Conversation-level token tracking
  describe('conversation-level data', () => {
    it('uses conversation tokens when available for hasDetailsToShow', () => {
      mockSessionsStore.conversationTokens = {
        inputTokens: 500,
        outputTokens: 250,
        cacheReadInputTokens: 50,
        cacheCreationInputTokens: 25,
      };

      const wrapper = mountComponent();

      // Should show toggle button because conversationTokens has cache data
      expect(wrapper.find('.toggle-details').exists()).toBe(true);
    });

    it('uses store contextPercentage getter', () => {
      mockSessionsStore.contextPercentage = 42;

      const wrapper = mountComponent();

      expect(wrapper.find('.context-pct').text()).toBe('42%');
    });

    it('displays formatted total from store', () => {
      mockSessionsStore.formattedTokens = {
        input: '2K',
        output: '1K',
        total: '3K',
        cacheRead: '0',
        cacheCreation: '0',
      };

      const wrapper = mountComponent();

      expect(wrapper.find('.total-label').text()).toBe('3K');
    });
  });
});
