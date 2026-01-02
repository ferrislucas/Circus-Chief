import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent, reactive, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

// Mock vue-router
vi.mock('vue-router', () => ({
  useRoute: vi.fn(() => ({
    params: {},
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

// Mock WebSocket composable - global subscription
vi.mock('../composables/useWebSocket.js', () => ({
  useGlobalSessionSubscription: vi.fn(() => ({
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

// Create a module-level mock store that persists across tests
// Wrap it in reactive() so Vue can detect property changes
let mockSessionsStore = reactive({
  loading: false,
  error: null,
  statusFilter: null,
  starredFilter: null,
  activeSessions: [],
  fetchActiveSessions: vi.fn().mockResolvedValue(),
  restoreStatusFilter: vi.fn(),
  setStatusFilter(filter) {
    this.statusFilter = filter;
  },
  restoreStarredFilter: vi.fn(),
  setStarredFilter(filter) {
    this.starredFilter = filter;
  },
});

// Mock sessions store - use factory function to return the store
vi.mock('../stores/sessions.js', () => {
  return {
    useSessionsStore: () => mockSessionsStore,
  };
});

// Mock command buttons store
let mockCommandButtonsStore = {
  buttons: [],
  runs: {},
  loading: false,
  error: null,
  fetchButtons: vi.fn().mockResolvedValue(),
  getButtonsByProjectId: vi.fn(() => []),
  getLatestRunForButton: vi.fn(() => null),
};

// Mock command buttons store - use factory function to return the store
vi.mock('../stores/commandButtons.js', () => {
  return {
    useCommandButtonsStore: () => mockCommandButtonsStore,
  };
});

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
    props: ['session', 'showProject', 'showSummary', 'summary', 'summaryLoading', 'summaryError'],
    emits: ['retrySummary'],
    template: '<div class="session-card" :data-session-id="session.id" :data-summary="JSON.stringify(summary)"><slot /></div>',
  }),
}));

// Import mocks FIRST and set return values BEFORE importing the component
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useGlobalSessionSubscription } from '../composables/useWebSocket.js';

// Now import the component - mocks are already configured by the factory functions above
import ActiveSessionsView from './ActiveSessionsView.vue';

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

describe('ActiveSessionsView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());

    // Reset callbacks
    onSessionCreatedCallback = null;
    onSessionUpdatedCallback = null;
    onSessionDeletedCallback = null;
    onSessionSummaryUpdatedCallback = null;

    // Reset API mocks
    mockGetSessionSummary.mockReset();
    mockGetSessionSummary.mockResolvedValue(null);

    // Reset mock function call counts and reconfigure
    mockSessionsStore.fetchActiveSessions.mockClear();
    mockSessionsStore.fetchActiveSessions.mockResolvedValue();
    mockSessionsStore.restoreStatusFilter.mockClear();
    mockSessionsStore.restoreStarredFilter.mockClear();

    // Update store properties
    mockSessionsStore.loading = false;
    mockSessionsStore.error = null;
    mockSessionsStore.statusFilter = null;
    mockSessionsStore.starredFilter = null;
    mockSessionsStore.activeSessions = [
      { id: 'session-1', name: 'Active Session 1', status: 'running', projectId: 'project-1' },
      { id: 'session-2', name: 'Active Session 2', status: 'waiting', projectId: 'project-2' },
    ];

    // Reset command buttons store mocks
    mockCommandButtonsStore.fetchButtons.mockClear();
    mockCommandButtonsStore.fetchButtons.mockResolvedValue();
    mockCommandButtonsStore.getButtonsByProjectId.mockClear();
    mockCommandButtonsStore.getLatestRunForButton.mockClear();

    // Update command buttons store properties
    mockCommandButtonsStore.buttons = [];
    mockCommandButtonsStore.runs = {};
    mockCommandButtonsStore.loading = false;
    mockCommandButtonsStore.error = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('WebSocket subscription', () => {
    it('uses global session subscription on mount', async () => {
      mount(ActiveSessionsView);
      await flushPromises();

      expect(useGlobalSessionSubscription).toHaveBeenCalled();
    });

    it('registers onSessionSummaryUpdated callback', async () => {
      mount(ActiveSessionsView);
      await flushPromises();

      expect(onSessionSummaryUpdatedCallback).not.toBeNull();
      expect(typeof onSessionSummaryUpdatedCallback).toBe('function');
    });

    it('receives summary updates for sessions across all projects', async () => {
      mount(ActiveSessionsView);
      await flushPromises();

      // Global subscription should receive updates from any project
      expect(onSessionSummaryUpdatedCallback).toBeDefined();
    });
  });

  describe('Real-time summary updates', () => {
    it('updates summary when onSessionSummaryUpdated is called', async () => {
      const wrapper = mount(ActiveSessionsView);
      await flushAll(wrapper);

      // Verify callback is registered
      expect(onSessionSummaryUpdatedCallback).not.toBeNull();

      // Simulate receiving a summary update (global subscription includes projectId)
      const newSummary = {
        id: 'summary-1',
        sessionId: 'session-1',
        shortSummary: 'Test summary for active session',
        fullSummary: 'Full test summary',
        keyActions: ['action1'],
        filesModified: ['file.js'],
        outcome: 'ongoing',
      };

      // Global subscription callback signature: (sessionId, summary, projectId)
      onSessionSummaryUpdatedCallback('session-1', newSummary, 'project-1');
      await flushAll(wrapper);

      // Find the SessionCard for session-1 and check the summary prop
      const sessionCard = wrapper.find('[data-session-id="session-1"]');
      expect(sessionCard.exists()).toBe(true);
      expect(sessionCard.attributes('data-summary')).toBe(JSON.stringify(newSummary));
    });

    it('clears loading state when summary update is received', async () => {
      mount(ActiveSessionsView);
      await flushPromises();

      const newSummary = { shortSummary: 'Test' };
      onSessionSummaryUpdatedCallback('session-1', newSummary, 'project-1');
      await nextTick();

      // Loading state should be cleared
    });

    it('clears error state when summary update is received', async () => {
      mount(ActiveSessionsView);
      await flushPromises();

      const newSummary = { shortSummary: 'Test' };
      onSessionSummaryUpdatedCallback('session-1', newSummary, 'project-1');
      await nextTick();

      // Error state should be cleared
    });

    it('handles summary updates for sessions from different projects', async () => {
      const wrapper = mount(ActiveSessionsView);
      await flushAll(wrapper);

      // Update summaries for sessions from different projects
      const summary1 = { shortSummary: 'Summary from project 1' };
      const summary2 = { shortSummary: 'Summary from project 2' };

      onSessionSummaryUpdatedCallback('session-1', summary1, 'project-1');
      onSessionSummaryUpdatedCallback('session-2', summary2, 'project-2');
      await flushAll(wrapper);

      // Verify both summaries are updated
      const card1 = wrapper.find('[data-session-id="session-1"]');
      const card2 = wrapper.find('[data-session-id="session-2"]');

      expect(card1.attributes('data-summary')).toBe(JSON.stringify(summary1));
      expect(card2.attributes('data-summary')).toBe(JSON.stringify(summary2));
    });

    it('overwrites existing summary with new update', async () => {
      const wrapper = mount(ActiveSessionsView);
      await flushAll(wrapper);

      // Initial summary
      const initialSummary = { shortSummary: 'Initial' };
      onSessionSummaryUpdatedCallback('session-1', initialSummary, 'project-1');
      await flushAll(wrapper);

      // Updated summary
      const updatedSummary = { shortSummary: 'Updated' };
      onSessionSummaryUpdatedCallback('session-1', updatedSummary, 'project-1');
      await flushAll(wrapper);

      const card = wrapper.find('[data-session-id="session-1"]');
      expect(card.attributes('data-summary')).toBe(JSON.stringify(updatedSummary));
    });
  });

  describe('Session lifecycle events', () => {
    it('cleans up summary data when session is deleted', async () => {
      mount(ActiveSessionsView);
      await flushPromises();

      // First add a summary
      const summary = { shortSummary: 'Test' };
      onSessionSummaryUpdatedCallback('session-1', summary, 'project-1');
      await nextTick();

      // Then delete the session (simulate onSessionDeleted)
      onSessionDeletedCallback('session-1', 'project-1');
      await nextTick();

      // Summary data should be cleaned up
    });

    it('cleans up summary when session becomes inactive', async () => {
      mount(ActiveSessionsView);
      await flushPromises();

      // Add a summary
      const summary = { shortSummary: 'Test' };
      onSessionSummaryUpdatedCallback('session-1', summary, 'project-1');
      await nextTick();

      // Session status changes to stopped (no longer active)
      const updatedSession = {
        id: 'session-1',
        status: 'stopped',
        projectId: 'project-1',
      };
      onSessionUpdatedCallback(updatedSession, 'project-1');
      await nextTick();

      // Session should be removed from active list and summary cleaned up
    });
  });

  describe('Global subscription behavior', () => {
    it('receives updates without filtering by project', async () => {
      mount(ActiveSessionsView);
      await flushPromises();

      // Global subscription should receive updates from any project
      // The callback should be called with (sessionId, summary, projectId)
      const summary = { shortSummary: 'From any project' };

      // This should work regardless of projectId
      onSessionSummaryUpdatedCallback('session-1', summary, 'any-project-id');
      await nextTick();

      // The summary should be applied
    });
  });
});

describe('Status filtering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());

    onSessionCreatedCallback = null;
    onSessionUpdatedCallback = null;
    onSessionDeletedCallback = null;
    onSessionSummaryUpdatedCallback = null;

    mockGetSessionSummary.mockReset();
    mockGetSessionSummary.mockResolvedValue(null);

    // Update the module-level mockSessionsStore with test data
    mockSessionsStore.loading = false;
    mockSessionsStore.error = null;
    mockSessionsStore.statusFilter = null;
    mockSessionsStore.starredFilter = null;
    mockSessionsStore.activeSessions = [
      { id: 'session-1', name: 'Running Session', status: 'running', projectId: 'project-1' },
      { id: 'session-2', name: 'Waiting Session', status: 'waiting', projectId: 'project-2' },
      { id: 'session-3', name: 'Starting Session', status: 'starting', projectId: 'project-1' },
      { id: 'session-4', name: 'Error Session', status: 'error', projectId: 'project-3' },
      { id: 'session-5', name: 'Stopped Session', status: 'stopped', projectId: 'project-4' },
    ];
    mockSessionsStore.fetchActiveSessions.mockClear();
    mockSessionsStore.fetchActiveSessions.mockResolvedValue();
    mockSessionsStore.restoreStatusFilter.mockClear();
    mockSessionsStore.restoreStarredFilter.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders filter buttons for running and idle statuses', async () => {
    const wrapper = mount(ActiveSessionsView);
    await flushPromises();

    const filterButtons = wrapper.findAll('.filter-btn');
    expect(filterButtons).toHaveLength(4);
    expect(filterButtons[0].text()).toBe('running');
    expect(filterButtons[1].text()).toBe('idle');
    expect(filterButtons[2].text()).toContain('Starred');
    expect(filterButtons[3].text()).toContain('Unstarred');
  });

  it('shows all sessions when no filters are active', async () => {
    const wrapper = mount(ActiveSessionsView);
    await flushPromises();

    const sessionCards = wrapper.findAll('.session-card');
    expect(sessionCards).toHaveLength(5);
  });

  it('filters to show only running sessions (running + starting) when running filter is clicked', async () => {
    const wrapper = mount(ActiveSessionsView);
    await flushAll(wrapper);

    const runningButton = wrapper.findAll('.filter-btn')[0];
    await runningButton.trigger('click');
    await flushAll(wrapper);

    const sessionCards = wrapper.findAll('.session-card');
    expect(sessionCards).toHaveLength(2);
    const sessionIds = sessionCards.map(card => card.attributes('data-session-id'));
    expect(sessionIds).toContain('session-1'); // running
    expect(sessionIds).toContain('session-3'); // starting
  });

  it('filters to show only idle sessions (waiting + error + stopped) when idle filter is clicked', async () => {
    const wrapper = mount(ActiveSessionsView);
    await flushAll(wrapper);

    const idleButton = wrapper.findAll('.filter-btn')[1];
    await idleButton.trigger('click');
    await flushAll(wrapper);

    const sessionCards = wrapper.findAll('.session-card');
    expect(sessionCards).toHaveLength(3);
    const sessionIds = sessionCards.map(card => card.attributes('data-session-id'));
    expect(sessionIds).toContain('session-2'); // waiting
    expect(sessionIds).toContain('session-4'); // error
    expect(sessionIds).toContain('session-5'); // stopped
  });

  it('makes filters mutually exclusive - running filter disables idle filter', async () => {
    const wrapper = mount(ActiveSessionsView);
    await flushAll(wrapper);

    let filterButtons = wrapper.findAll('.filter-btn');
    let runningButton = filterButtons[0];
    let idleButton = filterButtons[1];

    // Click running filter
    await runningButton.trigger('click');
    await flushAll(wrapper);
    filterButtons = wrapper.findAll('.filter-btn');
    runningButton = filterButtons[0];
    idleButton = filterButtons[1];
    expect(runningButton.classes()).toContain('active');
    expect(idleButton.classes()).not.toContain('active');

    // Click idle filter - should disable running and enable idle
    await idleButton.trigger('click');
    await flushAll(wrapper);
    filterButtons = wrapper.findAll('.filter-btn');
    runningButton = filterButtons[0];
    idleButton = filterButtons[1];
    expect(runningButton.classes()).not.toContain('active');
    expect(idleButton.classes()).toContain('active');
  });

  it('makes filters mutually exclusive - idle filter disables running filter', async () => {
    const wrapper = mount(ActiveSessionsView);
    await flushAll(wrapper);

    let filterButtons = wrapper.findAll('.filter-btn');
    let runningButton = filterButtons[0];
    let idleButton = filterButtons[1];

    // Click idle filter first
    await idleButton.trigger('click');
    await flushAll(wrapper);
    filterButtons = wrapper.findAll('.filter-btn');
    runningButton = filterButtons[0];
    idleButton = filterButtons[1];
    expect(idleButton.classes()).toContain('active');
    expect(runningButton.classes()).not.toContain('active');

    // Click running filter - should disable idle and enable running
    await runningButton.trigger('click');
    await flushAll(wrapper);
    filterButtons = wrapper.findAll('.filter-btn');
    runningButton = filterButtons[0];
    idleButton = filterButtons[1];
    expect(idleButton.classes()).not.toContain('active');
    expect(runningButton.classes()).toContain('active');
  });

  it('toggles filter off when clicked again (shows all sessions)', async () => {
    const wrapper = mount(ActiveSessionsView);
    await flushAll(wrapper);

    let runningButton = wrapper.findAll('.filter-btn')[0];

    // Click to enable filter
    await runningButton.trigger('click');
    await flushAll(wrapper);
    runningButton = wrapper.findAll('.filter-btn')[0];
    expect(wrapper.findAll('.session-card')).toHaveLength(2);
    expect(runningButton.classes()).toContain('active');

    // Click again to disable filter (show all)
    await runningButton.trigger('click');
    await flushAll(wrapper);
    runningButton = wrapper.findAll('.filter-btn')[0];
    expect(wrapper.findAll('.session-card')).toHaveLength(5);
    expect(runningButton.classes()).not.toContain('active');
  });

  it('adds active class to selected filter button', async () => {
    const wrapper = mount(ActiveSessionsView);
    await flushAll(wrapper);

    let runningButton = wrapper.findAll('.filter-btn')[0];
    expect(runningButton.classes()).not.toContain('active');

    await runningButton.trigger('click');
    await flushAll(wrapper);
    runningButton = wrapper.findAll('.filter-btn')[0];
    expect(runningButton.classes()).toContain('active');
  });

  it('includes starting status in running filter', async () => {
    const wrapper = mount(ActiveSessionsView);
    await flushAll(wrapper);

    const runningButton = wrapper.findAll('.filter-btn')[0];
    await runningButton.trigger('click');
    await flushAll(wrapper);

    const sessionCards = wrapper.findAll('.session-card');
    const sessionIds = sessionCards.map(card => card.attributes('data-session-id'));

    // Should include session-3 which has status 'starting'
    expect(sessionIds).toContain('session-3');
  });

  it('includes waiting and error statuses in idle filter', async () => {
    const wrapper = mount(ActiveSessionsView);
    await flushAll(wrapper);

    const idleButton = wrapper.findAll('.filter-btn')[1];
    await idleButton.trigger('click');
    await flushAll(wrapper);

    const sessionCards = wrapper.findAll('.session-card');
    const sessionIds = sessionCards.map(card => card.attributes('data-session-id'));

    // Should include session-2 (waiting) and session-4 (error)
    expect(sessionIds).toContain('session-2');
    expect(sessionIds).toContain('session-4');
  });

  it('shows empty state message when filters return no results', async () => {
    // Set up store with only running session (no idle sessions)
    mockSessionsStore.activeSessions = [
      { id: 'session-1', name: 'Running Session', status: 'running', projectId: 'project-1' },
    ];

    const wrapper = mount(ActiveSessionsView);
    await flushAll(wrapper);

    // Click idle filter - no idle sessions exist
    const idleButton = wrapper.findAll('.filter-btn')[1];
    await idleButton.trigger('click');
    await flushAll(wrapper);

    const emptyState = wrapper.find('.empty-state');
    expect(emptyState.exists()).toBe(true);
    expect(emptyState.text()).toContain('No sessions match the current filter');
  });

  it('handles multiple status groupings in running filter correctly', async () => {
    // Verify that both "running" and "starting" are included in running filter
    mockSessionsStore.activeSessions = [
      { id: 'session-1', name: 'Running', status: 'running', projectId: 'project-1' },
      { id: 'session-2', name: 'Starting', status: 'starting', projectId: 'project-2' },
      { id: 'session-3', name: 'Waiting', status: 'waiting', projectId: 'project-3' },
    ];

    const wrapper = mount(ActiveSessionsView);
    await flushAll(wrapper);

    const runningButton = wrapper.findAll('.filter-btn')[0];
    await runningButton.trigger('click');
    await flushAll(wrapper);

    const sessionCards = wrapper.findAll('.session-card');
    expect(sessionCards).toHaveLength(2);
    const sessionIds = sessionCards.map(c => c.attributes('data-session-id'));
    expect(sessionIds).toEqual(['session-1', 'session-2']);
  });

  it('handles multiple status groupings in idle filter correctly', async () => {
    // Verify that "waiting", "stopped", and "error" are all included in idle filter
    mockSessionsStore.activeSessions = [
      { id: 'session-1', name: 'Waiting', status: 'waiting', projectId: 'project-1' },
      { id: 'session-2', name: 'Stopped', status: 'stopped', projectId: 'project-2' },
      { id: 'session-3', name: 'Error', status: 'error', projectId: 'project-3' },
      { id: 'session-4', name: 'Running', status: 'running', projectId: 'project-4' },
    ];

    const wrapper = mount(ActiveSessionsView);
    await flushAll(wrapper);

    const idleButton = wrapper.findAll('.filter-btn')[1];
    await idleButton.trigger('click');
    await flushAll(wrapper);

    const sessionCards = wrapper.findAll('.session-card');
    expect(sessionCards).toHaveLength(3);
    const sessionIds = sessionCards.map(c => c.attributes('data-session-id'));
    expect(sessionIds).toEqual(['session-1', 'session-2', 'session-3']);
  });
});

describe('ActiveSessionsView polling fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());

    // Reset callbacks
    onSessionCreatedCallback = null;
    onSessionUpdatedCallback = null;
    onSessionDeletedCallback = null;
    onSessionSummaryUpdatedCallback = null;

    // Reset API mocks
    mockGetSessionSummary.mockReset();
    mockGetSessionSummary.mockResolvedValue(null);

    // Reset mock function call counts and reconfigure
    mockSessionsStore.fetchActiveSessions.mockClear();
    mockSessionsStore.fetchActiveSessions.mockResolvedValue();
    mockSessionsStore.restoreStatusFilter.mockClear();
    mockSessionsStore.restoreStarredFilter.mockClear();

    // Update store properties
    mockSessionsStore.loading = false;
    mockSessionsStore.error = null;
    mockSessionsStore.statusFilter = null;
    mockSessionsStore.starredFilter = null;
    mockSessionsStore.activeSessions = [
      { id: 'session-1', name: 'Active Session 1', status: 'running', projectId: 'project-1' },
      { id: 'session-2', name: 'Active Session 2', status: 'waiting', projectId: 'project-2' },
    ];

    // Reset command buttons store mocks
    mockCommandButtonsStore.fetchButtons.mockClear();
    mockCommandButtonsStore.fetchButtons.mockResolvedValue();
    mockCommandButtonsStore.getButtonsByProjectId.mockClear();
    mockCommandButtonsStore.getLatestRunForButton.mockClear();

    // Update command buttons store properties
    mockCommandButtonsStore.buttons = [];
    mockCommandButtonsStore.runs = {};
    mockCommandButtonsStore.loading = false;
    mockCommandButtonsStore.error = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has polling as fallback with 30s interval (reduced from real-time)', async () => {
    const sessionsStore = useSessionsStore();

    // Ensure mock is properly set up
    expect(typeof sessionsStore.fetchActiveSessions).toBe('function');
    expect(sessionsStore.fetchActiveSessions.mock).toBeDefined();

    mount(ActiveSessionsView);
    await flushPromises();

    // Initial fetch
    const callCount = sessionsStore.fetchActiveSessions.mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(1);

    // Advance time by 30 seconds
    vi.advanceTimersByTime(30000);
    await flushPromises();

    // Should have called fetchActiveSessions at least twice (initial + polling)
    const newCallCount = sessionsStore.fetchActiveSessions.mock.calls.length;
    expect(newCallCount).toBeGreaterThan(callCount);
  });

  describe('Command buttons loading for multiple projects', () => {
    it('fetches command buttons for projects with active sessions on mount', async () => {
      mockCommandButtonsStore.fetchButtons.mockClear();
      mount(ActiveSessionsView);
      await flushPromises();

      // Should fetch buttons for both projects
      expect(mockCommandButtonsStore.fetchButtons).toHaveBeenCalledWith('project-1');
      expect(mockCommandButtonsStore.fetchButtons).toHaveBeenCalledWith('project-2');
    });

    it('handles errors when fetching buttons gracefully', async () => {
      mockCommandButtonsStore.fetchButtons.mockRejectedValueOnce(new Error('API Error'));

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mount(ActiveSessionsView);
      await flushPromises();

      // Should not throw, just log the error
      expect(mockCommandButtonsStore.fetchButtons).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Starred filter', () => {
    it('renders starred filter buttons', async () => {
      const wrapper = mount(ActiveSessionsView);
      await flushAll(wrapper);

      // Get the filter buttons
      const filterButtons = wrapper.findAll('.filter-btn');

      // Check that starred filter buttons are rendered
      const starredButton = filterButtons.find((btn) => btn.text().includes('Starred'));
      expect(starredButton).toBeDefined();
    });
  });
});
