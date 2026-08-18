import { onUnmounted, watch } from 'vue';
import { useProjectSubscription, useWebSocket } from './useWebSocket.js';

// Refreshing re-runs the workspace aggregate query. Keep a quiet window long
// enough to coalesce high-frequency status and usage events
// emitted while multiple sessions are active.
export const WORKSPACE_LIST_REFRESH_DELAY_MS = 1_000;
export const WORKSPACE_LIST_MAX_REFRESH_DELAY_MS = 5_000;

// Events that can change membership or ordering of the list (creation,
// deletion, archive/star, activity promotion). The authoritative read model is
// re-fetched, coalesced behind the debounce.
const REFRESH_EVENTS = [
  'onSessionCreated',
  'onSessionUpdated',
  'onSessionDeleted',
  'onKanbanBoardUpdated',
  'onKanbanCardMoved',
  'onKanbanCardAdded',
  'onKanbanCardRemoved',
];

const KILLED_STATUS = { status: 'killed' };

/**
 * Project-scoped invalidation for the short-term workspace list read model.
 *
 * Single-card events (command runs, summaries) are patched into the owning
 * card via `patchEvent` and issue zero list requests. Events that can change
 * membership or ordering trigger a debounced refresh. The composable never
 * touches the legacy session collection or the workspace-card response shape.
 *
 * @param {import('vue').Ref<string|null>} projectId
 * @param {(projectId: string) => Promise} refresh - debounced full refresh
 * @param {(event: {kind: string, sessionId?: string, [key: string]: any}) => string|null} [patchEvent]
 *   Applies a single-card event to its owning card; returns the patched card id
 *   or null when the session is unknown (caller should fall back to a refresh).
 */
export function useWorkspaceListRealtime(projectId, refresh, _isRefreshInFlight = () => false, patchEvent) {
  let timer = null;
  let cleanupCurrentProject = () => {};
  let refreshInFlight = false;
  let trailingRefresh = false;
  let generation = 0;
  let disposed = false;
  let refreshDelay = WORKSPACE_LIST_REFRESH_DELAY_MS;
  let queuedEventCount = 0;

  function clearRefreshTimer() {
    clearTimeout(timer);
    timer = null;
  }

  function scheduleRefresh(expectedGeneration = generation) {
    if (disposed || expectedGeneration !== generation || !projectId.value) return;
    queuedEventCount += 1;
    if (timer && queuedEventCount > 3) {
      refreshDelay = Math.min(refreshDelay * 2, WORKSPACE_LIST_MAX_REFRESH_DELAY_MS);
    }
    clearRefreshTimer();
    timer = setTimeout(() => runRefresh(expectedGeneration), refreshDelay);
  }

  function handlePatchEvent(kind, payload) {
    if (disposed) return;
    const applied = patchEvent?.({ kind, ...payload });
    // Unknown session (not in the loaded list, or a descendant without a
    // patchable root field): fall back to a debounced refresh so the card
    // still converges without issuing a request per event.
    if (applied === null || applied === undefined) scheduleRefresh();
  }

  async function runRefresh(expectedGeneration) {
    timer = null;
    queuedEventCount = 0;
    if (disposed || expectedGeneration !== generation || !projectId.value) return;
    if (refreshInFlight) {
      trailingRefresh = true;
      return;
    }

    const joinedExistingLoad = _isRefreshInFlight();
    refreshInFlight = true;
    const refreshProjectId = projectId.value;
    try {
      await refresh(refreshProjectId);
    } catch {
      // The workspace-list store owns the visible error state. Realtime
      // invalidation must not create an unhandled timer rejection.
    } finally {
      refreshInFlight = false;
      if (joinedExistingLoad) trailingRefresh = true;
      if (!disposed && expectedGeneration === generation && trailingRefresh) {
        trailingRefresh = false;
        scheduleRefresh(expectedGeneration);
      } else if (!disposed && expectedGeneration === generation) {
        refreshDelay = WORKSPACE_LIST_REFRESH_DELAY_MS;
      }
    }
  }

  function installProjectSubscription(id) {
    generation += 1;
    const projectGeneration = generation;
    clearRefreshTimer();
    refreshInFlight = false;
    trailingRefresh = false;
    refreshDelay = WORKSPACE_LIST_REFRESH_DELAY_MS;
    queuedEventCount = 0;
    cleanupCurrentProject();

    if (!id) {
      cleanupCurrentProject = () => {};
      return;
    }

    const subscription = useProjectSubscription(id, { autoCleanup: false });
    // Session updates are the server's umbrella event for workspace membership,
    // archive/star/scheduling changes; the other registrations cover activity
    // whose compact card fields can change without a generic update.
    const cleanups = [];
    for (const name of REFRESH_EVENTS) {
      if (typeof subscription[name] === 'function') {
        cleanups.push(subscription[name](() => scheduleRefresh(projectGeneration)));
      }
    }

    if (patchEvent) {
      const patchHandlers = {
        onCommandRunStarted: cb => subscription.onCommandRunStarted((runId, sessionId, buttonId) => cb({
          sessionId, buttonId, runId, status: 'running', startedAt: Date.now(),
        })),
        onCommandRunComplete: cb => subscription.onCommandRunComplete(run => cb({
          sessionId: run.sessionId, buttonId: run.buttonId, runId: run.runId,
          status: run.status, exitCode: run.exitCode, startedAt: run.startedAt ?? null, completedAt: Date.now(),
        })),
        onCommandRunError: cb => subscription.onCommandRunError((runId, sessionId, buttonId) => cb({
          sessionId, buttonId, runId, status: 'error', completedAt: Date.now(),
        })),
        onCommandRunKilled: cb => subscription.onCommandRunKilled(msg => cb({
          sessionId: msg.sessionId, buttonId: msg.buttonId, runId: msg.runId,
          startedAt: msg.startedAt ?? null, completedAt: Date.now(), ...KILLED_STATUS,
        })),
        onCommandRunDeleted: cb => subscription.onCommandRunDeleted((runId, sessionId, buttonId) => cb({
          sessionId, buttonId, runId, delete: true,
        })),
        onSessionSummaryUpdated: cb => subscription.onSessionSummaryUpdated((sessionId, summary) => cb({ sessionId, summary })),
      };
      for (const [name, register] of Object.entries(patchHandlers)) {
        if (typeof subscription[name] === 'function') {
          cleanups.push(register(payload => handlePatchEvent(name, payload)));
        }
      }
    }

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
    refreshInFlight = false;
    trailingRefresh = false;
    stopProjectWatch();
    cleanupCurrentProject();
  });

  return { scheduleRefresh };
}
