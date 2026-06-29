import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { defineComponent, h } from 'vue';
import SessionChatContent from './SessionChatContent.vue';
import sessionChatContentSource from './SessionChatContent.vue?raw';

const mockSessionsStore = {
  currentSession: { id: 'sess-root', name: 'Root Workspace', status: 'waiting', projectId: 'proj-1' },
  sessions: [],
  messages: [],
  workLogs: {},
  activeConversationId: 'conv-1',
  viewedSessionId: null,
  getSessionById: vi.fn(),
  getRootSession: vi.fn(),
  addSessionToList: vi.fn(),
  deleteSession: vi.fn(),
  fetchSession: vi.fn(),
  fetchConversations: vi.fn(),
  fetchMessages: vi.fn(),
  fetchWorkLogs: vi.fn(),
  clearRunningUsage: vi.fn(),
  clearPartialText: vi.fn(),
  updateSessionStatus: vi.fn(),
  addMessage: vi.fn(),
  setPartialText: vi.fn(),
  updateSession: vi.fn(),
  addConversation: vi.fn(),
  updateConversation: vi.fn(),
  $cleanup: vi.fn(),
};

const mockTodosStore = {
  clearTodos: vi.fn(),
  fetchTodos: vi.fn(),
  $cleanup: vi.fn(),
};

const mockUiStore = {
  success: vi.fn(),
  error: vi.fn(),
};

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: () => mockSessionsStore,
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: () => mockUiStore,
}));

vi.mock('../stores/createOverlaySessionsStore.js', () => ({
  createOverlaySessionsStore: () => mockSessionsStore,
}));

vi.mock('../stores/createOverlayTodosStore.js', () => ({
  createOverlayTodosStore: () => mockTodosStore,
}));

vi.mock('../composables/useOverlayStore.js', () => ({
  SESSIONS_STORE_KEY: Symbol('test-sessions-store'),
  TODOS_STORE_KEY: Symbol('test-todos-store'),
}));

vi.mock('../composables/useApi.js', () => ({
  api: {
    createSession: vi.fn().mockResolvedValue({
      id: 'child-1',
      name: 'New Session',
      status: 'waiting',
      projectId: 'proj-1',
      parentSessionId: 'sess-root',
    }),
  },
}));

const mockUnsubscribe = vi.fn();
vi.mock('../composables/useSessionSubscription.js', () => ({
  useSessionSubscription: () => ({
    subscribe: vi.fn(),
    unsubscribe: mockUnsubscribe,
    onStatus: vi.fn(() => vi.fn()),
    onMessage: vi.fn(() => vi.fn()),
    onPartial: vi.fn(() => vi.fn()),
    onSessionUpdate: vi.fn(() => vi.fn()),
    onConversationCreated: vi.fn(() => vi.fn()),
    onConversationUpdated: vi.fn(() => vi.fn()),
  }),
}));

