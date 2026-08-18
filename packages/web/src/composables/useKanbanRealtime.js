import { onUnmounted, watch } from 'vue';
import { useProjectSubscription } from './useWebSocket.js';
import { useKanbanStore } from '../stores/kanban.js';

/**
 * Project-scoped realtime updates for the Kanban board read model.
 *
 * The board is its own read model: `kanbanStore.updateLane` and friends
 * deliberately do not patch local state, because the server broadcasts the
 * authoritative board on every mutation. Something has to apply those
 * broadcasts, and card command-status indicators read their runs from board
 * data, so command-run events are folded in here too.
 *
 * Kept separate from the workspace-list invalidation composable because the
 * board stays mounted (and subscribed) on tabs where the list is not loaded.
 *
 * @param {import('vue').Ref<string|null>} projectId - Project owning the board
 */
export function useKanbanRealtime(projectId) {
  const kanbanStore = useKanbanStore();

  let cleanupCurrentProject = () => {};

  function installProjectSubscription(id) {
    cleanupCurrentProject();

    if (!id) {
      cleanupCurrentProject = () => {};
      return;
    }

    const subscription = useProjectSubscription(id, { autoCleanup: false });
    const registrations = {
      onSessionUpdated: session => kanbanStore.handleSessionUpdated(session),
      onKanbanBoardUpdated: board => kanbanStore.handleBoardUpdated(board),
      onKanbanCardMoved: (cardId, fromLaneId, toLaneId, card) => {
        kanbanStore.handleCardMoved(cardId, fromLaneId, toLaneId, card);
      },
      onKanbanCardAdded: (card, laneId) => kanbanStore.handleCardAdded(card, laneId),
      onKanbanCardRemoved: (cardId, laneId) => kanbanStore.handleCardRemoved(cardId, laneId),
      onCommandRunStarted: (runId, sessionId, buttonId) => {
        kanbanStore.handleSessionCommandRun(sessionId, {
          buttonId, runId, status: 'running', exitCode: null, startedAt: Date.now(),
        });
      },
      onCommandRunComplete: ({ runId, sessionId, buttonId, exitCode, status }) => {
        kanbanStore.handleSessionCommandRun(sessionId, {
          buttonId,
          runId,
          status: status || (exitCode === 0 ? 'success' : 'error'),
          exitCode,
          completedAt: Date.now(),
        });
      },
      onCommandRunError: (runId, sessionId, buttonId) => {
        kanbanStore.handleSessionCommandRun(sessionId, {
          buttonId, runId, status: 'error', exitCode: 1, completedAt: Date.now(),
        });
      },
      onCommandRunDeleted: (runId, sessionId, buttonId) => {
        // Deleting the displayed run may reveal an older run for the button;
        // only the authoritative board response can supply that replacement.
        kanbanStore.fetchBoard(id).catch(() => {});
      },
    };
    const cleanups = Object.entries(registrations)
      .filter(([name]) => typeof subscription[name] === 'function')
      .map(([name, callback]) => subscription[name](callback));
    subscription.subscribe();

    cleanupCurrentProject = () => {
      for (const cleanup of cleanups) cleanup?.();
      subscription.unsubscribe();
    };
  }

  const stopProjectWatch = watch(projectId, installProjectSubscription, { immediate: true });

  onUnmounted(() => {
    stopProjectWatch();
    cleanupCurrentProject();
  });
}
