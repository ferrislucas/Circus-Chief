import { ref } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { api } from './useApi.js';

/**
 * Start a scheduled session immediately, saving an edited prompt first when needed.
 * @param {import('../stores/sessions.js').useSessionsStore} sessionsStore
 */
export function useScheduleStartNow(sessionsStore) {
  const startingNow = ref(false);
  const uiStore = useUiStore();

  async function startScheduledNow(session, promptOverride) {
    startingNow.value = true;
    try {
      if (promptOverride !== undefined && promptOverride !== session.pendingPrompt) {
        await api.updateSessionPendingPrompt(session.id, promptOverride);
      }
      await sessionsStore.runScheduledNow(session.id);
      uiStore.success('Workspace started');
      return true;
    } catch (err) {
      uiStore.error(`Failed to start workspace: ${err.message}`);
      return false;
    } finally {
      startingNow.value = false;
    }
  }

  return { startingNow, startScheduledNow };
}
