import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

// Create a mutable route object that can be modified during tests
const mockRouteParams = { id: 'test-session-id', tab: 'conversation' };

// Mock vue-router
vi.mock('vue-router', () => ({
  useRoute: vi.fn(() => ({
    params: mockRouteParams,
  })),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
  })),
}));

// Mock WebSocket composable
vi.mock('../composables/useWebSocket.js', () => ({
  useSessionSubscription: vi.fn(() => ({
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onStatus: vi.fn(() => vi.fn()),
    onMessage: vi.fn(() => vi.fn()),
    onError: vi.fn(() => vi.fn()),
    onCanvasAdd: vi.fn(() => vi.fn()),
    onCanvasRemove: vi.fn(() => vi.fn()),
    onTodosUpdate: vi.fn(() => vi.fn()),
    onSessionUpdate: vi.fn(() => vi.fn()),
    onSummaryUpdate: vi.fn(() => vi.fn()),
    onUsageUpdate: vi.fn(() => vi.fn()),
    onConversationUpdated: vi.fn(() => vi.fn()),
  })),
}));

// Mock the stores
vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(),
}));

vi.mock('../stores/canvas.js', () => ({
  useCanvasStore: vi.fn(() => ({
    fetchItems: vi.fn(),
  })),
}));

vi.mock('../stores/todos.js', () => ({
  useTodosStore: vi.fn(() => ({
    fetchTodos: vi.fn(),
  })),
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock the API - use object reference so value can be changed between tests
let mockChangesResult = { staged: '', unstaged: '', untracked: '' };
const mockGetSessionChanges = vi.fn(() => Promise.resolve(mockChangesResult));
const mockGetSessionSummary = vi.fn(() => Promise.resolve(null));
vi.mock('../composables/useApi.js', () => ({
  api: {
    getSessionChanges: (...args) => mockGetSessionChanges(...args),
    getSessionSummary: (...args) => mockGetSessionSummary(...args),
  },
}));

// Mock child components to avoid their internal dependencies
vi.mock('../components/ConversationTab.vue', () => ({
  default: defineComponent({ name: 'ConversationTab', template: '<div />' }),
}));
vi.mock('../components/ChangesTab.vue', () => ({
  default: defineComponent({ name: 'ChangesTab', template: '<div />' }),
}));
vi.mock('../components/CanvasTab.vue', () => ({
  default: defineComponent({ name: 'CanvasTab', template: '<div />' }),
}));
vi.mock('../components/NotesTab.vue', () => ({
  default: defineComponent({ name: 'NotesTab', template: '<div />' }),
}));
vi.mock('../components/SummaryTab.vue', () => ({
  default: defineComponent({ name: 'SummaryTab', template: '<div />' }),
}));

import SessionDetailView from './SessionDetailView.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useSessionSubscription } from '../composables/useWebSocket.js';

describe('SessionDetailView', () => {
  let mockSessionsStore;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());

    // Reset route params to default values
    mockRouteParams.id = 'test-session-id';
    mockRouteParams.tab = 'conversation';

    // Reset API mocks with default returns
    mockChangesResult = { staged: '', unstaged: '', untracked: '' };

    // Reset useSessionSubscription to default mock
    useSessionSubscription.mockImplementation(() => ({
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      onStatus: vi.fn(() => vi.fn()),
      onMessage: vi.fn(() => vi.fn()),
      onError: vi.fn(() => vi.fn()),
      onCanvasAdd: vi.fn(() => vi.fn()),
      onCanvasRemove: vi.fn(() => vi.fn()),
      onTodosUpdate: vi.fn(() => vi.fn()),
      onSessionUpdate: vi.fn(() => vi.fn()),
      onSummaryUpdate: vi.fn(() => vi.fn()),
      onUsageUpdate: vi.fn(() => vi.fn()),
      onConversationUpdated: vi.fn(() => vi.fn()),
    }));

    mockSessionsStore = {
      loading: false,
      currentSession: {
        id: 'test-session-id',
        projectId: 'test-project-id',
        name: 'Test Session',
        status: 'running',
        mode: 'standard',
        gitBranch: null,
        prUrl: null,
      },
      fetchSession: vi.fn(),
      fetchMessages: vi.fn(),
      fetchWorkLogs: vi.fn(),
      deleteSession: vi.fn(),
      archiveSession: vi.fn(),
      updateSessionStatus: vi.fn(),
      addMessage: vi.fn(),
      updateSession: vi.fn(),
      // Issue #175 - Conversation-level token tracking methods
      finalizeUsage: vi.fn(),
      updateRunningUsage: vi.fn(),
      updateConversation: vi.fn(),
    };

    useSessionsStore.mockReturnValue(mockSessionsStore);
  });

  function mountComponent() {
    return mount(SessionDetailView, {
      global: {
        stubs: {
          'router-link': {
            template: '<a><slot /></a>',
            props: ['to'],
          },
        },
      },
    });
  }

  describe('branch indicator', () => {
    it('does not show branch indicator when gitBranch is null', async () => {
      mockSessionsStore.currentSession.gitBranch = null;

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.find('.branch-indicator').exists()).toBe(false);
    });

    it('shows branch indicator when gitBranch is set', async () => {
      mockSessionsStore.currentSession.gitBranch = 'feature/auth-fix';

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.find('.branch-indicator').exists()).toBe(true);
    });

    it('displays the branch name in the indicator', async () => {
      mockSessionsStore.currentSession.gitBranch = 'feature/auth-fix';

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const branchIndicator = wrapper.find('.branch-indicator');
      expect(branchIndicator.text()).toContain('feature/auth-fix');
    });

    it('includes git branch icon (SVG)', async () => {
      mockSessionsStore.currentSession.gitBranch = 'main';

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const branchIndicator = wrapper.find('.branch-indicator');
      expect(branchIndicator.find('.branch-icon').exists()).toBe(true);
      expect(branchIndicator.find('svg').exists()).toBe(true);
    });

    it('sets title attribute for tooltip on long branch names', async () => {
      const longBranchName = 'feature/very-long-branch-name-that-might-get-truncated';
      mockSessionsStore.currentSession.gitBranch = longBranchName;

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const branchIndicator = wrapper.find('.branch-indicator');
      expect(branchIndicator.attributes('title')).toBe(longBranchName);
    });

    it('icon has aria-hidden for accessibility', async () => {
      mockSessionsStore.currentSession.gitBranch = 'main';

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const icon = wrapper.find('.branch-icon');
      expect(icon.attributes('aria-hidden')).toBe('true');
    });
  });

  describe('session meta display', () => {
    it('shows status badge', async () => {
      mockSessionsStore.currentSession.status = 'running';

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.find('.status-badge').exists()).toBe(true);
      expect(wrapper.find('.status-badge').text()).toBe('running');
    });

    it('shows session mode', async () => {
      mockSessionsStore.currentSession.mode = 'standard';

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.find('.session-mode').text()).toBe('Standard');
    });

    it('shows PR link when prUrl is set', async () => {
      mockSessionsStore.currentSession.prUrl = 'https://github.com/org/repo/pull/123';

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const prLink = wrapper.find('.pr-link');
      expect(prLink.exists()).toBe(true);
      expect(prLink.attributes('href')).toBe('https://github.com/org/repo/pull/123');
    });

    it('does not show PR link when prUrl is null', async () => {
      mockSessionsStore.currentSession.prUrl = null;

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.find('.pr-link').exists()).toBe(false);
    });
  });

  describe('loading state', () => {
    it('shows loading spinner when loading', async () => {
      mockSessionsStore.loading = true;
      mockSessionsStore.currentSession = null;

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.find('.loading-state').exists()).toBe(true);
      expect(wrapper.text()).toContain('Loading session...');
    });
  });

  describe('data fetching on mount', () => {
    it('fetches session, messages, and work logs on mount', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(mockSessionsStore.fetchSession).toHaveBeenCalledWith('test-session-id');
      expect(mockSessionsStore.fetchMessages).toHaveBeenCalledWith('test-session-id');
      expect(mockSessionsStore.fetchWorkLogs).toHaveBeenCalledWith('test-session-id');
    });

    it('fetches work logs after messages to ensure proper ordering', async () => {
      const callOrder = [];
      mockSessionsStore.fetchSession.mockImplementation(() => {
        callOrder.push('fetchSession');
        return Promise.resolve();
      });
      mockSessionsStore.fetchMessages.mockImplementation(() => {
        callOrder.push('fetchMessages');
        return Promise.resolve();
      });
      mockSessionsStore.fetchWorkLogs.mockImplementation(() => {
        callOrder.push('fetchWorkLogs');
        return Promise.resolve();
      });

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(callOrder).toEqual(['fetchSession', 'fetchMessages', 'fetchWorkLogs']);
    });
  });

  describe('session ID capturing (race condition prevention)', () => {
    it('captures session ID at component creation time', async () => {
      // Mount component with initial session ID
      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Verify initial fetch was called with the correct session ID
      expect(mockSessionsStore.fetchSession).toHaveBeenCalledWith('test-session-id');
      expect(mockSessionsStore.fetchMessages).toHaveBeenCalledWith('test-session-id');
    });

    it('uses captured session ID for WebSocket subscription', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Verify useSessionSubscription was called with the session ID
      expect(useSessionSubscription).toHaveBeenCalledWith('test-session-id');
    });

    it('uses captured session ID even after route params change (simulating navigation)', async () => {
      // Start with the original session ID
      mockRouteParams.id = 'original-session-id';

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Verify initial fetch used original session ID
      expect(mockSessionsStore.fetchSession).toHaveBeenCalledWith('original-session-id');

      // Clear mock call history
      mockSessionsStore.fetchSession.mockClear();
      mockSessionsStore.fetchMessages.mockClear();

      // Simulate what happens during navigation: route params change
      // (In real navigation, Vue Router updates params BEFORE component unmounts)
      mockRouteParams.id = 'different-project-id';

      // Verify that useSessionSubscription was called with the ORIGINAL ID
      // (captured at component creation), not the new route param
      expect(useSessionSubscription).toHaveBeenCalledWith('original-session-id');
      expect(useSessionSubscription).not.toHaveBeenCalledWith('different-project-id');
    });

    it('passes captured session ID to updateSessionStatus', async () => {
      // Get the mock onStatus callback registrar
      let capturedOnStatusCallback;
      useSessionSubscription.mockImplementation(() => ({
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        onStatus: vi.fn((callback) => {
          capturedOnStatusCallback = callback;
          return vi.fn();
        }),
        onMessage: vi.fn(() => vi.fn()),
        onError: vi.fn(() => vi.fn()),
        onCanvasAdd: vi.fn(() => vi.fn()),
        onCanvasRemove: vi.fn(() => vi.fn()),
        onTodosUpdate: vi.fn(() => vi.fn()),
        onSessionUpdate: vi.fn(() => vi.fn()),
        onSummaryUpdate: vi.fn(() => vi.fn()),
        onUsageUpdate: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Simulate route change (as happens during navigation)
      mockRouteParams.id = 'some-other-id';

      // Trigger a status update through WebSocket
      if (capturedOnStatusCallback) {
        capturedOnStatusCallback('stopped');
      }

      // Verify updateSessionStatus was called with the ORIGINAL session ID
      expect(mockSessionsStore.updateSessionStatus).toHaveBeenCalledWith(
        'test-session-id',
        'stopped'
      );
    });
  });

  describe('changes indicator', () => {
    it('does not show changes indicator when hasChanges is false', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // With default empty changes, indicator should not be visible
      expect(wrapper.find('.changes-indicator').exists()).toBe(false);
    });

    it('checks for changes on mount', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(mockGetSessionChanges).toHaveBeenCalledWith('test-session-id');
    });

    it('checks for changes when status changes to waiting', async () => {
      let capturedOnStatusCallback;
      useSessionSubscription.mockImplementation(() => ({
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        onStatus: vi.fn((callback) => {
          capturedOnStatusCallback = callback;
          return vi.fn();
        }),
        onMessage: vi.fn(() => vi.fn()),
        onError: vi.fn(() => vi.fn()),
        onCanvasAdd: vi.fn(() => vi.fn()),
        onCanvasRemove: vi.fn(() => vi.fn()),
        onTodosUpdate: vi.fn(() => vi.fn()),
        onSessionUpdate: vi.fn(() => vi.fn()),
        onSummaryUpdate: vi.fn(() => vi.fn()),
        onUsageUpdate: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Clear initial call
      mockGetSessionChanges.mockClear();

      // Trigger status change to 'waiting'
      if (capturedOnStatusCallback) {
        capturedOnStatusCallback('waiting');
      }
      await flushPromises();

      expect(mockGetSessionChanges).toHaveBeenCalledWith('test-session-id');
    });

    it('checks for changes when status changes to waiting', async () => {
      let capturedOnStatusCallback;
      useSessionSubscription.mockImplementation(() => ({
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        onStatus: vi.fn((callback) => {
          capturedOnStatusCallback = callback;
          return vi.fn();
        }),
        onMessage: vi.fn(() => vi.fn()),
        onError: vi.fn(() => vi.fn()),
        onCanvasAdd: vi.fn(() => vi.fn()),
        onCanvasRemove: vi.fn(() => vi.fn()),
        onTodosUpdate: vi.fn(() => vi.fn()),
        onSessionUpdate: vi.fn(() => vi.fn()),
        onSummaryUpdate: vi.fn(() => vi.fn()),
        onUsageUpdate: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Clear initial call
      mockGetSessionChanges.mockClear();

      // Trigger status change to 'waiting' (session completed a turn)
      if (capturedOnStatusCallback) {
        capturedOnStatusCallback('waiting');
      }
      await flushPromises();

      expect(mockGetSessionChanges).toHaveBeenCalledWith('test-session-id');
    });

  });

  describe('archive button', () => {
    describe('visibility based on session status', () => {
      it('hides archive button when session status is running', async () => {
        mockSessionsStore.currentSession.status = 'running';

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        expect(wrapper.find('.btn-archive-session').exists()).toBe(false);
      });

      it('shows archive button when session status is stopped', async () => {
        mockSessionsStore.currentSession.status = 'stopped';

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        expect(wrapper.find('.btn-archive-session').exists()).toBe(true);
      });

      it('shows archive button when session status is completed', async () => {
        mockSessionsStore.currentSession.status = 'completed';

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        expect(wrapper.find('.btn-archive-session').exists()).toBe(true);
      });

      it('shows archive button when session status is error', async () => {
        mockSessionsStore.currentSession.status = 'error';

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        expect(wrapper.find('.btn-archive-session').exists()).toBe(true);
      });

      it('shows archive button when session status is waiting', async () => {
        mockSessionsStore.currentSession.status = 'waiting';

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        expect(wrapper.find('.btn-archive-session').exists()).toBe(true);
      });

      it('shows archive button when session status is starting', async () => {
        mockSessionsStore.currentSession.status = 'starting';

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        expect(wrapper.find('.btn-archive-session').exists()).toBe(true);
      });

      it('hides archive button when currentSession is null', async () => {
        mockSessionsStore.currentSession = null;
        mockSessionsStore.loading = false;

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        expect(wrapper.find('.btn-archive-session').exists()).toBe(false);
      });
    });

    describe('archive button content', () => {
      it('displays Archive text on the button', async () => {
        mockSessionsStore.currentSession.status = 'stopped';

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        const archiveBtn = wrapper.find('.btn-archive-session');
        expect(archiveBtn.text()).toContain('Archive');
      });

      it('includes an archive icon (SVG)', async () => {
        mockSessionsStore.currentSession.status = 'stopped';

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        const archiveBtn = wrapper.find('.btn-archive-session');
        expect(archiveBtn.find('svg').exists()).toBe(true);
      });

      it('has the correct button classes', async () => {
        mockSessionsStore.currentSession.status = 'stopped';

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        const archiveBtn = wrapper.find('.btn-archive-session');
        expect(archiveBtn.classes()).toContain('btn');
        expect(archiveBtn.classes()).toContain('btn-outline-secondary');
      });
    });

    describe('archive action', () => {
      it('calls archiveSession when archive button is clicked', async () => {
        mockSessionsStore.currentSession.status = 'stopped';
        mockSessionsStore.archiveSession.mockResolvedValue({});

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(mockSessionsStore.archiveSession).toHaveBeenCalledWith('test-session-id');
      });

      it('calls archiveSession with correct session ID', async () => {
        mockRouteParams.id = 'specific-session-123';
        mockSessionsStore.currentSession.status = 'completed';
        mockSessionsStore.currentSession.id = 'specific-session-123';
        mockSessionsStore.archiveSession.mockResolvedValue({});

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(mockSessionsStore.archiveSession).toHaveBeenCalledWith('specific-session-123');
      });
    });

    describe('navigation after archive', () => {
      let mockRouter;

      beforeEach(async () => {
        const { useRouter } = await import('vue-router');
        mockRouter = { push: vi.fn() };
        useRouter.mockReturnValue(mockRouter);
      });

      it('navigates to project sessions list after successful archive', async () => {
        mockSessionsStore.currentSession.status = 'stopped';
        mockSessionsStore.currentSession.projectId = 'project-abc';
        mockSessionsStore.archiveSession.mockResolvedValue({});

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(mockRouter.push).toHaveBeenCalledWith('/projects/project-abc/sessions');
      });

      it('navigates to home when projectId is not available', async () => {
        mockSessionsStore.currentSession.status = 'error';
        mockSessionsStore.currentSession.projectId = null;
        mockSessionsStore.archiveSession.mockResolvedValue({});

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(mockRouter.push).toHaveBeenCalledWith('/');
      });

      it('navigates to home when projectId is undefined', async () => {
        mockSessionsStore.currentSession.status = 'stopped';
        delete mockSessionsStore.currentSession.projectId;
        mockSessionsStore.archiveSession.mockResolvedValue({});

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(mockRouter.push).toHaveBeenCalledWith('/');
      });
    });

    describe('success and error messages', () => {
      let mockUiStore;

      beforeEach(async () => {
        const { useUiStore } = await import('../stores/ui.js');
        mockUiStore = { success: vi.fn(), error: vi.fn() };
        useUiStore.mockReturnValue(mockUiStore);
      });

      it('shows success message after successful archive', async () => {
        mockSessionsStore.currentSession.status = 'stopped';
        mockSessionsStore.archiveSession.mockResolvedValue({});

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(mockUiStore.success).toHaveBeenCalledWith('Session archived');
      });

      it('shows error message when archive fails', async () => {
        mockSessionsStore.currentSession.status = 'stopped';
        mockSessionsStore.archiveSession.mockRejectedValue(new Error('Archive failed: server error'));

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(mockUiStore.error).toHaveBeenCalledWith('Archive failed: server error');
      });

      it('shows error message with correct message from API error', async () => {
        mockSessionsStore.currentSession.status = 'waiting';
        mockSessionsStore.archiveSession.mockRejectedValue(new Error('Can only archive stopped, completed, or error sessions'));

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(mockUiStore.error).toHaveBeenCalledWith('Can only archive stopped, completed, or error sessions');
      });

      it('does not show success message when archive fails', async () => {
        mockSessionsStore.currentSession.status = 'stopped';
        mockSessionsStore.archiveSession.mockRejectedValue(new Error('Archive failed'));

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(mockUiStore.success).not.toHaveBeenCalled();
      });
    });

    describe('archive button does not interfere with delete button', () => {
      it('both archive and delete buttons are present when session is archivable', async () => {
        mockSessionsStore.currentSession.status = 'stopped';

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        expect(wrapper.find('.btn-archive-session').exists()).toBe(true);
        expect(wrapper.find('.btn-delete-session').exists()).toBe(true);
      });

      it('only delete button is present when session is running', async () => {
        mockSessionsStore.currentSession.status = 'running';

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        expect(wrapper.find('.btn-archive-session').exists()).toBe(false);
        expect(wrapper.find('.btn-delete-session').exists()).toBe(true);
      });

      it('archive button click does not trigger delete', async () => {
        mockSessionsStore.currentSession.status = 'stopped';
        mockSessionsStore.archiveSession.mockResolvedValue({});

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(mockSessionsStore.archiveSession).toHaveBeenCalled();
        expect(mockSessionsStore.deleteSession).not.toHaveBeenCalled();
      });

      it('delete button click does not trigger archive', async () => {
        mockSessionsStore.currentSession.status = 'stopped';
        mockSessionsStore.deleteSession.mockResolvedValue({});

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-delete-session').trigger('click');
        await flushPromises();

        expect(mockSessionsStore.deleteSession).toHaveBeenCalled();
        expect(mockSessionsStore.archiveSession).not.toHaveBeenCalled();
      });
    });

    describe('session-action-buttons container', () => {
      it('renders session-action-buttons container', async () => {
        mockSessionsStore.currentSession.status = 'stopped';

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        expect(wrapper.find('.session-action-buttons').exists()).toBe(true);
      });

      it('contains both archive and delete buttons inside session-action-buttons', async () => {
        mockSessionsStore.currentSession.status = 'stopped';

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        const container = wrapper.find('.session-action-buttons');
        expect(container.find('.btn-archive-session').exists()).toBe(true);
        expect(container.find('.btn-delete-session').exists()).toBe(true);
      });
    });
  });

  // Issue #175 - Conversation-level token usage tracking
  describe('WebSocket usage update handlers', () => {
    it('registers onUsageUpdate callback on mount', async () => {
      let mockOnUsageUpdate = vi.fn(() => vi.fn());
      useSessionSubscription.mockImplementation(() => ({
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        onStatus: vi.fn(() => vi.fn()),
        onMessage: vi.fn(() => vi.fn()),
        onError: vi.fn(() => vi.fn()),
        onCanvasAdd: vi.fn(() => vi.fn()),
        onCanvasRemove: vi.fn(() => vi.fn()),
        onTodosUpdate: vi.fn(() => vi.fn()),
        onSessionUpdate: vi.fn(() => vi.fn()),
        onSummaryUpdate: vi.fn(() => vi.fn()),
        onUsageUpdate: mockOnUsageUpdate,
        onConversationUpdated: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(mockOnUsageUpdate).toHaveBeenCalled();
    });

    it('calls finalizeUsage with conversationId when isFinal is true', async () => {
      let capturedUsageCallback;
      useSessionSubscription.mockImplementation(() => ({
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        onStatus: vi.fn(() => vi.fn()),
        onMessage: vi.fn(() => vi.fn()),
        onError: vi.fn(() => vi.fn()),
        onCanvasAdd: vi.fn(() => vi.fn()),
        onCanvasRemove: vi.fn(() => vi.fn()),
        onTodosUpdate: vi.fn(() => vi.fn()),
        onSessionUpdate: vi.fn(() => vi.fn()),
        onSummaryUpdate: vi.fn(() => vi.fn()),
        onUsageUpdate: vi.fn((callback) => {
          capturedUsageCallback = callback;
          return vi.fn();
        }),
        onConversationUpdated: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Simulate final usage update with conversationId
      const usageData = {
        isFinal: true,
        usage: { inputTokens: 1000, outputTokens: 500 },
        conversationId: 'conv-123',
      };
      capturedUsageCallback(usageData);

      expect(mockSessionsStore.finalizeUsage).toHaveBeenCalledWith(
        usageData.usage,
        'conv-123'
      );
    });

    it('calls updateRunningUsage with conversationId when isFinal is false', async () => {
      let capturedUsageCallback;
      useSessionSubscription.mockImplementation(() => ({
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        onStatus: vi.fn(() => vi.fn()),
        onMessage: vi.fn(() => vi.fn()),
        onError: vi.fn(() => vi.fn()),
        onCanvasAdd: vi.fn(() => vi.fn()),
        onCanvasRemove: vi.fn(() => vi.fn()),
        onTodosUpdate: vi.fn(() => vi.fn()),
        onSessionUpdate: vi.fn(() => vi.fn()),
        onSummaryUpdate: vi.fn(() => vi.fn()),
        onUsageUpdate: vi.fn((callback) => {
          capturedUsageCallback = callback;
          return vi.fn();
        }),
        onConversationUpdated: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Simulate partial usage update with conversationId
      const usageData = {
        isFinal: false,
        usage: { inputTokens: 500, outputTokens: 250 },
        conversationId: 'conv-456',
      };
      capturedUsageCallback(usageData);

      expect(mockSessionsStore.updateRunningUsage).toHaveBeenCalledWith(
        usageData.usage,
        'conv-456'
      );
    });

    it('handles usage update without conversationId for backward compatibility', async () => {
      let capturedUsageCallback;
      useSessionSubscription.mockImplementation(() => ({
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        onStatus: vi.fn(() => vi.fn()),
        onMessage: vi.fn(() => vi.fn()),
        onError: vi.fn(() => vi.fn()),
        onCanvasAdd: vi.fn(() => vi.fn()),
        onCanvasRemove: vi.fn(() => vi.fn()),
        onTodosUpdate: vi.fn(() => vi.fn()),
        onSessionUpdate: vi.fn(() => vi.fn()),
        onSummaryUpdate: vi.fn(() => vi.fn()),
        onUsageUpdate: vi.fn((callback) => {
          capturedUsageCallback = callback;
          return vi.fn();
        }),
        onConversationUpdated: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Simulate usage update without conversationId
      const usageData = {
        isFinal: true,
        usage: { inputTokens: 1000, outputTokens: 500 },
        // no conversationId
      };
      capturedUsageCallback(usageData);

      expect(mockSessionsStore.finalizeUsage).toHaveBeenCalledWith(
        usageData.usage,
        undefined
      );
    });
  });

  describe('WebSocket conversation update handlers', () => {
    it('registers onConversationUpdated callback on mount', async () => {
      let mockOnConversationUpdated = vi.fn(() => vi.fn());
      useSessionSubscription.mockImplementation(() => ({
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        onStatus: vi.fn(() => vi.fn()),
        onMessage: vi.fn(() => vi.fn()),
        onError: vi.fn(() => vi.fn()),
        onCanvasAdd: vi.fn(() => vi.fn()),
        onCanvasRemove: vi.fn(() => vi.fn()),
        onTodosUpdate: vi.fn(() => vi.fn()),
        onSessionUpdate: vi.fn(() => vi.fn()),
        onSummaryUpdate: vi.fn(() => vi.fn()),
        onUsageUpdate: vi.fn(() => vi.fn()),
        onConversationUpdated: mockOnConversationUpdated,
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(mockOnConversationUpdated).toHaveBeenCalled();
    });

    it('calls updateConversation when conversation update is received', async () => {
      let capturedConversationCallback;
      useSessionSubscription.mockImplementation(() => ({
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        onStatus: vi.fn(() => vi.fn()),
        onMessage: vi.fn(() => vi.fn()),
        onError: vi.fn(() => vi.fn()),
        onCanvasAdd: vi.fn(() => vi.fn()),
        onCanvasRemove: vi.fn(() => vi.fn()),
        onTodosUpdate: vi.fn(() => vi.fn()),
        onSessionUpdate: vi.fn(() => vi.fn()),
        onSummaryUpdate: vi.fn(() => vi.fn()),
        onUsageUpdate: vi.fn(() => vi.fn()),
        onConversationUpdated: vi.fn((callback) => {
          capturedConversationCallback = callback;
          return vi.fn();
        }),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Simulate conversation update
      const conversationData = {
        id: 'conv-789',
        name: 'Test Conversation',
        inputTokens: 1500,
        outputTokens: 750,
      };
      capturedConversationCallback(conversationData);

      expect(mockSessionsStore.updateConversation).toHaveBeenCalledWith(conversationData);
    });
  });
});
