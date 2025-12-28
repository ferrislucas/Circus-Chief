import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, reactive } from 'vue';

// Mock the API - MUST be before imports that use it
vi.mock('../composables/useApi.js', () => ({
  api: {
    getSessionSummary: vi.fn().mockResolvedValue(null),
    regenerateSessionSummary: vi.fn().mockResolvedValue({ shortSummary: 'Test summary' }),
    generateSessionSummary: vi.fn().mockResolvedValue({ shortSummary: 'Test summary' }),
    getConversations: vi.fn().mockResolvedValue([]),
  },
}));

// Mock the sessions store
vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(),
}));

// Mock the UI store
vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(() => ({
    error: vi.fn(),
    success: vi.fn(),
  })),
}));

// Mock WebSocket composable
vi.mock('../composables/useWebSocket.js', () => ({
  useSessionSubscription: vi.fn(() => ({
    onSummaryUpdate: vi.fn(() => vi.fn()),
    onSummaryGenerating: vi.fn(() => vi.fn()),
  })),
}));

// Mock router
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

import SummaryTab from './SummaryTab.vue';
import { api } from '../composables/useApi.js';
import { useSessionsStore } from '../stores/sessions.js';

describe('SummaryTab', () => {
  let mockSessionsStore;
  let consoleError;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    mockSessionsStore = reactive({
      sessions: [{ id: 'sess-123', status: 'waiting' }],
      currentSession: { id: 'sess-123', status: 'waiting' },
      conversations: [],
      fetchConversations: vi.fn().mockResolvedValue([]),
      switchConversation: vi.fn().mockResolvedValue(),
    });

    vi.mocked(useSessionsStore).mockReturnValue(mockSessionsStore);

    // Reset API mock
    vi.mocked(api.getConversations).mockReset();
    vi.mocked(api.getConversations).mockResolvedValue([]);

    consoleError = console.error;
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = consoleError;
  });

  function mountComponent(props = { sessionId: 'sess-123' }) {
    return mount(SummaryTab, {
      props,
      global: {
        stubs: {
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

  describe('Session Overview', () => {
    it('renders session overview section', async () => {
      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.session-overview').exists()).toBe(true);
      expect(wrapper.text()).toContain('Session Overview');
    });

    it('displays conversation count', async () => {
      vi.mocked(api.getConversations).mockResolvedValue([
        { id: 'conv-1', name: 'First', isActive: false, messageCount: 3 },
        { id: 'conv-2', name: 'Second', isActive: true, messageCount: 5 },
      ]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.stat-value').text()).toBe('2');
    });

    it('displays session status', async () => {
      mockSessionsStore.sessions = [{ id: 'sess-123', status: 'completed' }];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.text()).toContain('completed');
    });

    it('has regenerate button', async () => {
      const wrapper = mountComponent();
      await flushAll(wrapper);

      const regenButton = wrapper.find('.overview-header .btn-link');
      expect(regenButton.exists()).toBe(true);
      expect(regenButton.text()).toContain('Regenerate');
    });
  });

  describe('Conversations Section', () => {
    it('shows loading state while fetching conversations', async () => {
      let resolvePromise;
      vi.mocked(api.getConversations).mockImplementation(() => new Promise(resolve => {
        resolvePromise = resolve;
      }));

      const wrapper = mountComponent();
      await nextTick();

      expect(wrapper.text()).toContain('Loading');

      resolvePromise([]);
      await flushAll(wrapper);
    });

    it('shows empty state when no conversations', async () => {
      vi.mocked(api.getConversations).mockResolvedValue([]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.text()).toContain('No conversations');
    });

    it('displays conversation cards', async () => {
      vi.mocked(api.getConversations).mockResolvedValue([
        { id: 'conv-1', name: 'First Conv', isActive: true, messageCount: 5, summary: 'Test summary' },
        { id: 'conv-2', name: 'Second Conv', isActive: false, messageCount: 3 },
      ]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const cards = wrapper.findAll('.conversation-card');
      expect(cards).toHaveLength(2);
    });

    it('displays conversation name', async () => {
      vi.mocked(api.getConversations).mockResolvedValue([
        { id: 'conv-1', name: 'My Conversation', isActive: true, messageCount: 5 },
      ]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.text()).toContain('My Conversation');
    });

    it('displays Untitled for conversations without name', async () => {
      vi.mocked(api.getConversations).mockResolvedValue([
        { id: 'conv-1', name: null, isActive: true, messageCount: 2 },
      ]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.text()).toContain('Untitled');
    });

    it('shows active badge for active conversation', async () => {
      vi.mocked(api.getConversations).mockResolvedValue([
        { id: 'conv-1', name: 'Active Conv', isActive: true, messageCount: 3 },
      ]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.active-badge').exists()).toBe(true);
    });

    it('displays message count', async () => {
      vi.mocked(api.getConversations).mockResolvedValue([
        { id: 'conv-1', name: 'Test', isActive: true, messageCount: 10 },
      ]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.text()).toContain('10 msgs');
    });

    it('displays conversation summary when available', async () => {
      vi.mocked(api.getConversations).mockResolvedValue([
        { id: 'conv-1', name: 'Test', isActive: false, messageCount: 5, summary: 'This is a test summary' },
      ]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.text()).toContain('This is a test summary');
    });

    it('shows pending message for active conversation without summary', async () => {
      vi.mocked(api.getConversations).mockResolvedValue([
        { id: 'conv-1', name: 'Test', isActive: true, messageCount: 5, summary: null },
      ]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.text()).toContain('Summary will generate when conversation ends');
    });

    it('shows View Conversation button', async () => {
      vi.mocked(api.getConversations).mockResolvedValue([
        { id: 'conv-1', name: 'Test', isActive: true, messageCount: 3 },
      ]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.text()).toContain('View Conversation');
    });
  });

  describe('Fetching conversations', () => {
    it('fetches conversations on mount', async () => {
      mountComponent();
      await flushPromises();

      expect(vi.mocked(api.getConversations)).toHaveBeenCalledWith('sess-123');
    });
  });
});
