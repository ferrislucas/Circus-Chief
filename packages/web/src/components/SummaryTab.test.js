import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, shallowMount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

// Mock the API - MUST be before imports that use it
vi.mock('../composables/useApi.js', () => ({
  api: {
    getSessionSummary: vi.fn().mockResolvedValue(null),
    regenerateSessionSummary: vi.fn().mockResolvedValue({ shortSummary: 'Test summary' }),
    generateSessionSummary: vi.fn().mockResolvedValue({ shortSummary: 'Test summary' }),
  },
}));

// Note: Not mocking sessions and UI stores - will use actual Pinia instances

// Mock WebSocket composable
vi.mock('../composables/useWebSocket.js', () => ({
  useSessionSubscription: vi.fn(() => ({
    onSummaryUpdate: vi.fn(() => vi.fn()),
    onSummaryGenerating: vi.fn(() => vi.fn()),
  })),
}));

// Mock router
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

import SummaryTab from './SummaryTab.vue';
import { api } from '../composables/useApi.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

describe('SummaryTab', () => {
  let sessionsStore;
  let uiStore;
  let consoleError;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Get actual store instances
    sessionsStore = useSessionsStore();
    uiStore = useUiStore();

    // Initialize store with test data
    sessionsStore.sessions = [{ id: 'sess-123', status: 'waiting' }];
    sessionsStore.currentSession = { id: 'sess-123', status: 'waiting' };

    // Mock store methods
    vi.spyOn(uiStore, 'error').mockImplementation(() => {});
    vi.spyOn(uiStore, 'success').mockImplementation(() => {});

    consoleError = console.error;
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = consoleError;
  });

  function mountComponent(props = { sessionId: 'sess-123' }) {
    return mount(SummaryTab, {
      props,
      global: {
        stubs: {
          MarkdownViewer: { template: '<div class="markdown-stub"><slot /></div>' },
          SessionCardWorkflowPanel: { template: '<div class="workflow-panel-stub"></div>' },
        },
      },
    });
  }

  async function flushAll(wrapper) {
    await flushPromises();
    await nextTick();
    await wrapper.vm.$nextTick?.();
    // Force Vue to re-render with updated state (critical for v-if/v-for updates)
    await wrapper.vm.$forceUpdate();
    await nextTick();
    // Multiple update cycles to ensure all v-if/v-for conditions re-evaluate
    await wrapper.vm.$forceUpdate();
    await nextTick();
  }

  describe('Session Overview', () => {
    it('renders session overview section', async () => {
      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.session-overview').exists()).toBe(true);
      expect(wrapper.text()).toContain('Session Overview');
    });

    it('does not render overview-stats div', async () => {
      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.overview-stats').exists()).toBe(false);
    });

    it('does not have regenerate button in overview header', async () => {
      const wrapper = mountComponent();
      await flushAll(wrapper);

      const regenButton = wrapper.find('.overview-header .btn-link');
      expect(regenButton.exists()).toBe(false);
    });
  });

  describe('Child Sessions', () => {
    function mountForChildSessions(props = { sessionId: 'sess-123' }) {
      return shallowMount(SummaryTab, {
        props,
        global: {
          stubs: {
            RouterLink: { template: '<a><slot /></a>' },
          },
        },
      });
    }

    it('does not render SessionCardWorkflowPanel when no child sessions', async () => {
      // sessionsStore.sessions only contains the parent session with no parentSessionId
      // so getChildSessions('sess-123') returns []
      const wrapper = mountForChildSessions();
      await flushAll(wrapper);

      expect(wrapper.find('.workflow-sessions-panel').exists()).toBe(false);
    });

    it('renders SessionCardWorkflowPanel when child sessions exist', async () => {
      // Add a child session that has parentSessionId matching 'sess-123'
      sessionsStore.sessions = [
        { id: 'sess-123', status: 'waiting' },
        { id: 'child-1', name: 'Child Session', status: 'completed', parentSessionId: 'sess-123' },
      ];

      const wrapper = mountForChildSessions();
      await flushAll(wrapper);

      expect(wrapper.find('.workflow-sessions-panel').exists()).toBe(true);
    });
  });

});
