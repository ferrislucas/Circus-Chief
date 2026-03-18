import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useProjectsStore } from '../stores/projects.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
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

  const { fetchSummariesBatch, updateSummary, cleanupSummary } = summaryCallbacks;

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
      } = useProjectSubscription(newProjectId);

      currentUnsubscribe = unsubscribe;
      subscribe();

      // Handle new session created
      cleanups.push(
        onSessionCreated((session) => {
          sessionsStore.addSessionToList(session);
        })
      );

      // Handle session updated
      cleanups.push(
        onSessionUpdated((session) => {
          sessionsStore.updateSession(session);
        })
      );

      // Handle session deleted
      cleanups.push(
        onSessionDeleted((sessionId) => {
          sessionsStore.removeSessionFromList(sessionId);
          cleanupSummary(sessionId);
        })
      );

      // Handle session summary updated (real-time updates when summaries are generated)
      cleanups.push(
        onSessionSummaryUpdated((sessionId, summary) => {
          updateSummary(sessionId, summary);
        })
      );

      // Handle command run output (for real-time status icon updates)
      cleanups.push(
        onCommandRunOutput((runId, sessionId, buttonId, output) => {
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
        })
      );

      // Handle command run complete
      cleanups.push(
        onCommandRunComplete(({ runId, sessionId, buttonId, exitCode, output }) => {
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
        })
      );

      // Handle command run error
      cleanups.push(
        onCommandRunError((runId, sessionId, buttonId, error) => {
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
        })
      );

      // Handle command run deleted
      cleanups.push(
        onCommandRunDeleted((runId, sessionId, buttonId) => {
          commandButtonsStore.clearRun(runId);
          sessionsStore.removeSessionCommandRun(sessionId, buttonId);
        })
      );
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
