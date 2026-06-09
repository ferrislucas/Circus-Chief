import { useSessionsStore } from '../stores/sessions.js';

/**
 * Find the nearest scheduled time across all sessions in a workflow tree.
 *
 * The root session's scheduled time is returned even when it is in the past,
 * which preserves the existing session-card behavior and surfaces stale
 * scheduling state. Descendant sessions only count when scheduled in the
 * future.
 *
 * @param {string} rootSessionId
 * @returns {string|number|null}
 */
export function findNearestScheduledTime(rootSessionId) {
  const sessionsStore = useSessionsStore();
  const allSessions = sessionsStore.getWorkflowSessions(rootSessionId);
  const rootSession =
    sessionsStore.getSessionById?.(rootSessionId) ||
    allSessions.find((session) => session.id === rootSessionId);
  if (!rootSession) return null;

  if (rootSession.status === 'scheduled' && rootSession.scheduledAt) {
    return rootSession.scheduledAt;
  }

  const now = Date.now();
  let earliest = null;

  for (const session of allSessions) {
    if (session.id === rootSessionId) continue;

    if (session.status === 'scheduled' && session.scheduledAt) {
      const scheduledTime = new Date(session.scheduledAt).getTime();
      if (scheduledTime >= now && (earliest === null || scheduledTime < earliest)) {
        earliest = scheduledTime;
      }
    }
  }

  return earliest;
}
