import { ref, watch } from 'vue';
import { useProjectSubscription } from './useProjectSubscription.js';

/**
 * Refcounted project-subscription bookkeeping for the session detail view.
 *
 * Using `useProjectSubscription` (rather than a raw `send(SUBSCRIBE_PROJECT)`)
 * registers the project id in the shared `projectSubscriptionIds` registry, so
 * `useWebSocket`'s reconnect path re-subscribes automatically — fixing the
 * silent channel loss on any WebSocket disconnect/reconnect.
 *
 * @param {import('vue').Ref<string>|(() => string)} getSessionId - Resolves the
 *   session id whose project should be subscribed (used as a fallback when the
 *   hydrated current session has not yet exposed a projectId).
 * @param {import('pinia').Store} sessionsStore
 */
export function useSessionDetailProjectSubscription(getSessionId, sessionsStore) {
  const currentProjectId = ref(null);
  let currentProjectSubscription = null;
  let projectSubscriptionWatcher = null;

  function unsubscribe() {
    if (currentProjectSubscription) {
      currentProjectSubscription.unsubscribe();
      currentProjectSubscription = null;
    }
    currentProjectId.value = null;
  }

  function stopWatcher() {
    if (projectSubscriptionWatcher) {
      projectSubscriptionWatcher();
      projectSubscriptionWatcher = null;
    }
  }

  function subscribe(projectId) {
    if (!projectId || currentProjectId.value === projectId) return;
    unsubscribe();
    currentProjectSubscription = useProjectSubscription(projectId, { autoCleanup: false });
    currentProjectSubscription.subscribe();
    currentProjectId.value = projectId;
  }

  function ensure() {
    const sessionId = typeof getSessionId === 'function' ? getSessionId() : getSessionId.value;
    const projectId = sessionsStore.currentSession?.projectId
      || sessionsStore.getSessionById(sessionId)?.projectId;
    if (projectId) {
      subscribe(projectId);
      return;
    }

    // Rare mount race: the session rehydrated without a projectId yet. Subscribe
    // as soon as one appears (one-shot, guard against duplicate subscriptions).
    if (!projectSubscriptionWatcher) {
      projectSubscriptionWatcher = watch(
        () => sessionsStore.currentSession?.projectId,
        (id) => {
          if (!id) return;
          subscribe(id);
          stopWatcher();
        },
      );
    }
  }

  return { currentProjectId, subscribe, unsubscribe, ensure, stopWatcher };
}