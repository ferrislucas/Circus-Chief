import { computed, unref } from 'vue';
import { useUiStore } from '../stores/ui.js';

/**
 * Composable for cancelling a scheduled session.
 * Centralises the confirm dialog, API call, loading state, and toast feedback
 * so all cancel buttons behave consistently.
 *
 * `cancelling` and the in-flight guard are shared state on the store itself,
 * keyed by session id (see `useScheduleStartNow` for the full rationale) so
 * Cancel disables — and is disabled by — Start Now/Edit for the same session
 * regardless of which component instantiated this composable.
 *
 * @param {import('../stores/sessions.js').useSessionsStore} sessionsStore
 * @param {string|(() => string)} [sessionIdSource] - Session id, or a getter
 *   for it, used to compute `cancelling` for a specific session.
 * @returns {{ cancelling: import('vue').ComputedRef<boolean>, cancelScheduledSession: (sessionId: string) => Promise<boolean> }}
 */
export function useScheduleCancel(sessionsStore, sessionIdSource) {
  const uiStore = useUiStore();

  const cancelling = computed(() => {
    const id = typeof sessionIdSource === 'function' ? sessionIdSource() : unref(sessionIdSource);
    // Optional-chained: display-only read, safe to degrade to "not in
    // flight" for store test doubles that don't implement this getter.
    return sessionsStore.scheduleMutationInFlight?.(id) === 'cancelling';
  });

  async function cancelScheduledSession(sessionId) {
    // Claim the in-flight slot before the confirm dialog, not after — a
    // rapid double-click (or a click racing another control's mutation for
    // this session) bails out immediately, without popping a second
    // confirm dialog for a cancel that's already happening.
    if (!sessionsStore.beginScheduleMutation(sessionId, 'cancelling')) return false;

    if (!confirm('Cancel this scheduled workspace?')) {
      sessionsStore.endScheduleMutation(sessionId);
      return false;
    }

    try {
      await sessionsStore.updateSessionFields(sessionId, {
        status: 'stopped',
        scheduledAt: null,
      });
      uiStore.success('Workspace cancelled');
      return true;
    } catch (err) {
      uiStore.error(`Failed to cancel workspace: ${err.message}`);
      return false;
    } finally {
      sessionsStore.endScheduleMutation(sessionId);
    }
  }

  return { cancelling, cancelScheduledSession };
}