vi.mock('../composables/useSessionPolling.js', () => ({
  useSessionPolling: () => ({
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('./ConversationTab.vue', () => ({
  default: defineComponent({
    name: 'ConversationTab',
    props: ['sessionId', 'scrollContainerRef', 'hideNewConversation', 'initialScrollTarget'],
    emits: ['prompt-focus', 'prompt-blur'],
    setup(props) {
      return () => h('div', {
        class: 'conversation-tab',
        'data-session-id': props.sessionId,
        'data-hide-new-conversation': String(props.hideNewConversation),
        'data-initial-scroll-target': props.initialScrollTarget,
      });
    },
  }),
}));

vi.mock('./SessionChatPicker.vue', () => ({
  default: defineComponent({
    name: 'SessionChatPicker',
    props: [
      'sessions',
      'activeSessionId',
      'summaries',
      'rootSessionId',
      'deletingSessionId',
      'getTokenLabel',
      'getModelLabel',
    ],
    emits: ['select', 'delete-session'],
    setup(props, { emit }) {
      return () => h('div', { 'data-testid': 'session-chat-picker' }, [
        h('button', {
          'data-testid': 'picker-select',
          onClick: () => emit('select', props.sessions[1]?.session.id),
        }, 'Select'),
        h('button', {
          'data-testid': 'picker-delete',
          onClick: () => emit('delete-session', props.sessions[1]?.session.id),
        }, 'Delete'),
        h('span', { 'data-testid': 'picker-root-id' }, props.rootSessionId),
        h('span', { 'data-testid': 'picker-token-label' }, props.getTokenLabel?.(props.sessions[1]?.session)),
        h('span', { 'data-testid': 'picker-model-label' }, props.getModelLabel?.(props.sessions[1]?.session)),
      ]);
    },
  }),
}));

describe('SessionChatContent', () => {
  let router;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSessionsStore.currentSession = { id: 'sess-root', name: 'Root Workspace', status: 'waiting', projectId: 'proj-1' };
    mockSessionsStore.sessions = [mockSessionsStore.currentSession];
    mockSessionsStore.activeConversationId = 'conv-1';
    mockSessionsStore.getSessionById.mockImplementation(id => mockSessionsStore.sessions.find(session => session.id === id));
    mockSessionsStore.getRootSession.mockReturnValue(mockSessionsStore.currentSession);
    mockSessionsStore.fetchSession.mockResolvedValue(undefined);
    mockSessionsStore.fetchConversations.mockResolvedValue(undefined);
    mockSessionsStore.fetchMessages.mockResolvedValue(undefined);
    mockSessionsStore.fetchWorkLogs.mockResolvedValue(undefined);
    mockSessionsStore.deleteSession.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/projects/:id/sessions', component: { template: '<div />' } },
      ],
    });
    await router.push('/');
    await router.isReady();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function mountContent(props = {}, attrs = {}) {
    return mount(SessionChatContent, {
      attachTo: document.body,
      global: { plugins: [router] },
      attrs,
      props: {
        sessionId: 'sess-root',
        sessionChain: [{ session: mockSessionsStore.currentSession, depth: 0 }],
        summariesMap: {},
        mode: 'overlay',
        ...props,
      },
    });
  }

  it('loads the initial workspace and emits active-workspace-change', async () => {
    const activeSessionChange = vi.fn();
    const wrapper = mountContent({}, { onActiveSessionChange: activeSessionChange });
    await flushPromises();

    expect(mockSessionsStore.fetchSession).toHaveBeenCalledWith('sess-root', false);
    expect(mockSessionsStore.fetchConversations).toHaveBeenCalledWith('sess-root');
    expect(mockSessionsStore.fetchMessages).toHaveBeenCalledWith('sess-root', false, 'conv-1');
    expect(mockTodosStore.fetchTodos).toHaveBeenCalledWith('sess-root', 'conv-1');
    expect(activeSessionChange).toHaveBeenCalledWith({ id: 'sess-root', status: 'waiting' });
  });

  it('passes overlay conversation configuration to ConversationTab', async () => {
    const wrapper = mountContent();
    await flushPromises();

    const conversation = wrapper.findComponent({ name: 'ConversationTab' });
    expect(conversation.props('sessionId')).toBe('sess-root');
    expect(conversation.props('hideNewConversation')).toBe(true);
    expect(conversation.props('initialScrollTarget')).toBe('latest-agent-turn');
    expect(conversation.props('scrollContainerRef')).toBeTruthy();
  });

  it('switches when sessionId prop changes and cleans up stores on unmount', async () => {
    mockSessionsStore.sessions.push({ id: 'child-1', name: 'Child', status: 'running', projectId: 'proj-1', parentSessionId: 'sess-root' });
    const wrapper = mountContent();
    await flushPromises();

    await wrapper.setProps({ sessionId: 'child-1' });
    await flushPromises();

    expect(wrapper.vm.activeSessionId).toBe('child-1');
    expect(mockSessionsStore.fetchSession).toHaveBeenCalledWith('child-1', false);

    wrapper.unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(mockSessionsStore.$cleanup).toHaveBeenCalled();
    expect(mockTodosStore.$cleanup).toHaveBeenCalled();
  });

  it('renders embedded mode without overlay shell elements and exposes picker close', async () => {
    const pickerOpenChange = vi.fn();
    const wrapper = mountContent({
      mode: 'embedded',
      sessionChain: [
        { session: mockSessionsStore.currentSession, depth: 0 },
        { session: { id: 'child-1', name: 'Child', status: 'waiting' }, depth: 1 },
      ],
    }, { onPickerOpenChange: pickerOpenChange });
    await flushPromises();

    expect(wrapper.classes()).toContain('session-chat-content--embedded');
    expect(wrapper.find('.overlay-backdrop').exists()).toBe(false);
    expect(wrapper.find('[data-testid="session-chat-overlay-close-handle"]').exists()).toBe(false);
    expect(wrapper.find('.back-to-sessions-link').exists()).toBe(false);

    await wrapper.find('[data-testid="overlay-picker-trigger"]').trigger('click');
    expect(pickerOpenChange).toHaveBeenLastCalledWith(true);
    expect(wrapper.classes()).toContain('session-chat-content--picker-open');
    wrapper.vm.closePicker();
    await flushPromises();
    expect(pickerOpenChange).toHaveBeenLastCalledWith(false);
    expect(wrapper.classes()).not.toContain('session-chat-content--picker-open');
  });

  it('keeps the embedded chat header sticky below the workspace detail chrome', () => {
    expect(sessionChatContentSource).toMatch(/--session-detail-chat-header-top:\s*calc\(var\(--header-height-computed,\s*51px\) \+ var\(--viewport-offset-top,\s*0px\) \+ 3\.125rem\)/);

    const selector = '.session-chat-content--embedded .overlay-header';
    const start = sessionChatContentSource.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = sessionChatContentSource.indexOf('\n}', start);
    const block = sessionChatContentSource.slice(start, end + 2);

    expect(block).toMatch(/position:\s*-webkit-sticky/);
    expect(block).toMatch(/position:\s*sticky/);
    expect(block).toMatch(/top:\s*var\(--session-detail-chat-header-top\)/);
    expect(block).toMatch(/z-index:\s*98/);
  });

  it('keeps the overlay header above sticky composer controls', () => {
    const headerSelector = '.overlay-header';
    const headerStart = sessionChatContentSource.indexOf(`${headerSelector} {`);
    expect(headerStart).toBeGreaterThanOrEqual(0);
    const headerEnd = sessionChatContentSource.indexOf('\n}', headerStart);
    const headerBlock = sessionChatContentSource.slice(headerStart, headerEnd + 2);

    const controlsSelector = '.session-chat-content :deep(.conversation-controls-row)';
    const controlsStart = sessionChatContentSource.indexOf(`${controlsSelector} {`);
    expect(controlsStart).toBeGreaterThanOrEqual(0);
    const controlsEnd = sessionChatContentSource.indexOf('\n}', controlsStart);
    const controlsBlock = sessionChatContentSource.slice(controlsStart, controlsEnd + 2);

    expect(headerBlock).toMatch(/z-index:\s*110/);
    expect(controlsBlock).toMatch(/z-index:\s*10/);

    const bodySelector = '.overlay-body';
    const bodyStart = sessionChatContentSource.indexOf(`${bodySelector} {`);
    expect(bodyStart).toBeGreaterThanOrEqual(0);
    const bodyEnd = sessionChatContentSource.indexOf('\n}', bodyStart);
    const bodyBlock = sessionChatContentSource.slice(bodyStart, bodyEnd + 2);
    expect(bodyBlock).toMatch(/position:\s*relative/);
    expect(bodyBlock).toMatch(/z-index:\s*0/);

    const pickerOpenSelector = '.session-chat-content--picker-open .overlay-body';
    const pickerOpenStart = sessionChatContentSource.indexOf(`${pickerOpenSelector} {`);
    expect(pickerOpenStart).toBeGreaterThanOrEqual(0);
    const pickerOpenEnd = sessionChatContentSource.indexOf('\n}', pickerOpenStart);
    const pickerOpenBlock = sessionChatContentSource.slice(pickerOpenStart, pickerOpenEnd + 2);
    expect(pickerOpenBlock).toMatch(/pointer-events:\s*none/);

    const pickerOpenDescendantSelector = '.session-chat-content--picker-open .overlay-body :deep(*)';
    const pickerOpenDescendantStart = sessionChatContentSource.indexOf(`${pickerOpenDescendantSelector} {`);
    expect(pickerOpenDescendantStart).toBeGreaterThanOrEqual(0);
    const pickerOpenDescendantEnd = sessionChatContentSource.indexOf('\n}', pickerOpenDescendantStart);
    const pickerOpenDescendantBlock = sessionChatContentSource.slice(pickerOpenDescendantStart, pickerOpenDescendantEnd + 2);
    expect(pickerOpenDescendantBlock).toMatch(/pointer-events:\s*none/);

    const pickerOpenRootSelector = '.session-chat-content--picker-open';
    const pickerOpenRootStart = sessionChatContentSource.indexOf(`${pickerOpenRootSelector} {`);
    expect(pickerOpenRootStart).toBeGreaterThanOrEqual(0);
    const pickerOpenRootEnd = sessionChatContentSource.indexOf('\n}', pickerOpenRootStart);
    const pickerOpenRootBlock = sessionChatContentSource.slice(pickerOpenRootStart, pickerOpenRootEnd + 2);
    expect(pickerOpenRootBlock).toMatch(/overflow:\s*visible/);
  });

  it('lets embedded chat content grow the page instead of creating an internal scroll container', () => {
    const selector = '.session-chat-content--embedded';
    const start = sessionChatContentSource.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = sessionChatContentSource.indexOf('\n}', start);
    const block = sessionChatContentSource.slice(start, end + 2);

    expect(block).toMatch(/height:\s*auto/);
    expect(block).toMatch(/overflow:\s*visible/);
    expect(block).toMatch(/display:\s*flex/);
    expect(block).toMatch(/flex-direction:\s*column/);

    const bodySelector = '.session-chat-content--embedded .overlay-body';
    const bodyStart = sessionChatContentSource.indexOf(`${bodySelector} {`);
    expect(bodyStart).toBeGreaterThanOrEqual(0);
    const bodyEnd = sessionChatContentSource.indexOf('\n}', bodyStart);
    const bodyBlock = sessionChatContentSource.slice(bodyStart, bodyEnd + 2);

    expect(bodyBlock).toMatch(/overflow-y:\s*visible/);
    expect(bodyBlock).toMatch(/overscroll-behavior:\s*auto/);
  });

  it('keeps embedded scroll action buttons fixed to the viewport', () => {
    const selector = '.session-chat-content--embedded :deep(.conversation-scroll-actions)';
    const start = sessionChatContentSource.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = sessionChatContentSource.indexOf('\n}', start);
    const block = sessionChatContentSource.slice(start, end + 2);

    expect(block).toMatch(/position:\s*fixed/);
    expect(block).toMatch(/right:\s*max\(1rem,\s*calc\(\(100vw - 1200px\) \/ 2 \+ 1rem\)\)/);
    expect(block).toMatch(/bottom:\s*calc\(1rem \+ env\(safe-area-inset-bottom\)\)/);
    expect(block).toMatch(/z-index:\s*100/);
  });

  it('derives rootSessionId from parentSessionId instead of row order', async () => {
    const root = { id: 'root-1', name: 'Root', status: 'waiting', projectId: 'proj-1' };
    const child = { id: 'child-1', name: 'Child', status: 'waiting', projectId: 'proj-1', parentSessionId: 'root-1' };
    mockSessionsStore.sessions = [root, child];
    mockSessionsStore.currentSession = root;

    const wrapper = mountContent({
      sessionId: 'root-1',
      sessionChain: [
        { session: child, depth: 1 },
        { session: root, depth: 0 },
      ],
    });
    await flushPromises();

    await wrapper.find('[data-testid="overlay-picker-trigger"]').trigger('click');
    const picker = wrapper.findComponent({ name: 'SessionChatPicker' });
    expect(picker.props('rootSessionId')).toBe('root-1');
  });

  it('passes direct token and model labels to the picker', async () => {
    const root = { id: 'root-1', name: 'Root', status: 'waiting', projectId: 'proj-1' };
    const child = {
      id: 'child-1',
      name: 'Child',
      status: 'waiting',
      projectId: 'proj-1',
      parentSessionId: 'root-1',
      pendingModel: 'gpt-pending',
      inputTokens: 1200,
      outputTokens: 34,
    };
    const grandchild = {
      id: 'grandchild-1',
      name: 'Grandchild',
      status: 'waiting',
      projectId: 'proj-1',
      parentSessionId: 'child-1',
      inputTokens: 900000,
    };
    mockSessionsStore.sessions = [root, child, grandchild];
    mockSessionsStore.currentSession = root;

    const wrapper = mountContent({
      sessionId: 'root-1',
      sessionChain: [
        { session: root, depth: 0 },
        { session: child, depth: 1 },
        { session: grandchild, depth: 2 },
      ],
    });
    await flushPromises();

    await wrapper.find('[data-testid="overlay-picker-trigger"]').trigger('click');
    expect(wrapper.find('[data-testid="picker-token-label"]').text()).toBe('1.2K');
    expect(wrapper.find('[data-testid="picker-model-label"]').text()).toBe('gpt-pending');
  });

  it('does not delete the root workspace from the picker', async () => {
    const root = { id: 'root-1', name: 'Root', status: 'waiting', projectId: 'proj-1' };
    mockSessionsStore.sessions = [root];
    mockSessionsStore.currentSession = root;

    const wrapper = mountContent({
      sessionId: 'root-1',
      sessionChain: [{ session: root, depth: 0 }],
    });
    await flushPromises();

    await wrapper.vm.handlePickerDelete('root-1');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(mockSessionsStore.deleteSession).not.toHaveBeenCalled();
  });

  it('does not delete when picker confirmation is cancelled', async () => {
    window.confirm.mockReturnValue(false);
    const root = { id: 'root-1', name: 'Root', status: 'waiting', projectId: 'proj-1' };
    const child = { id: 'child-1', name: 'Child', status: 'waiting', projectId: 'proj-1', parentSessionId: 'root-1' };
    mockSessionsStore.sessions = [root, child];
    mockSessionsStore.currentSession = root;

    const wrapper = mountContent({
      sessionId: 'root-1',
      sessionChain: [
        { session: root, depth: 0 },
        { session: child, depth: 1 },
      ],
    });
    await flushPromises();

    await wrapper.vm.handlePickerDelete('child-1');
    expect(mockSessionsStore.deleteSession).not.toHaveBeenCalled();
  });

  it('deletes a confirmed child workspace and emits session-deleted', async () => {
    const root = { id: 'root-1', name: 'Root', status: 'waiting', projectId: 'proj-1' };
    const child = { id: 'child-1', name: 'Child', status: 'waiting', projectId: 'proj-1', parentSessionId: 'root-1' };
    mockSessionsStore.sessions = [root, child];
    mockSessionsStore.currentSession = root;
    const sessionDeleted = vi.fn();

    const wrapper = mountContent({
      sessionId: 'root-1',
      sessionChain: [
        { session: root, depth: 0 },
        { session: child, depth: 1 },
      ],
    }, { onSessionDeleted: sessionDeleted });
    await flushPromises();

    await wrapper.vm.handlePickerDelete('child-1');
    expect(mockSessionsStore.deleteSession).toHaveBeenCalledWith('child-1');
    expect(mockUiStore.success).toHaveBeenCalledWith('Session deleted');
    expect(sessionDeleted).toHaveBeenCalledWith('child-1');
  });

  it('switches to the root workspace when the active child is deleted', async () => {
    const root = { id: 'root-1', name: 'Root', status: 'waiting', projectId: 'proj-1' };
    const child = { id: 'child-1', name: 'Child', status: 'waiting', projectId: 'proj-1', parentSessionId: 'root-1' };
    mockSessionsStore.sessions = [root, child];
    mockSessionsStore.currentSession = child;

    const wrapper = mountContent({
      sessionId: 'child-1',
      sessionChain: [
        { session: child, depth: 1 },
        { session: root, depth: 0 },
      ],
    });
    await flushPromises();

    await wrapper.vm.handlePickerDelete('child-1');
    await flushPromises();

    expect(wrapper.vm.activeSessionId).toBe('root-1');
    expect(mockSessionsStore.fetchSession).toHaveBeenCalledWith('root-1', false);
  });
});
