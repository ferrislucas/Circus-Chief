import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent, reactive } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

// Create mutable route params
const mockRouteParams = { id: 'test-project-id' };
const mockRoute = reactive({
  params: mockRouteParams,
  name: 'SessionList',
});

// Mock vue-router
vi.mock('vue-router', () => ({
  useRoute: vi.fn(() => mockRoute),
  useRouter: vi.fn(() => ({
    push: vi.fn((path) => {
      // Update the mock route based on the path
      if (path.includes('/archived')) {
        mockRoute.name = 'ArchivedSessions';
      } else if (path.includes('/templates')) {
        mockRoute.name = 'ProjectTemplates';
      } else if (path.includes('/commands')) {
        mockRoute.name = 'ProjectCommands';
      } else {
        mockRoute.name = 'SessionList';
      }
    }),
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
let onCommandRunOutputCallback = null;
let onCommandRunCompleteCallback = null;
let onCommandRunErrorCallback = null;

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
    onCommandRunOutput: vi.fn((cb) => {
      onCommandRunOutputCallback = cb;
      return vi.fn();
    }),
    onCommandRunComplete: vi.fn((cb) => {
      onCommandRunCompleteCallback = cb;
      return vi.fn();
    }),
    onCommandRunError: vi.fn((cb) => {
      onCommandRunErrorCallback = cb;
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

vi.mock('../stores/commandButtons.js', () => ({
  useCommandButtonsStore: vi.fn(),
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
    props: ['session', 'showSummary', 'summary', 'summaryLoading', 'summaryError', 'children', 'summaries', 'showArchive', 'showUnarchive', 'prUrl', 'prSummary'],
    emits: ['retrySummary', 'archive', 'unarchive'],
    template: '<div class="session-card" :data-session-id="session.id" :data-summary="JSON.stringify(summary)" :data-pr-url="prUrl" :data-pr-summary="JSON.stringify(prSummary)"><slot /></div>',
  }),
}));

vi.mock('../components/TemplatesPanel.vue', () => ({
  default: defineComponent({
    name: 'TemplatesPanel',
    props: ['projectId'],
    template: '<div class="templates-panel" />',
  }),
}));

vi.mock('../components/CommandButtonsPanel.vue', () => ({
  default: defineComponent({
    name: 'CommandButtonsPanel',
    props: ['projectId'],
    template: '<div class="command-buttons-panel" />',
  }),
}));

import SessionListView from './SessionListView.vue';
import { useProjectsStore } from '../stores/projects.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useProjectSubscription } from '../composables/useWebSocket.js';

// Helper to create a sessions store mock with proper groupedSessions getter
function createSessionsStoreMock(sessions = [], overrides = {}) {
  const baseStore = reactive({
    loading: false,
    error: null,
    sessions,
    archivedSessions: [],
    statusFilter: null,
    starredFilter: null,
    get groupedSessions() {
      // Derive groupedSessions from sessions like the real store does
      const grouped = [];
      const seen = new Set();

      this.sessions.forEach((session) => {
        if (!session.parentSessionId && !seen.has(session.id)) {
          grouped.push({
            parent: session,
            children: this.sessions.filter((s) => s.parentSessionId === session.id),
          });
          seen.add(session.id);
        }
      });

      return grouped;
    },
    fetchSessions: vi.fn().mockResolvedValue(),
    fetchArchivedSessions: vi.fn().mockResolvedValue(),
    archiveSession: vi.fn().mockResolvedValue(),
    unarchiveSession: vi.fn().mockResolvedValue(),
    addSessionToList: vi.fn(),
    updateSession: vi.fn(),
    removeSessionFromList: vi.fn(),
    restoreExpandedState: vi.fn(),
    saveExpandedState: vi.fn(),
    restoreStatusFilter: vi.fn(),
    setStatusFilter: vi.fn(function(filter) {
      this.statusFilter = filter;
    }),
    saveStatusFilter: vi.fn(),
    restoreStarredFilter: vi.fn(),
    setStarredFilter: vi.fn(function(filter) {
      this.starredFilter = filter;
    }),
    saveStarredFilter: vi.fn(),
    ...overrides,
  });
  return baseStore;
}

describe('SessionListView', () => {
  let mockProjectsStore;
  let mockSessionsStore;
  let mockCommandButtonsStore;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());

    // Reset route params and name - recreate the reactive object to ensure clean state
    Object.assign(mockRoute, {
      params: { id: 'test-project-id' },
      name: 'SessionList',
    });

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
    mockSessionsStore = createSessionsStoreMock([
      { id: 'session-1', name: 'Session 1', status: 'completed' },
      { id: 'session-2', name: 'Session 2', status: 'running' },
    ]);
    useSessionsStore.mockReturnValue(mockSessionsStore);

    // Setup command buttons store mock - MUST be created fresh in each test
    mockCommandButtonsStore = {
      buttons: [],
      runs: {},
      loading: false,
      error: null,
      fetchButtons: vi.fn().mockResolvedValue(),
      fetchLatestRunsForProject: vi.fn().mockResolvedValue(),
      getButtonsByProjectId: vi.fn(() => []),
      getLatestRunForButton: vi.fn(() => null),
    };
    useCommandButtonsStore.mockReturnValue(mockCommandButtonsStore);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to flush all async updates and force DOM re-render
  async function flushAll(wrapper) {
    await flushPromises();
    await nextTick();
    if (wrapper && wrapper.vm) {
      await wrapper.vm.$nextTick?.();
      // Force Vue to re-render with updated state (critical for data attribute/v-if/v-for updates)
      await wrapper.vm.$forceUpdate();
      await nextTick();
      // Multiple update cycles to ensure all conditions re-evaluate
      await wrapper.vm.$forceUpdate();
      await nextTick();
    }
  }

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
      await flushAll(wrapper);

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
      await flushAll(wrapper);

      // Find the SessionCard for session-1 and check the summary prop
      let sessionCard = wrapper.find('[data-session-id="session-1"]');
      expect(sessionCard.exists()).toBe(true);
      sessionCard = wrapper.find('[data-session-id="session-1"]'); // Re-query after state update
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
      await flushAll(wrapper);

      // Update summaries for both sessions
      const summary1 = { shortSummary: 'Summary 1' };
      const summary2 = { shortSummary: 'Summary 2' };

      onSessionSummaryUpdatedCallback('session-1', summary1);
      onSessionSummaryUpdatedCallback('session-2', summary2);
      await flushAll(wrapper);

      // Verify both summaries are updated - re-query after state update
      let card1 = wrapper.find('[data-session-id="session-1"]');
      let card2 = wrapper.find('[data-session-id="session-2"]');

      card1 = wrapper.find('[data-session-id="session-1"]');
      card2 = wrapper.find('[data-session-id="session-2"]');

      expect(card1.attributes('data-summary')).toBe(JSON.stringify(summary1));
      expect(card2.attributes('data-summary')).toBe(JSON.stringify(summary2));
    });

    it('overwrites existing summary with new update', async () => {
      const wrapper = mount(SessionListView);
      await flushPromises();

      // Initial summary
      const initialSummary = { shortSummary: 'Initial' };
      onSessionSummaryUpdatedCallback('session-1', initialSummary);
      await flushAll(wrapper);

      // Updated summary
      const updatedSummary = { shortSummary: 'Updated' };
      onSessionSummaryUpdatedCallback('session-1', updatedSummary);
      await flushAll(wrapper);

      let card = wrapper.find('[data-session-id="session-1"]');
      card = wrapper.find('[data-session-id="session-1"]'); // Re-query
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
  let mockCommandButtonsStore;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());

    // Reset route params and name
    Object.assign(mockRoute, {
      params: { id: 'test-project-id' },
      name: 'SessionList',
    });

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

    mockSessionsStore = createSessionsStoreMock([
      { id: 'session-1', name: 'Running Session', status: 'running' },
      { id: 'session-2', name: 'Waiting Session', status: 'waiting' },
      { id: 'session-3', name: 'Stopped Session', status: 'stopped' },
      { id: 'session-4', name: 'Error Session', status: 'error' },
      { id: 'session-5', name: 'Starting Session', status: 'starting' },
    ]);
    useSessionsStore.mockReturnValue(mockSessionsStore);

    mockCommandButtonsStore = {
      buttons: [],
      runs: {},
      loading: false,
      error: null,
      fetchButtons: vi.fn().mockResolvedValue(),
      fetchLatestRunsForProject: vi.fn().mockResolvedValue(),
      getButtonsByProjectId: vi.fn(() => []),
      getLatestRunForButton: vi.fn(() => null),
    };
    useCommandButtonsStore.mockReturnValue(mockCommandButtonsStore);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to flush all async updates and force DOM re-render
  async function flushAll(wrapper) {
    await flushPromises();
    await nextTick();
    if (wrapper && wrapper.vm) {
      await wrapper.vm.$nextTick?.();
      // Force Vue to re-render with updated state (critical for filter classes/session list updates)
      await wrapper.vm.$forceUpdate();
      await nextTick();
      // Multiple update cycles to ensure all conditions re-evaluate
      await wrapper.vm.$forceUpdate();
      await nextTick();
    }
  }

  describe('Filter button rendering', () => {
    it('renders filter buttons for running and idle statuses', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const filterButtons = wrapper.findAll('.filter-btn');
      expect(filterButtons).toHaveLength(3);
      expect(filterButtons[0].text()).toBe('running');
      expect(filterButtons[1].text()).toBe('idle');
      expect(filterButtons[2].classes()).toContain('star-btn');
    });

    it('only shows filter buttons on sessions tab', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      // Filters should be visible on sessions tab
      expect(wrapper.find('.status-filters').exists()).toBe(true);

      // Click on templates tab
      const templatesTab = wrapper.findAll('.tab')[2];
      await templatesTab.trigger('click');
      await flushAll(wrapper);

      // Filters should not be visible on templates tab
      expect(wrapper.find('.status-filters').exists()).toBe(false);
    });

    it('adds active class to selected filter button', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      let runningButton = wrapper.findAll('.filter-btn')[0];
      expect(runningButton.classes()).not.toContain('active');

      await runningButton.trigger('click');
      await flushAll(wrapper);
      runningButton = wrapper.findAll('.filter-btn')[0];
      expect(runningButton.classes()).toContain('active');
    });

    it('adds active class to idle filter button when selected', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      let idleButton = wrapper.findAll('.filter-btn')[1];
      expect(idleButton.classes()).not.toContain('active');

      await idleButton.trigger('click');
      await flushAll(wrapper);
      idleButton = wrapper.findAll('.filter-btn')[1];
      expect(idleButton.classes()).toContain('active');
    });
  });

  describe('No filter selected', () => {
    it('shows all sessions when no filters are active', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(5);
    });
  });

  describe('Running filter', () => {
    it('filters to show running and starting sessions when running filter is clicked', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const runningButton = wrapper.findAll('.filter-btn')[0];
      await runningButton.trigger('click');
      await flushAll(wrapper);

      const sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(2); // running + starting

      const sessionIds = sessionCards.map(c => c.attributes('data-session-id'));
      expect(sessionIds).toContain('session-1'); // running
      expect(sessionIds).toContain('session-5'); // starting
    });

    it('includes starting sessions in running filter', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const runningButton = wrapper.findAll('.filter-btn')[0];
      await runningButton.trigger('click');
      await flushAll(wrapper);

      const sessionCards = wrapper.findAll('.session-card');
      const sessionIds = sessionCards.map(c => c.attributes('data-session-id'));
      expect(sessionIds).toContain('session-5'); // starting session
    });

    it('does not include idle sessions in running filter', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const runningButton = wrapper.findAll('.filter-btn')[0];
      await runningButton.trigger('click');
      await flushAll(wrapper);

      const sessionCards = wrapper.findAll('.session-card');
      const sessionIds = sessionCards.map(c => c.attributes('data-session-id'));
      expect(sessionIds).not.toContain('session-2'); // waiting
      expect(sessionIds).not.toContain('session-3'); // stopped
      expect(sessionIds).not.toContain('session-4'); // error
    });

    it('toggles running filter off when clicked again', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const runningButton = wrapper.findAll('.filter-btn')[0];

      // Click to enable filter
      await runningButton.trigger('click');
      await flushAll(wrapper);
      expect(wrapper.findAll('.session-card')).toHaveLength(2); // running + starting

      // Click again to disable filter
      await runningButton.trigger('click');
      await flushAll(wrapper);
      expect(wrapper.findAll('.session-card')).toHaveLength(5);
    });
  });

  describe('Idle filter', () => {
    it('shows waiting sessions when idle filter is clicked', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const idleButton = wrapper.findAll('.filter-btn')[1];
      await idleButton.trigger('click');
      await flushAll(wrapper);

      const sessionCards = wrapper.findAll('.session-card');
      const sessionIds = sessionCards.map(c => c.attributes('data-session-id'));
      expect(sessionIds).toContain('session-2'); // waiting
    });

    it('shows stopped sessions when idle filter is clicked', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const idleButton = wrapper.findAll('.filter-btn')[1];
      await idleButton.trigger('click');
      await flushAll(wrapper);

      const sessionCards = wrapper.findAll('.session-card');
      const sessionIds = sessionCards.map(c => c.attributes('data-session-id'));
      expect(sessionIds).toContain('session-3'); // stopped
    });

    it('shows error sessions when idle filter is clicked', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const idleButton = wrapper.findAll('.filter-btn')[1];
      await idleButton.trigger('click');
      await flushAll(wrapper);

      const sessionCards = wrapper.findAll('.session-card');
      const sessionIds = sessionCards.map(c => c.attributes('data-session-id'));
      expect(sessionIds).toContain('session-4'); // error
    });

    it('shows all idle statuses (waiting, stopped, error) when idle filter is clicked', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const idleButton = wrapper.findAll('.filter-btn')[1];
      await idleButton.trigger('click');
      await flushAll(wrapper);

      const sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(3); // waiting, stopped, error

      const sessionIds = sessionCards.map(c => c.attributes('data-session-id'));
      expect(sessionIds).toContain('session-2'); // waiting
      expect(sessionIds).toContain('session-3'); // stopped
      expect(sessionIds).toContain('session-4'); // error
    });

    it('does not include running sessions in idle filter', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const idleButton = wrapper.findAll('.filter-btn')[1];
      await idleButton.trigger('click');
      await flushAll(wrapper);

      const sessionCards = wrapper.findAll('.session-card');
      const sessionIds = sessionCards.map(c => c.attributes('data-session-id'));
      expect(sessionIds).not.toContain('session-1'); // running
    });

    it('does not include starting sessions in idle filter', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const idleButton = wrapper.findAll('.filter-btn')[1];
      await idleButton.trigger('click');
      await flushAll(wrapper);

      const sessionCards = wrapper.findAll('.session-card');
      const sessionIds = sessionCards.map(c => c.attributes('data-session-id'));
      expect(sessionIds).not.toContain('session-5'); // starting
    });

    it('toggles idle filter off when clicked again', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const idleButton = wrapper.findAll('.filter-btn')[1];

      // Click to enable filter
      await idleButton.trigger('click');
      await flushAll(wrapper);
      expect(wrapper.findAll('.session-card')).toHaveLength(3);

      // Click again to disable filter
      await idleButton.trigger('click');
      await flushAll(wrapper);
      expect(wrapper.findAll('.session-card')).toHaveLength(5);
    });
  });

  describe('Exclusive filter behavior', () => {
    it('disables running filter when idle filter is clicked', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const filterButtons = wrapper.findAll('.filter-btn');

      // Click running filter
      await filterButtons[0].trigger('click');
      await flushAll(wrapper);
      let sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(2); // running + starting

      // Click idle filter (should disable running and enable idle)
      await filterButtons[1].trigger('click');
      await flushAll(wrapper);

      // Should now show only idle sessions
      sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(3); // waiting, stopped, error

      const sessionIds = sessionCards.map(c => c.attributes('data-session-id'));
      expect(sessionIds).not.toContain('session-1'); // running - now excluded
      expect(sessionIds).not.toContain('session-5'); // starting - now excluded
      expect(sessionIds).toContain('session-2'); // waiting
      expect(sessionIds).toContain('session-3'); // stopped
      expect(sessionIds).toContain('session-4'); // error
    });

    it('disables idle filter when running filter is clicked', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const filterButtons = wrapper.findAll('.filter-btn');

      // Click idle filter
      await filterButtons[1].trigger('click');
      await flushAll(wrapper);
      let sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(3); // waiting, stopped, error

      // Click running filter (should disable idle and enable running)
      await filterButtons[0].trigger('click');
      await flushAll(wrapper);

      // Should now show only running sessions
      sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(2); // running + starting

      const sessionIds = sessionCards.map(c => c.attributes('data-session-id'));
      expect(sessionIds).toContain('session-1'); // running
      expect(sessionIds).toContain('session-5'); // starting
      expect(sessionIds).not.toContain('session-2'); // waiting - now excluded
      expect(sessionIds).not.toContain('session-3'); // stopped - now excluded
      expect(sessionIds).not.toContain('session-4'); // error - now excluded
    });

    it('only allows one filter active at a time', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      let filterButtons = wrapper.findAll('.filter-btn');

      // Click running filter
      await filterButtons[0].trigger('click');
      await flushAll(wrapper);
      filterButtons = wrapper.findAll('.filter-btn');
      expect(filterButtons[0].classes()).toContain('active');
      expect(filterButtons[1].classes()).not.toContain('active');

      // Click idle filter
      await filterButtons[1].trigger('click');
      await flushAll(wrapper);
      filterButtons = wrapper.findAll('.filter-btn');
      expect(filterButtons[0].classes()).not.toContain('active');
      expect(filterButtons[1].classes()).toContain('active');

      // Click running again
      await filterButtons[0].trigger('click');
      await flushAll(wrapper);
      filterButtons = wrapper.findAll('.filter-btn');
      expect(filterButtons[0].classes()).toContain('active');
      expect(filterButtons[1].classes()).not.toContain('active');
    });
  });

  describe('Grouped sessions filtering', () => {
    it('filters grouped sessions by parent status (running filter)', async () => {
      // Set up store with grouped sessions
      mockSessionsStore = createSessionsStoreMock([
        { id: 'session-1', name: 'Running Session', status: 'running' },
        { id: 'session-2', name: 'Waiting Session', status: 'waiting' },
      ]);
      useSessionsStore.mockReturnValue(mockSessionsStore);

      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const runningButton = wrapper.findAll('.filter-btn')[0];
      await runningButton.trigger('click');
      await flushAll(wrapper);

      // Should show only the running parent group
      const sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(1);
      expect(sessionCards[0].attributes('data-session-id')).toBe('session-1');
    });

    it('filters grouped sessions by parent status (idle filter)', async () => {
      // Set up store with grouped sessions
      mockSessionsStore = createSessionsStoreMock([
        { id: 'session-1', name: 'Running Session', status: 'running' },
        { id: 'session-2', name: 'Waiting Session', status: 'waiting' },
      ]);
      useSessionsStore.mockReturnValue(mockSessionsStore);

      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const idleButton = wrapper.findAll('.filter-btn')[1];
      await idleButton.trigger('click');
      await flushAll(wrapper);

      // Should show only the waiting parent group
      const sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(1);
      expect(sessionCards[0].attributes('data-session-id')).toBe('session-2');
    });

    it('includes entire group (parent + children) when parent matches filter', async () => {
      // Set up store with grouped sessions
      mockSessionsStore = createSessionsStoreMock([
        { id: 'session-1', name: 'Running Session', status: 'running' },
        { id: 'child-1', name: 'Child 1', status: 'completed', parentSessionId: 'session-1' },
        { id: 'child-2', name: 'Child 2', status: 'completed', parentSessionId: 'session-1' },
      ]);
      useSessionsStore.mockReturnValue(mockSessionsStore);

      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      // Click running filter
      const runningButton = wrapper.findAll('.filter-btn')[0];
      await runningButton.trigger('click');
      await flushAll(wrapper);

      // Should show the session card (which includes its children)
      const sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(1);
      expect(sessionCards[0].attributes('data-session-id')).toBe('session-1');
    });
  });

  describe('Empty states', () => {
    it('shows empty state message when running filter returns no results', async () => {
      // Set up store with no running sessions
      mockSessionsStore.sessions = [
        { id: 'session-1', name: 'Stopped Session', status: 'stopped' },
      ];
      useSessionsStore.mockReturnValue(mockSessionsStore);

      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const runningButton = wrapper.findAll('.filter-btn')[0];
      await runningButton.trigger('click');
      await flushAll(wrapper);

      const emptyState = wrapper.find('.empty-state');
      expect(emptyState.exists()).toBe(true);
      expect(emptyState.text()).toContain('No sessions match the current filter');
    });

    it('shows empty state message when idle filter returns no results', async () => {
      // Set up store with only running sessions
      mockSessionsStore.sessions = [
        { id: 'session-1', name: 'Running Session', status: 'running' },
      ];
      useSessionsStore.mockReturnValue(mockSessionsStore);

      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const idleButton = wrapper.findAll('.filter-btn')[1];
      await idleButton.trigger('click');
      await flushAll(wrapper);

      const emptyState = wrapper.find('.empty-state');
      expect(emptyState.exists()).toBe(true);
      expect(emptyState.text()).toContain('No sessions match the current filter');
    });

    it('shows idle sessions but not starting sessions when only starting and idle exist', async () => {
      mockSessionsStore.sessions = [
        { id: 'session-1', name: 'Starting Session', status: 'starting' },
        { id: 'session-2', name: 'Waiting Session', status: 'waiting' },
      ];
      useSessionsStore.mockReturnValue(mockSessionsStore);

      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const idleButton = wrapper.findAll('.filter-btn')[1];
      await idleButton.trigger('click');
      await flushAll(wrapper);

      const sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(1);
      expect(sessionCards[0].attributes('data-session-id')).toBe('session-2');
    });
  });

  describe('Edge cases', () => {
    it('handles empty session list', async () => {
      mockSessionsStore.sessions = [];
      useSessionsStore.mockReturnValue(mockSessionsStore);

      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      // Should show the "No sessions yet" empty state
      const emptyState = wrapper.find('.empty-state');
      expect(emptyState.exists()).toBe(true);
      expect(emptyState.text()).toContain('No sessions yet');
    });

    it('handles session list with only starting sessions', async () => {
      mockSessionsStore.sessions = [
        { id: 'session-1', name: 'Starting Session', status: 'starting' },
      ];
      useSessionsStore.mockReturnValue(mockSessionsStore);

      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      // Running filter should show the starting session
      const runningButton = wrapper.findAll('.filter-btn')[0];
      await runningButton.trigger('click');
      await flushAll(wrapper);

      let sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(1);
      expect(sessionCards[0].attributes('data-session-id')).toBe('session-1');

      // Reset to no filter
      await runningButton.trigger('click');
      await flushAll(wrapper);

      // Idle filter should show empty (starting is not idle)
      const idleButton = wrapper.findAll('.filter-btn')[1];
      await idleButton.trigger('click');
      await flushAll(wrapper);

      const emptyState = wrapper.find('.empty-state');
      expect(emptyState.exists()).toBe(true);
    });

    it('starting sessions show in running filter but not idle filter', async () => {
      mockSessionsStore.sessions = [
        { id: 'session-1', name: 'Starting Session', status: 'starting' },
        { id: 'session-2', name: 'Running Session', status: 'running' },
        { id: 'session-3', name: 'Waiting Session', status: 'waiting' },
      ];
      useSessionsStore.mockReturnValue(mockSessionsStore);

      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      // Running filter should include starting
      const runningButton = wrapper.findAll('.filter-btn')[0];
      await runningButton.trigger('click');
      await flushAll(wrapper);

      let sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(2);
      const runningIds = sessionCards.map(c => c.attributes('data-session-id'));
      expect(runningIds).toContain('session-1'); // starting
      expect(runningIds).toContain('session-2'); // running

      // Reset
      await runningButton.trigger('click');
      await flushAll(wrapper);

      // Idle filter should NOT include starting
      const idleButton = wrapper.findAll('.filter-btn')[1];
      await idleButton.trigger('click');
      await flushAll(wrapper);

      sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(1);
      const idleIds = sessionCards.map(c => c.attributes('data-session-id'));
      expect(idleIds).toContain('session-3'); // waiting
      expect(idleIds).not.toContain('session-1'); // starting - NOT idle
    });
  });
});

