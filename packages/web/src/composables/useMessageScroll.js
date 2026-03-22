import { ref, nextTick, onMounted, onUnmounted, watch } from 'vue';

/**
 * Composable for managing message scroll behavior in conversation view.
 * Handles auto-scrolling, scroll position tracking, and new message detection.
 *
 * @param {Object} options
 * @param {import('vue').Ref<Array>} options.messages - Reactive messages array
 * @param {import('vue').Ref<string>} options.partialText - Streaming partial text
 * @param {import('vue').Ref<string|null>} options.activeConversationId - Active conversation ID
 * @param {import('vue').Ref<HTMLElement|null>} [options.scrollContainer] - Optional alternate scroll container
 * @returns {Object} Scroll management utilities
 */
export function useMessageScroll({ messages, partialText, activeConversationId, scrollContainer }) {
  const messagesContainer = ref(null);
  const isNearBottom = ref(true);
  const hasNewMessages = ref(false);
  let debounceTimer = null;
  const SCROLL_THRESHOLD = 100; // pixels from bottom

  /**
   * Resolve which element to use for scrolling.
   * When scrollContainer is provided (e.g. overlay's .overlay-body), use it.
   * Otherwise fall back to messagesContainer (the .messages div).
   */
  function getScrollEl() {
    return scrollContainer?.value || messagesContainer.value;
  }

  function handleScroll() {
    const el = getScrollEl();
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottom.value = distanceFromBottom < SCROLL_THRESHOLD;
    if (isNearBottom.value) {
      hasNewMessages.value = false;
    }
  }

  function scrollToBottom(force = false) {
    if (!force && !isNearBottom.value) {
      hasNewMessages.value = true;
      return;
    }

    nextTick(() => {
      const el = getScrollEl();
      if (el) {
        el.scrollTop = el.scrollHeight;
        isNearBottom.value = true;
        hasNewMessages.value = false;
      }
    });
  }

  function scrollToClaudesTurn() {
    nextTick(() => {
      const scrollEl = getScrollEl();
      if (!scrollEl) return;

      // Use messagesContainer for DOM queries (it contains the message elements)
      const queryEl = messagesContainer.value || scrollEl;

      // Find last assistant message
      const msgArray = messages.value || [];
      const lastAssistantIdx = findLastIndex(msgArray, (m) => m.role === 'assistant');
      if (lastAssistantIdx < 0) return;

      const lastAssistantMsg = msgArray[lastAssistantIdx];
      const el = queryEl.querySelector(
        `[data-message-id="${lastAssistantMsg.id}"]`
      );
      if (!el) return;

      // Scroll so the message is near the top of the visible area
      const containerRect = scrollEl.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const scrollOffset = elRect.top - containerRect.top + scrollEl.scrollTop - 16;
      scrollEl.scrollTop = scrollOffset;
    });
  }

  // Utility: find last index matching predicate
  function findLastIndex(arr, predicate) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (predicate(arr[i])) return i;
    }
    return -1;
  }

  // Auto-scroll when messages are added
  watch(
    () => (messages.value || []).length,
    (newLen, oldLen) => {
      if (oldLen === 0 && newLen > 0) {
        scrollToBottom(true);
      } else {
        scrollToBottom();
      }
    }
  );

  // Auto-scroll on streaming text
  watch(
    () => partialText?.value,
    () => {
      scrollToBottom();
    }
  );

  // Reset scroll state on conversation switch
  watch(
    () => activeConversationId?.value,
    () => {
      isNearBottom.value = true;
      hasNewMessages.value = false;
    }
  );

  // Lifecycle management
  onMounted(() => {
    const el = getScrollEl();
    if (el) {
      el.addEventListener('scroll', handleScroll, { passive: true });
    }
  });

  onUnmounted(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    const el = getScrollEl();
    if (el) {
      el.removeEventListener('scroll', handleScroll);
    }
  });

  // Re-attach scroll listener if scrollContainer changes after mount
  // (e.g. when the parent ref resolves after the child mounts)
  watch(
    () => scrollContainer?.value,
    (newEl, oldEl) => {
      if (oldEl) oldEl.removeEventListener('scroll', handleScroll);
      if (newEl) newEl.addEventListener('scroll', handleScroll, { passive: true });
    },
    { immediate: false }
  );

  return {
    messagesContainer,
    isNearBottom,
    hasNewMessages,
    scrollToBottom,
    scrollToClaudesTurn,
    handleScroll,
  };
}
