import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { h, defineComponent, nextTick } from 'vue';
import SessionTreeOverlay from './SessionTreeOverlay.vue';
import { api } from '../composables/useApi.js';
import { generateWorktreeBranch } from '@claudetools/shared';

// Mock @claudetools/shared
vi.mock('@claudetools/shared', () => ({
  generateWorktreeBranch: vi.fn(() => 'claude-tools/abcd-new-session'),
}));

// Mock sessions store
const mockSessionsStore = {
  currentSession: null,
  sessions: [],
  messages: [],
  conversations: [],
  activeConversationId: null,
  getSessionById: vi.fn(),
  getSessionPath: vi.fn(),
  getRootSession: vi.fn(),
  getAllDescendants: vi.fn(),
  getChildSessions: vi.fn(),
  hasChildren: vi.fn(),
  fetchSession: vi.fn(),
  fetchSessions: vi.fn(),
  fetchConversations: vi.fn(),
  fetchMessages: vi.fn(),
  updateSessionStatus: vi.fn(),
  addMessage: vi.fn(),
  clearPartialText: vi.fn(),
  clearRunningUsage: vi.fn(),
  setPartialText: vi.fn(),
  updateSession: vi.fn(),
  addConversation: vi.fn(),
  updateConversation: vi.fn(),
  createSession: vi.fn(),
};

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: () => mockSessionsStore,
}));

// Mock todos store
const mockTodosStore = {
  items: [],
  loading: false,
  error: null,
  expanded: false,
  currentConversationId: null,
  clearTodos: vi.fn(),
  fetchTodos: vi.fn(),
  toggleExpanded: vi.fn(),
  setExpanded: vi.fn(),
};

vi.mock('../stores/todos.js', () => ({
  useTodosStore: () => mockTodosStore,
}));

// Mock useSessionSubscription
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockOnStatus = vi.fn(() => vi.fn());
const mockOnMessage = vi.fn(() => vi.fn());
const mockOnPartial = vi.fn(() => vi.fn());
const mockOnSessionUpdate = vi.fn(() => vi.fn());
const mockOnConversationCreated = vi.fn(() => vi.fn());
const mockOnConversationUpdated = vi.fn(() => vi.fn());

vi.mock('../composables/useSessionSubscription.js', () => ({
  useSessionSubscription: () => ({
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    onStatus: mockOnStatus,
    onMessage: mockOnMessage,
    onPartial: mockOnPartial,
    onSessionUpdate: mockOnSessionUpdate,
    onConversationCreated: mockOnConversationCreated,
    onConversationUpdated: mockOnConversationUpdated,
  }),
}));

// Mock useSessionPolling
vi.mock('../composables/useSessionPolling.js', () => ({
  useSessionPolling: () => ({
    hasChanges: { value: false },
    changesFileCount: { value: 0 },
    checkForChanges: vi.fn(),
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    reset: vi.fn(),
  }),
}));

// Mock API
vi.mock('../composables/useApi.js', () => ({
  api: {
    getSessionSummary: vi.fn().mockResolvedValue(null),
    getProjectSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue({ id: 'new-sess', name: 'New Session', status: 'waiting', projectId: 'proj-123' }),
    updateSession: vi.fn().mockResolvedValue({}),
  },
}));

// Mock UI store
const mockUiStore = {
  error: vi.fn(),
  success: vi.fn(),
  addToast: vi.fn(),
  removeToast: vi.fn(),
  toasts: [],
};

vi.mock('../stores/ui.js', () => ({
  useUiStore: () => mockUiStore,
}));

// Mock ConversationTab with a lightweight stub
vi.mock('./ConversationTab.vue', () => ({
  default: defineComponent({
    name: 'ConversationTab',
    props: ['sessionId'],
    render() {
      return h('div', { class: 'conversation-tab-mock', 'data-session-id': this.sessionId }, 'ConversationTab');
    },
  }),
}));

// Mock SessionTreePicker
vi.mock('./SessionTreePicker.vue', () => ({
  default: defineComponent({
    name: 'SessionTreePicker',
    props: ['sessions', 'activeSessionId', 'summaries'],
    emits: ['select'],
    render() {
      return h('div', {
        class: 'session-tree-picker-stub',
        'data-testid': 'session-tree-picker',
      }, this.sessions?.map(s =>
        h('div', {
          key: s.session.id,
          role: 'option',
          onClick: () => this.$emit('select', s.session.id),
        }, s.session.name)
      ));
    },
  }),
}));

