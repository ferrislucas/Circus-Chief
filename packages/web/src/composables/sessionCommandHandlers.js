/**
 * Register command button WebSocket handlers (output, complete, error, deleted).
 * Extracted from useSessionInitializer to keep that composable focused on the
 * session lifecycle ordering; the behavior is unchanged.
 *
 * @param {Object} subscription - The session subscription object
 * @param {string} sessionId - Current session ID
 * @param {Object} stores - Object containing sessionsStore and commandButtonsStore
 * @returns {Function[]} Array of cleanup functions
 */
export function registerCommandHandlers(subscription, sessionId, stores) {
  const { sessionsStore, commandButtonsStore } = stores;
  const { onCommandStarted, onCommandOutput, onCommandComplete, onCommandError, onCommandRunDeleted } = subscription;
  const handlers = [];

  if (onCommandStarted) handlers.push(
    onCommandStarted((runId, buttonId) => {
      const startedAt = Date.now();
      if (!commandButtonsStore.runs[runId]) {
        commandButtonsStore.runs[runId] = {
          runId, buttonId, sessionId, status: 'running', output: '', exitCode: null,
          startedAt, outputTruncated: false,
        };
      }
      sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
        buttonId, status: 'running', runId, startedAt,
      });
    })
  );

  handlers.push(
    onCommandOutput((runId, buttonId, output) => {
      const existingRun = commandButtonsStore.runs[runId];
      const existingSessionRun = sessionsStore.currentSession?.latestCommandRuns?.find(r => r.runId === runId);
      sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
        buttonId,
        status: 'running',
        runId,
        startedAt: existingRun?.startedAt || existingSessionRun?.startedAt || Date.now(),
      });
    })
  );

  handlers.push(
    onCommandComplete((runId, buttonId, exitCode, output) => {
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
    onCommandError((runId, buttonId, error) => {
      sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
        buttonId,
        status: 'error',
        runId,
        completedAt: Date.now(),
      });
    })
  );

  handlers.push(
    onCommandRunDeleted(async (runId, buttonId) => {
      console.log('[onCommandRunDeleted] Run deleted:', runId, 'for button:', buttonId);
      commandButtonsStore.clearRun(runId);
      try {
        await sessionsStore.fetchSession(sessionId, false);
        console.log('[onCommandRunDeleted] Session refetched, latestCommandRuns:', sessionsStore.currentSession?.latestCommandRuns);
        sessionsStore.commandRunVersion++;
        console.log('[onCommandRunDeleted] commandRunVersion incremented to:', sessionsStore.commandRunVersion);
      } catch (error) {
        console.error('Failed to fetch session after run deletion:', error);
        sessionsStore.removeSessionCommandRun(sessionId, buttonId);
      }
    })
  );

  return handlers;
}
