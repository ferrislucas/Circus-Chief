import { onUnmounted, watch } from 'vue';
import { useProjectSubscription } from './useProjectSubscription.js';
import { useWebSocket } from './useWebSocket.js';
import { useProjectsStore } from '../stores/projects.js';
import {
  WORKSPACE_LIST_REFRESH_DELAY_MS,
  WORKSPACE_LIST_MAX_REFRESH_DELAY_MS,
} from './useWorkspaceListRealtime.js';

// Events that can change the project list read model (creation, deletion,
// status transitions, renames). The authoritative aggregate is re-fetched,
// coalesced behind the debounce.
//
// SESSION_STATUS is delivered to *session* subscribers only; project
// subscribers learn about status transitions through SESSION_UPDATED (the
// server sends `session:updated` with the full session row to the project
// channel). Registering onSessionStatus here would therefore be dead code.
const REFRESH_EVENTS = ['onSessionCreated', 'onSessionUpdated', 'onSessionDeleted'];

/**
 * Project-list invalidation. Subscribes to every loaded project and refetches
 * the project list on session-membership/status changes, coalescing bursts
 * behind a debounce with backoff. The refetch is the silent variant so the
 * list never flashes its skeleton during a background refresh.
 *
 * @param {import('vue').Ref<Array<string>>} projectIds - reactive list of
 *   project ids to watch.
 */
export function useProjectListRealtime(projectIds) {
  const projectsStore = useProjectsStore();
  let disposed = false;
  let timer = null;
  let refreshDelay = WORKSPACE_LIST_REFRESH_DELAY_MS;
  let queuedEventCount = 0;
  const subscriptions = new Map(); // projectId -> () => void

  function clearTimer() {
    clearTimeout(timer);
    timer = null;
  }

  function scheduleRefresh() {
    if (disposed) return;
    queuedEventCount += 1;
    // Back off under sustained event pressure, capped at the max delay.
    if (timer && queuedEventCount > 3) {
      refreshDelay = Math.min(refreshDelay * 2, WORKSPACE_LIST_MAX_REFRESH_DELAY_MS);
    }
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      queuedEventCount = 0;
      refreshDelay = WORKSPACE_LIST_REFRESH_DELAY_MS;
      if (!disposed) projectsStore.fetchProjects({ silent: true });
    }, refreshDelay);
  }

  function subscribeTo(projectId) {
    if (subscriptions.has(projectId)) return;
    const subscription = useProjectSubscription(projectId, { autoCleanup: false });
    const cleanups = [];
    for (const name of REFRESH_EVENTS) {
      if (typeof subscription[name] === 'function') {
        cleanups.push(subscription[name](() => scheduleRefresh()));
      }
    }
    subscription.subscribe();
    subscriptions.set(projectId, () => {
      for (const cleanup of cleanups) cleanup?.();
      subscription.unsubscribe();
    });
  }

  function reconcile(ids) {
    const idSet = new Set(ids || []);
    for (const [projectId, cleanup] of [...subscriptions]) {
      if (!idSet.has(projectId)) {
        cleanup();
        subscriptions.delete(projectId);
      }
    }
    for (const projectId of idSet) {
      subscribeTo(projectId);
    }
  }

  const stopWatch = watch(projectIds, reconcile, { immediate: true });
  const removeReconnect = useWebSocket().onReconnect?.(() => scheduleRefresh()) ?? (() => {});

  onUnmounted(() => {
    disposed = true;
    clearTimer();
    stopWatch();
    removeReconnect();
    for (const cleanup of subscriptions.values()) cleanup();
    subscriptions.clear();
  });
}