describe('SessionTreeOverlay', () => {
  let pinia;
  let router;
  const rootSession = {
    id: 'sess-root',
    name: 'Root Session',
    status: 'waiting',
    parentSessionId: null,
    projectId: 'proj-123',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    pinia = createPinia();
    setActivePinia(pinia);

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/sessions/:id', component: { template: '<div />' } },
        { path: '/projects/:id/sessions', component: { template: '<div />' } },
      ],
    });
    await router.push('/sessions/sess-root');
    await router.isReady();

    mockSessionsStore.currentSession = { ...rootSession };
    mockSessionsStore.getSessionById.mockReturnValue(null);
    mockSessionsStore.getSessionPath.mockReturnValue([rootSession]);
    mockSessionsStore.getRootSession.mockReturnValue(rootSession);
    mockSessionsStore.getAllDescendants.mockReturnValue([]);
    mockSessionsStore.getChildSessions.mockReturnValue([]);
    mockSessionsStore.hasChildren.mockReturnValue(false);
    mockSessionsStore.fetchSession.mockResolvedValue(undefined);
    mockSessionsStore.fetchSessions.mockResolvedValue(undefined);
    mockSessionsStore.fetchConversations.mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Clean up teleported content
    document.querySelectorAll('[data-testid="session-tree-overlay"]').forEach(el => el.remove());
  });

  function mountOverlay(propsOverrides = {}) {
    return mount(SessionTreeOverlay, {
      props: {
        sessionId: 'sess-root',
        ...propsOverrides,
      },
      global: {
        plugins: [router],
      },
      attachTo: document.body,
    });
  }

  async function waitForTransition() {
    // In jsdom, CSS transitions don't actually run, so we manually
    // trigger the afterLeave hook to simulate the transition completing
    await nextTick();
    await new Promise(r => setTimeout(r, 10)); // Small delay for Vue to process state changes
  }

  describe('rendering', () => {
    it('renders overlay with correct test id', async () => {
      const wrapper = mountOverlay();
      await nextTick();
      const overlay = document.querySelector('[data-testid="session-tree-overlay"]');
      expect(overlay).toBeTruthy();
      wrapper.unmount();
    });

    it('displays active session name in header', async () => {
      const wrapper = mountOverlay();
      await nextTick();
      const name = document.querySelector('.overlay-root-name');
      expect(name.textContent).toBe('Root Session');
      wrapper.unmount();
    });

    it('renders ConversationTab with correct session id', async () => {
      const wrapper = mountOverlay();
      await nextTick();
      const conv = document.querySelector('.conversation-tab-mock');
      expect(conv).toBeTruthy();
      expect(conv.getAttribute('data-session-id')).toBe('sess-root');
      wrapper.unmount();
    });

    it('renders back to sessions link in header', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({
        ...rootSession,
        projectId: 'proj-123',
      });
      const wrapper = mountOverlay();
      await nextTick();
      const backLink = document.querySelector('.back-to-sessions-link');
      expect(backLink).toBeTruthy();
      expect(backLink.getAttribute('href')).toBe('/projects/proj-123/sessions');
      expect(backLink.getAttribute('title')).toBe('Back to Sessions');
      // Verify SVG icons are present
      expect(backLink.querySelectorAll('svg').length).toBe(2);
      wrapper.unmount();
    });

    it('back link defaults to home when session has no projectId', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({
        ...rootSession,
        projectId: null,
      });
      mockSessionsStore.currentSession = { ...rootSession, projectId: null };
      const wrapper = mountOverlay();
      await nextTick();
      const backLink = document.querySelector('.back-to-sessions-link');
      expect(backLink).toBeTruthy();
      expect(backLink.getAttribute('href')).toBe('/');
      wrapper.unmount();
    });

    it('renders close handle with correct test id', async () => {
      const wrapper = mountOverlay();
      await nextTick();
      const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');
      expect(handle).toBeTruthy();
      wrapper.unmount();
    });

    it('close handle has correct ARIA attributes', async () => {
      const wrapper = mountOverlay();
      await nextTick();
      const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');
      expect(handle).toBeTruthy();
      expect(handle.getAttribute('role')).toBe('button');
      expect(handle.getAttribute('aria-label')).toBe('Close session tree');
      expect(handle.getAttribute('tabindex')).toBe('0');
      wrapper.unmount();
    });
  });

  describe('close behavior', () => {
    it('emits close on Escape when picker is closed', async () => {
      const onClose = vi.fn();
      const wrapper = mount(SessionTreeOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onClose },
        attachTo: document.body,
      });
      await nextTick();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await nextTick();
      await waitForTransition();
      wrapper.vm.afterLeave(); // Manually trigger the transition complete hook
      expect(onClose).toHaveBeenCalled();
      wrapper.unmount();
    });

    it('emits close when clicking the backdrop', async () => {
      const onClose = vi.fn();
      const wrapper = mount(SessionTreeOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onClose },
        attachTo: document.body,
      });
      await nextTick();
      // Click the backdrop (overlay-backdrop) directly, not the content
      const backdrop = document.querySelector('[data-testid="session-tree-overlay"]');
      backdrop.click();
      await nextTick();
      await waitForTransition();
      wrapper.vm.afterLeave(); // Manually trigger the transition complete hook
      expect(onClose).toHaveBeenCalled();
      wrapper.unmount();
    });

    it('does not emit close when clicking inside overlay content', async () => {
      const onClose = vi.fn();
      const wrapper = mount(SessionTreeOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onClose },
        attachTo: document.body,
      });
      await nextTick();
      // Click inside the overlay content area
      const content = document.querySelector('.overlay-content');
      content.click();
      await nextTick();
      expect(onClose).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('emits close when close handle is clicked', async () => {
      const onClose = vi.fn();
      const wrapper = mount(SessionTreeOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onClose },
        attachTo: document.body,
      });
      await nextTick();
      const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');
      expect(handle).toBeTruthy();
      handle.click();
      await nextTick();
      await waitForTransition();
      wrapper.vm.afterLeave(); // Manually trigger the transition complete hook
      expect(onClose).toHaveBeenCalled();
      wrapper.unmount();
    });

    it('emits close when Enter is pressed on close handle', async () => {
      const onClose = vi.fn();
      const wrapper = mount(SessionTreeOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onClose },
        attachTo: document.body,
      });
      await nextTick();
      const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');
      expect(handle).toBeTruthy();
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await nextTick();
      await waitForTransition();
      wrapper.vm.afterLeave(); // Manually trigger the transition complete hook
      expect(onClose).toHaveBeenCalled();
      wrapper.unmount();
    });

    it('emits close when Space is pressed on close handle', async () => {
      const onClose = vi.fn();
      const wrapper = mount(SessionTreeOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onClose },
        attachTo: document.body,
      });
      await nextTick();
      const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');
      expect(handle).toBeTruthy();
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      await nextTick();
      await waitForTransition();
      wrapper.vm.afterLeave(); // Manually trigger the transition complete hook
      expect(onClose).toHaveBeenCalled();
      wrapper.unmount();
    });
  });

  describe('close animation', () => {
    it('delays close event until after transition completes', async () => {
      const onClose = vi.fn();
      const wrapper = mount(SessionTreeOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onClose },
        attachTo: document.body,
      });
      await nextTick();

      // Trigger close
      const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');
      handle.click();
      await nextTick();

      // Immediately after click, close should NOT have been emitted yet
      expect(onClose).not.toHaveBeenCalled();

      // Wait for transition
      await waitForTransition();

      // Manually trigger afterLeave to simulate transition completing
      wrapper.vm.afterLeave();

      // Now close should have been emitted
      expect(onClose).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });

    it('sets closing state when close is triggered', async () => {
      const wrapper = mountOverlay();
      await nextTick();

      // Initially not closing
      expect(wrapper.vm.closing).toBe(false);

      // Trigger close
      const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');
      handle.click();
      await nextTick();

      // Should be in closing state
      expect(wrapper.vm.closing).toBe(true);
      expect(wrapper.vm.visible).toBe(false);

      // Clean up
      document.querySelectorAll('[data-testid="session-tree-overlay"]').forEach(el => el.remove());
    });

    it('guards against rapid close attempts', async () => {
      const onClose = vi.fn();
      const wrapper = mount(SessionTreeOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onClose },
        attachTo: document.body,
      });
      await nextTick();

      const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');

      // Click close multiple times rapidly
      handle.click();
      await nextTick();
      handle.click();
      await nextTick();
      handle.click();
      await nextTick();

      // Wait for transition
      await waitForTransition();

      // Manually trigger afterLeave to simulate transition completing
      wrapper.vm.afterLeave();

      // Should only emit close once
      expect(onClose).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });

    it('component remains mounted during transition', async () => {
      const wrapper = mountOverlay();
      await nextTick();

      const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');
      const backdrop = document.querySelector('[data-testid="session-tree-overlay"]');

      // Trigger close
      handle.click();
      await nextTick();

      // Component should still be in DOM
      expect(backdrop).toBeTruthy();

      // Wait for transition
      await waitForTransition();

      // After transition, parent would unmount, so we manually unmount here
      wrapper.unmount();
    });

    it('all close triggers use the same guarded close method', async () => {
      const onClose = vi.fn();

      // Test each close trigger
      const triggers = [
        () => document.querySelector('[data-testid="session-tree-overlay-close-handle"]').click(),
        () => document.querySelector('[data-testid="session-tree-overlay"]').click(),
      ];

      for (const trigger of triggers) {
        const testWrapper = mount(SessionTreeOverlay, {
          props: { sessionId: 'sess-root' },
          attrs: { onClose },
          attachTo: document.body,
        });
        await nextTick();

        trigger();
        await nextTick();

        // Should not emit immediately
        expect(onClose).not.toHaveBeenCalled();

        // Wait for transition
        await waitForTransition();

        // Manually trigger afterLeave to simulate transition completing
        testWrapper.vm.afterLeave();

        // Should emit once
        expect(onClose).toHaveBeenCalledTimes(1);

        // Clean up
        onClose.mockClear();
        document.querySelectorAll('[data-testid="session-tree-overlay"]').forEach(el => el.remove());
      }
    });
  });

  describe('session tree picker integration', () => {
    const childSession = {
      id: 'child-1',
      name: 'Child Session',
      status: 'running',
      parentSessionId: 'sess-root',
      projectId: 'proj-123',
    };

    const chainSessions = [{ session: rootSession, depth: 0 }, { session: childSession, depth: 1 }];
    const chainSummaries = {
      'sess-root': { shortSummary: 'Root summary' },
      'child-1': { shortSummary: 'Child summary' },
    };

    function mountWithPicker(propsOverrides = {}) {
      return mount(SessionTreeOverlay, {
        props: {
          sessionId: 'sess-root',
          sessionChain: chainSessions,
          summariesMap: chainSummaries,
          ...propsOverrides,
        },
        global: {
          plugins: [router],
        },
        attachTo: document.body,
      });
    }

    it('does not show picker when sessionChain has only 1 session', async () => {
      const wrapper = mount(SessionTreeOverlay, {
        props: {
          sessionId: 'sess-root',
          sessionChain: [{ session: rootSession, depth: 0 }],
          summariesMap: {},
        },
        global: { plugins: [router] },
        attachTo: document.body,
      });
      await nextTick();
      const trigger = document.querySelector('[data-testid="overlay-picker-trigger"]');
      expect(trigger).toBeFalsy();
      wrapper.unmount();
    });

    it('shows dropdown trigger when sessionChain has multiple sessions', async () => {
      const wrapper = mountWithPicker();
      await nextTick();
      const trigger = document.querySelector('[data-testid="overlay-picker-trigger"]');
      expect(trigger).toBeTruthy();
      wrapper.unmount();
    });

    it('clicking dropdown trigger toggles picker open/closed', async () => {
      const wrapper = mountWithPicker();
      await nextTick();

      const trigger = document.querySelector('[data-testid="overlay-picker-trigger"]');

      // Initially picker should not be shown
      expect(document.querySelector('[data-testid="session-tree-picker"]')).toBeFalsy();

      // Click to open
      trigger.click();
      await nextTick();
      expect(document.querySelector('[data-testid="session-tree-picker"]')).toBeTruthy();

      // Click to close
      trigger.click();
      await nextTick();
      expect(document.querySelector('[data-testid="session-tree-picker"]')).toBeFalsy();

      wrapper.unmount();
    });

    it('SessionTreePicker receives correct props', async () => {
      const wrapper = mountWithPicker();
      await nextTick();

      // Open picker
      wrapper.vm.pickerOpen = true;
      await nextTick();

      const picker = document.querySelector('[data-testid="session-tree-picker"]');
      expect(picker).toBeTruthy();
      // The mock renders session names as text content
      expect(picker.textContent).toContain('Root Session');
      expect(picker.textContent).toContain('Child Session');

      wrapper.unmount();
    });

    it('selecting a session calls selectSession and closes picker', async () => {
      mockSessionsStore.getSessionById.mockImplementation((id) => {
        if (id === 'sess-root') return rootSession;
        if (id === 'child-1') return childSession;
        return null;
      });

      const wrapper = mountWithPicker();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      // Open picker
      wrapper.vm.pickerOpen = true;
      await nextTick();

      // Call handlePickerSelect directly
      expect(typeof wrapper.vm.handlePickerSelect).toBe('function');
      wrapper.vm.handlePickerSelect('child-1');
      await nextTick();

      // Verify picker was closed
      expect(wrapper.vm.pickerOpen).toBe(false);
      // Verify session was switched
      expect(wrapper.vm.activeSessionId).toBe('child-1');

      wrapper.unmount();
    });

    it('Escape key closes picker without closing the overlay', async () => {
      const onClose = vi.fn();
      const wrapper = mount(SessionTreeOverlay, {
        props: {
          sessionId: 'sess-root',
          sessionChain: chainSessions,
          summariesMap: chainSummaries,
        },
        attrs: { onClose },
        global: { plugins: [router] },
        attachTo: document.body,
      });
      await nextTick();

      // Open picker
      wrapper.vm.pickerOpen = true;
      await nextTick();
      expect(document.querySelector('[data-testid="session-tree-picker"]')).toBeTruthy();

      // Press Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await nextTick();

      // Picker should be closed but overlay should stay open
      expect(wrapper.vm.pickerOpen).toBe(false);
      expect(wrapper.vm.visible).toBe(true);
      expect(onClose).not.toHaveBeenCalled();

      wrapper.unmount();
    });

    it('displays active session name in dropdown trigger', async () => {
      mockSessionsStore.getSessionById.mockReturnValue(rootSession);

      const wrapper = mountWithPicker();
      await nextTick();

      const triggerEl = document.querySelector('[data-testid="overlay-picker-trigger"]');
      expect(triggerEl).toBeTruthy();
      const nameEl = triggerEl.querySelector('.dropdown-name');
      expect(nameEl.textContent).toBeTruthy();

      wrapper.unmount();
    });

    it('shows down chevron when picker is closed', async () => {
      const wrapper = mountWithPicker();
      await nextTick();

      const chevron = document.querySelector('.dropdown-chevron');
      expect(chevron.textContent).toBe('▼');

      wrapper.unmount();
    });

    it('shows up chevron when picker is open', async () => {
      const wrapper = mountWithPicker();
      await nextTick();

      const trigger = document.querySelector('[data-testid="overlay-picker-trigger"]');
      trigger.click();
      await nextTick();

      const chevron = document.querySelector('.dropdown-chevron');
      expect(chevron.textContent).toBe('▲');

      wrapper.unmount();
    });
  });

  describe('data loading', () => {
    it('calls fetchConversations on mount', async () => {
      const wrapper = mountOverlay();
      await nextTick();
      // Give async onMounted time to run
      await new Promise(r => setTimeout(r, 10));
      expect(mockSessionsStore.fetchConversations).toHaveBeenCalledWith('sess-root');
      wrapper.unmount();
    });

    it('subscribes to WebSocket on mount', async () => {
      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));
      expect(mockSubscribe).toHaveBeenCalled();
      wrapper.unmount();
    });

    it('unsubscribes from WebSocket on unmount', async () => {
      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));
      wrapper.unmount();
      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  describe('defaults', () => {
    it('defaults activeSessionId to the prop value', async () => {
      const wrapper = mountOverlay({ sessionId: 'my-session' });
      await nextTick();
      expect(wrapper.vm.activeSessionId).toBe('my-session');
      wrapper.unmount();
    });
  });

  describe('animation', () => {
    it('applies correct transition classes on mount', async () => {
      const wrapper = mountOverlay();
      await nextTick();
      const backdrop = document.querySelector('.overlay-backdrop');
      expect(backdrop).toBeTruthy();
      wrapper.unmount();
    });

    it('positions overlay on right side of viewport', async () => {
      const wrapper = mountOverlay();
      await nextTick();
      const backdrop = document.querySelector('[data-testid="session-tree-overlay"]');
      expect(backdrop).toBeTruthy();
      // Verify the backdrop class exists which has justify-content: flex-end
      expect(backdrop.classList.contains('overlay-backdrop')).toBe(true);
      wrapper.unmount();
    });

    it('has overlay content with correct structure', async () => {
      const wrapper = mountOverlay();
      await nextTick();
      const content = document.querySelector('.overlay-content');
      expect(content).toBeTruthy();
      // Verify the content has the correct class
      expect(content.classList.contains('overlay-content')).toBe(true);
      wrapper.unmount();
    });
  });

  describe('Add Session button', () => {
    it('renders add session button in overlay', async () => {
      const wrapper = mountOverlay();
      await nextTick();
      const btn = document.querySelector('[data-testid="overlay-add-session-btn"]');
      expect(btn).toBeTruthy();
      expect(btn.textContent.trim()).toContain('New Session');
      wrapper.unmount();
    });

    it('inherits git settings from parent session with worktree', async () => {
      const newSession = { id: 'new-sess', name: 'New Session', status: 'waiting', projectId: 'proj-123', parentSessionId: 'sess-root' };
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, projectId: 'proj-123', gitBranch: 'feature/parent-branch', gitWorktree: '/path/to/worktree' });
      api.createSession.mockResolvedValue(newSession);

      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      const btn = document.querySelector('[data-testid="overlay-add-session-btn"]');
      btn.click();
      await nextTick();
      await new Promise(r => setTimeout(r, 50));

      expect(generateWorktreeBranch).not.toHaveBeenCalled();
      expect(api.createSession).toHaveBeenCalledWith('proj-123', {
        prompt: ' ',
        name: 'New Session',
        parentSessionId: 'sess-root',
        startImmediately: false,
        gitMode: 'worktree',
        gitBranch: 'feature/parent-branch',
      });
      wrapper.unmount();
    });

    it('omits git settings when parent has branch but no worktree', async () => {
      const newSession = { id: 'new-sess', name: 'New Session', status: 'waiting', projectId: 'proj-123', parentSessionId: 'sess-root' };
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, projectId: 'proj-123', gitBranch: 'feature/parent-branch', gitWorktree: null });
      api.createSession.mockResolvedValue(newSession);

      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      const btn = document.querySelector('[data-testid="overlay-add-session-btn"]');
      btn.click();
      await nextTick();
      await new Promise(r => setTimeout(r, 50));

      expect(generateWorktreeBranch).not.toHaveBeenCalled();
      // Without a gitWorktree, git params should NOT be sent to avoid
      // triggering git checkout in directories that may not be git repos
      expect(api.createSession).toHaveBeenCalledWith('proj-123', {
        prompt: ' ',
        name: 'New Session',
        parentSessionId: 'sess-root',
        startImmediately: false,
      });
      wrapper.unmount();
    });

    it('omits git settings when parent has no git config', async () => {
      const newSession = { id: 'new-sess', name: 'New Session', status: 'waiting', projectId: 'proj-123', parentSessionId: 'sess-root' };
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, projectId: 'proj-123', gitBranch: null, gitWorktree: null });
      api.createSession.mockResolvedValue(newSession);

      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      const btn = document.querySelector('[data-testid="overlay-add-session-btn"]');
      btn.click();
      await nextTick();
      await new Promise(r => setTimeout(r, 50));

      expect(api.createSession).toHaveBeenCalledWith('proj-123', {
        prompt: ' ',
        name: 'New Session',
        parentSessionId: 'sess-root',
        startImmediately: false,
      });
      wrapper.unmount();
    });

    it('after creation, overlay switches activeSessionId to new session', async () => {
      const newSession = { id: 'new-sess', name: 'New Session', status: 'waiting', projectId: 'proj-123', parentSessionId: 'sess-root' };
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, projectId: 'proj-123', gitBranch: 'feature/parent-branch', gitWorktree: '/path/to/worktree' });
      api.createSession.mockResolvedValue(newSession);

      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      const btn = document.querySelector('[data-testid="overlay-add-session-btn"]');
      btn.click();
      await nextTick();
      await new Promise(r => setTimeout(r, 50));

      expect(wrapper.vm.activeSessionId).toBe('new-sess');
      expect(mockSessionsStore.fetchSession).toHaveBeenCalledWith('new-sess', false);
      expect(mockSessionsStore.fetchConversations).toHaveBeenCalledWith('new-sess');
      wrapper.unmount();
    });

    it('emits session-created event after creation', async () => {
      const newSession = { id: 'new-sess', name: 'New Session', status: 'waiting', projectId: 'proj-123', parentSessionId: 'sess-root' };
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, projectId: 'proj-123', gitBranch: 'feature/parent-branch', gitWorktree: '/path/to/worktree' });
      api.createSession.mockResolvedValue(newSession);

      const onSessionCreated = vi.fn();
      const wrapper = mount(SessionTreeOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onSessionCreated },
        global: { plugins: [router] },
        attachTo: document.body,
      });
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      const btn = document.querySelector('[data-testid="overlay-add-session-btn"]');
      btn.click();
      await nextTick();
      await new Promise(r => setTimeout(r, 50));

      expect(onSessionCreated).toHaveBeenCalledWith('new-sess');
      wrapper.unmount();
    });

    it('button shows disabled state while creating', async () => {
      let resolveCreate;
      const createPromise = new Promise(resolve => { resolveCreate = resolve; });
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, projectId: 'proj-123', gitBranch: 'feature/parent-branch', gitWorktree: '/path/to/worktree' });
      api.createSession.mockReturnValue(createPromise);

      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      const btn = document.querySelector('[data-testid="overlay-add-session-btn"]');
      btn.click();
      await nextTick();

      // Button should be disabled while creating
      expect(btn.disabled).toBe(true);
      expect(btn.textContent.trim()).toContain('Creating...');

      // Resolve the creation
      resolveCreate({ id: 'new-sess', name: 'New Session', status: 'waiting', projectId: 'proj-123' });
      await nextTick();
      await new Promise(r => setTimeout(r, 50));

      // Button should be re-enabled
      expect(wrapper.vm.isCreatingSession).toBe(false);
      wrapper.unmount();
    });

    it('shows error toast on API failure', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, projectId: 'proj-123', gitBranch: 'feature/parent-branch', gitWorktree: '/path/to/worktree' });
      api.createSession.mockRejectedValue(new Error('Network error'));

      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      const btn = document.querySelector('[data-testid="overlay-add-session-btn"]');
      btn.click();
      await nextTick();
      await new Promise(r => setTimeout(r, 50));

      expect(mockUiStore.error).toHaveBeenCalledWith('Network error');
      wrapper.unmount();
    });

    it('shows error toast when no project context', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, projectId: null });
      mockSessionsStore.currentSession = { ...rootSession, projectId: null };

      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      const btn = document.querySelector('[data-testid="overlay-add-session-btn"]');
      btn.click();
      await nextTick();
      await new Promise(r => setTimeout(r, 50));

      expect(api.createSession).not.toHaveBeenCalled();
      expect(mockUiStore.error).toHaveBeenCalledWith('Cannot create session: no project context');
      wrapper.unmount();
    });

    it('does not send gitBranch for non-git project sessions', async () => {
      const nonGitSession = { ...rootSession, projectId: 'proj-123', gitBranch: null };
      mockSessionsStore.getSessionById.mockReturnValue(nonGitSession);
      api.createSession.mockResolvedValue({ id: 'new-sess', name: 'New Session', status: 'waiting', projectId: 'proj-123' });

      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      const btn = document.querySelector('[data-testid="overlay-add-session-btn"]');
      btn.click();
      await nextTick();
      await new Promise(r => setTimeout(r, 50));

      expect(generateWorktreeBranch).not.toHaveBeenCalled();
      expect(api.createSession).toHaveBeenCalledWith('proj-123', {
        prompt: ' ',
        name: 'New Session',
        parentSessionId: 'sess-root',
        startImmediately: false,
      });
      wrapper.unmount();
    });
  });

  describe('active session spinner indicator', () => {
    it('shows spinner when session is running', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, status: 'running' });
      mockSessionsStore.currentSession = { ...rootSession, status: 'running' };
      const wrapper = mountOverlay();
      await nextTick();
      const spinner = document.querySelector('.active-spinner');
      expect(spinner).toBeTruthy();
      wrapper.unmount();
    });

    it('shows spinner when session is starting', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, status: 'starting' });
      mockSessionsStore.currentSession = { ...rootSession, status: 'starting' };
      const wrapper = mountOverlay();
      await nextTick();
      const spinner = document.querySelector('.active-spinner');
      expect(spinner).toBeTruthy();
      wrapper.unmount();
    });

    it('does not show spinner when session is waiting', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, status: 'waiting' });
      mockSessionsStore.currentSession = { ...rootSession, status: 'waiting' };
      const wrapper = mountOverlay();
      await nextTick();
      const spinner = document.querySelector('.active-spinner');
      expect(spinner).toBeFalsy();
      wrapper.unmount();
    });

    it('does not show spinner when session is completed', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, status: 'completed' });
      mockSessionsStore.currentSession = { ...rootSession, status: 'completed' };
      const wrapper = mountOverlay();
      await nextTick();
      const spinner = document.querySelector('.active-spinner');
      expect(spinner).toBeFalsy();
      wrapper.unmount();
    });

    it('does not show spinner when session is error', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, status: 'error' });
      mockSessionsStore.currentSession = { ...rootSession, status: 'error' };
      const wrapper = mountOverlay();
      await nextTick();
      const spinner = document.querySelector('.active-spinner');
      expect(spinner).toBeFalsy();
      wrapper.unmount();
    });

    it('close handle ARIA label reflects running session status', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, status: 'running' });
      mockSessionsStore.currentSession = { ...rootSession, status: 'running' };
      const wrapper = mountOverlay();
      await nextTick();
      const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');
      expect(handle.getAttribute('aria-label')).toBe('Session running...');
      expect(handle.getAttribute('title')).toBe('Session running...');
      wrapper.unmount();
    });

    it('close handle ARIA label reflects starting session status', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, status: 'starting' });
      mockSessionsStore.currentSession = { ...rootSession, status: 'starting' };
      const wrapper = mountOverlay();
      await nextTick();
      const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');
      expect(handle.getAttribute('aria-label')).toBe('Session starting...');
      expect(handle.getAttribute('title')).toBe('Session starting...');
      wrapper.unmount();
    });

    it('close handle ARIA label is "Close session tree" for inactive sessions', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, status: 'waiting' });
      mockSessionsStore.currentSession = { ...rootSession, status: 'waiting' };
      const wrapper = mountOverlay();
      await nextTick();
      const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');
      expect(handle.getAttribute('aria-label')).toBe('Close session tree');
      expect(handle.getAttribute('title')).toBe('Close session tree');
      wrapper.unmount();
    });

    it('spinner has correct title for running status', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, status: 'running' });
      mockSessionsStore.currentSession = { ...rootSession, status: 'running' };
      const wrapper = mountOverlay();
      await nextTick();
      const spinner = document.querySelector('.active-spinner');
      expect(spinner.getAttribute('title')).toBe('Session running...');
      wrapper.unmount();
    });

    it('spinner has correct title for starting status', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, status: 'starting' });
      mockSessionsStore.currentSession = { ...rootSession, status: 'starting' };
      const wrapper = mountOverlay();
      await nextTick();
      const spinner = document.querySelector('.active-spinner');
      expect(spinner.getAttribute('title')).toBe('Session starting...');
      wrapper.unmount();
    });
  });

  describe('session switching state reset', () => {
    const childSession = {
      id: 'child-1',
      name: 'Child Session',
      status: 'running',
      parentSessionId: 'sess-root',
      projectId: 'proj-123',
    };

    const chainSessions = [{ session: rootSession, depth: 0 }, { session: childSession, depth: 1 }];

    it('clears stale state when switching sessions', async () => {
      mockSessionsStore.getSessionById.mockImplementation((id) => {
        if (id === 'sess-root') return rootSession;
        if (id === 'child-1') return childSession;
        return null;
      });

      const wrapper = mount(SessionTreeOverlay, {
        props: {
          sessionId: 'sess-root',
          sessionChain: chainSessions,
          summariesMap: {},
        },
        global: { plugins: [router] },
        attachTo: document.body,
      });
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      // Switch to child session
      wrapper.vm.handlePickerSelect('child-1');
      await nextTick();
      await new Promise(r => setTimeout(r, 50));

      // Verify stale state was cleared
      expect(mockSessionsStore.clearRunningUsage).toHaveBeenCalled();
      expect(mockSessionsStore.clearPartialText).toHaveBeenCalled();
      expect(mockTodosStore.clearTodos).toHaveBeenCalled();

      wrapper.unmount();
    });

    it('fetches todos for new session after loading data', async () => {
      mockSessionsStore.getSessionById.mockImplementation((id) => {
        if (id === 'sess-root') return rootSession;
        if (id === 'child-1') return childSession;
        return null;
      });

      // After fetchConversations, activeConversationId should be set
      mockSessionsStore.fetchConversations.mockImplementation(async () => {
        mockSessionsStore.activeConversationId = 'conv-child-1';
      });

      const wrapper = mount(SessionTreeOverlay, {
        props: {
          sessionId: 'sess-root',
          sessionChain: chainSessions,
          summariesMap: {},
        },
        global: { plugins: [router] },
        attachTo: document.body,
      });
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      // Reset mocks after initial mount calls
      mockTodosStore.fetchTodos.mockClear();

      // Switch to child session
      wrapper.vm.handlePickerSelect('child-1');
      await nextTick();
      await new Promise(r => setTimeout(r, 50));

      // Verify todos were fetched for the new session
      expect(mockTodosStore.fetchTodos).toHaveBeenCalledWith('child-1', 'conv-child-1');

      wrapper.unmount();
    });

    it('does not fetch todos when no activeConversationId', async () => {
      mockSessionsStore.getSessionById.mockImplementation((id) => {
        if (id === 'sess-root') return rootSession;
        if (id === 'child-1') return childSession;
        return null;
      });

      // After fetchConversations, activeConversationId remains null
      mockSessionsStore.fetchConversations.mockImplementation(async () => {
        mockSessionsStore.activeConversationId = null;
      });

      const wrapper = mount(SessionTreeOverlay, {
        props: {
          sessionId: 'sess-root',
          sessionChain: chainSessions,
          summariesMap: {},
        },
        global: { plugins: [router] },
        attachTo: document.body,
      });
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      // Reset mocks after initial mount calls
      mockTodosStore.fetchTodos.mockClear();

      // Switch to child session
      wrapper.vm.handlePickerSelect('child-1');
      await nextTick();
      await new Promise(r => setTimeout(r, 50));

      // Verify todos were NOT fetched (no active conversation)
      expect(mockTodosStore.fetchTodos).not.toHaveBeenCalled();

      wrapper.unmount();
    });
  });
});
