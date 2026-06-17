import { ref } from 'vue';
import { useUiStore } from '../stores/ui.js';

/**
 * Composable for cancelling a scheduled session.
 * Centralises the confirm dialog, API call, loading state, and toast feedback
 * so all cancel buttons behave consistently.
 *
 * @param {import('../stores/sessions.js').useSessionsStore} sessionsStore
 * @returns {{ cancelling: import('vue').Ref<boolean>, cancelScheduledSession: (sessionId: string) => Promise<boolean> }}
 */
export function useScheduleCancel(sessionsStore) {
  const cancelling = ref(false);
  const uiStore = useUiStore();

  async function cancelScheduledSession(sessionId) {
    if (!confirm('Cancel this scheduled workspace?')) return false;

    cancelling.value = true;
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
      cancelling.value = false;
    }
  }

  return { cancelling, cancelScheduledSession };
}
