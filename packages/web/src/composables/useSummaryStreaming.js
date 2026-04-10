import { onMounted, onUnmounted, watch } from 'vue';
import { useSessionSubscription } from './useWebSocket.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useSessionStreamingStore } from '../stores/sessionStreaming.js';

/**
 * Composable that manages streaming subscriptions for a session and its
 * running descendants (work-logs, partial text, thinking).
 *
 * Returns the primary session subscription handlers so the caller can
 * hook additional listeners (e.g. onMessage, onSummaryUpdate).
 */
export function useSummaryStreaming(sessionId) {
  const sessionsStore = useSessionsStore();
  const streamingStore = useSessionStreamingStore();

  const {
    onWorkLog,
    onPartial,
    onThinkingPartial,
    onSummaryUpdate,
    onSummaryGenerating,
    onMessage,
  } = useSessionSubscription(sessionId);

  // Restore collapsed log state for this session
  streamingStore.restoreCollapsedLogState();

  // Listen for work logs
  onWorkLog((log) => {
    streamingStore.addSessionWorkLog(sessionId, log);
  });

  // Listen for partial text (streaming response)
  onPartial((text) => {
    if (text) {
      streamingStore.setSessionPartialText(sessionId, text);
    }
  });

  // Listen for thinking
  onThinkingPartial((thinking) => {
    if (thinking) {
      streamingStore.setPartialThinking(thinking, sessionId);
    }
  });

  // --- Descendant session streaming subscriptions ---
  const descendantSubscriptions = {};

  function subscribeToDescendant(descId) {
    if (descendantSubscriptions[descId]) return;

    const sub = useSessionSubscription(descId);
    const cleanups = [];

    cleanups.push(sub.onWorkLog((log) => {
      streamingStore.addSessionWorkLog(descId, log);
    }));

    cleanups.push(sub.onPartial((text) => {
      if (text) {
        streamingStore.setSessionPartialText(descId, text);
      }
    }));

    cleanups.push(sub.onThinkingPartial((thinking) => {
      if (thinking) {
        streamingStore.setPartialThinking(thinking, descId);
      }
    }));

    sub.subscribe();

    descendantSubscriptions[descId] = {
      subscription: sub,
      cleanup: () => {
        cleanups.forEach(fn => fn && fn());
        sub.unsubscribe();
      },
    };

    // Hydrate streaming state for this descendant
    hydrateStreamingState(descId);
  }

  function unsubscribeFromDescendant(descId) {
    const entry = descendantSubscriptions[descId];
    if (entry) {
      entry.cleanup();
      delete descendantSubscriptions[descId];
    }
  }

  // Watch for running descendants and subscribe/unsubscribe dynamically
  watch(
    () => sessionsStore.getAllDescendants(sessionId)
      .filter(d => d.status === 'running' || d.status === 'starting')
      .map(d => d.id),
    (newIds, oldIds = []) => {
      const added = newIds.filter(id => !oldIds.includes(id));
      const removed = oldIds.filter(id => !newIds.includes(id));
      added.forEach(id => subscribeToDescendant(id));
      removed.forEach(id => unsubscribeFromDescendant(id));
    },
    { immediate: true },
  );

  // Hydrate streaming state from server on mount (browser only)
  onMounted(async () => {
    hydrateStreamingState(sessionId);
  });

  onUnmounted(() => {
    Object.keys(descendantSubscriptions).forEach(id => unsubscribeFromDescendant(id));
  });

  return {
    onSummaryUpdate,
    onSummaryGenerating,
    onMessage,
  };
}

/**
 * Fetch the streaming-state snapshot for a session and hydrate the store.
 * Silently ignores errors (non-fatal).
 */
async function hydrateStreamingState(targetSessionId) {
  if (typeof window === 'undefined') return;
  try {
    const response = await fetch(`/api/sessions/${targetSessionId}/streaming-state`);
    if (response.ok) {
      const snapshot = await response.json();
      const streamingStore = useSessionStreamingStore();
      if (snapshot && (snapshot.workLogs?.length || snapshot.partialText || snapshot.thinking)) {
        streamingStore.hydrateSessionState(targetSessionId, snapshot);
      }
    }
  } catch (_error) {
    // Non-fatal
  }
}
