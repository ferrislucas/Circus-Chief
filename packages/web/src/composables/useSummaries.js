import { reactive, watch } from 'vue';
import { api } from './useApi.js';

/**
 * Composable for managing session summaries with batched fetching,
 * loading states, and error handling.
 *
 * @returns {Object} Summary management utilities
 */
export function useSummaries() {
  // Store summaries keyed by session ID
  const summaries = reactive({});
  const loadingSummaries = reactive({});
  const summaryErrors = reactive({});

  /**
   * Fetch summaries for an array of sessions in a single batch request.
   * Only fetches for sessions that don't already have summaries loaded.
   *
   * @param {Array} sessions - Array of session objects with id property
   */
  async function fetchSummariesBatch(sessions) {
    const idsToFetch = sessions
      .filter(s => !summaries[s.id] && !loadingSummaries[s.id])
      .map(s => s.id);

    if (idsToFetch.length === 0) return;

    // Mark all as loading
    for (const id of idsToFetch) {
      loadingSummaries[id] = true;
      summaryErrors[id] = false;
    }

    try {
      const batchResult = await api.getSessionSummariesBatch(idsToFetch);
      for (const id of idsToFetch) {
        if (batchResult[id]) {
          summaries[id] = batchResult[id];
        }
        loadingSummaries[id] = false;
      }
    } catch (error) {
      console.warn('Failed to fetch summaries batch:', error.message);
      for (const id of idsToFetch) {
        summaryErrors[id] = true;
        loadingSummaries[id] = false;
      }
    }
  }

  /**
   * Fetch a single session's summary.
   *
   * @param {string} sessionId - The session ID to fetch summary for
   */
  async function fetchSummary(sessionId) {
    loadingSummaries[sessionId] = true;
    summaryErrors[sessionId] = false;
    try {
      const summary = await api.getSessionSummary(sessionId);
      if (summary) {
        summaries[sessionId] = summary;
      }
      // No summary yet is not an error - it just means one hasn't been generated
    } catch (error) {
      // Log error for debugging but don't show as error if it's just a 404 (no summary yet)
      if (error.response?.status !== 404) {
        console.warn(`Failed to fetch summary for session ${sessionId}:`, error.message);
        summaryErrors[sessionId] = true;
      }
    } finally {
      loadingSummaries[sessionId] = false;
    }
  }

  /**
   * Retry fetching a summary that previously failed.
   *
   * @param {string} sessionId - The session ID to retry
   */
  async function retryFetchSummary(sessionId) {
    summaryErrors[sessionId] = false;
    await fetchSummary(sessionId);
  }

  /**
   * Update a summary from an external source (e.g., WebSocket event).
   *
   * @param {string} sessionId - The session ID
   * @param {Object} summary - The summary data
   */
  function updateSummary(sessionId, summary) {
    summaries[sessionId] = summary;
    loadingSummaries[sessionId] = false;
    summaryErrors[sessionId] = false;
  }

  /**
   * Clean up summary data for a deleted session.
   *
   * @param {string} sessionId - The session ID to clean up
   */
  function cleanupSummary(sessionId) {
    delete summaries[sessionId];
    delete loadingSummaries[sessionId];
    delete summaryErrors[sessionId];
  }

  /**
   * Create a debounced watcher for sessions changes that fetches summaries.
   * Returns a cleanup function.
   *
   * @param {Function} getSessionsFn - A function that returns the sessions array
   * @param {number} debounceMs - Debounce delay in milliseconds (default: 400)
   * @returns {Function} Cleanup function to clear the debounce timer
   */
  function watchSessionsForSummaries(getSessionsFn, debounceMs = 400) {
    let timer = null;

    const stopWatch = watch(
      getSessionsFn,
      () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const sessions = getSessionsFn();
          fetchSummariesBatch(sessions);
        }, debounceMs);
      }
    );

    // Return cleanup function
    return () => {
      clearTimeout(timer);
      stopWatch();
    };
  }

  return {
    summaries,
    loadingSummaries,
    summaryErrors,
    fetchSummariesBatch,
    fetchSummary,
    retryFetchSummary,
    updateSummary,
    cleanupSummary,
    watchSessionsForSummaries,
  };
}
