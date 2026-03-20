import { watch, onUnmounted, ref } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useSessionStreamingStore } from '../stores/sessionStreaming.js';
import { useSessionSubscription } from './useWebSocket.js';

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

  // Track pending hydration retry timeouts: { [sessionId]: timeoutId }
  const hydrationRetryTimeouts = {};

  /**
   * Fetch streaming state from the server and hydrate the store.
   * If the initial fetch returns no data and the session is still running,
   * retry once after a delay to cover the race where a child session
   * has just started but hasn't populated its streaming state yet.
   * @param {string} sessionId
   */
  function hydrateStreamingState(sessionId) {
    fetch(`/api/sessions/${sessionId}/streaming-state`)
      .then(res => res.ok ? res.json() : null)
      .then(snapshot => {
        if (snapshot && (snapshot.workLogs?.length || snapshot.partialText || snapshot.thinking)) {
          streamingStore.hydrateSessionState(sessionId, snapshot);
        } else {
          // No data yet — schedule a retry for sessions that just started.
          // This covers the race where a child session was just created
          // but hasn't emitted any streaming events yet.
          scheduleHydrationRetry(sessionId);
        }
      })
      .catch(() => {
        // Hydration failure is non-fatal — retry in case the session
        // hasn't registered streaming state on the server yet.
        scheduleHydrationRetry(sessionId);
      });
  }

  /**
   * Retry hydration after a delay if the session is still running/starting.
   * @param {string} sessionId
   */
  function scheduleHydrationRetry(sessionId) {
    hydrationRetryTimeouts[sessionId] = setTimeout(() => {
      delete hydrationRetryTimeouts[sessionId];
      // Only retry if still subscribed and the session is still active
      if (!activeSubscriptions.value[sessionId]) return;
      const session = sessionsStore.sessions.find(s => s.id === sessionId);
      if (session && ['running', 'starting'].includes(session.status)) {
        fetch(`/api/sessions/${sessionId}/streaming-state`)
          .then(res => res.ok ? res.json() : null)
          .then(retrySnapshot => {
            if (retrySnapshot) {
              streamingStore.hydrateSessionState(sessionId, retrySnapshot);
            }
          })
          .catch(() => { /* Retry failure is non-fatal */ });
      }
    }, 1500);
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
      streamingStore.setSessionPartialText(sessionId, text);
    }));

    // Listen for thinking
    // NOTE: onThinkingPartial callback receives a string (thinking), not { thinking }
    cleanups.push(sub.onThinkingPartial((thinking) => {
      streamingStore.setPartialThinking(thinking, sessionId);
    }));

    // Listen for file change count updates (real-time)
    cleanups.push(sub.onChangesUpdate((changeCount) => {
      streamingStore.setSessionFileCount(sessionId, changeCount);
    }));

    // Listen for status changes (to clean up when session stops running)
    // NOTE: onStatus callback receives a string (status), not { status }
    cleanups.push(sub.onStatus((status) => {
      if (!['running', 'starting'].includes(status)) {
        // Session stopped — clear streaming state after a brief delay.
        // Store the timeout ID so it can be cancelled if the session resumes.
        clearTimeouts[sessionId] = setTimeout(() => {
          delete clearTimeouts[sessionId];
          streamingStore.clearSessionStreamingState(sessionId);
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
    if (hydrationRetryTimeouts[sessionId]) {
      clearTimeout(hydrationRetryTimeouts[sessionId]);
      delete hydrationRetryTimeouts[sessionId];
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

  // Cleanup all on unmount
  onUnmounted(() => {
    Object.keys(activeSubscriptions.value).forEach(id => unsubscribeFromSession(id));
  });

  return { activeSubscriptions };
}
