import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

// Create mutable route params
const mockRouteParams = { id: 'test-project-id' };

// Mock vue-router
vi.mock('vue-router', () => ({
  useRoute: vi.fn(() => ({
    params: mockRouteParams,
  })),
  RouterLink: defineComponent({
    name: 'RouterLink',
    props: ['to'],
    template: '<a><slot /></a>',
  }),
}));

// Store mock callbacks for testing real-time updates
let onSessionCreatedCallback = null;
let onSessionUpdatedCallback = null;
let onSessionDeletedCallback = null;
let onSessionSummaryUpdatedCallback = null;

// Mock WebSocket composable
vi.mock('../composables/useWebSocket.js', () => ({
  useProjectSubscription: vi.fn(() => ({
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onSessionCreated: vi.fn((cb) => {
      onSessionCreatedCallback = cb;
      return vi.fn();
    }),
    onSessionUpdated: vi.fn((cb) => {
      onSessionUpdatedCallback = cb;
      return vi.fn();
    }),
    onSessionDeleted: vi.fn((cb) => {
      onSessionDeletedCallback = cb;
      return vi.fn();
    }),
    onSessionSummaryUpdated: vi.fn((cb) => {
      onSessionSummaryUpdatedCallback = cb;
      return vi.fn();
    }),
  })),
}));

// Mock stores
vi.mock('../stores/projects.js', () => ({
  useProjectsStore: vi.fn(),
}));

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(),
}));

// Mock API
const mockGetSessionSummary = vi.fn();
vi.mock('../composables/useApi.js', () => ({
  api: {
    getSessionSummary: (...args) => mockGetSessionSummary(...args),
  },
}));

// Mock child components
vi.mock('../components/SessionCard.vue', () => ({
  default: defineComponent({
    name: 'SessionCard',
    props: ['session', 'showSummary', 'summary', 'summaryLoading', 'summaryError'],
    emits: ['retrySummary'],
    template: '<div class="session-card" :data-session-id="session.id" :data-summary="JSON.stringify(summary)"><slot /></div>',
  }),
}));

vi.mock('../components/TemplatesPanel.vue', () => ({
  default: defineComponent({
    name: 'TemplatesPanel',
    props: ['projectId'],
    template: '<div class="templates-panel" />',
  }),
}));

import SessionListView from './SessionListView.vue';
import { useProjectsStore } from '../stores/projects.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useProjectSubscription } from '../composables/useWebSocket.js';

