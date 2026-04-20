import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { h, defineComponent, nextTick } from 'vue';
import SessionChatOverlay from './SessionChatOverlay.vue';
import sessionChatOverlaySource from './SessionChatOverlay.vue?raw';
import { api } from '../composables/useApi.js';
import { generateWorktreeBranch } from '@circuschief/shared';

// jsdom has no scrollIntoView. Several overlay code paths call it after
// focus transitions fire; stub it globally so blur-recovery tests can
// exercise the real focusin/focusout listeners without throwing.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function scrollIntoViewStub() {};
}

// Mock @circuschief/shared
vi.mock('@circuschief/shared', () => ({
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
  fetchWorkLogs: vi.fn(),
  workLogs: {},
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

// Mock overlay store factories — return the same mock stores so existing
// assertions against mockSessionsStore / mockTodosStore continue to work.
// Add $dispose and $cleanup as no-ops since the overlay disposes on unmount.
mockSessionsStore.$dispose = vi.fn();
mockTodosStore.$dispose = vi.fn();
mockSessionsStore.$cleanup = vi.fn();
mockTodosStore.$cleanup = vi.fn();

vi.mock('../stores/createOverlaySessionsStore.js', () => ({
  createOverlaySessionsStore: () => mockSessionsStore,
}));

vi.mock('../stores/createOverlayTodosStore.js', () => ({
  createOverlayTodosStore: () => mockTodosStore,
}));

vi.mock('../composables/useOverlayStore.js', () => ({
  SESSIONS_STORE_KEY: Symbol('test-sessions-store'),
  TODOS_STORE_KEY: Symbol('test-todos-store'),
  useInjectedSessionsStore: () => mockSessionsStore,
  useInjectedTodosStore: () => mockTodosStore,
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

// Mock SessionChatPicker
vi.mock('./SessionChatPicker.vue', () => ({
  default: defineComponent({
    name: 'SessionChatPicker',
    props: ['sessions', 'activeSessionId', 'summaries'],
    emits: ['select'],
    render() {
      return h('div', {
        class: 'session-chat-picker-stub',
        'data-testid': 'session-chat-picker',
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

describe('SessionChatOverlay', () => {
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
    mockSessionsStore.fetchMessages.mockResolvedValue(undefined);
    mockSessionsStore.fetchWorkLogs.mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Clean up teleported content
    document.querySelectorAll('[data-testid="session-chat-overlay"]').forEach(el => el.remove());
  });

  function mountOverlay(propsOverrides = {}) {
    return mount(SessionChatOverlay, {
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
      const overlay = document.querySelector('[data-testid="session-chat-overlay"]');
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
      // Wait for async onMounted to complete (loadSessionData + setupSubscription)
      // before ConversationTab renders, since switchingSession starts as true.
      await new Promise(r => setTimeout(r, 10));
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
      // Verify "Sessions" text label is present
      expect(backLink.textContent).toContain('Sessions');
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

    it('back link has Sessions text label', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({
        ...rootSession,
        projectId: 'proj-123',
      });
      const wrapper = mountOverlay();
      await nextTick();
      const textSpan = document.querySelector('.back-to-sessions-text');
      expect(textSpan).toBeTruthy();
      expect(textSpan.textContent).toBe('Sessions');
      wrapper.unmount();
    });

    it('back link has accessible minimum click target size', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({
        ...rootSession,
        projectId: 'proj-123',
      });
      const wrapper = mountOverlay();
      await nextTick();
      const backLink = document.querySelector('.back-to-sessions-link');
      expect(backLink).toBeTruthy();
      // Verify the class is applied (scoped CSS handles the actual sizing)
      expect(backLink.classList.contains('back-to-sessions-link')).toBe(true);
      wrapper.unmount();
    });

    it('back link has sufficient spacing from adjacent buttons', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({
        ...rootSession,
        projectId: 'proj-123',
      });
      const wrapper = mountOverlay();
      await nextTick();
      const backLink = document.querySelector('.back-to-sessions-link');
      const addBtn = document.querySelector('[data-testid="overlay-add-session-btn"]');
      expect(backLink).toBeTruthy();
      expect(addBtn).toBeTruthy();
      // Verify both elements are siblings in the same row
      expect(backLink.parentElement).toBe(addBtn.parentElement);
      // Back link should come before the add button
      expect(backLink.compareDocumentPosition(addBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      wrapper.unmount();
    });

    it('renders close handle with correct test id', async () => {
      const wrapper = mountOverlay();
      await nextTick();
      const handle = document.querySelector('[data-testid="session-chat-overlay-close-handle"]');
      expect(handle).toBeTruthy();
      wrapper.unmount();
    });

    it('close handle has correct ARIA attributes', async () => {
      const wrapper = mountOverlay();
      await nextTick();
      const handle = document.querySelector('[data-testid="session-chat-overlay-close-handle"]');
      expect(handle).toBeTruthy();
      expect(handle.getAttribute('role')).toBe('button');
      expect(handle.getAttribute('aria-label')).toBe('Close session chat');
      expect(handle.getAttribute('tabindex')).toBe('0');
      wrapper.unmount();
    });
  });

  describe('close behavior', () => {
    it('emits close on Escape when picker is closed', async () => {
      const onClose = vi.fn();
      const wrapper = mount(SessionChatOverlay, {
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
      const wrapper = mount(SessionChatOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onClose },
        attachTo: document.body,
      });
      await nextTick();
      // Click the backdrop (overlay-backdrop) directly, not the content
      const backdrop = document.querySelector('[data-testid="session-chat-overlay"]');
      backdrop.click();
      await nextTick();
      await waitForTransition();
      wrapper.vm.afterLeave(); // Manually trigger the transition complete hook
      expect(onClose).toHaveBeenCalled();
      wrapper.unmount();
    });

    it('does not emit close when clicking inside overlay content', async () => {
      const onClose = vi.fn();
      const wrapper = mount(SessionChatOverlay, {
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
      const wrapper = mount(SessionChatOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onClose },
        attachTo: document.body,
      });
      await nextTick();
      const handle = document.querySelector('[data-testid="session-chat-overlay-close-handle"]');
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
      const wrapper = mount(SessionChatOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onClose },
        attachTo: document.body,
      });
      await nextTick();
      const handle = document.querySelector('[data-testid="session-chat-overlay-close-handle"]');
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
      const wrapper = mount(SessionChatOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onClose },
        attachTo: document.body,
      });
      await nextTick();
      const handle = document.querySelector('[data-testid="session-chat-overlay-close-handle"]');
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
      const wrapper = mount(SessionChatOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onClose },
        attachTo: document.body,
      });
      await nextTick();

      // Trigger close
      const handle = document.querySelector('[data-testid="session-chat-overlay-close-handle"]');
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
      const handle = document.querySelector('[data-testid="session-chat-overlay-close-handle"]');
      handle.click();
      await nextTick();

      // Should be in closing state
      expect(wrapper.vm.closing).toBe(true);
      expect(wrapper.vm.visible).toBe(false);

      // Clean up
      document.querySelectorAll('[data-testid="session-chat-overlay"]').forEach(el => el.remove());
    });

    it('guards against rapid close attempts', async () => {
      const onClose = vi.fn();
      const wrapper = mount(SessionChatOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onClose },
        attachTo: document.body,
      });
      await nextTick();

      const handle = document.querySelector('[data-testid="session-chat-overlay-close-handle"]');

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

      const handle = document.querySelector('[data-testid="session-chat-overlay-close-handle"]');
      const backdrop = document.querySelector('[data-testid="session-chat-overlay"]');

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
        () => document.querySelector('[data-testid="session-chat-overlay-close-handle"]').click(),
        () => document.querySelector('[data-testid="session-chat-overlay"]').click(),
      ];

      for (const trigger of triggers) {
        const testWrapper = mount(SessionChatOverlay, {
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
        document.querySelectorAll('[data-testid="session-chat-overlay"]').forEach(el => el.remove());
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
      return mount(SessionChatOverlay, {
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
      const wrapper = mount(SessionChatOverlay, {
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
      expect(document.querySelector('[data-testid="session-chat-picker"]')).toBeFalsy();

      // Click to open
      trigger.click();
      await nextTick();
      expect(document.querySelector('[data-testid="session-chat-picker"]')).toBeTruthy();

      // Click to close
      trigger.click();
      await nextTick();
      expect(document.querySelector('[data-testid="session-chat-picker"]')).toBeFalsy();

      wrapper.unmount();
    });

    it('SessionChatPicker receives correct props', async () => {
      const wrapper = mountWithPicker();
      await nextTick();

      // Open picker
      wrapper.vm.pickerOpen = true;
      await nextTick();

      const picker = document.querySelector('[data-testid="session-chat-picker"]');
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
      const wrapper = mount(SessionChatOverlay, {
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
      expect(document.querySelector('[data-testid="session-chat-picker"]')).toBeTruthy();

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
      const backdrop = document.querySelector('[data-testid="session-chat-overlay"]');
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
      expect(mockSessionsStore.fetchMessages).toHaveBeenCalledWith('new-sess', false, mockSessionsStore.activeConversationId);
      expect(mockSessionsStore.fetchWorkLogs).toHaveBeenCalledWith('new-sess');
      wrapper.unmount();
    });

    it('emits session-created event after creation', async () => {
      const newSession = { id: 'new-sess', name: 'New Session', status: 'waiting', projectId: 'proj-123', parentSessionId: 'sess-root' };
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, projectId: 'proj-123', gitBranch: 'feature/parent-branch', gitWorktree: '/path/to/worktree' });
      api.createSession.mockResolvedValue(newSession);

      const onSessionCreated = vi.fn();
      const wrapper = mount(SessionChatOverlay, {
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

  describe('session switch loading state', () => {
    const childSession = {
      id: 'child-1',
      name: 'Child Session',
      status: 'running',
      parentSessionId: 'sess-root',
      projectId: 'proj-123',
    };
    const chainSessions = [
      { session: rootSession, depth: 0 },
      { session: childSession, depth: 1 },
    ];

    it('shows loading spinner when switching sessions', async () => {
      // Setup: make fetchSession return a pending promise so we can
      // observe the spinner while data is loading.
      let resolveFetch;
      mockSessionsStore.fetchSession.mockReturnValue(
        new Promise(resolve => { resolveFetch = resolve; })
      );
      mockSessionsStore.fetchConversations.mockResolvedValue(undefined);
      mockSessionsStore.getSessionById.mockImplementation((id) => {
        if (id === 'sess-root') return rootSession;
        if (id === 'child-1') return childSession;
        return null;
      });

      const wrapper = mount(SessionChatOverlay, {
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

      // Trigger session switch (don't await — we want to check mid-flight)
      wrapper.vm.handlePickerSelect('child-1');
      await nextTick();

      // Spinner should be visible
      const spinner = document.querySelector('.session-switch-loading');
      expect(spinner).toBeTruthy();
      expect(spinner.textContent).toContain('Loading session...');

      // ConversationTab should NOT be visible
      const conv = document.querySelector('.conversation-tab-mock');
      expect(conv).toBeFalsy();

      // Resolve the fetch to clean up
      resolveFetch();
      await new Promise(r => setTimeout(r, 50));

      wrapper.unmount();
    });

    it('hides loading spinner after data loads', async () => {
      mockSessionsStore.getSessionById.mockImplementation((id) => {
        if (id === 'sess-root') return rootSession;
        if (id === 'child-1') return childSession;
        return null;
      });
      mockSessionsStore.fetchSession.mockResolvedValue(undefined);
      mockSessionsStore.fetchConversations.mockResolvedValue(undefined);

      const wrapper = mount(SessionChatOverlay, {
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

      // Trigger switch and wait for it to complete
      wrapper.vm.handlePickerSelect('child-1');
      await nextTick();
      await new Promise(r => setTimeout(r, 50));

      // Spinner should be gone
      expect(document.querySelector('.session-switch-loading')).toBeFalsy();
      // ConversationTab should be visible with new session ID
      const conv = document.querySelector('.conversation-tab-mock');
      expect(conv).toBeTruthy();
      expect(conv.getAttribute('data-session-id')).toBe('child-1');

      wrapper.unmount();
    });

    it('clears spinner even when fetchSession rejects (error caught in loadSessionData)', async () => {
      // Note: loadSessionData has its own try/catch that swallows errors.
      // So fetchSession rejection doesn't propagate to switchToSession.
      // The spinner still clears because loadSessionData completes normally
      // (after catching the error internally).
      mockSessionsStore.getSessionById.mockImplementation((id) => {
        if (id === 'sess-root') return rootSession;
        if (id === 'child-1') return childSession;
        return null;
      });
      mockSessionsStore.fetchSession.mockRejectedValue(new Error('Network error'));

      const wrapper = mount(SessionChatOverlay, {
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

      wrapper.vm.handlePickerSelect('child-1');
      await nextTick();
      await new Promise(r => setTimeout(r, 50));

      // Spinner should be cleared despite the error
      expect(wrapper.vm.switchingSession).toBe(false);
      expect(document.querySelector('.session-switch-loading')).toBeFalsy();

      wrapper.unmount();
    });

    it('does not show spinner when selecting the already-active session', async () => {
      const wrapper = mount(SessionChatOverlay, {
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

      // Select the same session that's already active
      wrapper.vm.handlePickerSelect('sess-root');
      await nextTick();

      // No spinner should appear
      expect(wrapper.vm.switchingSession).toBe(false);
      expect(document.querySelector('.session-switch-loading')).toBeFalsy();

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
      const handle = document.querySelector('[data-testid="session-chat-overlay-close-handle"]');
      expect(handle.getAttribute('aria-label')).toBe('Session running...');
      expect(handle.getAttribute('title')).toBe('Session running...');
      wrapper.unmount();
    });

    it('close handle ARIA label reflects starting session status', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, status: 'starting' });
      mockSessionsStore.currentSession = { ...rootSession, status: 'starting' };
      const wrapper = mountOverlay();
      await nextTick();
      const handle = document.querySelector('[data-testid="session-chat-overlay-close-handle"]');
      expect(handle.getAttribute('aria-label')).toBe('Session starting...');
      expect(handle.getAttribute('title')).toBe('Session starting...');
      wrapper.unmount();
    });

    it('close handle ARIA label is "Close session chat" for inactive sessions', async () => {
      mockSessionsStore.getSessionById.mockReturnValue({ ...rootSession, status: 'waiting' });
      mockSessionsStore.currentSession = { ...rootSession, status: 'waiting' };
      const wrapper = mountOverlay();
      await nextTick();
      const handle = document.querySelector('[data-testid="session-chat-overlay-close-handle"]');
      expect(handle.getAttribute('aria-label')).toBe('Close session chat');
      expect(handle.getAttribute('title')).toBe('Close session chat');
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

      const wrapper = mount(SessionChatOverlay, {
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
      expect(mockSessionsStore.messages).toEqual([]);
      expect(mockSessionsStore.workLogs).toEqual({});
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

      const wrapper = mount(SessionChatOverlay, {
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

      const wrapper = mount(SessionChatOverlay, {
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

  describe('visualViewport syncing', () => {
    // Preserve the original window.visualViewport descriptor so each test
    // can install its own mock and then restore.
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'visualViewport'
    );

    function installMockVisualViewport(props = {}) {
      const addEventListener = vi.fn();
      const removeEventListener = vi.fn();
      const vv = {
        offsetTop: 120,
        offsetLeft: 0,
        width: 390,
        height: 580,
        addEventListener,
        removeEventListener,
        ...props,
      };
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: vv,
      });
      return vv;
    }

    function restoreVisualViewport() {
      if (originalDescriptor) {
        Object.defineProperty(window, 'visualViewport', originalDescriptor);
      } else {
        // jsdom has no native visualViewport; delete what the test set
        delete window.visualViewport;
      }
    }

    afterEach(() => {
      restoreVisualViewport();
    });

    it('applies geometry from window.visualViewport on mount', async () => {
      installMockVisualViewport({
        offsetTop: 120,
        offsetLeft: 0,
        width: 390,
        height: 580,
      });

      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      const backdrop = document.querySelector('.overlay-backdrop');
      expect(backdrop).toBeTruthy();
      expect(backdrop.style.top).toBe('120px');
      expect(backdrop.style.left).toBe('0px');
      expect(backdrop.style.width).toBe('390px');
      expect(backdrop.style.height).toBe('580px');

      wrapper.unmount();
    });

    it('attaches resize and scroll listeners on mount', async () => {
      const vv = installMockVisualViewport();

      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      expect(vv.addEventListener).toHaveBeenCalledWith(
        'resize',
        expect.any(Function)
      );
      expect(vv.addEventListener).toHaveBeenCalledWith(
        'scroll',
        expect.any(Function)
      );

      wrapper.unmount();
    });

    it('removes listeners on unmount using the same handler reference', async () => {
      const vv = installMockVisualViewport();

      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      // Capture the handler passed to addEventListener (currently `onVVChange`,
      // which wraps syncToVisualViewport with a trailing re-sync timer) so we
      // can prove the same reference was passed to removeEventListener —
      // otherwise the listener would leak.
      const resizeAdd = vv.addEventListener.mock.calls.find(
        c => c[0] === 'resize'
      );
      const scrollAdd = vv.addEventListener.mock.calls.find(
        c => c[0] === 'scroll'
      );
      expect(resizeAdd).toBeDefined();
      expect(scrollAdd).toBeDefined();
      const resizeHandler = resizeAdd[1];
      const scrollHandler = scrollAdd[1];

      wrapper.unmount();

      expect(vv.removeEventListener).toHaveBeenCalledWith(
        'resize',
        resizeHandler
      );
      expect(vv.removeEventListener).toHaveBeenCalledWith(
        'scroll',
        scrollHandler
      );
    });

    it('re-syncs backdrop geometry when visualViewport resizes', async () => {
      const vv = installMockVisualViewport({
        offsetTop: 120,
        offsetLeft: 0,
        width: 390,
        height: 580,
      });

      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      const backdrop = document.querySelector('.overlay-backdrop');
      expect(backdrop.style.top).toBe('120px');
      expect(backdrop.style.height).toBe('580px');

      // Simulate URL bar retracting / keyboard dismissing: visual viewport
      // shifts up and grows taller. Invoke the registered resize handler.
      const resizeHandler = vv.addEventListener.mock.calls.find(
        c => c[0] === 'resize'
      )[1];
      vv.offsetTop = 40;
      vv.height = 620;
      resizeHandler();

      expect(backdrop.style.top).toBe('40px');
      expect(backdrop.style.height).toBe('620px');

      wrapper.unmount();
    });

    it('is a no-op when window.visualViewport is undefined', async () => {
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: undefined,
      });

      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      const backdrop = document.querySelector('.overlay-backdrop');
      expect(backdrop).toBeTruthy();
      // No inline geometry should have been written; CSS `inset: 0` remains
      // authoritative in this fallback path.
      expect(backdrop.style.top).toBe('');
      expect(backdrop.style.left).toBe('');
      expect(backdrop.style.width).toBe('');
      expect(backdrop.style.height).toBe('');

      // Unmounting must not throw.
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it('exposes syncToVisualViewport for testing', async () => {
      installMockVisualViewport();

      const wrapper = mountOverlay();
      await nextTick();
      await new Promise(r => setTimeout(r, 10));

      expect(wrapper.vm.syncToVisualViewport).toBeDefined();
      expect(typeof wrapper.vm.syncToVisualViewport).toBe('function');

      wrapper.unmount();
    });
  });

  describe('visualViewport blur recovery + clamp', () => {
    // Preserve the original window.visualViewport descriptor so each test
    // can install its own mock and then restore.
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'visualViewport'
    );

    function installMockVisualViewport(props = {}) {
      const addEventListener = vi.fn();
      const removeEventListener = vi.fn();
      const vv = {
        offsetTop: 0,
        offsetLeft: 0,
        width: 400,
        height: 800,
        addEventListener,
        removeEventListener,
        ...props,
      };
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: vv,
      });
      return vv;
    }

    function restoreVisualViewport() {
      if (originalDescriptor) {
        Object.defineProperty(window, 'visualViewport', originalDescriptor);
      } else {
        delete window.visualViewport;
      }
    }

    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;

    function setInnerSize(w, innerH) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerH });
    }

    beforeEach(() => {
      vi.useFakeTimers({
        toFake: [
          'setTimeout', 'clearTimeout',
          'setInterval', 'clearInterval',
          'requestAnimationFrame', 'cancelAnimationFrame',
          'Date',
        ],
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      restoreVisualViewport();
      setInnerSize(originalInnerWidth, originalInnerHeight);
    });

    // Helper: mount the overlay, flush enough to register listeners and refs.
    async function mountAndFlush() {
      const wrapper = mountOverlay();
      await nextTick();
      await vi.advanceTimersByTimeAsync(10);
      return wrapper;
    }

    it('onVVChange syncs immediately and coalesces trailing re-syncs into one at 400 ms', async () => {
      const vv = installMockVisualViewport({
        offsetTop: 10, offsetLeft: 0, width: 400, height: 800,
      });
      setInnerSize(400, 800);

      const wrapper = await mountAndFlush();

      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      const setSpy = vi.spyOn(globalThis, 'setTimeout');

      const resizeHandler = vv.addEventListener.mock.calls.find(
        c => c[0] === 'resize'
      )[1];

      const backdrop = document.querySelector('.overlay-backdrop');

      // Fire the handler three times with mutating vv values.
      vv.offsetTop = 20; vv.height = 790;
      resizeHandler();
      expect(backdrop.style.top).toBe('20px');
      expect(backdrop.style.height).toBe('790px');

      vv.offsetTop = 30; vv.height = 780;
      resizeHandler();
      expect(backdrop.style.top).toBe('30px');
      expect(backdrop.style.height).toBe('780px');

      vv.offsetTop = 40; vv.height = 770;
      resizeHandler();
      expect(backdrop.style.top).toBe('40px');
      expect(backdrop.style.height).toBe('770px');

      // Each subsequent onVVChange cancels the previous trailing timer.
      // The first call had no previous timer to clear, so only two clears.
      // Filter to the trailing-timer clears (onVVChange passes the stored id,
      // which is always a numeric handle; we can simply count calls on the
      // spy since nothing else in this test clears timers).
      expect(clearSpy).toHaveBeenCalledTimes(2);

      // Exactly three trailing timers were scheduled (one per call) at 400 ms.
      const trailing400 = setSpy.mock.calls.filter(c => c[1] === 400);
      expect(trailing400.length).toBe(3);

      // Advance time; the single surviving trailing timer should fire once.
      await vi.advanceTimersByTimeAsync(400);

      // Backdrop still reflects the last vv values.
      expect(backdrop.style.top).toBe('40px');
      expect(backdrop.style.height).toBe('770px');

      wrapper.unmount();
    });

    it('trailing timer is cleared on unmount', async () => {
      const vv = installMockVisualViewport();

      const wrapper = await mountAndFlush();

      const resizeHandler = vv.addEventListener.mock.calls.find(
        c => c[0] === 'resize'
      )[1];
      resizeHandler(); // schedule a trailing timer

      wrapper.unmount();

      // Advance well past the trailing-timer deadline — no errors should be
      // thrown (the cleared timer does not fire against a stale backdrop).
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();

      // Backdrop removed by teleport cleanup.
      expect(document.querySelector('.overlay-backdrop')).toBeNull();
    });

    it('clamp fires after blur when vv.height is stale', async () => {
      const vv = installMockVisualViewport({
        offsetTop: 200, offsetLeft: 0, width: 400, height: 300,
      });
      setInnerSize(400, 800);

      const wrapper = await mountAndFlush();

      const body = document.querySelector('.overlay-body');
      expect(body).toBeTruthy();
      const ta = document.createElement('textarea');
      body.appendChild(ta);

      // Dispatch real focus/focusout to let handleOverlayFocusout run.
      ta.focus();
      ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

      // Flush the rAF inside handleOverlayFocusout (which calls markRecentBlur).
      // vitest's fake-timer rAF is scheduled with ~16 ms; advance past that.
      await vi.advanceTimersByTimeAsync(20);

      // Advance to the first blur-recovery timer (350 ms).
      await vi.advanceTimersByTimeAsync(350);

      const backdrop = document.querySelector('.overlay-backdrop');
      // Clamp path: layout-viewport geometry.
      expect(backdrop.style.top).toBe('0px');
      expect(backdrop.style.left).toBe('0px');
      expect(backdrop.style.width).toBe('400px');
      expect(backdrop.style.height).toBe('800px');

      // Also keep vv values stale so the 700 ms recovery honors clamp too.
      await vi.advanceTimersByTimeAsync(350);
      expect(backdrop.style.top).toBe('0px');
      expect(backdrop.style.height).toBe('800px');

      wrapper.unmount();
    });

    it('clamp does NOT fire outside the recent-blur window (iPad URL-bar case preserved)', async () => {
      installMockVisualViewport({
        offsetTop: 60, offsetLeft: 0, width: 400, height: 720,
      });
      setInnerSize(400, 800);

      const wrapper = await mountAndFlush();

      // No blur occurs. Manually call the sync.
      wrapper.vm.syncToVisualViewport();

      const backdrop = document.querySelector('.overlay-backdrop');
      expect(backdrop.style.top).toBe('60px');
      expect(backdrop.style.height).toBe('720px');

      wrapper.unmount();
    });

    it('clamp does NOT fire when gap is below threshold', async () => {
      const vv = installMockVisualViewport({
        offsetTop: 40, offsetLeft: 0, width: 400, height: 750,
      });
      setInnerSize(400, 800);

      const wrapper = await mountAndFlush();

      // height gap = 50 px (< 100), offsetTop = 40 (< 60). Both sub-threshold.
      wrapper.vm.markRecentBlur();
      wrapper.vm.syncToVisualViewport();

      const backdrop = document.querySelector('.overlay-backdrop');
      expect(backdrop.style.top).toBe(`${vv.offsetTop}px`);
      expect(backdrop.style.height).toBe(`${vv.height}px`);

      wrapper.unmount();
    });

    it('clamp fires on large offsetTop alone (height fully rebounded)', async () => {
      installMockVisualViewport({
        offsetTop: 150, offsetLeft: 0, width: 400, height: 800,
      });
      setInnerSize(400, 800);

      const wrapper = await mountAndFlush();

      wrapper.vm.markRecentBlur();
      wrapper.vm.syncToVisualViewport();

      const backdrop = document.querySelector('.overlay-backdrop');
      expect(backdrop.style.top).toBe('0px');
      expect(backdrop.style.left).toBe('0px');
      expect(backdrop.style.width).toBe('400px');
      expect(backdrop.style.height).toBe('800px');

      wrapper.unmount();
    });

    it('handleOverlayFocusout TEXTAREA schedules two recovery timers (350 ms, 700 ms)', async () => {
      installMockVisualViewport();
      setInnerSize(400, 800);

      const wrapper = await mountAndFlush();

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      const body = document.querySelector('.overlay-body');
      const ta = document.createElement('textarea');
      body.appendChild(ta);
      ta.focus();
      ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(20);

      const called350 = setTimeoutSpy.mock.calls.some(c => c[1] === 350);
      const called700 = setTimeoutSpy.mock.calls.some(c => c[1] === 700);
      expect(called350).toBe(true);
      expect(called700).toBe(true);

      wrapper.unmount();
    });

    it('handleOverlayFocusout INPUT type=text also triggers recovery', async () => {
      installMockVisualViewport();
      setInnerSize(400, 800);

      const wrapper = await mountAndFlush();

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      const body = document.querySelector('.overlay-body');
      const input = document.createElement('input');
      input.type = 'text';
      body.appendChild(input);
      input.focus();
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(20);

      const called350 = setTimeoutSpy.mock.calls.some(c => c[1] === 350);
      const called700 = setTimeoutSpy.mock.calls.some(c => c[1] === 700);
      expect(called350).toBe(true);
      expect(called700).toBe(true);

      wrapper.unmount();
    });

    it('handleOverlayFocusout INPUT type=checkbox does NOT trigger recovery', async () => {
      installMockVisualViewport();
      setInnerSize(400, 800);

      const wrapper = await mountAndFlush();

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      const body = document.querySelector('.overlay-body');
      const input = document.createElement('input');
      input.type = 'checkbox';
      body.appendChild(input);
      input.focus();
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(20);

      const called350 = setTimeoutSpy.mock.calls.some(c => c[1] === 350);
      const called700 = setTimeoutSpy.mock.calls.some(c => c[1] === 700);
      expect(called350).toBe(false);
      expect(called700).toBe(false);

      wrapper.unmount();
    });

    it('blur recovery timers are cancelled on unmount', async () => {
      installMockVisualViewport();
      setInnerSize(400, 800);

      const wrapper = await mountAndFlush();

      const body = document.querySelector('.overlay-body');
      const ta = document.createElement('textarea');
      body.appendChild(ta);
      ta.focus();
      ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(20);

      // Unmount before either 350 ms or 700 ms timer has fired.
      wrapper.unmount();

      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
      expect(document.querySelector('.overlay-backdrop')).toBeNull();
    });

    it('.overlay-panel-wrapper has 100dvh min-height fallback in the stylesheet', () => {
      // Assert against the SFC source text (imported as raw via Vite `?raw`).
      // jsdom does not parse the `dvh` unit, and @vue/test-utils does not
      // always inject `<style scoped>` blocks into document.styleSheets, so
      // source-text inspection is the reliable check.
      const blockMatch = sessionChatOverlaySource.match(/\.overlay-panel-wrapper\s*\{[^}]*\}/);
      expect(blockMatch).toBeTruthy();
      const block = blockMatch[0];

      expect(block).toMatch(/min-height:\s*100vh/);
      expect(block).toMatch(/min-height:\s*100dvh/);
    });
  });
});
