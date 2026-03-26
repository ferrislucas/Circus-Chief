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
    onWorkLog: vi.fn(() => vi.fn()),
    onPartial: vi.fn(() => vi.fn()),
    onThinkingPartial: vi.fn(() => vi.fn()),
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
          SessionLogStream: { template: '<div class="session-log-stream-stub"></div>' },
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
            MarkdownViewer: { template: '<div class="markdown-stub"><slot /></div>' },
            SessionLogStream: {
              name: 'SessionLogStream',
              props: ['sessionId'],
              template: '<div class="session-log-stream-stub">SessionLogStream</div>',
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
            MarkdownViewer: { template: '<div class="markdown-stub"><slot /></div>' },
            SessionLogStream: {
              name: 'SessionLogStream',
              props: ['sessionId'],
              template: '<div class="session-log-stream-stub">SessionLogStream</div>',
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
              MarkdownViewer: { template: '<div class="markdown-stub"><slot /></div>' },
              SessionLogStream: {
                name: 'SessionLogStream',
                template: '<div class="session-log-stream-stub">SessionLogStream</div>',
              },
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
            MarkdownViewer: { template: '<div class="markdown-stub"><slot /></div>' },
            SessionLogStream: {
              name: 'SessionLogStream',
              props: ['sessionId'],
              template: '<div class="session-log-stream-stub">{{ sessionId }}</div>',
            },
          },
        },
      });
      await flushAll(wrapper);

      const logStream = wrapper.findComponent({ name: 'SessionLogStream' });
      expect(logStream.exists()).toBe(true);
      expect(logStream.props('sessionId')).toBe('sess-456');
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
            MarkdownViewer: { template: '<div class="markdown-stub"><slot /></div>' },
            SessionLogStream: {
              name: 'SessionLogStream',
              template: '<div class="session-log-stream-stub">SessionLogStream</div>',
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
            MarkdownViewer: { template: '<div class="markdown-stub"><slot /></div>' },
            SessionLogStream: {
              name: 'SessionLogStream',
              template: '<div class="session-log-stream-stub">SessionLogStream</div>',
            },
          },
        },
      });
      await flushAll(wrapper);

      expect(wrapper.findComponent({ name: 'SessionLogStream' }).exists()).toBe(false);
    });
  });

});
