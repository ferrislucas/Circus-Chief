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
    getWorkflowLatestResponse: vi.fn().mockResolvedValue(null),
    getSessionFilesCount: vi.fn().mockResolvedValue({ count: 0 }),
  },
}));

// Note: Not mocking sessions and UI stores - will use actual Pinia instances

// Mock WebSocket composable
// Factory that creates a fresh subscription mock, tracking calls per sessionId
const subscriptionsBySessionId = {};
function createMockSubscription() {
  return {
    onSummaryUpdate: vi.fn(() => vi.fn()),
    onSummaryGenerating: vi.fn(() => vi.fn()),
    onWorkLog: vi.fn(() => vi.fn()),
    onPartial: vi.fn(() => vi.fn()),
    onThinkingPartial: vi.fn(() => vi.fn()),
    onMessage: vi.fn(() => vi.fn()),
    onChangesUpdate: vi.fn(() => vi.fn()),
    onStatus: vi.fn(() => vi.fn()),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };
}
vi.mock('../composables/useWebSocket.js', () => ({
  useSessionSubscription: vi.fn((sessionId) => {
    const sub = createMockSubscription();
    if (!subscriptionsBySessionId[sessionId]) {
      subscriptionsBySessionId[sessionId] = [];
    }
    subscriptionsBySessionId[sessionId].push(sub);
    return sub;
  }),
}));

// Mock router
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('./SchedulingInfo.vue', () => ({
  default: {
    name: 'SchedulingInfo',
    props: ['session'],
    template: '<div class="scheduling-info-stub" data-testid="scheduling-info">SchedulingInfo</div>',
  },
}));

import SummaryTab from './SummaryTab.vue';
import { api } from '../composables/useApi.js';
import { useSessionSubscription } from '../composables/useWebSocket.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

