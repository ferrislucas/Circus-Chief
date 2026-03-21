import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, shallowMount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

// Mock the API - MUST be before imports that use it
vi.mock('../composables/useApi.js', () => ({
  api: {
    getSessionSummary: vi.fn().mockResolvedValue(null),
    getSessionSummariesBatch: vi.fn().mockResolvedValue({}),
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

    // Reset API mock implementations to defaults
    api.getSessionSummary.mockResolvedValue(null);

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
          WhatJustHappenedCard: { template: '<div class="what-just-happened-card-stub"></div>' },
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
    it('does not render session overview when no PR info', async () => {
      // Default session has no prUrl, so no PR info
      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.session-overview').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('Session Overview');
    });

    it('renders session overview when PR info exists', async () => {
      // Setup session with PR URL and summary with prState
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        prUrl: 'https://github.com/example/repo/pull/123',
      };
      sessionsStore.sessions = [sessionsStore.currentSession];
      api.getSessionSummary.mockResolvedValue({
        prState: 'open',
        ciStatus: 'success',
      });

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
      // Setup session with PR info so the header is actually rendered
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        prUrl: 'https://github.com/example/repo/pull/123',
      };
      sessionsStore.sessions = [sessionsStore.currentSession];
      api.getSessionSummary.mockResolvedValue({
        prState: 'open',
        ciStatus: 'success',
      });

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
            WhatJustHappenedCard: { template: '<div class="what-just-happened-card-stub"></div>' },
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

      // Use mount instead of shallowMount to ensure component renders properly
      const wrapper = mount(SummaryTab, {
        props: { sessionId: 'sess-123' },
        global: {
          stubs: {
            RouterLink: { template: '<a><slot /></a>' },
          },
        },
      });
      await flushAll(wrapper);

      expect(wrapper.find('.workflow-sessions-panel').exists()).toBe(true);
    });
  });

  describe('WhatJustHappenedCard Integration', () => {
    it('renders WhatJustHappenedCard when session has descendants', async () => {
      sessionsStore.sessions = [
        { id: 'sess-123', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'child-1', name: 'Child Task', status: 'completed', parentSessionId: 'sess-123', updatedAt: '2024-01-01T01:00:00Z', lastActivityAt: '2024-01-01T01:00:00Z' },
      ];
      sessionsStore.currentSession = { id: 'sess-123', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' };

      // Use shallowMount to properly test stub rendering
      const wrapper = shallowMount(SummaryTab, {
        props: { sessionId: 'sess-123' },
        global: {
          stubs: {
            RouterLink: { template: '<a><slot /></a>' },
            WhatJustHappenedCard: {
              name: 'WhatJustHappenedCard',
              props: ['session', 'summary', 'descendantSummaries'],
              template: '<div class="what-just-happened-card-stub"></div>'
            },
          },
        },
      });
      await flushAll(wrapper);

      // Check for component existence (more reliable than stub class)
      const whatJustHappenedCard = wrapper.findComponent({ name: 'WhatJustHappenedCard' });
      expect(whatJustHappenedCard.exists()).toBe(true);
    });

    it('does not render WhatJustHappenedCard when no descendants', async () => {
      // Only root session, no children
      sessionsStore.sessions = [
        { id: 'sess-123', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
      ];
      sessionsStore.currentSession = { id: 'sess-123', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' };

      // Use mount() to test real v-if behavior (not stub)
      const wrapper = mount(SummaryTab, {
        props: { sessionId: 'sess-123' },
        global: {
          stubs: {
            RouterLink: { template: '<a><slot /></a>' },
            MarkdownViewer: { template: '<div class="markdown-stub"><slot /></div>' },
            SessionCardWorkflowPanel: { template: '<div class="workflow-panel-stub"></div>' },
          },
        },
      });
      await flushAll(wrapper);

      // Card should not render when no descendants exist
      // Check for the actual component's data-testid, not the stub
      expect(wrapper.find('[data-testid="what-just-happened-card"]').exists()).toBe(false);
    });

    it('passes correct props to WhatJustHappenedCard', async () => {
      sessionsStore.sessions = [
        { id: 'sess-123', name: 'Root Session', status: 'waiting', projectId: 'proj-1', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'child-1', name: 'Child Task', status: 'completed', parentSessionId: 'sess-123', updatedAt: '2024-01-01T01:00:00Z', lastActivityAt: '2024-01-01T01:00:00Z' },
      ];
      sessionsStore.currentSession = { id: 'sess-123', name: 'Root Session', status: 'waiting', projectId: 'proj-1', updatedAt: '2024-01-01T00:00:00Z' };

      const wrapper = shallowMount(SummaryTab, {
        props: { sessionId: 'sess-123' },
        global: {
          stubs: {
            RouterLink: { template: '<a><slot /></a>' },
            WhatJustHappenedCard: {
              name: 'WhatJustHappenedCard',
              props: ['session', 'summary', 'descendantSummaries'],
              template: '<div class="what-just-happened-card-stub"></div>'
            },
          },
        },
      });
      await flushAll(wrapper);

      const whatJustHappenedCard = wrapper.findComponent({ name: 'WhatJustHappenedCard' });
      expect(whatJustHappenedCard.exists()).toBe(true);

      // Verify session prop
      expect(whatJustHappenedCard.props('session')).toBeDefined();
      expect(whatJustHappenedCard.props('session').id).toBe('sess-123');
      expect(whatJustHappenedCard.props('session').name).toBe('Root Session');

      // Verify summary prop (initially null)
      expect(whatJustHappenedCard.props('summary')).toBeNull();

      // Verify descendantSummaries prop
      expect(whatJustHappenedCard.props('descendantSummaries')).toBeDefined();
      expect(typeof whatJustHappenedCard.props('descendantSummaries')).toBe('object');
    });
  });

});
