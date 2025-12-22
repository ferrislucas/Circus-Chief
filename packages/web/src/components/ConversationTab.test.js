import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

// Mock the sessions store
vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(),
}));

// Mock the ui store
vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(() => ({
    error: vi.fn(),
    success: vi.fn(),
  })),
}));

// Mock WebSocket composable
vi.mock('../composables/useWebSocket.js', () => ({
  useSessionSubscription: vi.fn(() => ({
    onPartial: vi.fn(() => vi.fn()),
    onMessage: vi.fn(() => vi.fn()),
    onWorkLog: vi.fn(() => vi.fn()),
    onWorkLogsAssociated: vi.fn(() => vi.fn()),
    onThinkingPartial: vi.fn(() => vi.fn()),
  })),
}));

import ConversationTab from './ConversationTab.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

describe('ConversationTab', () => {
  let mockSessionsStore;
  let mockUiStore;
  let consoleError;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    mockSessionsStore = {
      messages: [],
      currentSession: { id: 'sess-123', status: 'waiting', thinkingEnabled: false, mode: 'standard' },
      activeConversation: { id: 'conv-1', name: 'Test Conv' },
      conversations: [{ id: 'conv-1', name: 'Test Conv', isActive: true }],
      getWorkLogsForMessage: vi.fn().mockReturnValue([]),
      getUnassociatedWorkLogs: [],
      partialThinking: null,
      fetchConversations: vi.fn().mockResolvedValue([]),
      fetchWorkLogs: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue(),
      stopSession: vi.fn().mockResolvedValue(),
      restartSession: vi.fn().mockResolvedValue(),
      updateSessionThinking: vi.fn().mockResolvedValue(),
      updateSessionMode: vi.fn().mockResolvedValue(),
      addWorkLog: vi.fn(),
      associateWorkLogs: vi.fn(),
      clearWorkLogs: vi.fn(),
      clearConversations: vi.fn(),
      setPartialThinking: vi.fn(),
      clearPartialThinking: vi.fn(),
    };

    mockUiStore = {
      error: vi.fn(),
      success: vi.fn(),
    };

    vi.mocked(useSessionsStore).mockReturnValue(mockSessionsStore);
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    // Suppress console.error
    consoleError = console.error;
    console.error = vi.fn();

    // Mock localStorage
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    console.error = consoleError;
    vi.unstubAllGlobals();
  });

  function mountComponent(props = { sessionId: 'sess-123' }) {
    return mount(ConversationTab, {
      props,
      global: {
        stubs: {
          ConversationSelector: { template: '<div class="conversation-selector-stub"></div>' },
          TodoDrawer: { template: '<div class="todo-drawer-stub"></div>' },
          WorkLogPanel: { template: '<div class="work-log-panel-stub"></div>' },
          LiveWorkLogPanel: { template: '<div class="live-work-log-panel-stub"></div>' },
          MarkdownViewer: { template: '<div class="markdown-stub"><slot /></div>' },
        },
      },
    });
  }

  async function flushAll(wrapper) {
    await flushPromises();
    await nextTick();
    await wrapper.vm.$nextTick?.();
  }

  describe('Component rendering', () => {
    it('renders conversation selector', async () => {
      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Check that ConversationSelector is stubbed and rendered
      expect(wrapper.findComponent({ name: 'ConversationSelector' }).exists()).toBe(true);
    });

    it('renders messages container', async () => {
      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.messages').exists()).toBe(true);
    });

    it('renders input form when session is waiting', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'waiting', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.input-form').exists()).toBe(true);
    });

    it('renders input form when session is stopped', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'stopped', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.input-form').exists()).toBe(true);
      expect(wrapper.find('.status-stopped').exists()).toBe(true);
    });
  });

  describe('Messages display', () => {
    it('displays user messages', async () => {
      mockSessionsStore.messages = [
        { id: 'msg-1', role: 'user', content: 'Hello world', timestamp: Date.now() },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.message-user').exists()).toBe(true);
      expect(wrapper.text()).toContain('Hello world');
    });

    it('displays assistant messages', async () => {
      mockSessionsStore.messages = [
        { id: 'msg-1', role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.message-assistant').exists()).toBe(true);
    });

    it('displays message role', async () => {
      mockSessionsStore.messages = [
        { id: 'msg-1', role: 'user', content: 'Test', timestamp: Date.now() },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.message-role').text()).toBe('user');
    });

    it('displays message time', async () => {
      const now = Date.now();
      mockSessionsStore.messages = [
        { id: 'msg-1', role: 'user', content: 'Test', timestamp: now },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.message-time').exists()).toBe(true);
    });

    it('displays tool use for messages with tools', async () => {
      mockSessionsStore.messages = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Using a tool',
          timestamp: Date.now(),
          toolUse: [{ name: 'Read', input: { file: 'test.txt' } }],
        },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.message-tools').exists()).toBe(true);
      expect(wrapper.text()).toContain('Tool: Read');
    });
  });

  describe('Session states', () => {
    it('shows stop button when running', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'running', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.btn-danger').exists()).toBe(true);
      expect(wrapper.find('.btn-danger').text()).toContain('Stop');
    });

    it('shows restart button when completed', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'completed', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.status-completed').exists()).toBe(true);
      expect(wrapper.find('.btn-restart').text()).toContain('Restart');
    });

    it('shows restart button when error', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'error', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.status-error').exists()).toBe(true);
      expect(wrapper.find('.btn-restart').text()).toContain('Restart');
    });

    it('shows stopped message and input form', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'stopped', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.status-stopped').exists()).toBe(true);
      expect(wrapper.text()).toContain('send a message to resume');
    });
  });

  describe('Input form', () => {
    it('has a textarea', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'waiting', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('textarea').exists()).toBe(true);
    });

    it('has a send button', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'waiting', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.btn-send').exists()).toBe(true);
      expect(wrapper.find('.btn-send').text()).toContain('Send');
    });

    it('disables send button when input is empty', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'waiting', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.btn-send').attributes('disabled')).toBeDefined();
    });

    it('enables send button when input has text', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'waiting', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      await wrapper.find('textarea').setValue('Hello');
      await nextTick();

      expect(wrapper.find('.btn-send').attributes('disabled')).toBeUndefined();
    });

    it('sends message on form submit', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'waiting', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      await wrapper.find('textarea').setValue('Test message');
      await wrapper.find('form').trigger('submit.prevent');
      await flushAll(wrapper);

      expect(mockSessionsStore.sendMessage).toHaveBeenCalledWith('sess-123', 'Test message');
    });

    it('clears input after sending', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'waiting', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      await wrapper.find('textarea').setValue('Test message');
      await wrapper.find('form').trigger('submit.prevent');
      await flushAll(wrapper);

      expect(wrapper.find('textarea').element.value).toBe('');
    });
  });

  describe('Mode switcher', () => {
    it('displays mode buttons', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'waiting', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.mode-switcher').exists()).toBe(true);
      expect(wrapper.text()).toContain('Plan');
      expect(wrapper.text()).toContain('Standard');
      expect(wrapper.text()).toContain('YOLO');
    });

    it('highlights active mode', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'waiting', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const activeButton = wrapper.find('.mode-btn.active');
      expect(activeButton.exists()).toBe(true);
      expect(activeButton.text()).toBe('Standard');
    });

    it('changes mode on button click', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'waiting', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const planButton = wrapper.findAll('.mode-btn').find(btn => btn.text() === 'Plan');
      await planButton.trigger('click');
      await flushAll(wrapper);

      expect(mockSessionsStore.updateSessionMode).toHaveBeenCalledWith('sess-123', 'plan');
    });
  });

  describe('Thinking toggle', () => {
    it('displays thinking toggle', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'waiting', mode: 'standard', thinkingEnabled: false };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.thinking-toggle').exists()).toBe(true);
      expect(wrapper.text()).toContain('Thinking');
    });

    it('reflects thinking enabled state', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'waiting', mode: 'standard', thinkingEnabled: true };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const checkbox = wrapper.find('.thinking-toggle input[type="checkbox"]');
      expect(checkbox.element.checked).toBe(true);
    });

    it('toggles thinking on checkbox change', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'waiting', mode: 'standard', thinkingEnabled: false };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const checkbox = wrapper.find('.thinking-toggle input[type="checkbox"]');
      await checkbox.setValue(true);
      await flushAll(wrapper);

      expect(mockSessionsStore.updateSessionThinking).toHaveBeenCalledWith('sess-123', true);
    });
  });

  describe('Session actions', () => {
    it('stops session on stop button click', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'running', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      await wrapper.find('.btn-danger').trigger('click');
      await flushAll(wrapper);

      expect(mockSessionsStore.stopSession).toHaveBeenCalledWith('sess-123');
    });

    it('restarts session on restart button click', async () => {
      mockSessionsStore.currentSession = { id: 'sess-123', status: 'completed', mode: 'standard' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      await wrapper.find('.btn-restart').trigger('click');
      await flushAll(wrapper);

      expect(mockSessionsStore.restartSession).toHaveBeenCalledWith('sess-123');
    });
  });

  describe('Fetching data on mount', () => {
    it('fetches conversations on mount', async () => {
      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(mockSessionsStore.fetchConversations).toHaveBeenCalledWith('sess-123');
    });

    it('fetches work logs on mount', async () => {
      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(mockSessionsStore.fetchWorkLogs).toHaveBeenCalledWith('sess-123');
    });
  });
});