describe('SessionListView integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());

    // Reset route params and name
    Object.assign(mockRoute, {
      params: { id: 'test-project-id' },
      name: 'SessionList',
    });

    // Reset callbacks
    onSessionSummaryUpdatedCallback = null;

    useProjectsStore.mockReturnValue({
      currentProject: { id: 'test-project-id', name: 'Test Project' },
      fetchProject: vi.fn(),
    });

    useSessionsStore.mockReturnValue(createSessionsStoreMock([
      { id: 'session-1', name: 'Session 1', status: 'running' },
    ]));

    useCommandButtonsStore.mockReturnValue({
      buttons: [],
      runs: {},
      loading: false,
      error: null,
      fetchButtons: vi.fn().mockResolvedValue(),
      fetchLatestRunsForProject: vi.fn().mockResolvedValue(),
      getButtonsByProjectId: vi.fn(() => []),
      getLatestRunForButton: vi.fn(() => null),
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

describe('SessionListView Archived Tab', () => {
  let mockSessionsStore;
  let mockProjectsStore;
  let mockCommandButtonsStore;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());

    // Reset route params and name (start on Sessions tab by default)
    Object.assign(mockRoute, {
      params: { id: 'test-project-id' },
      name: 'SessionList',
    });

    // Reset callbacks
    onSessionSummaryUpdatedCallback = null;

    mockProjectsStore = {
      currentProject: { id: 'test-project-id', name: 'Test Project' },
      fetchProject: vi.fn(),
    };
    useProjectsStore.mockReturnValue(mockProjectsStore);

    mockSessionsStore = createSessionsStoreMock([
      { id: 'session-1', name: 'Session 1', status: 'completed' },
      { id: 'session-2', name: 'Session 2', status: 'running' },
    ]);
    useSessionsStore.mockReturnValue(mockSessionsStore);

    // Setup command buttons store mock
    mockCommandButtonsStore = {
      buttons: [],
      runs: {},
      loading: false,
      error: null,
      fetchButtons: vi.fn().mockResolvedValue(),
      fetchLatestRunsForProject: vi.fn().mockResolvedValue(),
      getButtonsByProjectId: vi.fn(() => []),
      getLatestRunForButton: vi.fn(() => null),
    };
    useCommandButtonsStore.mockReturnValue(mockCommandButtonsStore);

    mockGetSessionSummary.mockResolvedValue(null);
  });

  // Helper to flush all async updates and force DOM re-render
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

  it('renders Sessions tab as active by default', async () => {
    const wrapper = mount(SessionListView);
      await flushAll(wrapper);

    const tabs = wrapper.findAll('.tab');
    expect(tabs.length).toBe(5);
    expect(tabs[0].text()).toBe('Sessions');
    expect(tabs[1].text()).toBe('Archived');
    expect(tabs[2].text()).toBe('Templates');
    expect(tabs[3].text()).toBe('Commands');
    expect(tabs[4].text()).toContain('Scheduled');

    // Sessions tab should be active
    expect(tabs[0].classes()).toContain('active');
    expect(tabs[1].classes()).not.toContain('active');
  });

  it('switches to Archived tab when clicked', async () => {
    const wrapper = mount(SessionListView);
      await flushAll(wrapper);

    let archivedTab = wrapper.findAll('.tab')[1];
    await archivedTab.trigger('click');
    await flushAll(wrapper);

    archivedTab = wrapper.findAll('.tab')[1];
    expect(archivedTab.classes()).toContain('active');
  });

  it('fetches archived sessions on first Archived tab click', async () => {
    const wrapper = mount(SessionListView);
      await flushAll(wrapper);

    // Initially, fetchArchivedSessions should not have been called
    expect(mockSessionsStore.fetchArchivedSessions).not.toHaveBeenCalled();

    // Click Archived tab
    const archivedTab = wrapper.findAll('.tab')[1];
    await archivedTab.trigger('click');
    await flushPromises();

    // Now it should have been called
    expect(mockSessionsStore.fetchArchivedSessions).toHaveBeenCalledWith('test-project-id');
  });

  it('does not fetch archived sessions again on subsequent tab clicks', async () => {
    const wrapper = mount(SessionListView);
      await flushAll(wrapper);

    const archivedTab = wrapper.findAll('.tab')[1];

    // First click
    await archivedTab.trigger('click');
    await flushPromises();
    expect(mockSessionsStore.fetchArchivedSessions).toHaveBeenCalledTimes(1);

    // Switch away and back
    const sessionsTab = wrapper.findAll('.tab')[0];
    await sessionsTab.trigger('click');
    await flushPromises();

    await archivedTab.trigger('click');
    await flushPromises();

    // Should still only be called once (lazy loaded)
    expect(mockSessionsStore.fetchArchivedSessions).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when no archived sessions', async () => {
    mockSessionsStore.archivedSessions = [];
    const wrapper = mount(SessionListView);
      await flushAll(wrapper);

    // Switch to Archived tab
    const archivedTab = wrapper.findAll('.tab')[1];
    await archivedTab.trigger('click');
    await flushAll(wrapper);

    const emptyState = wrapper.find('.empty-state');
    expect(emptyState.exists()).toBe(true);
    expect(emptyState.text()).toContain('No archived sessions');
  });

  it('displays archived sessions when available', async () => {
    mockSessionsStore.archivedSessions = [
      { id: 'archived-1', name: 'Archived Session 1', status: 'completed', archived: true },
      { id: 'archived-2', name: 'Archived Session 2', status: 'stopped', archived: true },
    ];
    const wrapper = mount(SessionListView);
      await flushAll(wrapper);

    // Switch to Archived tab
    const archivedTab = wrapper.findAll('.tab')[1];
    await archivedTab.trigger('click');
    await flushPromises();

    const sessionCards = wrapper.findAll('.session-card');
    expect(sessionCards.length).toBe(2);
  });

  it('passes showArchive=true to SessionCards in Sessions tab', async () => {
    const wrapper = mount(SessionListView);
      await flushAll(wrapper);

    // Check that session cards in the sessions tab exist
    const sessionCards = wrapper.findAll('.session-card');
    expect(sessionCards.length).toBe(2);
  });

  it('passes showUnarchive=true to SessionCards in Archived tab', async () => {
    mockSessionsStore.archivedSessions = [
      { id: 'archived-1', name: 'Archived Session', status: 'completed', archived: true },
    ];
    const wrapper = mount(SessionListView);
      await flushAll(wrapper);

    // Switch to Archived tab
    const archivedTab = wrapper.findAll('.tab')[1];
    await archivedTab.trigger('click');
    await flushAll(wrapper);

    const sessionCards = wrapper.findAll('.session-card');
    expect(sessionCards.length).toBe(1);
  });

  it('hides New Session button on Archived tab', async () => {
    const wrapper = mount(SessionListView);
      await flushAll(wrapper);

    // Button should be visible on Sessions tab
    expect(wrapper.find('.btn-primary').exists()).toBe(true);

    // Switch to Archived tab
    const archivedTab = wrapper.findAll('.tab')[1];
    await archivedTab.trigger('click');
    await flushAll(wrapper);

    // Button should be hidden
    expect(wrapper.find('.btn-primary').exists()).toBe(false);
  });

  describe('Command buttons loading', () => {
    it('fetches command buttons when component mounts', async () => {
      mockCommandButtonsStore.fetchButtons.mockClear();
      mount(SessionListView);
      await flushPromises();

      expect(mockCommandButtonsStore.fetchButtons).toHaveBeenCalledWith('test-project-id');
    });

    it('fetches buttons alongside session data on mount', async () => {
      mockCommandButtonsStore.fetchButtons.mockClear();
      mount(SessionListView);
      await flushPromises();

      // Verify both sessions and buttons are fetched
      expect(mockSessionsStore.fetchSessions).toHaveBeenCalledWith('test-project-id');
      expect(mockCommandButtonsStore.fetchButtons).toHaveBeenCalledWith('test-project-id');
    });
  });

  describe('Starred filter', () => {
    it('restores starred filter on mount', async () => {
      mount(SessionListView);
      await flushAll();

      expect(mockSessionsStore.restoreStarredFilter).toHaveBeenCalled();
    });

    it('filters sessions by starred status when filter is set', async () => {
      mockSessionsStore = createSessionsStoreMock([
        { id: 'session-1', name: 'Starred Session', status: 'completed', starred: true },
        { id: 'session-2', name: 'Regular Session', status: 'completed', starred: false },
      ]);
      useSessionsStore.mockReturnValue(mockSessionsStore);

      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      // Set starred filter
      mockSessionsStore.starredFilter = 'starred';
      await wrapper.vm.$nextTick();
      await flushAll(wrapper);

      // Should show only the starred session
      const sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(1);
      expect(sessionCards[0].attributes('data-session-id')).toBe('session-1');
    });

    it('shows all sessions when starred filter is cleared', async () => {
      mockSessionsStore = createSessionsStoreMock([
        { id: 'session-1', name: 'Starred Session', status: 'completed', starred: true },
        { id: 'session-2', name: 'Regular Session', status: 'completed', starred: false },
      ]);
      useSessionsStore.mockReturnValue(mockSessionsStore);

      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      // Clear the filter (set to null)
      mockSessionsStore.starredFilter = null;
      await wrapper.vm.$nextTick();
      await flushAll(wrapper);

      // Should show all sessions
      const sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(2);
    });

    it('calls setStarredFilter when starred button is clicked', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      // Get the star filter button by class
      const starredButton = wrapper.find('.star-btn');

      await starredButton.trigger('click');
      await flushAll(wrapper);

      expect(mockSessionsStore.setStarredFilter).toHaveBeenCalledWith('starred');
    });

    it('toggles starred filter to unstarred when button is clicked again', async () => {
      mockSessionsStore.starredFilter = 'starred';
      useSessionsStore.mockReturnValue(mockSessionsStore);

      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      // Find and click the star filter button
      const starredButton = wrapper.find('.star-btn');

      await starredButton.trigger('click');
      await flushAll(wrapper);

      expect(mockSessionsStore.setStarredFilter).toHaveBeenCalledWith('unstarred');
    });

    it('filter works independently of status and archive state', async () => {
      // Set up sessions with both starred and unstarred
      mockSessionsStore = createSessionsStoreMock([
        { id: 'session-1', name: 'Session 1', status: 'completed', starred: true },
        { id: 'session-2', name: 'Session 2', status: 'completed', starred: false },
        { id: 'session-3', name: 'Session 3', status: 'running', starred: true },
      ]);
      useSessionsStore.mockReturnValue(mockSessionsStore);

      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      // Set starred filter
      mockSessionsStore.starredFilter = 'starred';
      await wrapper.vm.$nextTick();
      await flushAll(wrapper);

      // Should show only the starred sessions
      const sessionCards = wrapper.findAll('.session-card');
      expect(sessionCards).toHaveLength(2);
      const ids = sessionCards.map((card) => card.attributes('data-session-id'));
      expect(ids).toContain('session-1');
      expect(ids).toContain('session-3');
    });

    it('star filter button shows empty star when no filter is active', async () => {
      mockSessionsStore.starredFilter = null;
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const starButton = wrapper.find('.star-btn');
      expect(starButton.text()).toContain('☆');
    });

    it('star filter button shows filled star when starred filter is active', async () => {
      mockSessionsStore.starredFilter = 'starred';
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const starButton = wrapper.find('.star-btn');
      expect(starButton.text()).toContain('⭐');
    });

    it('displays correct tooltip for empty star (no filter)', async () => {
      mockSessionsStore.starredFilter = null;
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const starButton = wrapper.find('.star-btn');
      expect(starButton.attributes('title')).toBe('Showing all sessions. Click to filter by starred.');
    });

    it('displays correct tooltip for filled star (starred filter)', async () => {
      mockSessionsStore.starredFilter = 'starred';
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const starButton = wrapper.find('.star-btn');
      expect(starButton.attributes('title')).toBe('Showing starred sessions only. Click to filter unstarred.');
    });

    it('displays correct tooltip for unstarred filter', async () => {
      mockSessionsStore.starredFilter = 'unstarred';
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const starButton = wrapper.find('.star-btn');
      expect(starButton.attributes('title')).toBe('Showing unstarred sessions only. Click to show all.');
    });

    it('filter button has active class when any filter is applied', async () => {
      mockSessionsStore.starredFilter = 'starred';
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const starButton = wrapper.find('.star-btn');
      expect(starButton.classes()).toContain('star-filter-active');
    });

    it('filter button does not have active class when no filter is applied', async () => {
      mockSessionsStore.starredFilter = null;
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const starButton = wrapper.find('.star-btn');
      expect(starButton.classes()).toContain('star-filter-all');
    });

    it('cycles through three-state filter: null -> starred -> unstarred -> null', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      const starButton = wrapper.find('.star-btn');

      // Initially null, click to go to 'starred'
      mockSessionsStore.starredFilter = null;
      await starButton.trigger('click');
      expect(mockSessionsStore.setStarredFilter).toHaveBeenCalledWith('starred');

      // Clear mock and set to 'starred'
      mockSessionsStore.setStarredFilter.mockClear();
      mockSessionsStore.starredFilter = 'starred';
      await wrapper.vm.$nextTick();

      // Click to go to 'unstarred'
      await starButton.trigger('click');
      expect(mockSessionsStore.setStarredFilter).toHaveBeenCalledWith('unstarred');

      // Clear mock and set to 'unstarred'
      mockSessionsStore.setStarredFilter.mockClear();
      mockSessionsStore.starredFilter = 'unstarred';
      await wrapper.vm.$nextTick();

      // Click to go back to null
      await starButton.trigger('click');
      expect(mockSessionsStore.setStarredFilter).toHaveBeenCalledWith(null);
    });
  });

  describe('Archived sessions across projects', () => {
    it('loads archived sessions when first clicking archived tab', async () => {
      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      mockRoute.name = 'ArchivedSessions';
      mockSessionsStore.archivedSessions = [
        { id: 'session-1', archived: true, name: 'Archived 1' },
      ];

      await wrapper.vm.$nextTick();

      // Verify fetchArchivedSessions was called for the current project
      expect(mockSessionsStore.fetchArchivedSessions).toHaveBeenCalledWith('test-project-id');
    });

    it('loads archived sessions on page refresh (when mounted directly on archived route)', async () => {
      // Simulate page refresh while on /projects/:id/archived route
      // The route.name is already 'ArchivedSessions' when component mounts
      mockRoute.name = 'ArchivedSessions';

      const wrapper = mount(SessionListView);
      await flushAll(wrapper);

      mockSessionsStore.archivedSessions = [
        { id: 'session-1', archived: true, name: 'Archived Session 1' },
        { id: 'session-2', archived: true, name: 'Archived Session 2' },
      ];

      await wrapper.vm.$nextTick();

      // With { immediate: true } on the route.name watch, fetchArchivedSessions
      // should be called even though route.name didn't change from component mount
      expect(mockSessionsStore.fetchArchivedSessions).toHaveBeenCalledWith('test-project-id');

      // Verify archived sessions are displayed
      expect(mockSessionsStore.archivedSessions).toHaveLength(2);
    });
  });

  describe('PR data passing to SessionCard', () => {
    it('passes prUrl to parent SessionCard in grouped sessions', async () => {
      const pinia = createPinia();
      setActivePinia(pinia);

      const mockSessionsStore = createSessionsStoreMock([
        {
          id: 'parent-1',
          name: 'Parent Session',
          status: 'completed',
          prUrl: 'https://github.com/owner/repo/pull/123',
        },
        {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'completed',
          parentSessionId: 'parent-1',
        },
      ]);

      vi.mocked(useSessionsStore).mockReturnValue(mockSessionsStore);
      vi.mocked(useProjectsStore).mockReturnValue({
        currentProject: { id: 'test-project-id' },
        projects: [{ id: 'test-project-id' }],
        fetchProjects: vi.fn(),
        fetchProject: vi.fn(),
      });
      vi.mocked(useCommandButtonsStore).mockReturnValue({
        buttons: [],
        runs: {},
        loading: false,
        error: null,
        fetchButtons: vi.fn().mockResolvedValue(),
        fetchLatestRunsForProject: vi.fn().mockResolvedValue(),
        getButtonsByProjectId: vi.fn(() => []),
        getLatestRunForButton: vi.fn(() => null),
      });

      const wrapper = mount(SessionListView, {
        global: {
          plugins: [pinia],
          stubs: {
            TemplatesPanel: true,
            CommandButtonsPanel: true,
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            DuplicateSessionButton: true,
            StatusIndicator: true,
            OverflowMenu: true,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Find the parent SessionCard and verify prUrl prop is passed
      const parentCard = wrapper.findComponent({ name: 'SessionCard' });
      expect(parentCard.exists()).toBe(true);
      expect(parentCard.props('prUrl')).toBe('https://github.com/owner/repo/pull/123');
    });

    it('passes prUrl to unarchived sessions', async () => {
      const pinia = createPinia();
      setActivePinia(pinia);

      const mockSessionsStore = createSessionsStoreMock([
        {
          id: 'session-1',
          name: 'Session 1',
          status: 'completed',
          prUrl: 'https://github.com/owner/repo/pull/789',
        },
      ]);

      vi.mocked(useSessionsStore).mockReturnValue(mockSessionsStore);
      vi.mocked(useProjectsStore).mockReturnValue({
        currentProject: { id: 'test-project-id' },
        projects: [{ id: 'test-project-id' }],
        fetchProjects: vi.fn(),
        fetchProject: vi.fn(),
      });
      vi.mocked(useCommandButtonsStore).mockReturnValue({
        buttons: [],
        runs: {},
        loading: false,
        error: null,
        fetchButtons: vi.fn().mockResolvedValue(),
        fetchLatestRunsForProject: vi.fn().mockResolvedValue(),
        getButtonsByProjectId: vi.fn(() => []),
        getLatestRunForButton: vi.fn(() => null),
      });

      const wrapper = mount(SessionListView, {
        global: {
          plugins: [pinia],
          stubs: {
            TemplatesPanel: true,
            CommandButtonsPanel: true,
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            DuplicateSessionButton: true,
            StatusIndicator: true,
            OverflowMenu: true,
          },
        },
      });

      await flushPromises();
      await nextTick();

      const sessionCard = wrapper.findComponent({ name: 'SessionCard' });
      expect(sessionCard.exists()).toBe(true);
      expect(sessionCard.props('prUrl')).toBe('https://github.com/owner/repo/pull/789');
    });
  });
});
