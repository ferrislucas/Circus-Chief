/**
 * Composable for message formatting utilities.
 * Provides functions to format timestamps, model names, file sizes, and attachment icons.
 */
export function useMessageFormatting() {
  /**
   * Format a timestamp for display in message headers.
   * @param {string|number|Date} timestamp - The timestamp to format
   * @returns {string} Formatted time string
   */
  function formatTime(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString();
  }

  function parseValidDate(timestamp) {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /**
   * Format a timestamp date for display in message headers.
   * @param {string|number|Date} timestamp - The timestamp to format
   * @returns {string} Formatted date string
   */
  function formatMessageDate(timestamp) {
    const date = parseValidDate(timestamp);
    if (!date) return '';

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  /**
   * Check whether a timestamp is before today's local calendar date.
   * @param {string|number|Date} timestamp - The timestamp to compare
   * @param {Date} now - The date to compare against
   * @returns {boolean} True when timestamp is before today's local date
   */
  function isBeforeToday(timestamp, now = new Date()) {
    const date = parseValidDate(timestamp);
    const comparisonDate = parseValidDate(now);
    if (!date || !comparisonDate) return false;

    const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const today = new Date(
      comparisonDate.getFullYear(),
      comparisonDate.getMonth(),
      comparisonDate.getDate()
    );

    return messageDay < today;
  }

  /**
   * Format model name for display.
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
   * Format file size in human-readable form.
   * @param {number} bytes - File size in bytes
   * @returns {string} Formatted file size (e.g., "1.5 KB", "2.3 MB")
   */
  function formatFileSize(bytes) {
    if (bytes == null || bytes < 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Get an emoji icon for an attachment based on its MIME type.
   * @param {string} mimeType - The MIME type of the attachment
   * @returns {string} Emoji icon
   */
  function getAttachmentIcon(mimeType) {
    if (!mimeType) return '📎';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('text/') || mimeType === 'application/json') return '📄';
    if (mimeType === 'application/pdf') return '📕';
    if (mimeType.includes('javascript') || mimeType.includes('typescript')) return '📜';
    return '📎';
  }

  return {
    formatTime,
    formatMessageDate,
    isBeforeToday,
    formatModelName,
    formatFileSize,
    getAttachmentIcon,
  };
}
