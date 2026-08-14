import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useKanbanStore } from '../stores/kanban.js';

/**
 * Keep the command-run and Kanban stores in sync with project-scoped realtime
 * events.
 *
 * The workspace list no longer downloads every session in the project, so this
 * sync is deliberately independent of any session collection: it only applies
 * the payloads the server already pushes. Callers own their own list
 * reconciliation and register that separately.
 *
 * @param {Object} subscription - A `useProjectSubscription(projectId)` instance
 * @param {Object} [streamingScope] - Streaming eligibility policy for output
 * @param {import('vue').Ref<string>} [streamingScope.activeTab]
 * @param {import('vue').Ref<string[]>} [streamingScope.eligibleCommandSessionIds]
 * @returns {Function} cleanup - removes every handler registered here
 */
export function useProjectRealtimeStoreSync(subscription, streamingScope = {}) {
  const sessionsStore = useSessionsStore();
  const commandButtonsStore = useCommandButtonsStore();
  const kanbanStore = useKanbanStore();

  function ensureRun(runId, sessionId, buttonId, startedAt = Date.now()) {
    if (!commandButtonsStore.runs[runId]) {
      commandButtonsStore.runs[runId] = {
        runId, buttonId, sessionId, status: 'running', output: '', exitCode: null,
        startedAt, outputTruncated: false,
      };
    }
    return commandButtonsStore.runs[runId];
  }

  // The streaming output payload is heavy (it fires per chunk), so it is only
  // applied for cards that are actually rendering it. The status/lifecycle
  // update below stays unconditional so collapsed cards keep a correct
  // indicator instead of going stale until the run completes.
  function isOutputEligible(sessionId) {
    const tab = streamingScope.activeTab?.value;
    const eligibleIds = streamingScope.eligibleCommandSessionIds?.value;
    return !tab || tab === 'commands' || (tab === 'sessions' && (eligibleIds || []).includes(sessionId));
  }

  function handleCommandRunStarted(runId, sessionId, buttonId) {
    const startedAt = Date.now();
    ensureRun(runId, sessionId, buttonId, startedAt);
    sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
      buttonId, status: 'running', runId, startedAt,
    });
  }

  function handleCommandRunOutput(runId, sessionId, buttonId, output) {
    const existingRun = commandButtonsStore.runs[runId];
    const storeSession = sessionsStore.sessions.find(s => s.id === sessionId);
    const existingSessionRun = storeSession?.latestCommandRuns?.find(r => r.runId === runId);
    const startedAt = existingRun?.startedAt || existingSessionRun?.startedAt || Date.now();

    ensureRun(runId, sessionId, buttonId, startedAt);
    if (isOutputEligible(sessionId)) commandButtonsStore.appendOutput(runId, output);

    sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
      buttonId, status: 'running', runId, startedAt,
    });
  }

  function handleCommandRunComplete({ runId, sessionId, buttonId, exitCode, output }) {
    ensureRun(runId, sessionId, buttonId);
    commandButtonsStore.completeRun(runId, exitCode, output);
    sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
      buttonId, status: exitCode === 0 ? 'success' : 'error', exitCode, runId, completedAt: Date.now(),
    });
  }

  function handleCommandRunError(runId, sessionId, buttonId, error) {
    ensureRun(runId, sessionId, buttonId);
    commandButtonsStore.errorRun(runId, error);
    sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
      buttonId, status: 'error', runId, completedAt: Date.now(),
    });
  }

  function handleCommandRunDeleted(runId, sessionId, buttonId) {
    commandButtonsStore.clearRun(runId);
    sessionsStore.removeSessionCommandRun(sessionId, buttonId);
  }

  const registrations = [
    ['onSessionUpdated', session => kanbanStore.handleSessionUpdated(session)],
    ['onCommandRunStarted', handleCommandRunStarted],
    ['onCommandRunOutput', handleCommandRunOutput],
    ['onCommandRunComplete', handleCommandRunComplete],
    ['onCommandRunError', handleCommandRunError],
    ['onCommandRunDeleted', handleCommandRunDeleted],
    ['onKanbanBoardUpdated', board => kanbanStore.handleBoardUpdated(board)],
    ['onKanbanCardMoved', (cardId, fromLaneId, toLaneId, card) =>
      kanbanStore.handleCardMoved(cardId, fromLaneId, toLaneId, card)],
    ['onKanbanCardAdded', (card, laneId) => kanbanStore.handleCardAdded(card, laneId)],
    ['onKanbanCardRemoved', (cardId, laneId) => kanbanStore.handleCardRemoved(cardId, laneId)],
  ];

  const cleanups = registrations
    .filter(([name]) => typeof subscription[name] === 'function')
    .map(([name, handler]) => subscription[name](handler));

  return () => {
    for (const cleanup of cleanups) cleanup?.();
    cleanups.length = 0;
  };
}
