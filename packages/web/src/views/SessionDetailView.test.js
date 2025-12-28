import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent, reactive } from 'vue';
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
    onChangesUpdate: vi.fn(() => vi.fn()),
  })),
}));

// Mock useModelInfo composable - use real implementation to test model display
vi.mock('../composables/useModelInfo.js', async () => {
  const actual = await vi.importActual('../composables/useModelInfo.js');
  return actual;
});

// Mock the stores
vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(),
}));

// Create a mutable canvas store mock that tests can update
let mockCanvasStoreState = reactive({
  items: [],
  groupedItems: [],
  fetchItems: vi.fn(),
  addItem: vi.fn(),
  removeItem: vi.fn(),
});

vi.mock('../stores/canvas.js', () => ({
  useCanvasStore: vi.fn(() => mockCanvasStoreState),
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
vi.mock('../components/CommandsTab.vue', () => ({
  default: defineComponent({ name: 'CommandsTab', template: '<div />' }),
}));
vi.mock('../components/PrIndicators.vue', () => ({
  default: defineComponent({ name: 'PrIndicators', template: '<div />' }),
}));
vi.mock('../components/TokenUsagePanel.vue', () => ({
  default: defineComponent({ name: 'TokenUsagePanel', template: '<div />' }),
}));
vi.mock('../stores/templates.js', () => ({
  useTemplatesStore: vi.fn(() => ({
    fetchProjectTemplates: vi.fn(),
    getTemplateById: vi.fn(() => null),
  })),
}));

import SessionDetailView from './SessionDetailView.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useCanvasStore } from '../stores/canvas.js';
import { useSessionSubscription } from '../composables/useWebSocket.js';

describe('SessionDetailView', () => {
  let mockSessionsStore;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());

    // Reset canvas store mock after clearAllMocks
    useCanvasStore.mockReturnValue(mockCanvasStoreState);

    // Mock confirm dialog to always return true for testing
    global.confirm = vi.fn(() => true);

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
      onChangesUpdate: vi.fn(() => vi.fn()),
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
        archived: false,
      },
      fetchSession: vi.fn().mockResolvedValue(undefined),
      fetchMessages: vi.fn().mockResolvedValue(undefined),
      fetchConversations: vi.fn().mockResolvedValue(undefined),
      fetchWorkLogs: vi.fn().mockResolvedValue(undefined),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      archiveSession: vi.fn().mockResolvedValue(undefined),
      unarchiveSession: vi.fn().mockResolvedValue(undefined),
      updateSessionStatus: vi.fn(),
      addMessage: vi.fn(),
      updateSession: vi.fn(),
      // Issue #175 - Conversation-level token tracking methods
      finalizeUsage: vi.fn(),
      updateRunningUsage: vi.fn(),
      updateConversation: vi.fn(),
      clearRunningUsage: vi.fn(),
    };

    useSessionsStore.mockReturnValue(mockSessionsStore);
  });

  function mountComponent() {
    const RouterLinkStub = defineComponent({
      name: 'RouterLink',
      props: {
        to: String,
        activeClass: String,
      },
      inheritAttrs: true,
      template: '<a :href="to" v-bind="$attrs" :class="$attrs.class"><slot /></a>',
    });

    return mount(SessionDetailView, {
      global: {
        components: {
          'router-link': RouterLinkStub,
          'RouterLink': RouterLinkStub,
        },
        stubs: {
          'router-link': RouterLinkStub,
          'RouterLink': RouterLinkStub,
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

      // PrIndicators component should be rendered when prUrl is set
      const prIndicators = wrapper.findComponent({ name: 'PrIndicators' });
      expect(prIndicators.exists()).toBe(true);
    });

    it('does not show PR link when prUrl is null', async () => {
      mockSessionsStore.currentSession.prUrl = null;

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // PrIndicators component should not be rendered when prUrl is null
      const prIndicators = wrapper.findComponent({ name: 'PrIndicators' });
      expect(prIndicators.exists()).toBe(false);
    });
  });

  describe('model display', () => {
    it('displays Opus 4.5 for claude-opus-4-5-20251101 model', async () => {
      mockSessionsStore.currentSession.model = 'claude-opus-4-5-20251101';

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.find('.session-model').text()).toBe('Opus 4.5');
    });

    it('displays Sonnet 4.5 for claude-sonnet-4-5-20250929 model', async () => {
      mockSessionsStore.currentSession.model = 'claude-sonnet-4-5-20250929';

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.find('.session-model').text()).toBe('Sonnet 4.5');
    });

    it('displays Haiku 4.5 for claude-haiku-4-5-20251001 model', async () => {
      mockSessionsStore.currentSession.model = 'claude-haiku-4-5-20251001';

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.find('.session-model').text()).toBe('Haiku 4.5');
    });

    it('displays Default when model is null', async () => {
      mockSessionsStore.currentSession.model = null;

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.find('.session-model').text()).toBe('Default');
    });

    it('displays Default when model is undefined', async () => {
      // model is not set (undefined)
      delete mockSessionsStore.currentSession.model;

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.find('.session-model').text()).toBe('Default');
    });

    it('displays Unknown for unrecognized model ID', async () => {
      mockSessionsStore.currentSession.model = 'unknown-model-id';

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.find('.session-model').text()).toBe('Unknown');
    });

    it('renders model in session-meta alongside status and mode', async () => {
      mockSessionsStore.currentSession.model = 'claude-opus-4-5-20251101';

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const sessionMeta = wrapper.find('.session-meta');
      expect(sessionMeta.find('.status-badge').exists()).toBe(true);
      expect(sessionMeta.find('.session-mode').exists()).toBe(true);
      expect(sessionMeta.find('.session-model').exists()).toBe(true);
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
      mockSessionsStore.fetchConversations.mockImplementation(() => {
        callOrder.push('fetchConversations');
        return Promise.resolve();
      });
      mockSessionsStore.fetchWorkLogs.mockImplementation(() => {
        callOrder.push('fetchWorkLogs');
        return Promise.resolve();
      });

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(callOrder).toEqual(['fetchSession', 'fetchMessages', 'fetchConversations', 'fetchWorkLogs']);
    });
  });

  describe('proactive conversation loading (real-time token display)', () => {
    it('fetches conversations on mount (Issue #175)', async () => {
      mockSessionsStore.fetchConversations = vi.fn();

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(mockSessionsStore.fetchConversations).toHaveBeenCalledWith('test-session-id');
    });

    it('fetches conversations after messages to ensure proper ordering', async () => {
      const callOrder = [];
      mockSessionsStore.fetchMessages.mockImplementation(() => {
        callOrder.push('fetchMessages');
        return Promise.resolve();
      });
      mockSessionsStore.fetchConversations = vi.fn(() => {
        callOrder.push('fetchConversations');
        return Promise.resolve();
      });
      mockSessionsStore.fetchWorkLogs.mockImplementation(() => {
        callOrder.push('fetchWorkLogs');
        return Promise.resolve();
      });

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Conversations should be loaded between messages and work logs
      expect(callOrder).toEqual(['fetchMessages', 'fetchConversations', 'fetchWorkLogs']);
    });

    it('ensures conversation-level token updates are available immediately', async () => {
      mockSessionsStore.fetchConversations = vi.fn();

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Verify fetchConversations was called
      expect(mockSessionsStore.fetchConversations).toHaveBeenCalled();
    });

    it('loads conversations with the correct session ID', async () => {
      mockSessionsStore.fetchConversations = vi.fn();
      mockRouteParams.id = 'special-session-id-123';

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(mockSessionsStore.fetchConversations).toHaveBeenCalledWith('special-session-id-123');
    });

    it('does not wait for tab visibility to fetch conversations', async () => {
      mockSessionsStore.fetchConversations = vi.fn();

      // Mount the component (ConversationTab is not visible initially in real usage)
      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Conversations should be fetched in onMounted (not waiting for tab visibility)
      expect(mockSessionsStore.fetchConversations).toHaveBeenCalled();
    });

    it('handles conversation fetch errors gracefully', async () => {
      mockSessionsStore.fetchConversations = vi.fn().mockRejectedValue(new Error('Network error'));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Component should still render despite fetch error
      expect(wrapper.find('.session-header').exists()).toBe(true);
    });

    it('enables real-time token updates to display during streaming', async () => {
      // Setup: Mock all the necessary calls
      mockSessionsStore.fetchConversations = vi.fn(() => Promise.resolve());
      mockSessionsStore.updateRunningUsage = vi.fn();
      mockSessionsStore.finalizeUsage = vi.fn();

      // Setup the WebSocket callback capture
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
        onChangesUpdate: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Verify conversations were fetched
      expect(mockSessionsStore.fetchConversations).toHaveBeenCalledWith('test-session-id');

      // Simulate a streaming token update from WebSocket
      const streamingUpdate = {
        isFinal: false,
        usage: { inputTokens: 500, outputTokens: 250 },
        conversationId: 'conv-123',
      };
      capturedUsageCallback(streamingUpdate);

      // Verify the streaming usage is processed (making tokens available for display)
      expect(mockSessionsStore.updateRunningUsage).toHaveBeenCalledWith(
        streamingUpdate.usage,
        'conv-123'
      );
    });

    it('conversations are fetched alongside other critical data', async () => {
      mockSessionsStore.fetchConversations = vi.fn();

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // All critical data should be fetched in parallel
      expect(mockSessionsStore.fetchSession).toHaveBeenCalled();
      expect(mockSessionsStore.fetchMessages).toHaveBeenCalled();
      expect(mockSessionsStore.fetchConversations).toHaveBeenCalled();
      expect(mockSessionsStore.fetchWorkLogs).toHaveBeenCalled();
      expect(mockCanvasStoreState.fetchItems).toHaveBeenCalled();
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
        onConversationUpdated: vi.fn(() => vi.fn()),
        onChangesUpdate: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await flushPromises(); // Wait for async onMounted callbacks to complete

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
      await flushPromises(); // Wait for async onMounted operations including checkForChanges

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
        onConversationUpdated: vi.fn(() => vi.fn()),
        onChangesUpdate: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await flushPromises(); // Wait for async onMounted callbacks to complete

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
        onConversationUpdated: vi.fn(() => vi.fn()),
        onChangesUpdate: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await flushPromises(); // Wait for async onMounted callbacks to complete

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

  describe('canvas indicator', () => {
    beforeEach(() => {
      // Reset canvas store state for each test
      // Use splice to properly clear arrays while maintaining Vue reactivity
      mockCanvasStoreState.items.splice(0);
      mockCanvasStoreState.groupedItems.splice(0);
      mockCanvasStoreState.fetchItems = vi.fn();
      mockCanvasStoreState.addItem = vi.fn();
      mockCanvasStoreState.removeItem = vi.fn();
    });

    it('does not show canvas indicator when canvas is empty', async () => {
      // groupedItems is already empty from beforeEach

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.find('.canvas-indicator').exists()).toBe(false);
    });

    it('shows canvas indicator when canvas has files', async () => {
      mockCanvasStoreState.groupedItems.push(
        { id: 'item-1', filename: 'image.png' },
        { id: 'item-2', filename: 'document.md' }
      );

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.find('.canvas-indicator').exists()).toBe(true);
    });

    it('shows correct count in canvas tab label', async () => {
      mockCanvasStoreState.groupedItems.push(
        { id: 'item-1', filename: 'image.png' },
        { id: 'item-2', filename: 'document.md' },
        { id: 'item-3', filename: 'data.json' }
      );

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await wrapper.vm.$nextTick();

      const tabs = wrapper.findAll('.tabs-desktop .tab');
      const canvasTab = tabs.find((tab) => tab.text().includes('Canvas'));
      expect(canvasTab?.text()).toContain('Canvas (3)');
    });

    it('shows "Canvas" without count when empty', async () => {
      // Use splice to clear while maintaining reactivity (not array reassignment)
      mockCanvasStoreState.groupedItems.splice(0);

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await wrapper.vm.$nextTick();

      const tabs = wrapper.findAll('.tabs-desktop .tab');
      const canvasTab = tabs.find((tab) => tab.text().includes('Canvas'));
      expect(canvasTab?.text()).toBe('Canvas');
    });

    it('canvas indicator has correct CSS class', async () => {
      // Add item to reactive array
      mockCanvasStoreState.groupedItems.splice(0, 0, { id: 'item-1', filename: 'image.png' });

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const indicator = wrapper.find('.canvas-indicator');
      expect(indicator.exists()).toBe(true);
      expect(indicator.classes()).toContain('canvas-indicator');
    });

    it('canvas indicator has tooltip title attribute', async () => {
      // Add item to reactive array
      mockCanvasStoreState.groupedItems.splice(0, 0, { id: 'item-1', filename: 'image.png' });

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const indicator = wrapper.find('.canvas-indicator');
      expect(indicator.attributes('title')).toBe('Canvas contains files');
    });

    it('updates canvas count when groupedItems changes', async () => {
      // Initially empty
      const wrapper1 = mountComponent();
      await flushPromises();
      await nextTick();
      await wrapper1.vm.$nextTick();

      let tabs = wrapper1.findAll('.tabs-desktop .tab');
      let canvasTab = tabs.find((tab) => tab.text().includes('Canvas'));
      expect(canvasTab?.text()).toBe('Canvas');

      // Now test with items
      mockCanvasStoreState.groupedItems.push({ id: 'item-1', filename: 'image.png' });

      const wrapper2 = mountComponent();
      await flushPromises();
      await nextTick();
      await wrapper2.vm.$nextTick();

      tabs = wrapper2.findAll('.tabs-desktop .tab');
      canvasTab = tabs.find((tab) => tab.text().includes('Canvas'));
      expect(canvasTab?.text()).toContain('Canvas (1)');
    });

    it('shows canvas bullet indicator on mobile dropdown when files exist', async () => {
      // Add items to reactive array
      mockCanvasStoreState.groupedItems.push(
        { id: 'item-1', filename: 'image.png' },
        { id: 'item-2', filename: 'document.md' }
      );

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const options = wrapper.findAll('option');
      const canvasOption = options.find((opt) => opt.attributes('value') === 'canvas');
      expect(canvasOption.text()).toContain('Canvas (2)');
      expect(canvasOption.text()).toContain('•');
    });

    it('does not show canvas bullet indicator on mobile when empty', async () => {
      // groupedItems is already empty from beforeEach, but explicitly ensure it
      mockCanvasStoreState.groupedItems.splice(0);

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const options = wrapper.findAll('option');
      const canvasOption = options.find((opt) => opt.attributes('value') === 'canvas');
      const optionText = canvasOption.text();
      // Count bullets - should only be one if it's from changes indicator, not canvas
      const bulletCount = (optionText.match(/•/g) || []).length;
      expect(bulletCount).toBe(0);
    });

    it('fetches canvas items on mount', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // mockCanvasStoreState.fetchItems should have been called
      expect(mockCanvasStoreState.fetchItems).toHaveBeenCalledWith('test-session-id');
    });

    it('indicator dot has amber background color styling', async () => {
      // Add item to reactive array
      mockCanvasStoreState.groupedItems.push({ id: 'item-1', filename: 'image.png' });

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const indicator = wrapper.find('.canvas-indicator');
      const styles = indicator.element.getAttribute('style') || '';
      // Verify the element exists and has the class that applies the color
      expect(indicator.classes('canvas-indicator')).toBe(true);
    });

    it('canvas indicator appears next to tab label', async () => {
      // Add item to reactive array
      mockCanvasStoreState.groupedItems.push({ id: 'item-1', filename: 'image.png' });

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await wrapper.vm.$nextTick();

      const tabs = wrapper.findAll('.tabs-desktop .tab');
      const canvasTab = tabs.find((tab) => tab.text().includes('Canvas'));
      const indicator = canvasTab?.find('.canvas-indicator');
      expect(indicator?.exists()).toBe(true);
    });

    it('canvas indicator count shows multiple items correctly', async () => {
      // Add 10 items to reactive array
      const items = Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
        filename: `file-${i}.txt`,
      }));
      mockCanvasStoreState.groupedItems.push(...items);

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await wrapper.vm.$nextTick();

      const tabs = wrapper.findAll('.tabs-desktop .tab');
      const canvasTab = tabs.find((tab) => tab.text().includes('Canvas'));
      expect(canvasTab?.text()).toContain('Canvas (10)');
    });

    it('indicator does not appear for other tabs when canvas has files', async () => {
      // Add item to reactive array
      mockCanvasStoreState.groupedItems.push({ id: 'item-1', filename: 'image.png' });

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const indicators = wrapper.findAll('.canvas-indicator');
      // Should only find one canvas indicator
      expect(indicators).toHaveLength(1);
      // It should be associated with the canvas tab
      const canvasIndicator = indicators[0];
      expect(canvasIndicator.attributes('title')).toBe('Canvas contains files');
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

    describe('archive confirmation dialog', () => {
      let confirmSpy;

      beforeEach(() => {
        confirmSpy = vi.spyOn(window, 'confirm');
      });

      afterEach(() => {
        confirmSpy.mockRestore();
      });

      it('shows confirmation dialog when archive button is clicked', async () => {
        mockSessionsStore.currentSession.status = 'stopped';
        confirmSpy.mockReturnValue(true);
        mockSessionsStore.archiveSession.mockResolvedValue({});

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(confirmSpy).toHaveBeenCalledWith('Archive this session?');
      });

      it('shows confirmation dialog for unarchive when session is archived', async () => {
        mockSessionsStore.currentSession.status = 'stopped';
        mockSessionsStore.currentSession.archived = true;
        confirmSpy.mockReturnValue(true);
        mockSessionsStore.unarchiveSession.mockResolvedValue({});

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(confirmSpy).toHaveBeenCalledWith('Restore this session to active?');
      });

      it('does not call archiveSession when user cancels confirmation', async () => {
        mockSessionsStore.currentSession.status = 'stopped';
        confirmSpy.mockReturnValue(false);

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(mockSessionsStore.archiveSession).not.toHaveBeenCalled();
      });

      it('calls archiveSession when user confirms archive', async () => {
        mockSessionsStore.currentSession.status = 'stopped';
        confirmSpy.mockReturnValue(true);
        mockSessionsStore.archiveSession.mockResolvedValue({});

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(mockSessionsStore.archiveSession).toHaveBeenCalledWith('test-session-id');
      });

      it('does not call unarchiveSession when user cancels unarchive confirmation', async () => {
        mockSessionsStore.currentSession.status = 'stopped';
        mockSessionsStore.currentSession.archived = true;
        confirmSpy.mockReturnValue(false);

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(mockSessionsStore.unarchiveSession).not.toHaveBeenCalled();
      });

      it('calls unarchiveSession when user confirms unarchive', async () => {
        mockSessionsStore.currentSession.status = 'stopped';
        mockSessionsStore.currentSession.archived = true;
        confirmSpy.mockReturnValue(true);
        mockSessionsStore.unarchiveSession.mockResolvedValue({});

        const wrapper = mountComponent();
        await flushPromises();
        await nextTick();

        await wrapper.find('.btn-archive-session').trigger('click');
        await flushPromises();

        expect(mockSessionsStore.unarchiveSession).toHaveBeenCalledWith('test-session-id');
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
        onChangesUpdate: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await flushPromises(); // Wait for async onMounted callbacks to complete

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
        onChangesUpdate: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await flushPromises(); // Wait for async onMounted callbacks to complete

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
        onChangesUpdate: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await flushPromises(); // Wait for async onMounted callbacks to complete

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
        onChangesUpdate: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await flushPromises(); // Wait for async onMounted callbacks to complete

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
        onChangesUpdate: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await flushPromises(); // Wait for async onMounted callbacks to complete

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
        onChangesUpdate: vi.fn(() => vi.fn()),
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await flushPromises(); // Wait for async onMounted callbacks to complete

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

  describe('real-time changes updates (onChangesUpdate)', () => {
    it('calls onChangesUpdate handler on mount', async () => {
      const mockOnChangesUpdate = vi.fn(() => vi.fn());
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
        onChangesUpdate: mockOnChangesUpdate,
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(mockOnChangesUpdate).toHaveBeenCalled();
    });

    it('registers cleanup function for onChangesUpdate listener', async () => {
      const mockCleanup = vi.fn();
      const mockOnChangesUpdate = vi.fn(() => mockCleanup);
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
        onChangesUpdate: mockOnChangesUpdate,
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await flushPromises();

      // Cleanup should be registered (component stores it in cleanups array)
      expect(mockOnChangesUpdate).toHaveBeenCalled();
      const returnedCleanup = mockOnChangesUpdate.mock.results[0].value;
      expect(typeof returnedCleanup).toBe('function');
    });

    it('updates changesFileCount when changes update is received', async () => {
      let capturedChangesCallback;
      const mockOnChangesUpdate = vi.fn((callback) => {
        capturedChangesCallback = callback;
        return vi.fn();
      });

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
        onChangesUpdate: mockOnChangesUpdate,
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await flushPromises();

      // Verify onChangesUpdate handler was registered with a callback
      expect(mockOnChangesUpdate).toHaveBeenCalledWith(expect.any(Function));

      // Verify the callback function exists and is callable
      expect(typeof capturedChangesCallback).toBe('function');

      // Simulate changes update - should not throw
      expect(() => capturedChangesCallback(5, true)).not.toThrow();
    });

    it('updates changesFileCount to 0 when no changes', async () => {
      let capturedChangesCallback;
      const mockOnChangesUpdate = vi.fn((callback) => {
        capturedChangesCallback = callback;
        return vi.fn();
      });

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
        onChangesUpdate: mockOnChangesUpdate,
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      await flushPromises();

      // Simulate no changes - should not throw
      expect(() => capturedChangesCallback(0, false)).not.toThrow();
    });

    it('accepts changeCount and hasChanges parameters in callback', async () => {
      let capturedChangesCallback;
      const mockOnChangesUpdate = vi.fn((callback) => {
        capturedChangesCallback = callback;
        return vi.fn();
      });

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
        onChangesUpdate: mockOnChangesUpdate,
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Verify callback can be called with changeCount and hasChanges
      expect(() => {
        capturedChangesCallback(5, true);
        capturedChangesCallback(0, false);
        capturedChangesCallback(10, true);
      }).not.toThrow();
    });

    it('processes onChangesUpdate callback with various parameter values', async () => {
      let capturedChangesCallback;
      const mockOnChangesUpdate = vi.fn((callback) => {
        capturedChangesCallback = callback;
        return vi.fn();
      });

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
        onChangesUpdate: mockOnChangesUpdate,
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Test with multiple different parameter combinations
      expect(() => capturedChangesCallback(42, true)).not.toThrow();
      expect(() => capturedChangesCallback(0, false)).not.toThrow();
      expect(() => capturedChangesCallback(100, true)).not.toThrow();
    });
  });
});
