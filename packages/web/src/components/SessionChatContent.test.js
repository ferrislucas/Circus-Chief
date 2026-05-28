import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { defineComponent, h } from 'vue';
import SessionChatContent from './SessionChatContent.vue';

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

    await wrapper.find('[data-testid="overlay-picker-trigger"]').trigger('click');
    expect(pickerOpenChange).toHaveBeenLastCalledWith(true);
    wrapper.vm.closePicker();
    await flushPromises();
    expect(pickerOpenChange).toHaveBeenLastCalledWith(false);
  });
});
