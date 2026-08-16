import { onUnmounted, watch } from 'vue';
import { useProjectSubscription, useWebSocket } from './useWebSocket.js';

// Refreshing re-runs the workspace aggregate query. Keep a quiet window long
// enough to coalesce high-frequency status and usage events
// emitted while multiple sessions are active.
export const WORKSPACE_LIST_REFRESH_DELAY_MS = 1_000;

const REFRESH_EVENTS = [
  'onSessionCreated',
  'onSessionUpdated',
  'onSessionDeleted',
  'onSessionSummaryUpdated',
  'onSessionStatus',
  'onCommandRunStarted',
  'onCommandRunComplete',
  'onCommandRunError',
  'onCommandRunKilled',
  'onCommandRunDeleted',
  'onKanbanBoardUpdated',
  'onKanbanCardMoved',
  'onKanbanCardAdded',
  'onKanbanCardRemoved',
];

/**
 * Project-scoped invalidation for the short-term workspace list read model.
 * Events refresh the loaded list extent; they never patch the legacy session
 * collection or compete with the workspace-card response.
 */
export function useWorkspaceListRealtime(projectId, refresh, isRefreshInFlight = () => false) {
  let timer = null;
  let cleanupCurrentProject = () => {};
  let inFlightGeneration = null;
  let trailingRefresh = false;
  let generation = 0;
  let disposed = false;

  function clearRefreshTimer() {
    clearTimeout(timer);
    timer = null;
  }

  function scheduleRefresh(expectedGeneration = generation) {
    if (disposed || expectedGeneration !== generation || !projectId.value) return;
    clearRefreshTimer();
    timer = setTimeout(() => runRefresh(expectedGeneration), WORKSPACE_LIST_REFRESH_DELAY_MS);
  }

  async function runRefresh(expectedGeneration) {
    timer = null;
    if (disposed || expectedGeneration !== generation || !projectId.value) return;
    if (inFlightGeneration === expectedGeneration) {
      trailingRefresh = true;
      return;
    }

    const joinedExistingLoad = isRefreshInFlight();
    inFlightGeneration = expectedGeneration;
    const refreshProjectId = projectId.value;
    try {
      await refresh(refreshProjectId);
    } catch {
      // The workspace-list store owns the visible error state. Realtime
      // invalidation must not create an unhandled timer rejection.
    } finally {
      if (inFlightGeneration === expectedGeneration) {
        inFlightGeneration = null;
        // If the event joined a request that started before the event, its
        // response may not contain the mutation. One bounded trailing read
        // closes that race without issuing a request per event.
        if (joinedExistingLoad) trailingRefresh = true;
        if (!disposed && expectedGeneration === generation && trailingRefresh) {
          trailingRefresh = false;
          scheduleRefresh(expectedGeneration);
        }
      }
    }
  }

  function installProjectSubscription(id) {
    generation += 1;
    const projectGeneration = generation;
    clearRefreshTimer();
    trailingRefresh = false;
    inFlightGeneration = null;
    cleanupCurrentProject();

    if (!id) {
      cleanupCurrentProject = () => {};
      return;
    }

    const subscription = useProjectSubscription(id, { autoCleanup: false });
    // Session updates are the server's umbrella event for workspace membership,
    // archive/star/scheduling changes; the other registrations cover activity
    // whose compact card fields can change without a generic update.
    const cleanups = REFRESH_EVENTS
      .filter(name => typeof subscription[name] === 'function')
      .map(name => subscription[name](() => scheduleRefresh(projectGeneration)));
    const removeReconnect = useWebSocket().onReconnect?.(
      () => scheduleRefresh(projectGeneration),
    );
    subscription.subscribe();

    cleanupCurrentProject = () => {
      for (const cleanup of cleanups) cleanup?.();
      removeReconnect?.();
      subscription.unsubscribe();
    };
  }

  const stopProjectWatch = watch(projectId, installProjectSubscription, { immediate: true });

  onUnmounted(() => {
    disposed = true;
    generation += 1;
    clearRefreshTimer();
    trailingRefresh = false;
    stopProjectWatch();
    cleanupCurrentProject();
  });

  return { scheduleRefresh };
}
