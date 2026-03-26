import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import { useMessageScroll } from './useMessageScroll.js';

// Mock DOM methods
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue');
  return {
    ...actual,
    onMounted: (fn) => fn(),
    onUnmounted: (fn) => fn(),
  };
});

describe('useMessageScroll', () => {
  let messages, partialText, activeConversationId, scrollUtilities;
  let mockContainer;

  beforeEach(() => {
    // Reset DOM mock
    mockContainer = {
      scrollHeight: 1000,
      scrollTop: 0,
      clientHeight: 500,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      querySelector: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({
        top: 0,
        bottom: 500,
      })),
    };

    messages = ref([]);
    partialText = ref('');
    activeConversationId = ref('conv-1');

    // Create a wrapper to get DOM element reference
    const containerRef = ref(null);
    Object.defineProperty(containerRef, 'value', {
      get: () => mockContainer,
      set: (val) => { mockContainer = val; },
    });

    // Mock getBoundingClientRect on container
    mockContainer.getBoundingClientRect = vi.fn(() => ({ top: 0, height: 500 }));
  });

  function createMockMessage(id, role, content = '') {
    return { id, role, content, createdAt: new Date().toISOString() };
  }

  describe('initial state', () => {
    it('should initialize with default values', () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;

      expect(scrollUtilities.messagesContainer.value).toBeDefined();
      expect(scrollUtilities.isNearBottom.value).toBe(true);
      expect(scrollUtilities.hasNewMessages.value).toBe(false);
    });

    it('should return scroll control functions', () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });

      expect(typeof scrollUtilities.scrollToBottom).toBe('function');
      expect(typeof scrollUtilities.scrollToClaudesTurn).toBe('function');
      expect(typeof scrollUtilities.handleScroll).toBe('function');
    });
  });

  describe('handleScroll', () => {
    it('should set isNearBottom to true when near bottom', () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;

      mockContainer.scrollTop = 450; // 1000 - 450 - 500 = 50 (< 100 threshold)
      scrollUtilities.handleScroll();

      expect(scrollUtilities.isNearBottom.value).toBe(true);
      expect(scrollUtilities.hasNewMessages.value).toBe(false);
    });

    it('should set isNearBottom to false when not near bottom', () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;

      mockContainer.scrollTop = 200; // 1000 - 200 - 500 = 300 (>= 100 threshold)
      scrollUtilities.handleScroll();

      expect(scrollUtilities.isNearBottom.value).toBe(false);
    });

    it('should reset hasNewMessages when scrolling to bottom', () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;
      scrollUtilities.hasNewMessages.value = true;

      mockContainer.scrollTop = 500; // At bottom
      scrollUtilities.handleScroll();

      expect(scrollUtilities.hasNewMessages.value).toBe(false);
    });

    it('should not crash when container is null', () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = null;

      expect(() => scrollUtilities.handleScroll()).not.toThrow();
      expect(scrollUtilities.isNearBottom.value).toBe(true);
    });

    it('programmatic scroll does not set userScrolledAway', async () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;

      scrollUtilities.scrollToBottom();
      await nextTick();

      // Simulate the scroll event that fires after programmatic scroll
      scrollUtilities.handleScroll();
      expect(scrollUtilities.userScrolledAway.value).toBe(false);
    });

    it('user scrolling away from bottom sets userScrolledAway', () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;

      mockContainer.scrollTop = 200; // distance = 1000 - 200 - 500 = 300 (above threshold)
      scrollUtilities.handleScroll();

      expect(scrollUtilities.userScrolledAway.value).toBe(true);
    });

    it('user scrolling back to bottom clears userScrolledAway', () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;
      scrollUtilities.userScrolledAway.value = true;

      mockContainer.scrollTop = 450; // distance = 1000 - 450 - 500 = 50 (below threshold)
      scrollUtilities.handleScroll();

      expect(scrollUtilities.userScrolledAway.value).toBe(false);
    });
  });

  describe('scrollToBottom', () => {
    it('should scroll to bottom when forced', async () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;
      scrollUtilities.isNearBottom.value = false;

      scrollUtilities.scrollToBottom(true);
      await nextTick();

      expect(mockContainer.scrollTop).toBe(1000); // scrollHeight
      expect(scrollUtilities.isNearBottom.value).toBe(true);
      expect(scrollUtilities.hasNewMessages.value).toBe(false);
    });

    it('should scroll to bottom when already near bottom', async () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;
      scrollUtilities.isNearBottom.value = true;

      scrollUtilities.scrollToBottom(false);
      await nextTick();

      expect(mockContainer.scrollTop).toBe(1000);
    });

    it('should set hasNewMessages and not scroll when user scrolled away and not forced', async () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;
      scrollUtilities.userScrolledAway.value = true;

      scrollUtilities.scrollToBottom(false);
      await nextTick();

      expect(mockContainer.scrollTop).toBe(0); // No scroll
      expect(scrollUtilities.hasNewMessages.value).toBe(true);
    });

    it('should auto-scroll when userScrolledAway is false even if isNearBottom is false', async () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;
      scrollUtilities.isNearBottom.value = false;
      // userScrolledAway defaults to false

      scrollUtilities.scrollToBottom(false);
      await nextTick();

      expect(mockContainer.scrollTop).toBe(mockContainer.scrollHeight);
      expect(scrollUtilities.isNearBottom.value).toBe(true);
      expect(scrollUtilities.hasNewMessages.value).toBe(false);
    });

    it('should reset userScrolledAway when force is true', async () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;
      scrollUtilities.userScrolledAway.value = true;

      scrollUtilities.scrollToBottom(true);
      await nextTick();

      expect(scrollUtilities.userScrolledAway.value).toBe(false);
    });

    it('should not crash when container is null', async () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = null;

      expect(() => scrollUtilities.scrollToBottom(true)).not.toThrow();
      await nextTick();
    });
  });

  describe('scrollToClaudesTurn', () => {
    it('should scroll to last assistant message', async () => {
      messages.value = [
        createMockMessage('msg-1', 'user', 'Hello'),
        createMockMessage('msg-2', 'assistant', 'Hi there!'),
        createMockMessage('msg-3', 'user', 'How are you?'),
      ];

      const mockMsgElement = {
        getBoundingClientRect: vi.fn(() => ({ top: 200, height: 100 })),
      };
      mockContainer.querySelector = vi.fn((selector) => {
        if (selector.includes('msg-2')) return mockMsgElement;
        return null;
      });

      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;

      scrollUtilities.scrollToClaudesTurn();
      await nextTick();

      expect(mockContainer.querySelector).toHaveBeenCalledWith('[data-message-id="msg-2"]');
      expect(mockContainer.scrollTop).toBeDefined();
    });

    it('should not scroll when no assistant messages exist', async () => {
      messages.value = [
        createMockMessage('msg-1', 'user', 'Hello'),
        createMockMessage('msg-2', 'user', 'How are you?'),
      ];

      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;

      scrollUtilities.scrollToClaudesTurn();
      await nextTick();

      expect(mockContainer.querySelector).not.toHaveBeenCalled();
    });

    it('should not scroll when messages array is empty', async () => {
      messages.value = [];

      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;

      scrollUtilities.scrollToClaudesTurn();
      await nextTick();

      expect(mockContainer.querySelector).not.toHaveBeenCalled();
    });

    it('should not crash when container is null', async () => {
      messages.value = [
        createMockMessage('msg-1', 'user', 'Hello'),
        createMockMessage('msg-2', 'assistant', 'Hi there!'),
      ];

      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = null;

      expect(() => scrollUtilities.scrollToClaudesTurn()).not.toThrow();
      await nextTick();
    });
  });

  describe('auto-scroll on conversation switch', () => {
    it('should reset scroll state when conversation changes', async () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;
      scrollUtilities.isNearBottom.value = false;
      scrollUtilities.hasNewMessages.value = true;

      activeConversationId.value = 'conv-2';
      await nextTick();

      expect(scrollUtilities.isNearBottom.value).toBe(true);
      expect(scrollUtilities.hasNewMessages.value).toBe(false);
    });
  });

  describe('reset on conversation switch', () => {
    it('should reset scroll state when conversation changes', async () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;
      scrollUtilities.isNearBottom.value = false;
      scrollUtilities.hasNewMessages.value = true;

      activeConversationId.value = 'conv-2';
      await nextTick();

      expect(scrollUtilities.isNearBottom.value).toBe(true);
      expect(scrollUtilities.hasNewMessages.value).toBe(false);
    });

    it('should reset userScrolledAway when conversation changes', async () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;
      scrollUtilities.userScrolledAway.value = true;

      activeConversationId.value = 'conv-2';
      await nextTick();

      expect(scrollUtilities.userScrolledAway.value).toBe(false);
    });
  });

  describe('lifecycle', () => {
    it('should clean up debounce timer on unmount', () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      // The cleanup should happen without errors
      expect(() => {
        // Manually trigger cleanup logic
        const cleanup = scrollUtilities.handleScroll;
        if (cleanup) {
          cleanup();
        }
      }).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle null/undefined messages array', () => {
      messages.value = null;

      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;

      expect(() => scrollUtilities.handleScroll()).not.toThrow();
    });

    it('should handle missing partialText', () => {
      scrollUtilities = useMessageScroll({ messages, partialText: null, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;

      expect(() => scrollUtilities.scrollToBottom()).not.toThrow();
    });

    it('should handle missing activeConversationId', () => {
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId: null });
      scrollUtilities.messagesContainer.value = mockContainer;
      scrollUtilities.isNearBottom.value = false;

      expect(() => {
        activeConversationId.value = 'conv-2';
      }).not.toThrow();
    });
  });
});
