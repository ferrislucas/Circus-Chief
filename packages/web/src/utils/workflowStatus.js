const RUNNING_STATUSES = new Set(['running', 'starting']);
const COMPLETED_STATUSES = new Set(['completed', 'stopped']);

// A process paused on an interactive prompt still reports "running" from the
// runner. It is waiting for a person, though, so it must not drive running
// controls, counters, or effective workflow status.
export function isSessionActivelyRunning(session) {
  return Boolean(session)
    && !session.pendingAgentInput
    && RUNNING_STATUSES.has(session.status);
}

export function collectWorkflowSessions(root, findChildren) {
  if (!root) return [];
  const sessions = [root];
  const stack = [root.id];
  const visited = new Set();
  while (stack.length > 0) {
    const sessionId = stack.pop();
    if (visited.has(sessionId)) continue;
    visited.add(sessionId);
    for (const child of findChildren(sessionId)) {
      sessions.push(child);
      stack.push(child.id);
    }
  }
  return sessions;
}

export function summarizeWorkflowSessions(sessions) {
  const summary = {
    runningCount: 0,
    waitingCount: 0,
    scheduledCount: 0,
    completedCount: 0,
    totalCount: sessions.length,
  };
  for (const session of sessions) {
    summary.runningCount += Number(isSessionActivelyRunning(session));
    summary.waitingCount += Number(Boolean(session.pendingAgentInput));
    summary.scheduledCount += Number(session.status === 'scheduled');
    summary.completedCount += Number(COMPLETED_STATUSES.has(session.status));
  }
  return {
    ...summary,
    effectiveStatus: summary.runningCount > 0
      ? 'running'
      : summary.waitingCount > 0 ? 'waiting' : 'idle',
  };
}
