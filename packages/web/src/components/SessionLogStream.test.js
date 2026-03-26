import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import SessionLogStream from './SessionLogStream.vue';

// Mock streaming store
const mockStreamingStore = {
  getSessionWorkLogs: vi.fn(() => []),
  getSessionPartialText: vi.fn(() => ''),
  getPartialThinking: vi.fn(() => null),
  isSessionLogCollapsed: vi.fn(() => false),
  toggleSessionLogCollapsed: vi.fn(),
};

vi.mock('../stores/sessionStreaming.js', () => ({
  useSessionStreamingStore: vi.fn(() => mockStreamingStore),
}));

describe('SessionLogStream', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Reset mock defaults
    mockStreamingStore.getSessionWorkLogs.mockReturnValue([]);
    mockStreamingStore.getSessionPartialText.mockReturnValue('');
    mockStreamingStore.getPartialThinking.mockReturnValue(null);
    mockStreamingStore.isSessionLogCollapsed.mockReturnValue(false);
    mockStreamingStore.toggleSessionLogCollapsed.mockReset();
  });

  function mountComponent(props = {}) {
    return mount(SessionLogStream, {
      props: { sessionIds: ['session-1'], ...props },
      global: {
        plugins: [createPinia()],
      },
    });
  }

  describe('rendering', () => {
    it('renders nothing when there is no content (no logs, no partial text, no thinking)', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.session-log-stream').exists()).toBe(false);
      expect(wrapper.find('.log-collapsed').exists()).toBe(false);
    });

    it('renders work log entries when sessionWorkLogs has data', () => {
      mockStreamingStore.getSessionWorkLogs.mockReturnValue([
        { id: '1', type: 'tool_use', tool: 'Read', summary: 'Reading file.js' },
        { id: '2', type: 'tool_use', tool: 'Write', summary: 'Writing output.js' },
      ]);

      const wrapper = mountComponent();
      const entries = wrapper.findAll('.log-entry');
      expect(entries).toHaveLength(2);
    });

    it('renders partial text preview when streaming', () => {
      mockStreamingStore.getSessionPartialText.mockReturnValue('Hello streaming world');

      const wrapper = mountComponent();
      expect(wrapper.find('.log-partial').exists()).toBe(true);
      expect(wrapper.find('.log-partial').text()).toBe('Hello streaming world');
    });

    it('renders thinking preview when streaming', () => {
      mockStreamingStore.getPartialThinking.mockReturnValue('Let me think about this...');

      const wrapper = mountComponent();
      expect(wrapper.find('.log-thinking').exists()).toBe(true);
      expect(wrapper.find('.log-thinking').text()).toBe('Let me think about this...');
    });

    it('truncates thinking preview to last 500 chars', () => {
      const longThinking = 'A'.repeat(600);
      mockStreamingStore.getPartialThinking.mockReturnValue(longThinking);

      const wrapper = mountComponent();
      expect(wrapper.find('.log-thinking').text()).toHaveLength(500);
    });

    it('truncates partial text preview to last 500 chars', () => {
      const longText = 'B'.repeat(600);
      mockStreamingStore.getSessionPartialText.mockReturnValue(longText);

      const wrapper = mountComponent();
      expect(wrapper.find('.log-partial').text()).toHaveLength(500);
    });

    it('shows "Live Output" header when expanded and has content', () => {
      mockStreamingStore.getSessionWorkLogs.mockReturnValue([
        { id: '1', type: 'tool_use', tool: 'Read', summary: 'test' },
      ]);

      const wrapper = mountComponent();
      expect(wrapper.find('.log-header-label').text()).toBe('Live Output');
    });

    it('shows "Show live output" when collapsed and has content', () => {
      mockStreamingStore.getSessionWorkLogs.mockReturnValue([
        { id: '1', type: 'tool_use', tool: 'Read', summary: 'test' },
      ]);
      mockStreamingStore.isSessionLogCollapsed.mockReturnValue(true);

      const wrapper = mountComponent();
      expect(wrapper.find('.log-collapsed-label').text()).toBe('Show live output');
      expect(wrapper.find('.session-log-stream').exists()).toBe(false);
    });

    it('shows tool_use log entries with tool name', () => {
      mockStreamingStore.getSessionWorkLogs.mockReturnValue([
        { id: '1', type: 'tool_use', tool: 'Bash', summary: 'Running command' },
      ]);

      const wrapper = mountComponent();
      expect(wrapper.find('.log-tool').text()).toContain('Bash');
    });

    it('shows log summary text', () => {
      mockStreamingStore.getSessionWorkLogs.mockReturnValue([
        { id: '1', type: 'tool_use', tool: 'Read', summary: 'Reading config file' },
      ]);

      const wrapper = mountComponent();
      expect(wrapper.find('.log-summary').text()).toBe('Reading config file');
    });

    it('hides component entirely when no content even if not collapsed', () => {
      mockStreamingStore.isSessionLogCollapsed.mockReturnValue(false);
      // No content at all
      const wrapper = mountComponent();
      expect(wrapper.find('.session-log-stream').exists()).toBe(false);
      expect(wrapper.find('.log-collapsed').exists()).toBe(false);
    });
  });

  describe('interaction', () => {
    it('clicking collapse toggle calls toggleSessionLogCollapsed with first sessionId', async () => {
      mockStreamingStore.getSessionWorkLogs.mockReturnValue([
        { id: '1', type: 'tool_use', tool: 'Read', summary: 'test' },
      ]);

      const wrapper = mountComponent({ sessionIds: ['session-42'] });
      await wrapper.find('.log-header').trigger('click');

      expect(mockStreamingStore.toggleSessionLogCollapsed).toHaveBeenCalledWith('session-42');
    });

    it('clicking collapsed bar calls toggleSessionLogCollapsed', async () => {
      mockStreamingStore.getSessionWorkLogs.mockReturnValue([
        { id: '1', type: 'tool_use', tool: 'Read', summary: 'test' },
      ]);
      mockStreamingStore.isSessionLogCollapsed.mockReturnValue(true);

      const wrapper = mountComponent({ sessionIds: ['session-42'] });
      await wrapper.find('.log-collapsed').trigger('click');

      expect(mockStreamingStore.toggleSessionLogCollapsed).toHaveBeenCalledWith('session-42');
    });
  });

  describe('multiple sessionIds', () => {
    it('merges work logs from multiple sessions', () => {
      mockStreamingStore.getSessionWorkLogs.mockImplementation((id) => {
        if (id === 'session-a') return [{ id: 'a1', type: 'tool_use', tool: 'Read', summary: 'From A' }];
        if (id === 'session-b') return [{ id: 'b1', type: 'tool_use', tool: 'Write', summary: 'From B' }];
        return [];
      });

      const wrapper = mountComponent({ sessionIds: ['session-a', 'session-b'] });
      const entries = wrapper.findAll('.log-entry');
      expect(entries).toHaveLength(2);
    });

    it('caps merged logs at 15 entries', () => {
      const logsA = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, type: 'tool_use', tool: 'Read', summary: `A${i}` }));
      const logsB = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, type: 'tool_use', tool: 'Write', summary: `B${i}` }));

      mockStreamingStore.getSessionWorkLogs.mockImplementation((id) => {
        if (id === 'session-a') return logsA;
        if (id === 'session-b') return logsB;
        return [];
      });

      const wrapper = mountComponent({ sessionIds: ['session-a', 'session-b'] });
      const entries = wrapper.findAll('.log-entry');
      expect(entries).toHaveLength(15);
    });

    it('shows partial text from the first session that has it', () => {
      mockStreamingStore.getSessionPartialText.mockImplementation((id) => {
        if (id === 'session-a') return '';
        if (id === 'session-b') return 'Partial from B';
        return '';
      });

      const wrapper = mountComponent({ sessionIds: ['session-a', 'session-b'] });
      expect(wrapper.find('.log-partial').text()).toBe('Partial from B');
    });

    it('shows thinking from the first session that has it', () => {
      mockStreamingStore.getPartialThinking.mockImplementation((id) => {
        if (id === 'session-a') return null;
        if (id === 'session-b') return 'Thinking from B';
        return null;
      });

      const wrapper = mountComponent({ sessionIds: ['session-a', 'session-b'] });
      expect(wrapper.find('.log-thinking').text()).toBe('Thinking from B');
    });

    it('uses first sessionId for collapse state', () => {
      mockStreamingStore.getSessionWorkLogs.mockReturnValue([
        { id: '1', type: 'tool_use', tool: 'Read', summary: 'test' },
      ]);
      mockStreamingStore.isSessionLogCollapsed.mockImplementation((id) => id === 'root-session');

      const wrapper = mountComponent({ sessionIds: ['root-session', 'child-session'] });
      expect(wrapper.find('.session-log-stream').exists()).toBe(false);
      expect(wrapper.find('.log-collapsed').exists()).toBe(true);
    });
  });
});
