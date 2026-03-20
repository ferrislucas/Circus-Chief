import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useProjectsStore } from '../stores/projects.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useKanbanStore } from '../stores/kanban.js';
import { useProjectSubscription } from './useWebSocket.js';

/**
 * Ensure a command run entry exists in the store, creating one if needed.
 * @param {Object} commandButtonsStore - The command buttons store
 * @param {Object} runInfo - Run identification and timing
 * @param {string} runInfo.runId - Run ID
 * @param {string} runInfo.buttonId - Button ID
 * @param {string} runInfo.sessionId - Session ID
 * @param {number} [runInfo.startedAt] - Optional start time (defaults to Date.now())
 */
function ensureRunExists(commandButtonsStore, { runId, buttonId, sessionId, startedAt }) {
  if (!commandButtonsStore.runs[runId]) {
    commandButtonsStore.runs[runId] = {
      runId,
      buttonId,
      sessionId,
      status: 'running',
      output: '',
      exitCode: null,
      startedAt: startedAt || Date.now(),
      outputTruncated: false,
    };
  }
}

/**
 * Register session CRUD and summary event handlers.
 * @returns {Array<Function>} Array of cleanup functions
 */
function registerSessionHandlers(subscription, sessionsStore, summaryCallbacks) {
  const { onSessionCreated, onSessionUpdated, onSessionDeleted, onSessionSummaryUpdated } = subscription;
  const { updateSummary, cleanupSummary } = summaryCallbacks;
  const handlers = [];

  handlers.push(
    onSessionCreated((session) => {
      sessionsStore.addSessionToList(session);
    })
  );

  handlers.push(
    onSessionUpdated((session) => {
      sessionsStore.updateSession(session);
    })
  );

  handlers.push(
    onSessionDeleted((sessionId) => {
      sessionsStore.removeSessionFromList(sessionId);
      cleanupSummary(sessionId);
    })
  );

  handlers.push(
    onSessionSummaryUpdated((sessionId, summary) => {
      updateSummary(sessionId, summary);
    })
  );

  return handlers;
}

/**
 * Register command run event handlers.
 * @returns {Array<Function>} Array of cleanup functions
 */
function registerCommandHandlers(subscription, sessionsStore, commandButtonsStore) {
  const { onCommandRunOutput, onCommandRunComplete, onCommandRunError, onCommandRunDeleted } = subscription;
  const handlers = [];

  handlers.push(
    onCommandRunOutput((runId, sessionId, buttonId, output) => {
      const existingRun = commandButtonsStore.runs[runId];
      const sessions = sessionsStore.sessions;
      const storeSession = sessions.find(s => s.id === sessionId);
      const existingSessionRun = storeSession?.latestCommandRuns?.find(r => r.runId === runId);
      const startedAt = existingRun?.startedAt || existingSessionRun?.startedAt || Date.now();

      ensureRunExists(commandButtonsStore, { runId, buttonId, sessionId, startedAt });
      commandButtonsStore.appendOutput(runId, output);

      sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
        buttonId,
        status: 'running',
        runId,
        startedAt,
      });
    })
  );

  handlers.push(
    onCommandRunComplete(({ runId, sessionId, buttonId, exitCode, output }) => {
      ensureRunExists(commandButtonsStore, { runId, buttonId, sessionId });
      commandButtonsStore.completeRun(runId, exitCode, output);

      const status = exitCode === 0 ? 'success' : 'error';
      sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
        buttonId,
        status,
        exitCode,
        runId,
        completedAt: Date.now(),
      });
    })
  );

  handlers.push(
    onCommandRunError((runId, sessionId, buttonId, error) => {
      ensureRunExists(commandButtonsStore, { runId, buttonId, sessionId });
      commandButtonsStore.errorRun(runId, error);

      sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
        buttonId,
        status: 'error',
        runId,
        completedAt: Date.now(),
      });
    })
  );

  handlers.push(
    onCommandRunDeleted((runId, sessionId, buttonId) => {
      commandButtonsStore.clearRun(runId);
      sessionsStore.removeSessionCommandRun(sessionId, buttonId);
    })
  );

  return handlers;
}

/**
 * Register kanban event handlers.
 * @returns {Array<Function>} Array of cleanup functions
 */
function registerKanbanHandlers(subscription, kanbanStore) {
  const { onKanbanBoardUpdated, onKanbanCardMoved, onKanbanCardAdded, onKanbanCardRemoved } = subscription;
  const handlers = [];

  handlers.push(
    onKanbanBoardUpdated((board) => {
      kanbanStore.handleBoardUpdated(board);
    })
  );

  handlers.push(
    onKanbanCardMoved((cardId, fromLaneId, toLaneId, card) => {
      kanbanStore.handleCardMoved(cardId, fromLaneId, toLaneId, card);
    })
  );

  handlers.push(
    onKanbanCardAdded((card, laneId) => {
      kanbanStore.handleCardAdded(card, laneId);
    })
  );

  handlers.push(
    onKanbanCardRemoved((cardId, laneId) => {
      kanbanStore.handleCardRemoved(cardId, laneId);
    })
  );

  return handlers;
}

/**
 * Composable that encapsulates the WebSocket subscription setup for a project's
 * session list view. Handles:
 * - Subscribing/unsubscribing to project WebSocket channels on projectId change
 * - Registering all event handlers (session CRUD, summary updates, command runs, kanban)
 * - Fetching initial project data (project info, sessions, command buttons)
 * - Cleaning up handlers on unmount or project change
 *
 * @param {import('vue').ComputedRef<string>} projectId - Reactive project ID
 * @param {Object} summaryCallbacks - Callbacks for summary management
 * @param {Function} summaryCallbacks.fetchSummariesBatch - Batch fetch summaries for sessions
 * @param {Function} summaryCallbacks.updateSummary - Update a single summary
 * @param {Function} summaryCallbacks.cleanupSummary - Clean up summary data for a deleted session
 */
export function useProjectSessionSubscription(projectId, summaryCallbacks) {
  const projectsStore = useProjectsStore();
  const sessionsStore = useSessionsStore();
  const commandButtonsStore = useCommandButtonsStore();
  const kanbanStore = useKanbanStore();

  const { fetchSummariesBatch } = summaryCallbacks;

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
      projectsStore.fetchProject(newProjectId);
      await sessionsStore.fetchSessions(newProjectId);
      await commandButtonsStore.fetchButtons(newProjectId);
      fetchSummariesBatch(sessionsStore.sessions);

      // Create new subscription for new project
      const subscription = useProjectSubscription(newProjectId);

      currentUnsubscribe = subscription.unsubscribe;
      subscription.subscribe();

      // Register all handler groups
      cleanups.push(...registerSessionHandlers(subscription, sessionsStore, summaryCallbacks));
      cleanups.push(...registerCommandHandlers(subscription, sessionsStore, commandButtonsStore));
      cleanups.push(...registerKanbanHandlers(subscription, kanbanStore));
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