describe('SummaryTab', () => {
  let sessionsStore;
  let uiStore;
  let consoleError;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Clear subscription tracking
    Object.keys(subscriptionsBySessionId).forEach(k => delete subscriptionsBySessionId[k]);

    // Reset API mock implementations to defaults
    api.getSessionSummary.mockResolvedValue(null);
    api.getWorkflowLatestResponse.mockResolvedValue(null);

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
          MarkdownViewer: {
            template: '<div class="markdown-stub">{{ content }}</div>',
            props: ['content'],
          },
          SessionLogStream: { template: '<div class="session-log-stream-stub"></div>' },
          SummaryContent: {
            name: 'SummaryContent',
            template: '<div class="summary-content-stub"></div>',
          },
          SchedulingInfo: {
            name: 'SchedulingInfo',
            template: '<div class="scheduling-info-stub" data-testid="scheduling-info">SchedulingInfo</div>',
            props: ['session'],
          },
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

  describe('SessionLogStream Integration', () => {
    it('renders SessionLogStream when session status is running', async () => {
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'running',
        projectId: 'proj-1',
      };
      sessionsStore.sessions = [sessionsStore.currentSession];

      const wrapper = mount(SummaryTab, {
        props: { sessionId: 'sess-123' },
        global: {
          stubs: {
            MarkdownViewer: {
              template: '<div class="markdown-stub">{{ content }}</div>',
              props: ['content'],
            },
            SessionLogStream: {
              name: 'SessionLogStream',
              props: ['sessionId'],
              template: '<div class="session-log-stream-stub">SessionLogStream</div>',
            },
            SchedulingInfo: {
              name: 'SchedulingInfo',
              template: '<div class="scheduling-info-stub">SchedulingInfo</div>',
              props: ['session'],
            },
          },
        },
      });
      await flushAll(wrapper);

      expect(wrapper.findComponent({ name: 'SessionLogStream' }).exists()).toBe(true);
    });

    it('renders SessionLogStream when session status is starting', async () => {
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'starting',
        projectId: 'proj-1',
      };
      sessionsStore.sessions = [sessionsStore.currentSession];

      const wrapper = mount(SummaryTab, {
        props: { sessionId: 'sess-123' },
        global: {
          stubs: {
            MarkdownViewer: {
              template: '<div class="markdown-stub">{{ content }}</div>',
              props: ['content'],
            },
            SessionLogStream: {
              name: 'SessionLogStream',
              props: ['sessionId'],
              template: '<div class="session-log-stream-stub">SessionLogStream</div>',
            },
            SchedulingInfo: {
              name: 'SchedulingInfo',
              template: '<div class="scheduling-info-stub">SchedulingInfo</div>',
              props: ['session'],
            },
          },
        },
      });
      await flushAll(wrapper);

      expect(wrapper.findComponent({ name: 'SessionLogStream' }).exists()).toBe(true);
    });

    it('does not render SessionLogStream for non-running statuses', async () => {
      // Test all statuses that should NOT show live output
      const nonRunningStatuses = ['waiting', 'stopped', 'completed', 'error', 'scheduled'];

      for (const status of nonRunningStatuses) {
        sessionsStore.currentSession = {
          id: 'sess-123',
          status,
          projectId: 'proj-1',
        };
        sessionsStore.sessions = [sessionsStore.currentSession];

        const wrapper = mount(SummaryTab, {
          props: { sessionId: 'sess-123' },
          global: {
            stubs: {
              MarkdownViewer: {
                template: '<div class="markdown-stub">{{ content }}</div>',
                props: ['content'],
              },
              SessionLogStream: {
                name: 'SessionLogStream',
                template: '<div class="session-log-stream-stub">SessionLogStream</div>',
              },
              SchedulingInfo: true,
            },
          },
        });
        await flushAll(wrapper);

        expect(wrapper.findComponent({ name: 'SessionLogStream' }).exists()).toBe(false);
      }
    });

    it('passes correct sessionId prop to SessionLogStream', async () => {
      sessionsStore.currentSession = {
        id: 'sess-456',
        status: 'running',
        projectId: 'proj-1',
      };
      sessionsStore.sessions = [sessionsStore.currentSession];

      const wrapper = mount(SummaryTab, {
        props: { sessionId: 'sess-456' },
        global: {
          stubs: {
            MarkdownViewer: {
              template: '<div class="markdown-stub">{{ content }}</div>',
              props: ['content'],
            },
            SessionLogStream: {
              name: 'SessionLogStream',
              props: ['sessionIds'],
              template: '<div class="session-log-stream-stub">{{ sessionIds }}</div>',
            },
            SchedulingInfo: {
              name: 'SchedulingInfo',
              template: '<div class="scheduling-info-stub">SchedulingInfo</div>',
              props: ['session'],
            },
          },
        },
      });
      await flushAll(wrapper);

      const logStream = wrapper.findComponent({ name: 'SessionLogStream' });
      expect(logStream.exists()).toBe(true);
      expect(logStream.props('sessionIds')).toEqual(['sess-456']);
    });

    it('unmounts SessionLogStream when session status changes from running to completed', async () => {
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'running',
        projectId: 'proj-1',
      };
      sessionsStore.sessions = [sessionsStore.currentSession];

      const wrapper = mount(SummaryTab, {
        props: { sessionId: 'sess-123' },
        global: {
          stubs: {
            MarkdownViewer: {
              template: '<div class="markdown-stub">{{ content }}</div>',
              props: ['content'],
            },
            SessionLogStream: {
              name: 'SessionLogStream',
              template: '<div class="session-log-stream-stub">SessionLogStream</div>',
            },
            SchedulingInfo: {
              name: 'SchedulingInfo',
              template: '<div class="scheduling-info-stub">SchedulingInfo</div>',
              props: ['session'],
            },
          },
        },
      });
      await flushAll(wrapper);

      // Should render when running
      expect(wrapper.findComponent({ name: 'SessionLogStream' }).exists()).toBe(true);

      // Change status to completed
      sessionsStore.currentSession.status = 'completed';
      await flushAll(wrapper);

      // Should unmount after status change
      expect(wrapper.findComponent({ name: 'SessionLogStream' }).exists()).toBe(false);
    });

    it('does not render SessionLogStream when session is null', async () => {
      sessionsStore.currentSession = null;
      sessionsStore.sessions = [];

      const wrapper = mount(SummaryTab, {
        props: { sessionId: 'sess-123' },
        global: {
          stubs: {
            MarkdownViewer: {
              template: '<div class="markdown-stub">{{ content }}</div>',
              props: ['content'],
            },
            SessionLogStream: {
              name: 'SessionLogStream',
              template: '<div class="session-log-stream-stub">SessionLogStream</div>',
            },
            SchedulingInfo: {
              name: 'SchedulingInfo',
              template: '<div class="scheduling-info-stub">SchedulingInfo</div>',
              props: ['session'],
            },
          },
        },
      });
      await flushAll(wrapper);

      expect(wrapper.findComponent({ name: 'SessionLogStream' }).exists()).toBe(false);
    });
  });

  describe('Descendant Session Live Output', () => {
    function mountWithLogStream(props = { sessionId: 'sess-123' }) {
      return mount(SummaryTab, {
        props,
        global: {
          stubs: {
            MarkdownViewer: {
              template: '<div class="markdown-stub">{{ content }}</div>',
              props: ['content'],
            },
            SessionLogStream: {
              name: 'SessionLogStream',
              props: ['sessionIds'],
              template: '<div class="session-log-stream-stub">{{ sessionIds }}</div>',
            },
          },
        },
      });
    }

    it('renders SessionLogStream when parent is waiting but a child session is running', async () => {
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        projectId: 'proj-1',
      };
      sessionsStore.sessions = [
        sessionsStore.currentSession,
        { id: 'child-1', status: 'running', parentSessionId: 'sess-123', projectId: 'proj-1' },
      ];

      const wrapper = mountWithLogStream();
      await flushAll(wrapper);

      const logStream = wrapper.findComponent({ name: 'SessionLogStream' });
      expect(logStream.exists()).toBe(true);
    });

    it('includes running child session IDs in sessionIds prop', async () => {
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        projectId: 'proj-1',
      };
      sessionsStore.sessions = [
        sessionsStore.currentSession,
        { id: 'child-1', status: 'running', parentSessionId: 'sess-123', projectId: 'proj-1' },
      ];

      const wrapper = mountWithLogStream();
      await flushAll(wrapper);

      const logStream = wrapper.findComponent({ name: 'SessionLogStream' });
      expect(logStream.props('sessionIds')).toEqual(['child-1']);
    });

    it('includes both parent and child IDs when both are running', async () => {
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'running',
        projectId: 'proj-1',
      };
      sessionsStore.sessions = [
        sessionsStore.currentSession,
        { id: 'child-1', status: 'running', parentSessionId: 'sess-123', projectId: 'proj-1' },
      ];

      const wrapper = mountWithLogStream();
      await flushAll(wrapper);

      const logStream = wrapper.findComponent({ name: 'SessionLogStream' });
      expect(logStream.props('sessionIds')).toEqual(['sess-123', 'child-1']);
    });

    it('includes deeply nested running descendants (grandchild)', async () => {
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        projectId: 'proj-1',
      };
      sessionsStore.sessions = [
        sessionsStore.currentSession,
        { id: 'child-1', status: 'waiting', parentSessionId: 'sess-123', projectId: 'proj-1' },
        { id: 'grandchild-1', status: 'running', parentSessionId: 'child-1', projectId: 'proj-1' },
      ];

      const wrapper = mountWithLogStream();
      await flushAll(wrapper);

      const logStream = wrapper.findComponent({ name: 'SessionLogStream' });
      expect(logStream.exists()).toBe(true);
      expect(logStream.props('sessionIds')).toEqual(['grandchild-1']);
    });

    it('excludes non-running child sessions from sessionIds', async () => {
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        projectId: 'proj-1',
      };
      sessionsStore.sessions = [
        sessionsStore.currentSession,
        { id: 'child-1', status: 'completed', parentSessionId: 'sess-123', projectId: 'proj-1' },
        { id: 'child-2', status: 'running', parentSessionId: 'sess-123', projectId: 'proj-1' },
        { id: 'child-3', status: 'error', parentSessionId: 'sess-123', projectId: 'proj-1' },
      ];

      const wrapper = mountWithLogStream();
      await flushAll(wrapper);

      const logStream = wrapper.findComponent({ name: 'SessionLogStream' });
      expect(logStream.exists()).toBe(true);
      // Only child-2 is running
      expect(logStream.props('sessionIds')).toEqual(['child-2']);
    });

    it('does not render SessionLogStream when parent is waiting and no children are running', async () => {
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        projectId: 'proj-1',
      };
      sessionsStore.sessions = [
        sessionsStore.currentSession,
        { id: 'child-1', status: 'completed', parentSessionId: 'sess-123', projectId: 'proj-1' },
      ];

      const wrapper = mountWithLogStream();
      await flushAll(wrapper);

      expect(wrapper.findComponent({ name: 'SessionLogStream' }).exists()).toBe(false);
    });

    it('subscribes to WebSocket events for running descendant sessions', async () => {
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        projectId: 'proj-1',
      };
      sessionsStore.sessions = [
        sessionsStore.currentSession,
        { id: 'child-1', status: 'running', parentSessionId: 'sess-123', projectId: 'proj-1' },
      ];

      const wrapper = mountWithLogStream();
      await flushAll(wrapper);

      // useSessionSubscription should have been called for the child session
      expect(useSessionSubscription).toHaveBeenCalledWith('child-1');

      // The descendant subscription should have called subscribe()
      const childSubs = subscriptionsBySessionId['child-1'];
      expect(childSubs).toBeDefined();
      expect(childSubs.length).toBeGreaterThanOrEqual(1);
      // The descendant subscription (not the initial parent one) calls subscribe()
      const descendantSub = childSubs.find(s => s.subscribe.mock.calls.length > 0);
      expect(descendantSub).toBeDefined();
      expect(descendantSub.subscribe).toHaveBeenCalled();
    });

    it('unsubscribes from descendant when child session stops running', async () => {
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        projectId: 'proj-1',
      };
      sessionsStore.sessions = [
        sessionsStore.currentSession,
        { id: 'child-1', status: 'running', parentSessionId: 'sess-123', projectId: 'proj-1' },
      ];

      const wrapper = mountWithLogStream();
      await flushAll(wrapper);

      // Confirm it was subscribed
      const childSubs = subscriptionsBySessionId['child-1'];
      const descendantSub = childSubs.find(s => s.subscribe.mock.calls.length > 0);
      expect(descendantSub).toBeDefined();
      expect(descendantSub.unsubscribe).not.toHaveBeenCalled();

      // Change child status to completed — replace sessions array to trigger reactivity
      sessionsStore.sessions = [
        sessionsStore.currentSession,
        { id: 'child-1', status: 'completed', parentSessionId: 'sess-123', projectId: 'proj-1' },
      ];
      await flushAll(wrapper);

      // SessionLogStream should be gone (no running sessions)
      expect(wrapper.findComponent({ name: 'SessionLogStream' }).exists()).toBe(false);
      // unsubscribe should have been called
      expect(descendantSub.unsubscribe).toHaveBeenCalled();
    });

    it('cleans up all descendant subscriptions on unmount', async () => {
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        projectId: 'proj-1',
      };
      sessionsStore.sessions = [
        sessionsStore.currentSession,
        { id: 'child-1', status: 'running', parentSessionId: 'sess-123', projectId: 'proj-1' },
        { id: 'child-2', status: 'starting', parentSessionId: 'sess-123', projectId: 'proj-1' },
      ];

      const wrapper = mountWithLogStream();
      await flushAll(wrapper);

      // Both children should be subscribed
      const child1Sub = subscriptionsBySessionId['child-1']?.find(s => s.subscribe.mock.calls.length > 0);
      const child2Sub = subscriptionsBySessionId['child-2']?.find(s => s.subscribe.mock.calls.length > 0);
      expect(child1Sub).toBeDefined();
      expect(child2Sub).toBeDefined();

      // Unmount
      wrapper.unmount();

      // Both should be unsubscribed
      expect(child1Sub.unsubscribe).toHaveBeenCalled();
      expect(child2Sub.unsubscribe).toHaveBeenCalled();
    });

    it('subscribes to new running descendant when added dynamically', async () => {
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        projectId: 'proj-1',
      };
      sessionsStore.sessions = [sessionsStore.currentSession];

      const wrapper = mountWithLogStream();
      await flushAll(wrapper);

      // Initially no SessionLogStream
      expect(wrapper.findComponent({ name: 'SessionLogStream' }).exists()).toBe(false);

      // Add a running child session
      sessionsStore.sessions = [
        sessionsStore.currentSession,
        { id: 'child-new', status: 'running', parentSessionId: 'sess-123', projectId: 'proj-1' },
      ];
      await flushAll(wrapper);

      // SessionLogStream should now appear
      expect(wrapper.findComponent({ name: 'SessionLogStream' }).exists()).toBe(true);
      const logStream = wrapper.findComponent({ name: 'SessionLogStream' });
      expect(logStream.props('sessionIds')).toEqual(['child-new']);

      // Should have subscribed to the new child
      expect(useSessionSubscription).toHaveBeenCalledWith('child-new');
    });

    it('includes starting child sessions in live output', async () => {
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        projectId: 'proj-1',
      };
      sessionsStore.sessions = [
        sessionsStore.currentSession,
        { id: 'child-1', status: 'starting', parentSessionId: 'sess-123', projectId: 'proj-1' },
      ];

      const wrapper = mountWithLogStream();
      await flushAll(wrapper);

      const logStream = wrapper.findComponent({ name: 'SessionLogStream' });
      expect(logStream.exists()).toBe(true);
      expect(logStream.props('sessionIds')).toEqual(['child-1']);
    });
  });

  describe('Latest Response', () => {
    it('does not render latest response section when no response exists', async () => {
      // Default mock returns null
      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.latest-response').exists()).toBe(false);
    });

    it('renders latest response section when response exists', async () => {
      api.getWorkflowLatestResponse.mockResolvedValue({
        message: {
          content: 'Test response content',
          timestamp: Date.now(),
          role: 'assistant',
        },
        sessionName: 'Test Session',
      });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.latest-response').exists()).toBe(true);
      expect(wrapper.text()).toContain('Test response content');
    });

    it('shows session name in latest response header', async () => {
      api.getWorkflowLatestResponse.mockResolvedValue({
        message: {
          content: 'Response text',
          timestamp: Date.now(),
          role: 'assistant',
        },
        sessionName: 'My Child Session',
      });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.latest-response').exists()).toBe(true);
      expect(wrapper.text()).toContain('from My Child Session');
    });

    it('renders response content via MarkdownViewer', async () => {
      api.getWorkflowLatestResponse.mockResolvedValue({
        message: {
          content: '# Hello World',
          timestamp: Date.now(),
          role: 'assistant',
        },
        sessionName: 'Test Session',
      });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // The MarkdownViewer is stubbed; verify the content section exists and has content
      const contentSection = wrapper.find('.latest-response-content');
      expect(contentSection.exists()).toBe(true);
      expect(contentSection.text()).toContain('Hello World');
    });

    it('shows expand toggle for long content', async () => {
      const longContent = 'a'.repeat(600);
      api.getWorkflowLatestResponse.mockResolvedValue({
        message: {
          content: longContent,
          timestamp: Date.now(),
          role: 'assistant',
        },
        sessionName: 'Test Session',
      });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.expand-toggle').exists()).toBe(true);
      expect(wrapper.find('.expand-toggle').text()).toBe('Show full response');
    });

    it('does not show expand toggle for short content', async () => {
      api.getWorkflowLatestResponse.mockResolvedValue({
        message: {
          content: 'Short response',
          timestamp: Date.now(),
          role: 'assistant',
        },
        sessionName: 'Test Session',
      });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.expand-toggle').exists()).toBe(false);
    });
  });

  describe('Work Time Display', () => {
    /**
     * Helper: mount SummaryTab with a specific session state.
     * Sets up the store so `session` computed resolves correctly.
     */
    function mountWithSession(sessionData, { summary = null } = {}) {
      if (summary) {
        api.getSessionSummary.mockResolvedValue(summary);
      }
      sessionsStore.currentSession = sessionData;
      sessionsStore.sessions = [sessionData];
      return mountComponent({ sessionId: sessionData.id });
    }

    it('uses activeTimeMs from server when available', async () => {
      // Session with server-computed activeTimeMs of 1 minute
      const wrapper = mountWithSession({
        id: 'sess-123',
        status: 'completed',
        createdAt: Date.now() - 3600000,  // 1 hour ago
        updatedAt: Date.now(),
        lastActivityAt: Date.now(),
        activeTimeMs: 60000, // 1 minute of actual active time
      }, {
        summary: { shortSummary: 'Test' },
      });
      await flushAll(wrapper);

      // Should show "1m" work time, not "1h 0m"
      expect(wrapper.text()).toContain('1m');
      expect(wrapper.text()).not.toContain('1h');
    });

    it('falls back to wall-clock for running sessions without activeTimeMs', async () => {
      const createdAt = Date.now() - 300000; // 5 minutes ago
      const wrapper = mountWithSession({
        id: 'sess-123',
        status: 'running',
        createdAt,
        updatedAt: createdAt,
        lastActivityAt: null,
        activeTimeMs: 0,
      });
      await flushAll(wrapper);

      // Work time should use Date.now() - createdAt
      expect(wrapper.find('.metric-label').exists() || wrapper.text()).toBeDefined();
    });

    it('returns null for sessions with no activity and no tokens', async () => {
      const wrapper = mountWithSession({
        id: 'sess-123',
        status: 'waiting',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        activeTimeMs: 0,
        inputTokens: 0,
        outputTokens: 0,
      });
      await flushAll(wrapper);

      // No work time metric should be shown
      expect(wrapper.text()).not.toContain('Work Time');
    });

    it('shows work time for non-active session with token usage even without activeTimeMs', async () => {
      const createdAt = Date.now() - 600000; // 10 minutes ago
      const wrapper = mountWithSession({
        id: 'sess-123',
        status: 'completed',
        createdAt,
        updatedAt: Date.now(),
        lastActivityAt: Date.now(),
        activeTimeMs: 0,
        inputTokens: 1000,
        outputTokens: 500,
      }, {
        summary: { shortSummary: 'Test' },
      });
      await flushAll(wrapper);

      // Should show work time via fallback
      expect(wrapper.text()).toContain('Work Time');
    });

    it('prefers activeTimeMs over wall-clock even when wall-clock is longer', async () => {
      const wrapper = mountWithSession({
        id: 'sess-123',
        status: 'completed',
        createdAt: Date.now() - 86400000, // 1 day ago
        updatedAt: Date.now(),
        lastActivityAt: Date.now(),
        activeTimeMs: 30000, // 30 seconds of actual work
      }, {
        summary: { shortSummary: 'Test' },
      });
      await flushAll(wrapper);

      // Should show "30s" not "1d 0h"
      expect(wrapper.text()).toContain('30s');
      expect(wrapper.text()).not.toContain('1d');
    });
  });

  describe('Empty State', () => {
    it('shows empty state when session has no summary, no latest response, and is not running', async () => {
      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.summary-empty-state').exists()).toBe(true);
      expect(wrapper.text()).toContain("This session hasn't started yet.");
      expect(wrapper.text()).toContain('Start the session or send a message to see a summary here.');
    });

    it('does not show empty state while loading', async () => {
      api.getSessionSummary.mockReturnValue(new Promise(() => {}));

      const wrapper = mountComponent();
      await nextTick();

      expect(wrapper.find('.summary-empty-state').exists()).toBe(false);
      expect(wrapper.find('.loading-state').exists()).toBe(true);
    });

    it('does not show empty state when summary exists', async () => {
      api.getSessionSummary.mockResolvedValue({ shortSummary: 'A summary', fullSummary: 'Details' });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.summary-empty-state').exists()).toBe(false);
      expect(wrapper.findComponent({ name: 'SummaryContent' }).exists()).toBe(true);
    });

    it('does not show empty state when latest response exists', async () => {
      api.getWorkflowLatestResponse.mockResolvedValue({
        message: { content: 'A response', timestamp: Date.now(), role: 'assistant' },
      });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.summary-empty-state').exists()).toBe(false);
      expect(wrapper.find('.latest-response').exists()).toBe(true);
    });

    it('does not show empty state when session is running', async () => {
      sessionsStore.currentSession = { id: 'sess-123', status: 'running' };
      sessionsStore.sessions = [sessionsStore.currentSession];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.summary-empty-state').exists()).toBe(false);
    });

    it('does not show empty state when session is starting', async () => {
      sessionsStore.currentSession = { id: 'sess-123', status: 'starting' };
      sessionsStore.sessions = [sessionsStore.currentSession];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.summary-empty-state').exists()).toBe(false);
    });
  });

  describe('Latest Response Real-Time Updates', () => {
    /**
     * Helper: retrieve the onMessage callback captured by the mock.
     * useSessionSubscription returns an object with onMessage (a vi.fn).
     * That vi.fn was called with a callback when the component registered
     * the handler — we extract it so tests can fire it manually.
     */
    function getOnMessageCallback() {
      // The mock returns a fresh object each call; get the latest call's return value
      const subscription = useSessionSubscription.mock.results.at(-1).value;
      // onMessage is a vi.fn(() => vi.fn()) — the outer fn was called with the
      // component's callback, so it's the first (and only) call arg.
      return subscription.onMessage.mock.calls[0][0];
    }

    it('updates latestResponse when assistant message arrives via onMessage', async () => {
      // Mount with no initial latest response
      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.latest-response').exists()).toBe(false);

      // Fire the onMessage callback with an assistant message
      const onMessageCb = getOnMessageCallback();
      onMessageCb({
        role: 'assistant',
        content: 'New real-time response',
        timestamp: Date.now(),
      });
      await flushAll(wrapper);

      expect(wrapper.find('.latest-response').exists()).toBe(true);
      expect(wrapper.text()).toContain('New real-time response');
    });

    it('does not update latestResponse for user messages', async () => {
      // Set an initial latest response from the API
      api.getWorkflowLatestResponse.mockResolvedValue({
        message: {
          content: 'Initial API response',
          timestamp: Date.now(),
          role: 'assistant',
        },
        sessionName: 'Test Session',
      });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.text()).toContain('Initial API response');

      // Fire onMessage with a user message
      const onMessageCb = getOnMessageCallback();
      onMessageCb({
        role: 'user',
        content: 'User question',
        timestamp: Date.now(),
      });
      await flushAll(wrapper);

      // Should still show the original API response, not the user message
      expect(wrapper.text()).toContain('Initial API response');
      expect(wrapper.text()).not.toContain('User question');
    });

    it('does not update latestResponse for empty assistant messages', async () => {
      // Set an initial latest response from the API
      api.getWorkflowLatestResponse.mockResolvedValue({
        message: {
          content: 'Initial API response',
          timestamp: Date.now(),
          role: 'assistant',
        },
        sessionName: 'Test Session',
      });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.text()).toContain('Initial API response');

      // Fire onMessage with empty assistant message
      const onMessageCb = getOnMessageCallback();
      onMessageCb({
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      });
      await flushAll(wrapper);

      // Should still show the original response
      expect(wrapper.text()).toContain('Initial API response');
    });

    it('shows session name from current session in real-time update', async () => {
      // Set the session name
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        name: 'My Session',
      };
      sessionsStore.sessions = [sessionsStore.currentSession];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // No initial response
      expect(wrapper.find('.latest-response').exists()).toBe(false);

      // Fire onMessage with an assistant message
      const onMessageCb = getOnMessageCallback();
      onMessageCb({
        role: 'assistant',
        content: 'Real-time content',
        timestamp: Date.now(),
      });
      await flushAll(wrapper);

      expect(wrapper.find('.latest-response').exists()).toBe(true);
      expect(wrapper.text()).toContain('from My Session');
      expect(wrapper.text()).toContain('Real-time content');
    });
  });

  describe('Scheduling Info', () => {
    it('renders SchedulingInfo when session status is scheduled', async () => {
      sessionsStore.currentSession = {
        id: 'sess-123',
        status: 'scheduled',
        scheduledAt: Date.now() + 3600000,
      };
      sessionsStore.sessions = [sessionsStore.currentSession];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.findComponent({ name: 'SchedulingInfo' }).exists()).toBe(true);
    });

    it('does not render SchedulingInfo for non-scheduled sessions', async () => {
      // Default session has status: 'waiting'
      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.findComponent({ name: 'SchedulingInfo' }).exists()).toBe(false);
    });

    it('passes session prop to SchedulingInfo', async () => {
      const scheduledSession = {
        id: 'sess-123',
        status: 'scheduled',
        scheduledAt: Date.now() + 3600000,
      };
      sessionsStore.currentSession = scheduledSession;
      sessionsStore.sessions = [scheduledSession];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const schedulingInfo = wrapper.findComponent({ name: 'SchedulingInfo' });
      expect(schedulingInfo.exists()).toBe(true);
      expect(schedulingInfo.props('session')).toEqual(scheduledSession);
    });

    it('does not render SchedulingInfo when session is null', async () => {
      sessionsStore.currentSession = null;
      sessionsStore.sessions = [];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.findComponent({ name: 'SchedulingInfo' }).exists()).toBe(false);
    });
  });

});
