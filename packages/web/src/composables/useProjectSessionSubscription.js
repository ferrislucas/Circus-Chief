import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useProjectsStore } from '../stores/projects.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useKanbanStore } from '../stores/kanban.js';
import { useProjectSubscription } from './useWebSocket.js';

/**
 * Composable that encapsulates the WebSocket subscription setup for a project's
 * session list view. Handles:
 * - Subscribing/unsubscribing to project WebSocket channels on projectId change
 * - Registering all 7 event handlers (session CRUD, summary updates, command runs)
 * - Fetching initial project data (project info, sessions, command buttons)
 * - Cleaning up handlers on unmount or project change
 *
 * @param {import('vue').ComputedRef<string>} projectId - Reactive project ID
 * @param {Object} summaryCallbacks - Callbacks for summary management
 * @param {Function} summaryCallbacks.fetchSummariesBatch - Batch fetch summaries for sessions
 * @param {Function} summaryCallbacks.updateSummary - Update a single summary (e.g., from WebSocket)
 * @param {Function} summaryCallbacks.cleanupSummary - Clean up summary data for a deleted session
 */
export function useProjectSessionSubscription(projectId, summaryCallbacks) {
  const projectsStore = useProjectsStore();
  const sessionsStore = useSessionsStore();
  const commandButtonsStore = useCommandButtonsStore();
  const kanbanStore = useKanbanStore();

  const { fetchSummariesBatch, updateSummary, cleanupSummary } = summaryCallbacks;

  /**
   * Handle command run output (for real-time status icon updates).
   * Extracted to avoid excessive callback nesting inside the watch handler.
   */
  function handleCommandRunOutput(runId, sessionId, buttonId, output) {
    const existingRun = commandButtonsStore.runs[runId];
    const sessions = sessionsStore.sessions;
    const storeSession = sessions.find(s => s.id === sessionId);
    const existingSessionRun = storeSession?.latestCommandRuns?.find(r => r.runId === runId);
    const startedAt = existingRun?.startedAt || existingSessionRun?.startedAt || Date.now();

    if (!commandButtonsStore.runs[runId]) {
      commandButtonsStore.runs[runId] = {
        runId,
        buttonId,
        sessionId,
        status: 'running',
        output: '',
        exitCode: null,
        startedAt,
        outputTruncated: false,
      };
    }
    commandButtonsStore.appendOutput(runId, output);

    sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
      buttonId,
      status: 'running',
      runId,
      startedAt,
    });
  }

  /**
   * Handle command run complete.
   * Extracted to avoid excessive callback nesting inside the watch handler.
   */
  function handleCommandRunComplete({ runId, sessionId, buttonId, exitCode, output }) {
    if (!commandButtonsStore.runs[runId]) {
      commandButtonsStore.runs[runId] = {
        runId,
        buttonId,
        sessionId,
        status: 'running',
        output: '',
        exitCode: null,
        startedAt: Date.now(),
        outputTruncated: false,
      };
    }
    commandButtonsStore.completeRun(runId, exitCode, output);

    const status = exitCode === 0 ? 'success' : 'error';
    sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
      buttonId,
      status,
      exitCode,
      runId,
      completedAt: Date.now(),
    });
  }

  /**
   * Handle command run error.
   * Extracted to avoid excessive callback nesting inside the watch handler.
   */
  function handleCommandRunError(runId, sessionId, buttonId, error) {
    if (!commandButtonsStore.runs[runId]) {
      commandButtonsStore.runs[runId] = {
        runId,
        buttonId,
        sessionId,
        status: 'running',
        output: '',
        exitCode: null,
        startedAt: Date.now(),
        outputTruncated: false,
      };
    }
    commandButtonsStore.errorRun(runId, error);

    sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
      buttonId,
      status: 'error',
      runId,
      completedAt: Date.now(),
    });
  }

  /**
   * Register all project-level event handlers and return cleanup functions.
   * @param {Object} subscription - Destructured subscription handlers
   * @param {Object} stores - Store references
   * @param {Object} callbacks - Summary callback functions
   * @returns {Function[]} Array of cleanup functions
   */
  function registerProjectEventHandlers(subscription, stores, callbacks) {
    const {
      onSessionCreated, onSessionUpdated, onSessionDeleted,
      onSessionSummaryUpdated,
      onCommandRunOutput, onCommandRunComplete, onCommandRunError, onCommandRunDeleted,
      onKanbanBoardUpdated, onKanbanCardMoved, onKanbanCardAdded, onKanbanCardRemoved,
    } = subscription;

    const handlers = [];

    handlers.push(onSessionCreated((session) => { stores.sessionsStore.addSessionToList(session); }));
    handlers.push(onSessionUpdated((session) => { stores.sessionsStore.updateSession(session); }));
    handlers.push(onSessionDeleted((sid) => {
      stores.sessionsStore.removeSessionFromList(sid);
      callbacks.cleanupSummary(sid);
    }));
    handlers.push(onSessionSummaryUpdated((sid, summary) => { callbacks.updateSummary(sid, summary); }));
    handlers.push(onCommandRunOutput(handleCommandRunOutput));
    handlers.push(onCommandRunComplete(handleCommandRunComplete));
    handlers.push(onCommandRunError(handleCommandRunError));
    handlers.push(onCommandRunDeleted((runId, sid, buttonId) => {
      stores.commandButtonsStore.clearRun(runId);
      stores.sessionsStore.removeSessionCommandRun(sid, buttonId);
    }));
    handlers.push(onKanbanBoardUpdated((board) => { stores.kanbanStore.handleBoardUpdated(board); }));
    handlers.push(onKanbanCardMoved((cardId, fromLaneId, toLaneId, card) => {
      stores.kanbanStore.handleCardMoved(cardId, fromLaneId, toLaneId, card);
    }));
    handlers.push(onKanbanCardAdded((card, laneId) => { stores.kanbanStore.handleCardAdded(card, laneId); }));
    handlers.push(onKanbanCardRemoved((cardId, laneId) => { stores.kanbanStore.handleCardRemoved(cardId, laneId); }));

    return handlers;
  }

  // Store cleanup functions for WebSocket listeners
  const cleanups = [];

  // Track current unsubscribe function for cleanup when projectId changes
  let currentUnsubscribe = null;

  // Track if archived sessions have been loaded
  const archivedLoaded = ref(false);

  // Watch for projectId changes to properly subscribe/unsubscribe
  watch(
    projectId,
    async (newProjectId) => {
      if (!newProjectId) return;

      // Reset archived sessions loaded flag when changing projects
      archivedLoaded.value = false;

      // Clean up previous subscription handlers
      cleanups.forEach((cleanup) => cleanup());
      cleanups.length = 0;

      // Unsubscribe from old project
      if (currentUnsubscribe) {
        currentUnsubscribe();
        currentUnsubscribe = null;
      }

      // Fetch new project data
      await projectsStore.fetchProject(newProjectId);
      await sessionsStore.fetchSessions(newProjectId);
      await commandButtonsStore.fetchButtons(newProjectId);
      fetchSummariesBatch(sessionsStore.sessions);

      // Create new subscription for new project
      const {
        subscribe,
        unsubscribe,
        onSessionCreated,
        onSessionUpdated,
        onSessionDeleted,
        onSessionSummaryUpdated,
        onCommandRunOutput,
        onCommandRunComplete,
        onCommandRunError,
        onCommandRunDeleted,
        onKanbanBoardUpdated,
        onKanbanCardMoved,
        onKanbanCardAdded,
        onKanbanCardRemoved,
      } = useProjectSubscription(newProjectId);

      currentUnsubscribe = unsubscribe;
      subscribe();

      cleanups.push(...registerProjectEventHandlers(
        {
          onSessionCreated, onSessionUpdated, onSessionDeleted,
          onSessionSummaryUpdated,
          onCommandRunOutput, onCommandRunComplete, onCommandRunError, onCommandRunDeleted,
          onKanbanBoardUpdated, onKanbanCardMoved, onKanbanCardAdded, onKanbanCardRemoved,
        },
        { sessionsStore, commandButtonsStore, kanbanStore },
        { updateSummary, cleanupSummary },
      ));
    },
    { immediate: true }
  );

  // Save expanded state and cleanup WebSocket listeners on unmount
  onUnmounted(() => {
    cleanups.forEach((cleanup) => cleanup());
    if (currentUnsubscribe) {
      currentUnsubscribe();
    }
  });

  return {
    archivedLoaded,
  };
}
