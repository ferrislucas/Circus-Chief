import { ref, nextTick, onMounted, onUnmounted, watch } from 'vue';

/**
 * Composable for managing message scroll behavior in conversation view.
 * Handles auto-scrolling, scroll position tracking, and new message detection.
 *
 * @param {Object} options
 * @param {import('vue').Ref<Array>} options.messages - Reactive messages array
 * @param {import('vue').Ref<string>} options.partialText - Streaming partial text
 * @param {import('vue').Ref<string|null>} options.activeConversationId - Active conversation ID
 * @returns {Object} Scroll management utilities
 */
export function useMessageScroll({ messages, partialText, activeConversationId }) {
  const messagesContainer = ref(null);
  const isNearBottom = ref(true);
  const hasNewMessages = ref(false);
  let debounceTimer = null;
  const SCROLL_THRESHOLD = 100; // pixels from bottom

  function handleScroll() {
    if (!messagesContainer.value) return;
    const el = messagesContainer.value;
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
      if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
        isNearBottom.value = true;
        hasNewMessages.value = false;
      }
    });
  }

  function scrollToClaudesTurn() {
    nextTick(() => {
      if (!messagesContainer.value) return;

      // Find last assistant message
      const msgArray = messages.value || [];
      const lastAssistantIdx = findLastIndex(msgArray, (m) => m.role === 'assistant');
      if (lastAssistantIdx < 0) return;

      const lastAssistantMsg = msgArray[lastAssistantIdx];
      const el = messagesContainer.value.querySelector(
        `[data-message-id="${lastAssistantMsg.id}"]`
      );
      if (!el) return;

      // Scroll so the message is near the top of the visible area
      const containerRect = messagesContainer.value.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const scrollOffset = elRect.top - containerRect.top + messagesContainer.value.scrollTop - 16;
      messagesContainer.value.scrollTop = scrollOffset;
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
    if (messagesContainer.value) {
      messagesContainer.value.addEventListener('scroll', handleScroll, { passive: true });
    }
  });

  onUnmounted(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    if (messagesContainer.value) {
      messagesContainer.value.removeEventListener('scroll', handleScroll);
    }
  });

  return {
    messagesContainer,
    isNearBottom,
    hasNewMessages,
    scrollToBottom,
    scrollToClaudesTurn,
    handleScroll,
  };
}
