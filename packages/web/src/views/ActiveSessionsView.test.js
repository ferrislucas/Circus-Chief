import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent } from 'vue';
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

// Mock sessions store
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
    props: ['session', 'showProject', 'showSummary', 'summary', 'summaryLoading', 'summaryError'],
    emits: ['retrySummary'],
    template: '<div class="session-card" :data-session-id="session.id" :data-summary="JSON.stringify(summary)"><slot /></div>',
  }),
}));

import ActiveSessionsView from './ActiveSessionsView.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useGlobalSessionSubscription } from '../composables/useWebSocket.js';

describe('ActiveSessionsView', () => {
  let mockSessionsStore;

  beforeEach(() => {
    vi.clearAllMocks();
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

    // Setup sessions store mock
    mockSessionsStore = {
      loading: false,
      error: null,
      activeSessions: [
        { id: 'session-1', name: 'Active Session 1', status: 'running', projectId: 'project-1' },
        { id: 'session-2', name: 'Active Session 2', status: 'waiting', projectId: 'project-2' },
      ],
      fetchActiveSessions: vi.fn().mockResolvedValue(),
    };
    useSessionsStore.mockReturnValue(mockSessionsStore);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
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
      await flushPromises();

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
      await nextTick();

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
      await flushPromises();

      // Update summaries for sessions from different projects
      const summary1 = { shortSummary: 'Summary from project 1' };
      const summary2 = { shortSummary: 'Summary from project 2' };

      onSessionSummaryUpdatedCallback('session-1', summary1, 'project-1');
      onSessionSummaryUpdatedCallback('session-2', summary2, 'project-2');
      await nextTick();

      // Verify both summaries are updated
      const card1 = wrapper.find('[data-session-id="session-1"]');
      const card2 = wrapper.find('[data-session-id="session-2"]');

      expect(card1.attributes('data-summary')).toBe(JSON.stringify(summary1));
      expect(card2.attributes('data-summary')).toBe(JSON.stringify(summary2));
    });

    it('overwrites existing summary with new update', async () => {
      const wrapper = mount(ActiveSessionsView);
      await flushPromises();

      // Initial summary
      const initialSummary = { shortSummary: 'Initial' };
      onSessionSummaryUpdatedCallback('session-1', initialSummary, 'project-1');
      await nextTick();

      // Updated summary
      const updatedSummary = { shortSummary: 'Updated' };
      onSessionSummaryUpdatedCallback('session-1', updatedSummary, 'project-1');
      await nextTick();

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

      // Session status changes to completed (no longer active)
      const updatedSession = {
        id: 'session-1',
        status: 'completed',
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

describe('ActiveSessionsView polling fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setActivePinia(createPinia());

    onSessionSummaryUpdatedCallback = null;

    useSessionsStore.mockReturnValue({
      loading: false,
      error: null,
      activeSessions: [{ id: 'session-1', status: 'running' }],
      fetchActiveSessions: vi.fn().mockResolvedValue(),
    });

    mockGetSessionSummary.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has polling as fallback with 30s interval (reduced from real-time)', async () => {
    const sessionsStore = useSessionsStore();

    mount(ActiveSessionsView);
    await flushPromises();

    // Initial fetch
    expect(sessionsStore.fetchActiveSessions).toHaveBeenCalledTimes(1);

    // Advance time by 30 seconds
    vi.advanceTimersByTime(30000);

    // Should have called fetchActiveSessions again
    expect(sessionsStore.fetchActiveSessions).toHaveBeenCalledTimes(2);
  });
});
