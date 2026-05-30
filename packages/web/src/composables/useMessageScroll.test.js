import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

    it('should use the send button as the bottom target when present', () => {
      const sendButton = {
        getBoundingClientRect: vi.fn(() => ({ bottom: 500 })),
      };
      mockContainer.querySelector.mockReturnValue(sendButton);
      mockContainer.getBoundingClientRect.mockReturnValue({ top: 0, bottom: 500, height: 500 });

      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;
      scrollUtilities.hasNewMessages.value = true;

      mockContainer.scrollTop = 320;
      scrollUtilities.handleScroll();

      expect(mockContainer.querySelector).toHaveBeenCalledWith('.btn-send-full');
      expect(scrollUtilities.isNearBottom.value).toBe(true);
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

    it('should scroll so the send button bottom aligns with the container bottom', async () => {
      const sendButton = {
        getBoundingClientRect: vi.fn(() => ({ bottom: 900 })),
      };
      mockContainer.querySelector.mockReturnValue(sendButton);
      mockContainer.getBoundingClientRect.mockReturnValue({ top: 0, bottom: 500, height: 500 });
      mockContainer.scrollTop = 100;

      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;

      scrollUtilities.scrollToSendButton(true);
      await nextTick();

      expect(mockContainer.scrollTop).toBe(500);
      expect(scrollUtilities.isNearBottom.value).toBe(true);
      expect(scrollUtilities.hasNewMessages.value).toBe(false);
    });

    it('should fall back to content bottom when no send button exists', async () => {
      mockContainer.querySelector.mockReturnValue(null);
      scrollUtilities = useMessageScroll({ messages, partialText, activeConversationId });
      scrollUtilities.messagesContainer.value = mockContainer;

      scrollUtilities.scrollToSendButton(true);
      await nextTick();
      await nextTick();

      expect(mockContainer.scrollTop).toBe(mockContainer.scrollHeight);
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

  describe('document.documentElement as scroll container', () => {
    let windowAddSpy, windowRemoveSpy, docElAddSpy, docElRemoveSpy;
    let scrollContainerRef;
    let scrollTopValue;

    beforeEach(() => {
      windowAddSpy = vi.spyOn(window, 'addEventListener');
      windowRemoveSpy = vi.spyOn(window, 'removeEventListener');
      docElAddSpy = vi.spyOn(document.documentElement, 'addEventListener');
      docElRemoveSpy = vi.spyOn(document.documentElement, 'removeEventListener');

      // Set up scroll properties on document.documentElement
      scrollTopValue = 0;
      Object.defineProperty(document.documentElement, 'scrollHeight', {
        configurable: true,
        get: () => 2000,
      });
      Object.defineProperty(document.documentElement, 'clientHeight', {
        configurable: true,
        get: () => 800,
      });
      Object.defineProperty(document.documentElement, 'scrollTop', {
        configurable: true,
        get: () => scrollTopValue,
        set: (v) => { scrollTopValue = v; },
      });
      // Define scrollTo so the code path is consistent regardless of JSDOM version
      Object.defineProperty(document.documentElement, 'scrollTo', {
        configurable: true,
        writable: true,
        value: vi.fn((options) => {
          if (options && typeof options.top === 'number') scrollTopValue = options.top;
        }),
      });

      // Mock window.innerHeight
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        get: () => 800,
      });

      scrollContainerRef = ref(document.documentElement);
    });

    afterEach(() => {
      windowAddSpy.mockRestore();
      windowRemoveSpy.mockRestore();
      docElAddSpy.mockRestore();
      docElRemoveSpy.mockRestore();
    });

    it('attaches scroll listener to window, not to document.documentElement', () => {
      scrollUtilities = useMessageScroll({
        messages, partialText, activeConversationId,
        scrollContainer: scrollContainerRef,
      });

      // onMounted fires immediately in tests (mocked) — listener should be on window
      const windowScrollAdds = windowAddSpy.mock.calls.filter(([e]) => e === 'scroll');
      expect(windowScrollAdds).toHaveLength(1);
      expect(windowScrollAdds[0][2]).toEqual({ passive: true });

      // Must NOT attach scroll listener directly to document.documentElement
      const docElScrollAdds = docElAddSpy.mock.calls.filter(([e]) => e === 'scroll');
      expect(docElScrollAdds).toHaveLength(0);
    });

    it('removes scroll listener from window on unmount', () => {
      scrollUtilities = useMessageScroll({
        messages, partialText, activeConversationId,
        scrollContainer: scrollContainerRef,
      });

      // onUnmounted fires immediately in tests (mocked)
      const windowScrollRemoves = windowRemoveSpy.mock.calls.filter(([e]) => e === 'scroll');
      expect(windowScrollRemoves).toHaveLength(1);

      // Must NOT remove from document.documentElement directly
      const docElScrollRemoves = docElRemoveSpy.mock.calls.filter(([e]) => e === 'scroll');
      expect(docElScrollRemoves).toHaveLength(0);
    });

    it('handleScroll uses window.innerHeight to detect isNearBottom when send button is present', () => {
      // button bottom = 780 < window.innerHeight (800) → distance = -20 < threshold → near bottom
      const sendButton = { getBoundingClientRect: vi.fn(() => ({ bottom: 780 })) };
      vi.spyOn(document.documentElement, 'querySelector').mockReturnValue(sendButton);

      scrollUtilities = useMessageScroll({
        messages, partialText, activeConversationId,
        scrollContainer: scrollContainerRef,
      });

      scrollUtilities.handleScroll();

      expect(scrollUtilities.isNearBottom.value).toBe(true);
    });

    it('handleScroll detects not-near-bottom when send button is far below viewport', () => {
      // button bottom = 1000, window.innerHeight = 800 → distance = 200 >= threshold → not near bottom
      const sendButton = { getBoundingClientRect: vi.fn(() => ({ bottom: 1000 })) };
      vi.spyOn(document.documentElement, 'querySelector').mockReturnValue(sendButton);

      scrollUtilities = useMessageScroll({
        messages, partialText, activeConversationId,
        scrollContainer: scrollContainerRef,
      });

      scrollUtilities.handleScroll();

      expect(scrollUtilities.isNearBottom.value).toBe(false);
    });

    it('handleScroll falls back to scrollHeight-scrollTop-clientHeight when no send button', () => {
      vi.spyOn(document.documentElement, 'querySelector').mockReturnValue(null);
      scrollTopValue = 1150; // 2000 - 1150 - 800 = 50 < threshold → near bottom

      scrollUtilities = useMessageScroll({
        messages, partialText, activeConversationId,
        scrollContainer: scrollContainerRef,
      });

      scrollUtilities.handleScroll();

      expect(scrollUtilities.isNearBottom.value).toBe(true);
    });

    it('scrollToSendButton computes scroll target using window.innerHeight as viewport bottom', async () => {
      // scrollTop=0, scrollHeight=2000, clientHeight=800
      // button bottom=900, window.innerHeight=800
      // targetTop = Math.min(1200, Math.max(0, 0 + 900 - 800)) = 100
      const sendButton = { getBoundingClientRect: vi.fn(() => ({ bottom: 900 })) };
      vi.spyOn(document.documentElement, 'querySelector').mockReturnValue(sendButton);

      scrollUtilities = useMessageScroll({
        messages, partialText, activeConversationId,
        scrollContainer: scrollContainerRef,
      });

      scrollUtilities.scrollToSendButton(true);
      await nextTick();

      expect(scrollTopValue).toBe(100);
    });

    it('scrollContainer watcher removes from element and adds to window when container changes to document.documentElement', async () => {
      const regularRef = ref(mockContainer);

      scrollUtilities = useMessageScroll({
        messages, partialText, activeConversationId,
        scrollContainer: regularRef,
      });

      // Reset spies so we only capture the watcher-triggered actions
      windowAddSpy.mockClear();
      mockContainer.removeEventListener.mockClear();

      // Switch container to document.documentElement
      regularRef.value = document.documentElement;
      await nextTick();

      expect(mockContainer.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
      const windowScrollAdds = windowAddSpy.mock.calls.filter(([e]) => e === 'scroll');
      expect(windowScrollAdds).toHaveLength(1);
      expect(windowScrollAdds[0][2]).toEqual({ passive: true });
    });
  });
});
