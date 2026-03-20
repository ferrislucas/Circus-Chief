import { reactive, watch } from 'vue';
import { api } from './useApi.js';

/**
 * Execute a batch fetch of summaries and update the reactive state maps.
 * @param {string[]} idsToFetch - Session IDs to fetch
 * @param {Object} summaries - Reactive summaries map
 * @param {Object} loadingSummaries - Reactive loading states map
 * @param {Object} summaryErrors - Reactive error states map
 */
async function executeBatchFetch(idsToFetch, summaries, loadingSummaries, summaryErrors) {
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
 * Composable for managing session summaries with batched fetching,
 * loading states, and error handling.
 *
 * @returns {Object} Summary management utilities
 */
export function useSummaries() {
  const summaries = reactive({});
  const loadingSummaries = reactive({});
  const summaryErrors = reactive({});

  async function fetchSummariesBatch(sessions) {
    const idsToFetch = sessions
      .filter(s => !summaries[s.id] && !loadingSummaries[s.id])
      .map(s => s.id);

    if (idsToFetch.length === 0) return;

    await executeBatchFetch(idsToFetch, summaries, loadingSummaries, summaryErrors);
  }

  async function fetchSummary(sessionId) {
    loadingSummaries[sessionId] = true;
    summaryErrors[sessionId] = false;
    try {
      const summary = await api.getSessionSummary(sessionId);
      if (summary) {
        summaries[sessionId] = summary;
      }
    } catch (error) {
      if (error.response?.status !== 404) {
        console.warn(`Failed to fetch summary for session ${sessionId}:`, error.message);
        summaryErrors[sessionId] = true;
      }
    } finally {
      loadingSummaries[sessionId] = false;
    }
  }

  async function retryFetchSummary(sessionId) {
    summaryErrors[sessionId] = false;
    await fetchSummary(sessionId);
  }

  function updateSummary(sessionId, summary) {
    summaries[sessionId] = summary;
    loadingSummaries[sessionId] = false;
    summaryErrors[sessionId] = false;
  }

  function cleanupSummary(sessionId) {
    delete summaries[sessionId];
    delete loadingSummaries[sessionId];
    delete summaryErrors[sessionId];
  }

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
