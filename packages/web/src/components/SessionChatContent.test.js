import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { defineComponent, h } from 'vue';
import SessionChatContent from './SessionChatContent.vue';
import sessionChatContentSource from './SessionChatContent.vue?raw';

const mockSessionsStore = {
  currentSession: { id: 'sess-root', name: 'Root Session', status: 'waiting', projectId: 'proj-1' },
  sessions: [],
  messages: [],
  workLogs: {},
  activeConversationId: 'conv-1',
  viewedSessionId: null,
  getSessionById: vi.fn(),
  getRootSession: vi.fn(),
  addSessionToList: vi.fn(),
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

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: () => mockSessionsStore,
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: () => ({ error: vi.fn() }),
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
    props: ['sessions', 'activeSessionId', 'summaries'],
    emits: ['select'],
    setup(props, { emit }) {
      return () => h('button', {
        'data-testid': 'session-chat-picker',
        onClick: () => emit('select', props.sessions[1]?.session.id),
      }, 'Picker');
    },
  }),
}));

describe('SessionChatContent', () => {
  let router;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSessionsStore.currentSession = { id: 'sess-root', name: 'Root Session', status: 'waiting', projectId: 'proj-1' };
    mockSessionsStore.sessions = [mockSessionsStore.currentSession];
    mockSessionsStore.activeConversationId = 'conv-1';
    mockSessionsStore.getSessionById.mockImplementation(id => mockSessionsStore.sessions.find(session => session.id === id));
    mockSessionsStore.getRootSession.mockReturnValue(mockSessionsStore.currentSession);
    mockSessionsStore.fetchSession.mockResolvedValue(undefined);
    mockSessionsStore.fetchConversations.mockResolvedValue(undefined);
    mockSessionsStore.fetchMessages.mockResolvedValue(undefined);
    mockSessionsStore.fetchWorkLogs.mockResolvedValue(undefined);

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

  it('loads the initial session and emits active-session-change', async () => {
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

  it('passes the overlay body as the scroll container in overlay mode', async () => {
    const wrapper = mountContent();
    await flushPromises();

    const conversation = wrapper.findComponent({ name: 'ConversationTab' });
    expect(conversation.props('scrollContainerRef')).toBe(wrapper.find('.overlay-body').element);
  });

  it('passes document.documentElement as the scroll container in embedded mode', async () => {
    const wrapper = mountContent({ mode: 'embedded' });
    await flushPromises();

    const conversation = wrapper.findComponent({ name: 'ConversationTab' });
    expect(conversation.props('scrollContainerRef')).toBe(document.documentElement);
    expect(conversation.props('initialScrollTarget')).toBe('latest-agent-turn');
  });

  it('keeps overlay latest-turn runway on the scrollable content path', () => {
    const selector = '.session-chat-content--overlay :deep(.conversation-tab)::after';
    const start = sessionChatContentSource.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = sessionChatContentSource.indexOf('\n}', start);
    const block = sessionChatContentSource.slice(start, end + 2);

    expect(block).toContain('height: var(--session-chat-latest-turn-runway, 0px)');
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
    wrapper.vm.closePicker();
    await flushPromises();
    expect(pickerOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps the embedded chat header sticky below the session detail chrome', () => {
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
});