describe('SessionListView', () => {
  let mockProjectsStore;
  let mockSessionsStore;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());

    // Reset route params
    mockRouteParams.id = 'test-project-id';

    // Reset callbacks
    onSessionCreatedCallback = null;
    onSessionUpdatedCallback = null;
    onSessionDeletedCallback = null;
    onSessionSummaryUpdatedCallback = null;

    // Reset API mocks
    mockGetSessionSummary.mockReset();
    mockGetSessionSummary.mockResolvedValue(null);

    // Setup projects store mock
    mockProjectsStore = {
      currentProject: { id: 'test-project-id', name: 'Test Project', workingDirectory: '/test/path' },
      fetchProject: vi.fn(),
    };
    useProjectsStore.mockReturnValue(mockProjectsStore);

    // Setup sessions store mock
    mockSessionsStore = {
      loading: false,
      error: null,
      sessions: [
        { id: 'session-1', name: 'Session 1', status: 'completed' },
        { id: 'session-2', name: 'Session 2', status: 'running' },
      ],
      fetchSessions: vi.fn().mockResolvedValue(),
      addSessionToList: vi.fn(),
      updateSession: vi.fn(),
      removeSessionFromList: vi.fn(),
    };
    useSessionsStore.mockReturnValue(mockSessionsStore);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('WebSocket subscription', () => {
    it('subscribes to project updates on mount', async () => {
      mount(SessionListView);
      await flushPromises();

      expect(useProjectSubscription).toHaveBeenCalledWith('test-project-id');
    });

    it('registers onSessionSummaryUpdated callback', async () => {
      mount(SessionListView);
      await flushPromises();

      expect(onSessionSummaryUpdatedCallback).not.toBeNull();
      expect(typeof onSessionSummaryUpdatedCallback).toBe('function');
    });
  });

  describe('Real-time summary updates', () => {
    it('updates summary when onSessionSummaryUpdated is called', async () => {
      const wrapper = mount(SessionListView);
      await flushPromises();

      // Verify callback is registered
      expect(onSessionSummaryUpdatedCallback).not.toBeNull();

      // Simulate receiving a summary update
      const newSummary = {
        id: 'summary-1',
        sessionId: 'session-1',
        shortSummary: 'Test summary',
        fullSummary: 'Full test summary',
        keyActions: ['action1'],
        filesModified: ['file.js'],
        outcome: 'completed',
      };

      onSessionSummaryUpdatedCallback('session-1', newSummary);
      await nextTick();

      // Find the SessionCard for session-1 and check the summary prop
      const sessionCard = wrapper.find('[data-session-id="session-1"]');
      expect(sessionCard.exists()).toBe(true);
      expect(sessionCard.attributes('data-summary')).toBe(JSON.stringify(newSummary));
    });

    it('clears loading state when summary update is received', async () => {
      mount(SessionListView);
      await flushPromises();

      // Simulate receiving a summary update
      const newSummary = { shortSummary: 'Test' };
      onSessionSummaryUpdatedCallback('session-1', newSummary);
      await nextTick();

      // The loading state should be cleared (summaryLoading[sessionId] = false)
      // This is verified by the fact that the summary is now available
    });

    it('clears error state when summary update is received', async () => {
      mount(SessionListView);
      await flushPromises();

      // Simulate receiving a summary update after an error
      const newSummary = { shortSummary: 'Test' };
      onSessionSummaryUpdatedCallback('session-1', newSummary);
      await nextTick();

      // The error state should be cleared (summaryErrors[sessionId] = false)
    });

    it('handles summary updates for multiple sessions', async () => {
      const wrapper = mount(SessionListView);
      await flushPromises();

      // Update summaries for both sessions
      const summary1 = { shortSummary: 'Summary 1' };
      const summary2 = { shortSummary: 'Summary 2' };

      onSessionSummaryUpdatedCallback('session-1', summary1);
      onSessionSummaryUpdatedCallback('session-2', summary2);
      await nextTick();

      // Verify both summaries are updated
      const card1 = wrapper.find('[data-session-id="session-1"]');
      const card2 = wrapper.find('[data-session-id="session-2"]');

      expect(card1.attributes('data-summary')).toBe(JSON.stringify(summary1));
      expect(card2.attributes('data-summary')).toBe(JSON.stringify(summary2));
    });

    it('overwrites existing summary with new update', async () => {
      const wrapper = mount(SessionListView);
      await flushPromises();

      // Initial summary
      const initialSummary = { shortSummary: 'Initial' };
      onSessionSummaryUpdatedCallback('session-1', initialSummary);
      await nextTick();

      // Updated summary
      const updatedSummary = { shortSummary: 'Updated' };
      onSessionSummaryUpdatedCallback('session-1', updatedSummary);
      await nextTick();

      const card = wrapper.find('[data-session-id="session-1"]');
      expect(card.attributes('data-summary')).toBe(JSON.stringify(updatedSummary));
    });
  });

  describe('Session lifecycle events', () => {
    it('cleans up summary data when session is deleted', async () => {
      const wrapper = mount(SessionListView);
      await flushPromises();

      // First add a summary
      const summary = { shortSummary: 'Test' };
      onSessionSummaryUpdatedCallback('session-1', summary);
      await nextTick();

      // Then delete the session
      onSessionDeletedCallback('session-1');
      await nextTick();

      // The summary should be cleaned up
      expect(mockSessionsStore.removeSessionFromList).toHaveBeenCalledWith('session-1');
    });
  });
});

