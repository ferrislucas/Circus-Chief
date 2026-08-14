import { computed, unref } from 'vue';
import { useUiStore } from '../stores/ui.js';

/**
 * Start a scheduled session immediately.
 *
 * An edited prompt is sent directly to the server as part of this single
 * call (`sessionsStore.runScheduledNow(id, prompt)`), applied atomically
 * with the server's claim on the scheduled session — there is no separate
 * "save the prompt, then start" round trip. That matters under a race: if a
 * poller tick or another manual request claims the session first, this
 * request's edit is never silently half-applied.
 *
 * `startingNow` and the in-flight guard are shared state on the store
 * itself, keyed by session id (`scheduleMutationInFlight` /
 * `beginScheduleMutation` / `endScheduleMutation`) rather than a local ref —
 * so every control for a given session (the "Start Now" button, the prompt
 * submit button, Edit, Cancel) reflects and respects the same in-flight
 * state regardless of which component instantiated this composable.
 *
 * @param {import('../stores/sessions.js').useSessionsStore} sessionsStore
 * @param {string|(() => string)} [sessionIdSource] - Session id, or a getter
 *   for it, used to compute `startingNow` for a specific session. Optional —
 *   omit if you only need `startScheduledNow` (e.g. a list that starts
 *   different sessions and reads `scheduleMutationInFlight` per-row itself).
 */
export function useScheduleStartNow(sessionsStore, sessionIdSource) {
  const uiStore = useUiStore();

  const startingNow = computed(() => {
    const id = typeof sessionIdSource === 'function' ? sessionIdSource() : unref(sessionIdSource);
    // Optional-chained: display-only read, safe to degrade to "not in
    // flight" for store test doubles that don't implement this getter.
    return sessionsStore.scheduleMutationInFlight?.(id) === 'starting';
  });

  async function startScheduledNow(session, promptOverride) {
    if (!session?.id) return false;
    if (!sessionsStore.beginScheduleMutation(session.id, 'starting')) return false;
    try {
      const hasOverride = promptOverride !== undefined && promptOverride !== session.pendingPrompt;
      await sessionsStore.runScheduledNow(session.id, hasOverride ? promptOverride : undefined);
      uiStore.success('Workspace started');
      return true;
    } catch (err) {
      uiStore.error(`Failed to start workspace: ${err.message}`);
      return false;
    } finally {
      sessionsStore.endScheduleMutation(session.id);
    }
  }

  return { startingNow, startScheduledNow };
}
