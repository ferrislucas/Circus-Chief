import { watch, onUnmounted, ref } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useSessionStreamingStore } from '../stores/sessionStreaming.js';
import { useSessionSubscription, useWebSocket } from './useWebSocket.js';

/**
 * Composable that watches the session list for running sessions and
 * subscribes to their individual WebSocket streams to receive work logs,
 * partial text, and thinking for display in the session list view.
 */
export function useRunningSessionSubscriptions() {
  const sessionsStore = useSessionsStore();
  const streamingStore = useSessionStreamingStore();

  // Track active subscriptions: { [sessionId]: { subscription, cleanup } }
  const activeSubscriptions = ref({});

  // Track pending clear timeouts so stale ones can be cancelled: { [sessionId]: timeoutId }
  const clearTimeouts = {};

  // Track pending hydration retries: sessionId -> { count, timeout }
  const hydrationRetries = new Map();
  const MAX_HYDRATION_RETRIES = 4;

  /**
   * Fetch streaming state from the server and hydrate the store.
   * If the initial fetch returns no data and the session is still running,
   * retry with exponential backoff to cover the race where a child session
   * has just started but hasn't populated its streaming state yet.
   * @param {string} sessionId
   * @param {number} retryCount - current retry attempt (0-based)
   */
  function hydrateStreamingState(sessionId, retryCount = 0) {
    fetch(`/api/sessions/${sessionId}/streaming-state`)
      .then(res => res.ok ? res.json() : null)
      .then(snapshot => {
        if (snapshot && (snapshot.workLogs?.length || snapshot.partialText || snapshot.thinking)) {
          streamingStore.hydrateSessionState(sessionId, snapshot);
          // Successful hydration — clear any pending retry entry
          const retryEntry = hydrationRetries.get(sessionId);
          if (retryEntry) {
            clearTimeout(retryEntry.timeout);
            hydrationRetries.delete(sessionId);
          }
        } else {
          // No data yet — schedule a retry for sessions that just started.
          scheduleHydrationRetry(sessionId, retryCount);
        }
      })
      .catch(() => {
        // Hydration failure is non-fatal — retry in case the session
        // hasn't registered streaming state on the server yet.
        scheduleHydrationRetry(sessionId, retryCount);
      });
  }

  /**
   * Retry hydration after a delay with exponential backoff if the session
   * is still running/starting.
   * @param {string} sessionId
   * @param {number} retryCount - current retry attempt (0-based)
   */
  function scheduleHydrationRetry(sessionId, retryCount = 0) {
    if (retryCount >= MAX_HYDRATION_RETRIES) return;
    if (!activeSubscriptions.value[sessionId]) return;

    const session = sessionsStore.sessions.find(s => s.id === sessionId);
    if (!session || !['running', 'starting'].includes(session.status)) return;

    const delay = 1500 * Math.pow(2, retryCount); // 1.5s, 3s, 6s, 12s
    const timeout = setTimeout(() => {
      hydrationRetries.delete(sessionId);
      hydrateStreamingState(sessionId, retryCount + 1);
    }, delay);
    hydrationRetries.set(sessionId, { count: retryCount, timeout });
  }

  function subscribeToSession(sessionId) {
    if (activeSubscriptions.value[sessionId]) return; // already subscribed

    const sub = useSessionSubscription(sessionId);
    const cleanups = [];

    // Listen for work logs
    cleanups.push(sub.onWorkLog((log) => {
      streamingStore.addSessionWorkLog(sessionId, log);
    }));

    // Listen for partial text (streaming response)
    // NOTE: onPartial callback receives a string (text), not { text }
    cleanups.push(sub.onPartial((text) => {
      // Only update when there is actual content. Ignore empty-string clears
      // to prevent blank flashes in the list view. Partial text is naturally
      // replaced by work logs, or cleared on status change.
      if (text) {
        streamingStore.setSessionPartialText(sessionId, text);
      }
    }));

    // Listen for thinking
    // NOTE: onThinkingPartial callback receives a string (thinking), not { thinking }
    cleanups.push(sub.onThinkingPartial((thinking) => {
      // Only update when there is actual thinking content.
      // Ignore null/empty clears — thinking is replaced by work logs naturally,
      // or cleared on status change. This prevents blank flashes.
      if (thinking) {
        streamingStore.setPartialThinking(thinking, sessionId);
      }
    }));

    // Listen for file change count updates (real-time)
    cleanups.push(sub.onChangesUpdate((changeCount) => {
      streamingStore.setSessionFileCount(sessionId, changeCount);
    }));

    // Listen for status changes (to clean up when session stops running)
    // NOTE: onStatus callback receives a string (status), not { status }
    cleanups.push(sub.onStatus((status) => {
      if (!['running', 'starting'].includes(status)) {
        // Session stopped — clear ephemeral state after a brief delay.
        // Store the timeout ID so it can be cancelled if the session resumes.
        clearTimeouts[sessionId] = setTimeout(() => {
          delete clearTimeouts[sessionId];
          streamingStore.clearSessionEphemeralState(sessionId);
        }, 2000);
      } else {
        // Session returned to running/starting — cancel any stale clear timeout
        if (clearTimeouts[sessionId]) {
          clearTimeout(clearTimeouts[sessionId]);
          delete clearTimeouts[sessionId];
        }
      }
    }));

    sub.subscribe();

    activeSubscriptions.value[sessionId] = {
      subscription: sub,
      cleanup: () => {
        cleanups.forEach(fn => fn && fn());
        sub.unsubscribe();
      },
    };

    // Hydrate current streaming state from the server (fire-and-forget).
    // This ensures we see content for sessions already running before we subscribed.
    // Uses retry logic to handle child sessions that just started.
    hydrateStreamingState(sessionId);
  }

  function unsubscribeFromSession(sessionId) {
    const entry = activeSubscriptions.value[sessionId];
    if (entry) {
      entry.cleanup();
      delete activeSubscriptions.value[sessionId];
    }
    // Also cancel any pending clear timeout
    if (clearTimeouts[sessionId]) {
      clearTimeout(clearTimeouts[sessionId]);
      delete clearTimeouts[sessionId];
    }
    // Cancel any pending hydration retry
    const retryEntry = hydrationRetries.get(sessionId);
    if (retryEntry) {
      clearTimeout(retryEntry.timeout);
      hydrationRetries.delete(sessionId);
    }
  }

  // Watch for changes in the session list and subscribe/unsubscribe accordingly
  watch(
    () => sessionsStore.sessions.filter(s => ['running', 'starting'].includes(s.status)).map(s => s.id),
    (runningIds, oldRunningIds = []) => {
      const newIds = runningIds.filter(id => !oldRunningIds.includes(id));
      const removedIds = oldRunningIds.filter(id => !runningIds.includes(id));

      newIds.forEach(id => subscribeToSession(id));
      removedIds.forEach(id => unsubscribeFromSession(id));
    },
    { immediate: true },
  );

  // Re-hydrate streaming state for all active subscriptions when WebSocket reconnects
  const { onReconnect } = useWebSocket();
  const removeReconnectHandler = onReconnect(() => {
    for (const sessionId of Object.keys(activeSubscriptions.value)) {
      hydrateStreamingState(sessionId);
    }
  });

  // Cleanup all on unmount
  onUnmounted(() => {
    Object.keys(activeSubscriptions.value).forEach(id => unsubscribeFromSession(id));
    removeReconnectHandler();
  });

  return { activeSubscriptions };
}