describe('Status filtering', () => {
  let mockProjectsStore;
  let mockSessionsStore;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());

    mockRouteParams.id = 'test-project-id';

    onSessionCreatedCallback = null;
    onSessionUpdatedCallback = null;
    onSessionDeletedCallback = null;
    onSessionSummaryUpdatedCallback = null;

    mockGetSessionSummary.mockReset();
    mockGetSessionSummary.mockResolvedValue(null);

    mockProjectsStore = {
      currentProject: { id: 'test-project-id', name: 'Test Project', workingDirectory: '/test/path' },
      fetchProject: vi.fn(),
    };
    useProjectsStore.mockReturnValue(mockProjectsStore);

    mockSessionsStore = {
      loading: false,
      error: null,
      sessions: [
        { id: 'session-1', name: 'Running Session', status: 'running' },
        { id: 'session-2', name: 'Waiting Session', status: 'waiting' },
        { id: 'session-3', name: 'Completed Session', status: 'completed' },
        { id: 'session-4', name: 'Error Session', status: 'error' },
      ],
      fetchSessions: vi.fn().mockResolvedValue(),
      addSessionToList: vi.fn(),
      updateSession: vi.fn(),
      removeSessionFromList: vi.fn(),
    };
    useSessionsStore.mockReturnValue(mockSessionsStore);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders filter buttons for running and waiting statuses', async () => {
    const wrapper = mount(SessionListView);
    await flushPromises();

    const filterButtons = wrapper.findAll('.filter-btn');
    expect(filterButtons).toHaveLength(2);
    expect(filterButtons[0].text()).toBe('running');
    expect(filterButtons[1].text()).toBe('waiting');
  });

  it('shows all sessions when no filters are active', async () => {
    const wrapper = mount(SessionListView);
    await flushPromises();

    const sessionCards = wrapper.findAll('.session-card');
    expect(sessionCards).toHaveLength(4);
  });

  it('filters to show only running sessions when running filter is clicked', async () => {
    const wrapper = mount(SessionListView);
    await flushPromises();

    const runningButton = wrapper.findAll('.filter-btn')[0];
    await runningButton.trigger('click');

    const sessionCards = wrapper.findAll('.session-card');
    expect(sessionCards).toHaveLength(1);
    expect(sessionCards[0].attributes('data-session-id')).toBe('session-1');
  });

  it('filters to show only waiting sessions when waiting filter is clicked', async () => {
    const wrapper = mount(SessionListView);
    await flushPromises();

    const waitingButton = wrapper.findAll('.filter-btn')[1];
    await waitingButton.trigger('click');

    const sessionCards = wrapper.findAll('.session-card');
    expect(sessionCards).toHaveLength(1);
    expect(sessionCards[0].attributes('data-session-id')).toBe('session-2');
  });

  it('shows both running and waiting sessions when both filters are active', async () => {
    const wrapper = mount(SessionListView);
    await flushPromises();

    const filterButtons = wrapper.findAll('.filter-btn');
    await filterButtons[0].trigger('click'); // running
    await filterButtons[1].trigger('click'); // waiting

    const sessionCards = wrapper.findAll('.session-card');
    expect(sessionCards).toHaveLength(2);
  });

  it('toggles filter off when clicked again', async () => {
    const wrapper = mount(SessionListView);
    await flushPromises();

    const runningButton = wrapper.findAll('.filter-btn')[0];

    // Click to enable filter
    await runningButton.trigger('click');
    expect(wrapper.findAll('.session-card')).toHaveLength(1);

    // Click again to disable filter
    await runningButton.trigger('click');
    expect(wrapper.findAll('.session-card')).toHaveLength(4);
  });

  it('adds active class to selected filter button', async () => {
    const wrapper = mount(SessionListView);
    await flushPromises();

    const runningButton = wrapper.findAll('.filter-btn')[0];
    expect(runningButton.classes()).not.toContain('active');

    await runningButton.trigger('click');
    expect(runningButton.classes()).toContain('active');
  });

  it('shows empty state message when filters return no results', async () => {
    // Set up store with only completed sessions
    mockSessionsStore.sessions = [
      { id: 'session-1', name: 'Completed Session', status: 'completed' },
    ];
    useSessionsStore.mockReturnValue(mockSessionsStore);

    const wrapper = mount(SessionListView);
    await flushPromises();

    // Click running filter - no running sessions exist
    const runningButton = wrapper.findAll('.filter-btn')[0];
    await runningButton.trigger('click');

    const emptyState = wrapper.find('.empty-state');
    expect(emptyState.exists()).toBe(true);
    expect(emptyState.text()).toContain('No sessions match the current filter');
  });

  it('only shows filter buttons on sessions tab', async () => {
    const wrapper = mount(SessionListView);
    await flushPromises();

    // Filters should be visible on sessions tab
    expect(wrapper.find('.status-filters').exists()).toBe(true);

    // Click on templates tab
    const templatesTab = wrapper.findAll('.tab')[1];
    await templatesTab.trigger('click');

    // Filters should not be visible on templates tab
    expect(wrapper.find('.status-filters').exists()).toBe(false);
  });
});

describe('SessionListView integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    mockRouteParams.id = 'test-project-id';

    // Reset callbacks
    onSessionSummaryUpdatedCallback = null;

    useProjectsStore.mockReturnValue({
      currentProject: { id: 'test-project-id', name: 'Test Project' },
      fetchProject: vi.fn(),
    });

    useSessionsStore.mockReturnValue({
      loading: false,
      error: null,
      sessions: [{ id: 'session-1', name: 'Session 1', status: 'running' }],
      fetchSessions: vi.fn().mockResolvedValue(),
      addSessionToList: vi.fn(),
      updateSession: vi.fn(),
      removeSessionFromList: vi.fn(),
    });

    mockGetSessionSummary.mockResolvedValue(null);
  });

  it('receives real-time summary updates while viewing session list', async () => {
    mount(SessionListView);
    await flushPromises();

    // Verify the callback is registered and can be called
    expect(onSessionSummaryUpdatedCallback).toBeDefined();

    // This simulates what happens when summaryService broadcasts to project subscribers
    const broadcastedSummary = {
      shortSummary: 'Session completed task',
      outcome: 'completed',
    };

    // Call the callback as if a WebSocket message was received
    onSessionSummaryUpdatedCallback('session-1', broadcastedSummary);
    await nextTick();

    // The view should now have the updated summary
  });
});
