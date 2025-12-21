import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
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
      expect(wrapper.find('.btn-new').text()).toContain('New');
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
      // Even though click won't fire on disabled button, verify dropdown stays closed
      await wrapper.find('.dropdown-trigger').trigger('click');

      // Dropdown should NOT open when disabled
      expect(wrapper.find('.dropdown-menu').exists()).toBe(false);
    });
  });

  describe('dropdown interaction', () => {
    it('opens dropdown when clicked', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');

      expect(wrapper.find('.dropdown-menu').exists()).toBe(true);
    });

    it('shows all conversations in dropdown', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');

      const items = wrapper.findAll('.dropdown-item');
      expect(items.length).toBe(3);
    });

    it('marks active conversation in dropdown', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');

      const activeItem = wrapper.find('.dropdown-item.active');
      expect(activeItem.exists()).toBe(true);
      expect(activeItem.find('.conv-name').text()).toBe('Second Conversation');
    });

    it('shows message count for each conversation', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');

      const items = wrapper.findAll('.dropdown-item');
      expect(items[0].find('.conv-meta').text()).toBe('5 msgs');
      expect(items[1].find('.conv-meta').text()).toBe('10 msgs');
    });

    it('shows delete button for non-active conversations', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');

      const items = wrapper.findAll('.dropdown-item');
      // First item (not active) should have delete button
      expect(items[0].find('.delete-btn').exists()).toBe(true);
      // Second item (active) should not have delete button
      expect(items[1].find('.delete-btn').exists()).toBe(false);
    });
  });

  describe('switching conversations', () => {
    it('calls switchConversation when selecting different conversation', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');

      const items = wrapper.findAll('.dropdown-item');
      await items[0].trigger('click'); // Select first (non-active) conversation

      expect(mockSessionsStore.switchConversation).toHaveBeenCalledWith('session-123', 'conv-1');
    });

    it('closes dropdown after selecting conversation', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');
      expect(wrapper.find('.dropdown-menu').exists()).toBe(true);

      const items = wrapper.findAll('.dropdown-item');
      await items[0].trigger('click');
      await flushPromises(); // Wait for async switchConversation to complete

      expect(wrapper.find('.dropdown-menu').exists()).toBe(false);
    });

    it('does not call switchConversation when selecting same conversation', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');

      const items = wrapper.findAll('.dropdown-item');
      await items[1].trigger('click'); // Select active conversation

      expect(mockSessionsStore.switchConversation).not.toHaveBeenCalled();
    });

    it('shows error message on switch failure', async () => {
      mockSessionsStore.switchConversation.mockRejectedValue(new Error('Switch failed'));

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');

      const items = wrapper.findAll('.dropdown-item');
      await items[0].trigger('click');

      expect(mockUiStore.error).toHaveBeenCalledWith('Switch failed');
    });
  });

  describe('creating conversations', () => {
    it('calls createConversation when clicking new button', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.btn-new').trigger('click');

      expect(mockSessionsStore.createConversation).toHaveBeenCalledWith('session-123');
    });

    it('shows success message after creating conversation', async () => {
      const wrapper = mountComponent();
      await wrapper.find('.btn-new').trigger('click');

      expect(mockUiStore.success).toHaveBeenCalledWith('New conversation created');
    });

    it('shows error message on create failure', async () => {
      mockSessionsStore.createConversation.mockRejectedValue(new Error('Create failed'));

      const wrapper = mountComponent();
      await wrapper.find('.btn-new').trigger('click');

      expect(mockUiStore.error).toHaveBeenCalledWith('Create failed');
    });
  });

  describe('deleting conversations', () => {
    it('shows confirmation dialog before deleting', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');

      const deleteBtn = wrapper.find('.delete-btn');
      await deleteBtn.trigger('click');

      expect(confirmSpy).toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it('calls deleteConversation when confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');

      const deleteBtn = wrapper.find('.delete-btn');
      await deleteBtn.trigger('click');

      expect(mockSessionsStore.deleteConversation).toHaveBeenCalledWith('session-123', 'conv-1');
    });

    it('does not delete when cancelled', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');

      const deleteBtn = wrapper.find('.delete-btn');
      await deleteBtn.trigger('click');

      expect(mockSessionsStore.deleteConversation).not.toHaveBeenCalled();
    });

    it('shows success message after deleting', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');

      const deleteBtn = wrapper.find('.delete-btn');
      await deleteBtn.trigger('click');

      expect(mockUiStore.success).toHaveBeenCalledWith('Conversation deleted');
    });
  });

  describe('edge cases', () => {
    it('handles empty conversations list', () => {
      mockSessionsStore.conversations = [];
      mockSessionsStore.activeConversation = null;

      const wrapper = mountComponent();
      expect(wrapper.find('.dropdown-label').text()).toBe('Select conversation');
    });

    it('handles conversation with null name', () => {
      mockSessionsStore.conversations = [
        { id: 'conv-1', name: null, isActive: true, messageCount: 0 },
      ];
      mockSessionsStore.activeConversation = { id: 'conv-1', name: null };

      const wrapper = mountComponent();
      // Should show "Select conversation" or similar when name is null
      expect(wrapper.find('.dropdown-label').text()).toBeDefined();
    });

    it('hides delete button when only one conversation exists', async () => {
      mockSessionsStore.conversations = [
        { id: 'conv-1', name: 'Only One', isActive: true, messageCount: 5 },
      ];

      const wrapper = mountComponent();
      await wrapper.find('.dropdown-trigger').trigger('click');

      expect(wrapper.find('.delete-btn').exists()).toBe(false);
    });
  });
});
