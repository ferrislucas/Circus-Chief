import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import ConversationSelector from './ConversationSelector.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

// Mock the stores
vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(),
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(),
}));

describe('ConversationSelector', () => {
  let mockSessionsStore;
  let mockUiStore;
  let confirmSpy;

  const baseConversations = [
    { id: 'conv-1', name: 'First Conversation', isActive: false, messageCount: 5 },
    { id: 'conv-2', name: 'Second Conversation', isActive: true, messageCount: 10 },
    { id: 'conv-3', name: 'Third Conversation', isActive: false, messageCount: 3 },
  ];

  beforeEach(() => {
    setActivePinia(createPinia());

    mockSessionsStore = {
      conversations: [...baseConversations],
      activeConversationId: 'conv-2',
      activeConversation: baseConversations[1],
      currentSession: { id: 'session-123', status: 'waiting' },
      switchConversation: vi.fn().mockResolvedValue(undefined),
      createConversation: vi.fn().mockResolvedValue({ id: 'conv-new', name: null }),
      deleteConversation: vi.fn().mockResolvedValue(undefined),
    };

    mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };

    vi.mocked(useSessionsStore).mockReturnValue(mockSessionsStore);
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);
  });

  afterEach(() => {
    if (confirmSpy) {
      confirmSpy.mockRestore();
      confirmSpy = null;
    }
    vi.clearAllMocks();
  });

  function mountComponent(props = {}) {
    return mount(ConversationSelector, {
      props: {
        sessionId: 'session-123',
        ...props,
      },
    });
  }

  describe('basic rendering', () => {
    it('renders the dropdown trigger with active conversation name', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.dropdown-label').text()).toBe('Second Conversation');
    });

    it('renders the new conversation button', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.btn-new').exists()).toBe(true);
      expect(wrapper.find('.btn-new').text()).toContain('new conversation');
    });

    it('shows dropdown arrow when not disabled', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.dropdown-arrow').exists()).toBe(true);
    });
  });

  describe('disabled state', () => {
    beforeEach(() => {
      mockSessionsStore.currentSession = { id: 'session-123', status: 'running' };
    });

    it('disables dropdown when session is running', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.dropdown-trigger').attributes('disabled')).toBeDefined();
    });

    it('disables new conversation button when session is running', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.btn-new').attributes('disabled')).toBeDefined();
    });

    it('shows lock icon when disabled', () => {
      const wrapper = mountComponent();
      expect(wrapper.findAll('.lock-icon').length).toBeGreaterThan(0);
    });

    it('does not open dropdown when clicking disabled trigger', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      expect(wrapper.find('.dropdown-menu').exists()).toBe(false);
    });
  });

  describe('dropdown interaction', () => {
    it('opens dropdown when clicked', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      expect(wrapper.find('.dropdown-menu').exists()).toBe(true);
    });

    it('shows all conversations in dropdown', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      expect(items.length).toBe(3);
    });

    it('marks active conversation in dropdown', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const activeItem = wrapper.find('.dropdown-item.active');
      expect(activeItem.exists()).toBe(true);
      expect(activeItem.find('.conv-name').text()).toBe('Second Conversation');
    });

    it('shows message count for each conversation', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      expect(items[0].find('.conv-meta').text()).toContain('5 msgs');
      expect(items[1].find('.conv-meta').text()).toContain('10 msgs');
    });

    it('shows delete button for non-active conversations', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      expect(items[0].find('.delete-btn').exists()).toBe(true);
      expect(items[1].find('.delete-btn').exists()).toBe(false);
    });
  });

  describe('switching conversations', () => {
    it('calls switchConversation when selecting different conversation', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      await items[0].trigger('click');
      await flushPromises();

      expect(mockSessionsStore.switchConversation).toHaveBeenCalledWith('session-123', 'conv-1');
    });

    it('closes dropdown after selecting conversation', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();
      expect(wrapper.find('.dropdown-menu').exists()).toBe(true);

      const items = wrapper.findAll('.dropdown-item');
      await items[0].trigger('click');
      await flushPromises();
      await nextTick();

      expect(wrapper.find('.dropdown-menu').exists()).toBe(false);
    });

    it('does not call switchConversation when selecting same conversation', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      await items[1].trigger('click');
      await flushPromises();

      expect(mockSessionsStore.switchConversation).not.toHaveBeenCalled();
    });

    it('shows error message on switch failure', async () => {
      mockSessionsStore.switchConversation.mockRejectedValue(new Error('Switch failed'));

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      await items[0].trigger('click');
      await flushPromises();

      expect(mockUiStore.error).toHaveBeenCalledWith('Switch failed');
    });
  });

  describe('creating conversations', () => {
    it('calls createConversation when clicking new button', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.btn-new').trigger('click');
      await flushPromises();

      expect(mockSessionsStore.createConversation).toHaveBeenCalledWith('session-123');
    });

    it('shows success message after creating conversation', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.btn-new').trigger('click');
      await flushPromises();

      expect(mockUiStore.success).toHaveBeenCalledWith('New conversation created');
    });

    it('shows error message on create failure', async () => {
      mockSessionsStore.createConversation.mockRejectedValue(new Error('Create failed'));

      const wrapper = mountComponent();
      await wrapper.find('.btn-new').trigger('click');
      await flushPromises();

      expect(mockUiStore.error).toHaveBeenCalledWith('Create failed');
    });
  });

  describe('deleting conversations', () => {
    it('shows confirmation dialog before deleting', async () => {
      confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const deleteBtn = wrapper.find('.delete-btn');
      await deleteBtn.trigger('click');
      await flushPromises();

      expect(confirmSpy).toHaveBeenCalled();
    });

    it('calls deleteConversation when confirmed', async () => {
      confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const deleteBtn = wrapper.find('.delete-btn');
      await deleteBtn.trigger('click');
      await flushPromises();

      expect(mockSessionsStore.deleteConversation).toHaveBeenCalledWith('session-123', 'conv-1');
    });

    it('does not delete when cancelled', async () => {
      confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const deleteBtn = wrapper.find('.delete-btn');
      await deleteBtn.trigger('click');
      await flushPromises();

      expect(mockSessionsStore.deleteConversation).not.toHaveBeenCalled();
    });

    it('shows success message after deleting', async () => {
      confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const deleteBtn = wrapper.find('.delete-btn');
      await deleteBtn.trigger('click');
      await flushPromises();

      expect(mockUiStore.success).toHaveBeenCalledWith('Conversation deleted');
    });
  });

  describe('edge cases', () => {
    it('handles empty conversations list', () => {
      mockSessionsStore.conversations = [];
      mockSessionsStore.activeConversation = null;
      mockSessionsStore.activeConversationId = null;

      const wrapper = mountComponent();
      // When no conversations, dropdown is hidden but button still shows
      expect(wrapper.find('.btn-new').exists()).toBe(true);
    });

    it('shows button text with unnamed single conversation', () => {
      mockSessionsStore.conversations = [
        { id: 'conv-1', name: null, isActive: true, messageCount: 0 },
      ];
      mockSessionsStore.activeConversation = { id: 'conv-1', name: null };
      mockSessionsStore.activeConversationId = 'conv-1';

      const wrapper = mountComponent();
      // Dropdown is hidden with 1 conversation, so can only check the button
      expect(wrapper.find('.btn-new').text()).toContain('new conversation');
    });

    it('hides delete button when only one conversation exists', () => {
      mockSessionsStore.conversations = [
        { id: 'conv-1', name: 'Only One', isActive: true, messageCount: 5 },
      ];

      // With single conversation, dropdown is not rendered at all
      const wrapper = mountComponent();
      expect(wrapper.find('.delete-btn').exists()).toBe(false);
    });

    it('hides dropdown container when only one conversation exists', () => {
      mockSessionsStore.conversations = [
        { id: 'conv-1', name: 'Only One', isActive: true, messageCount: 5 },
      ];

      const wrapper = mountComponent();
      expect(wrapper.find('.dropdown-container').exists()).toBe(false);
    });

    it('shows dropdown container when multiple conversations exist', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.dropdown-container').exists()).toBe(true);
    });
  });

  describe('ordinal conversation labels', () => {
    it('formats conversation names with ordinal numbers for unnamed conversations', async () => {
      mockSessionsStore.conversations = [
        { id: 'conv-1', name: null, isActive: false, messageCount: 0 },
        { id: 'conv-2', name: null, isActive: true, messageCount: 0 },
        { id: 'conv-3', name: null, isActive: false, messageCount: 0 },
      ];
      mockSessionsStore.activeConversation = mockSessionsStore.conversations[1];
      mockSessionsStore.activeConversationId = 'conv-2';

      const wrapper = mountComponent();
      expect(wrapper.find('.dropdown-label').text()).toBe('2nd conversation');

      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      expect(items[0].find('.conv-name').text()).toBe('1st conversation');
      expect(items[1].find('.conv-name').text()).toBe('2nd conversation');
      expect(items[2].find('.conv-name').text()).toBe('3rd conversation');
    });

    it('correctly formats ordinal numbers ending in 1 and 2', async () => {
      mockSessionsStore.conversations = [
        { id: 'conv-1', name: null, isActive: true, messageCount: 0 },
        { id: 'conv-2', name: null, isActive: false, messageCount: 0 },
        { id: 'conv-3', name: null, isActive: false, messageCount: 0 },
        { id: 'conv-4', name: null, isActive: false, messageCount: 0 },
        { id: 'conv-5', name: null, isActive: false, messageCount: 0 },
      ];
      mockSessionsStore.activeConversation = mockSessionsStore.conversations[0];
      mockSessionsStore.activeConversationId = 'conv-1';

      const wrapper = mountComponent();
      expect(wrapper.find('.dropdown-label').text()).toBe('1st conversation');

      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      expect(items[0].find('.conv-name').text()).toBe('1st conversation');
      expect(items[1].find('.conv-name').text()).toBe('2nd conversation');
      expect(items[2].find('.conv-name').text()).toBe('3rd conversation');
      expect(items[3].find('.conv-name').text()).toBe('4th conversation');
      expect(items[4].find('.conv-name').text()).toBe('5th conversation');
    });

    it('correctly formats ordinal numbers ending in 11, 12, 13', async () => {
      // Create 15 conversations to test indices 10, 11, 12 (which are 11th, 12th, 13th)
      const conversations = Array.from({ length: 15 }, (_, i) => ({
        id: `conv-${i}`,
        name: null,
        isActive: i === 0,
        messageCount: 0,
      }));
      mockSessionsStore.conversations = conversations;
      mockSessionsStore.activeConversation = conversations[0];
      mockSessionsStore.activeConversationId = 'conv-0';

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      expect(items[10].find('.conv-name').text()).toBe('11th conversation');
      expect(items[11].find('.conv-name').text()).toBe('12th conversation');
      expect(items[12].find('.conv-name').text()).toBe('13th conversation');
    });

    it('preserves custom conversation names', async () => {
      mockSessionsStore.conversations = [
        { id: 'conv-1', name: 'My Custom Name', isActive: true, messageCount: 0 },
        { id: 'conv-2', name: 'Another Custom', isActive: false, messageCount: 0 },
        { id: 'conv-3', name: null, isActive: false, messageCount: 0 },
      ];
      mockSessionsStore.activeConversation = mockSessionsStore.conversations[0];
      mockSessionsStore.activeConversationId = 'conv-1';

      const wrapper = mountComponent();
      expect(wrapper.find('.dropdown-label').text()).toBe('My Custom Name');

      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      expect(items[0].find('.conv-name').text()).toBe('My Custom Name');
      expect(items[1].find('.conv-name').text()).toBe('Another Custom');
      expect(items[2].find('.conv-name').text()).toBe('3rd conversation');
    });
  });

  describe('token count display', () => {
    it('shows token count for each conversation in dropdown', async () => {
      mockSessionsStore.conversations = [
        { id: 'conv-1', name: 'First', isActive: false, messageCount: 5, inputTokens: 1000, outputTokens: 500 },
        { id: 'conv-2', name: 'Second', isActive: true, messageCount: 10, inputTokens: 5000, outputTokens: 2500 },
      ];
      mockSessionsStore.activeConversation = mockSessionsStore.conversations[1];
      mockSessionsStore.activeConversationId = 'conv-2';

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      expect(items[0].text()).toContain('1.5K');
      expect(items[1].text()).toContain('7.5K');
    });

    it('shows 0 tokens for conversations with no usage', async () => {
      mockSessionsStore.conversations = [
        { id: 'conv-1', name: 'Empty', isActive: false, messageCount: 0 },
        { id: 'conv-2', name: 'Second', isActive: true, messageCount: 5 },
      ];
      mockSessionsStore.activeConversation = mockSessionsStore.conversations[1];
      mockSessionsStore.activeConversationId = 'conv-2';

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      expect(items[0].find('.conv-meta').text()).toContain('0 msgs');
    });

    it('formats large token counts with K suffix', async () => {
      mockSessionsStore.conversations = [
        { id: 'conv-1', name: 'Large', isActive: false, messageCount: 20, inputTokens: 50000, outputTokens: 25000 },
        { id: 'conv-2', name: 'Second', isActive: true, messageCount: 5 },
      ];
      mockSessionsStore.activeConversation = mockSessionsStore.conversations[1];
      mockSessionsStore.activeConversationId = 'conv-2';

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      expect(items[0].text()).toContain('75.0K');
    });

    it('formats very large token counts with M suffix', async () => {
      mockSessionsStore.conversations = [
        { id: 'conv-1', name: 'Huge', isActive: false, messageCount: 100, inputTokens: 1500000, outputTokens: 500000 },
        { id: 'conv-2', name: 'Second', isActive: true, messageCount: 5 },
      ];
      mockSessionsStore.activeConversation = mockSessionsStore.conversations[1];
      mockSessionsStore.activeConversationId = 'conv-2';

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      expect(items[0].text()).toContain('2.0M');
    });

    it('handles missing token fields gracefully', async () => {
      mockSessionsStore.conversations = [
        { id: 'conv-1', name: 'Missing', isActive: false, messageCount: 5 },
        { id: 'conv-2', name: 'Second', isActive: true, messageCount: 5 },
      ];
      mockSessionsStore.activeConversation = mockSessionsStore.conversations[1];
      mockSessionsStore.activeConversationId = 'conv-2';

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      expect(items[0].exists()).toBe(true);
    });

    it('shows token count in meta section', async () => {
      mockSessionsStore.conversations = [
        { id: 'conv-1', name: 'Test', isActive: false, messageCount: 5, inputTokens: 2000, outputTokens: 1000 },
        { id: 'conv-2', name: 'Second', isActive: true, messageCount: 5 },
      ];
      mockSessionsStore.activeConversation = mockSessionsStore.conversations[1];
      mockSessionsStore.activeConversationId = 'conv-2';

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      await nextTick();

      const items = wrapper.findAll('.dropdown-item');
      const meta = items[0].find('.conv-meta');
      expect(meta.exists()).toBe(true);
      expect(meta.text()).toContain('3.0K');
    });
  });
});
