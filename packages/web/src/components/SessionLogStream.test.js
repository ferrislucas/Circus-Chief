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
      props: { sessionId: 'session-1', ...props },
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

    it('truncates thinking preview to last 200 chars', () => {
      const longThinking = 'A'.repeat(300);
      mockStreamingStore.getPartialThinking.mockReturnValue(longThinking);

      const wrapper = mountComponent();
      expect(wrapper.find('.log-thinking').text()).toHaveLength(200);
    });

    it('truncates partial text preview to last 200 chars', () => {
      const longText = 'B'.repeat(300);
      mockStreamingStore.getSessionPartialText.mockReturnValue(longText);

      const wrapper = mountComponent();
      expect(wrapper.find('.log-partial').text()).toHaveLength(200);
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
    it('clicking collapse toggle calls toggleSessionLogCollapsed with correct sessionId', async () => {
      mockStreamingStore.getSessionWorkLogs.mockReturnValue([
        { id: '1', type: 'tool_use', tool: 'Read', summary: 'test' },
      ]);

      const wrapper = mountComponent({ sessionId: 'session-42' });
      await wrapper.find('.log-header').trigger('click');

      expect(mockStreamingStore.toggleSessionLogCollapsed).toHaveBeenCalledWith('session-42');
    });

    it('clicking collapsed bar calls toggleSessionLogCollapsed', async () => {
      mockStreamingStore.getSessionWorkLogs.mockReturnValue([
        { id: '1', type: 'tool_use', tool: 'Read', summary: 'test' },
      ]);
      mockStreamingStore.isSessionLogCollapsed.mockReturnValue(true);

      const wrapper = mountComponent({ sessionId: 'session-42' });
      await wrapper.find('.log-collapsed').trigger('click');

      expect(mockStreamingStore.toggleSessionLogCollapsed).toHaveBeenCalledWith('session-42');
    });
  });
});
