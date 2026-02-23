import { ref, nextTick } from 'vue';

const SCROLL_THRESHOLD = 100; // pixels from bottom to consider "at bottom"

/**
 * Composable for conversation message display helpers and scroll management.
 * Extracts formatting utilities and auto-scroll logic from ConversationTab.
 */
export function useConversationMessages() {
  const isNearBottom = ref(true);
  const hasNewMessages = ref(false);

  /**
   * Format a timestamp to a locale time string
   * @param {string|number} timestamp
   * @returns {string}
   */
  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString();
  }

  /**
   * Format model name for display
   * Converts "claude-3-5-sonnet-20241022" to "claude-3.5-sonnet"
   * @param {string} model - The model name
   * @returns {string} Formatted model name
   */
  function formatModelName(model) {
    if (!model) return '';
    return model
      .replace(/-(\d{8})$/, '')  // Remove date suffix
      .replace(/-(\d)-(\d)-/, '-$1.$2-');  // Convert 3-5 to 3.5
  }

  /**
   * Format file size in bytes to a human-readable string
   * @param {number} bytes
   * @returns {string}
   */
  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Get an icon for an attachment based on its MIME type
   * @param {string} mimeType
   * @returns {string}
   */
  function getAttachmentIcon(mimeType) {
    if (!mimeType) return '\u{1F4CE}';
    if (mimeType.startsWith('image/')) return '\u{1F5BC}\uFE0F';
    if (mimeType.startsWith('text/') || mimeType === 'application/json') return '\u{1F4C4}';
    if (mimeType === 'application/pdf') return '\u{1F4D5}';
    if (mimeType.includes('javascript') || mimeType.includes('typescript')) return '\u{1F4DC}';
    return '\u{1F4CE}';
  }

  /**
   * Handle the window scroll event to track near-bottom state
   */
  function handleScroll() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = window.innerHeight || document.documentElement.clientHeight;
    const wasNearBottom = isNearBottom.value;
    isNearBottom.value = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;

    // Clear new messages indicator when user scrolls to bottom
    if (isNearBottom.value && !wasNearBottom) {
      hasNewMessages.value = false;
    }
  }

  /**
   * Scroll to the bottom of the page. If force is true, always scrolls.
   * Otherwise, only scrolls if the user is already near the bottom.
   * @param {boolean} force
   */
  function scrollToBottom(force = false) {
    nextTick(() => {
      if (force || isNearBottom.value) {
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: 'smooth'
        });
        isNearBottom.value = true;
        hasNewMessages.value = false;
      } else {
        // User has scrolled up, mark that there are new messages
        hasNewMessages.value = true;
      }
    });
  }

  /**
   * Scroll to the last assistant message in the conversation
   * @param {Array} messages - The messages array from the store
   */
  function scrollToClaudesTurn(messages) {
    nextTick(() => {
      const lastAssistantIndex = messages.findLastIndex(msg => msg.role === 'assistant');
      if (lastAssistantIndex < 0) return;

      const lastAssistantMsg = messages[lastAssistantIndex];
      const msgElement = document.querySelector(`[data-message-id="${lastAssistantMsg.id}"]`);

      if (msgElement) {
        const elementRect = msgElement.getBoundingClientRect();
        const scrollTop = window.pageYOffset + elementRect.top - 80; // 80px offset for header

        window.scrollTo({
          top: scrollTop,
          behavior: 'smooth'
        });
      }
    });
  }

  return {
    isNearBottom,
    hasNewMessages,
    formatTime,
    formatModelName,
    formatFileSize,
    getAttachmentIcon,
    handleScroll,
    scrollToBottom,
    scrollToClaudesTurn,
  };
}
