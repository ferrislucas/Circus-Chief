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
      deleteSession: vi.fn(),
      updateSessionStatus: vi.fn(),
      addMessage: vi.fn(),
      updateSession: vi.fn(),
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
      }));

      const wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Simulate route change (as happens during navigation)
      mockRouteParams.id = 'some-other-id';

      // Trigger a status update through WebSocket
      if (capturedOnStatusCallback) {
        capturedOnStatusCallback('completed');
      }

      // Verify updateSessionStatus was called with the ORIGINAL session ID
      expect(mockSessionsStore.updateSessionStatus).toHaveBeenCalledWith(
        'test-session-id',
        'completed'
      );
    });
  });
});
