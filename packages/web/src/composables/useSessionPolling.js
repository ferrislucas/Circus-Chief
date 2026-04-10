import { ref, watch } from 'vue';
import { api } from './useApi.js';
import { parseDiff } from '../utils/diffParser.js';

/**
 * Composable for managing session polling and file change detection.
 * Handles automatic polling while sessions are actively processing.
 *
 * @param {Object} options
 * @param {Function} options.getSessionId - Function that returns the current session ID
 * @param {Function} options.getSessionStatus - Function that returns the current session status
 * @param {Object} options.sessionsStore - The sessions Pinia store
 * @param {number} [options.pollInterval=3000] - Polling interval in milliseconds
 * @returns {Object} Polling and changes utilities
 */
export function useSessionPolling({ getSessionId, getSessionStatus, sessionsStore, pollInterval = 3000 }) {
  const pollIntervalId = ref(null);
  const hasChanges = ref(false);
  const changesFileCount = ref(0);

  /**
   * Check for file system changes (staged, unstaged, untracked).
   */
  async function checkForChanges() {
    const sessionId = getSessionId();
    if (!sessionId) return;

    try {
      const changes = await api.getSessionChanges(sessionId);
      hasChanges.value = Boolean(changes.staged || changes.unstaged || changes.untracked);

      // Count files from the diff responses
      const stagedFiles = parseDiff(changes.staged || '');
      const unstagedFiles = parseDiff(changes.unstaged || '');
      const untrackedFiles = parseDiff(changes.untracked || '');
      changesFileCount.value = stagedFiles.length + unstagedFiles.length + untrackedFiles.length;
    } catch (error) {
      // Silently fail - changes indicator is not critical
      console.error('Failed to check for changes:', error);
    }
  }

  /**
   * Start polling for updates while session is actively processing.
   * Polling is a fallback for race conditions that WebSocket might miss.
   */
  function startPolling() {
    if (pollIntervalId.value) return;

    pollIntervalId.value = setInterval(async () => {
      const status = getSessionStatus();
      const sessionId = getSessionId();

      // Only poll while actively processing, not while waiting for user input
      if (status === 'running' || status === 'starting') {
        // Run fetches in parallel instead of sequentially to reduce total poll time
        await Promise.all([
          sessionsStore.fetchSession(sessionId, false),
          sessionsStore.fetchMessages(sessionId, false, sessionsStore.activeConversationId),
          sessionsStore.fetchWorkLogs(sessionId),
        ]);
        // After the async fetches complete, verify the session hasn't changed.
        // If the user navigated away during the fetch, stop this (now-stale) polling.
        if (getSessionId() !== sessionId) {
          stopPolling();
          return;
        }
        // Check for file changes during active session
        checkForChanges();
      } else {
        // Session no longer actively processing, stop polling
        stopPolling();
      }
    }, pollInterval);
  }

  /**
   * Stop polling.
   */
  function stopPolling() {
    if (pollIntervalId.value) {
      clearInterval(pollIntervalId.value);
      pollIntervalId.value = null;
    }
  }

  /**
   * Reset state (for cleanup or session changes).
   */
  function reset() {
    stopPolling();
    hasChanges.value = false;
    changesFileCount.value = 0;
  }

  /**
   * Create a watcher that automatically starts/stops polling based on session status.
   *
   * @param {Function} getStatus - Function that returns the current status (reactive getter)
   * @returns {Function} Stop function for the watcher
   */
  function watchStatusForPolling(getStatus) {
    return watch(
      getStatus,
      (newStatus, oldStatus) => {
        if (newStatus === 'running' || newStatus === 'starting') {
          startPolling();
        } else if (oldStatus === 'running' || oldStatus === 'starting') {
          stopPolling();
        }
      }
    );
  }

  return {
    pollIntervalId,
    hasChanges,
    changesFileCount,
    checkForChanges,
    startPolling,
    stopPolling,
    reset,
    watchStatusForPolling,
  };
}
