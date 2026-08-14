/**
 * Boot-time recovery for sessions that were left in 'starting' status after a
 * server crash or kill.  In-process timeout handlers do not run when the process
 * is killed, so a server restart is the only reliable time to clean up.
 */

import { sessions } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

/** Default threshold: sessions stuck in 'starting' for longer than this are stale. */
const DEFAULT_STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Find sessions that are still in 'starting' and have not been updated recently,
 * mark them as 'error', and broadcast the change to their projects.
 *
 * Call once during server boot, after initDatabase() and before any services start.
 *
 * @returns {{ recovered: number }} Count of sessions recovered.
 */
export function recoverStaleStartingSessions() {
  const thresholdMs =
    Number(process.env.STALE_STARTING_THRESHOLD_MS) || DEFAULT_STALE_THRESHOLD_MS;
  const cutoff = Date.now() - thresholdMs;

  const stale = sessions.getStaleStartingSessions(cutoff);

  for (const session of stale) {
    const errorMessage = 'Recovered stale starting session after server restart. Startup likely failed before the agent launched.';
    const updatedSession = sessions.update(session.id, {
      status: 'error',
      error: errorMessage,
    });

    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId: session.projectId,
      sessionId: session.id,
      session: updatedSession,
    });

    console.warn(
      `[sessionStartupRecovery] Recovered stale starting session ${session.id} (project ${session.projectId})`
    );
  }

  if (stale.length > 0) {
    console.log(`[sessionStartupRecovery] Recovered ${stale.length} stale starting session(s).`);
  }

  return { recovered: stale.length };
}

/**
 * Find sessions still marked 'running' from a previous process and mark them
 * stopped.
 *
 * Agent processes do not survive the server that spawned them, so a 'running'
 * row at boot is always an orphan. This is the backstop for turns whose
 * terminal status write never happened — a killed process, or an abort that
 * unwound without any handler recording an outcome. Sessions land on 'stopped'
 * rather than 'error' because an orphaned row is not evidence that the work
 * itself failed, and 'stopped' leaves the session able to receive follow-ups.
 *
 * Call once during server boot, after initDatabase() and before any services start.
 *
 * @returns {{ recovered: number }} Count of sessions recovered.
 */
export function recoverOrphanedRunningSessions() {
  const orphaned = sessions.getOrphanedRunningSessions();

  for (const session of orphaned) {
    const updatedSession = sessions.update(session.id, {
      status: 'stopped',
      executionState: 'stopped',
    });

    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId: session.projectId,
      sessionId: session.id,
      session: updatedSession,
    });

    console.warn(
      `[sessionStartupRecovery] Recovered orphaned running session ${session.id} (project ${session.projectId})`
    );
  }

  if (orphaned.length > 0) {
    console.log(`[sessionStartupRecovery] Recovered ${orphaned.length} orphaned running session(s).`);
  }

  return { recovered: orphaned.length };
}
