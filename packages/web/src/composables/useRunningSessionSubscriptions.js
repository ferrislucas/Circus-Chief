import { watch, onUnmounted, ref, unref } from 'vue';
import { useSessionStreamingStore } from '../stores/sessionStreaming.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useSessionSubscription, useWebSocket } from './useWebSocket.js';

/**
 * Reconciles per-session streams against the list view's eligible IDs. The
 * caller owns visibility/filter/collapse policy; this composable owns cleanup.
 */
export function useRunningSessionSubscriptions(desiredSessionIds) {
  const streamingStore = useSessionStreamingStore();
  const sessionsStore = useSessionsStore();
  const activeSubscriptions = ref({});
  const entries = new Map();
  const MAX_HYDRATION_RETRIES = 4;

  function currentIds() {
    if (desiredSessionIds === undefined) {
      return new Set(sessionsStore.sessions
        .filter(session => ['running', 'starting'].includes(session.status))
        .map(session => session.id));
    }
    return new Set(unref(desiredSessionIds) || []);
  }

  function isCurrent(sessionId, entry) {
    return entries.get(sessionId) === entry && currentIds().has(sessionId);
  }

  function hydrate(sessionId, entry, retry = 0) {
    fetch(`/api/sessions/${sessionId}/streaming-state`, { signal: entry.controller.signal })
      .then(res => res.ok ? res.json() : null)
      .then(snapshot => {
        if (!isCurrent(sessionId, entry)) return;
        if (snapshot && (snapshot.workLogs?.length || snapshot.partialText || snapshot.thinking)) {
          streamingStore.hydrateSessionState(sessionId, snapshot);
          return;
        }
        if (retry < MAX_HYDRATION_RETRIES) {
          Object.assign(entry, {
            retryTimer: setTimeout(() => hydrate(sessionId, entry, retry + 1), 1500 * (2 ** retry)),
          });
        }
      })
      .catch(error => {
        if (error.name !== 'AbortError' && isCurrent(sessionId, entry) && retry < MAX_HYDRATION_RETRIES) {
          Object.assign(entry, {
            retryTimer: setTimeout(() => hydrate(sessionId, entry, retry + 1), 1500 * (2 ** retry)),
          });
        }
      });
  }

  function add(sessionId) {
    if (entries.has(sessionId)) return;
    const sub = useSessionSubscription(sessionId);
    const entry = { controller: new AbortController(), retryTimer: null, clearTimer: null, cleanups: [], sub };
    entries.set(sessionId, entry);
    entry.cleanups.push(sub.onWorkLog(log => { if (isCurrent(sessionId, entry)) streamingStore.addSessionWorkLog(sessionId, log); }));
    entry.cleanups.push(sub.onPartial(text => { if (text && isCurrent(sessionId, entry)) streamingStore.setSessionPartialText(sessionId, text); }));
    entry.cleanups.push(sub.onThinkingPartial(thinking => { if (thinking && isCurrent(sessionId, entry)) streamingStore.setPartialThinking(thinking, sessionId); }));
    entry.cleanups.push(sub.onChangesUpdate(count => { if (isCurrent(sessionId, entry)) streamingStore.setSessionFileCount(sessionId, count); }));
    entry.cleanups.push(sub.onStatus(status => {
      if (!['running', 'starting'].includes(status) && isCurrent(sessionId, entry)) {
        Object.assign(entry, {
          clearTimer: setTimeout(() => streamingStore.clearSessionEphemeralState(sessionId), 2000),
        });
      } else if (entry.clearTimer) {
        clearTimeout(entry.clearTimer);
        Object.assign(entry, { clearTimer: null });
      }
    }));
    sub.subscribe();
    activeSubscriptions.value[sessionId] = entry;
    hydrate(sessionId, entry);
  }

  function remove(sessionId) {
    const entry = entries.get(sessionId);
    if (!entry) return;
    entries.delete(sessionId);
    entry.controller.abort();
    clearTimeout(entry.retryTimer);
    clearTimeout(entry.clearTimer);
    entry.cleanups.forEach(cleanup => cleanup?.());
    entry.sub.unsubscribe();
    delete activeSubscriptions.value[sessionId];
  }

  function reconcile(ids = currentIds()) {
    for (const id of entries.keys()) if (!ids.has(id)) remove(id);
    for (const id of ids) add(id);
  }

  watch(() => [...currentIds()].sort(), () => reconcile(), { immediate: true });
  const { onReconnect } = useWebSocket();
  const removeReconnectHandler = onReconnect(() => {
    for (const [id, entry] of entries) hydrate(id, entry);
  });
  onUnmounted(() => { for (const id of [...entries.keys()]) remove(id); removeReconnectHandler(); });
  return { activeSubscriptions };
}
