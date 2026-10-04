/**
 * Boot-time recovery for sessions that were left in 'starting' status after a
 * server crash or kill.  In-process timeout handlers do not run when the process
 * is killed, so a server restart is the only reliable time to clean up.
 */

import { sessions } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { closeOwnWork } from './workflowSessionService.js';

/**
 * Find sessions left in 'starting' by the previous server process, mark them as
 * 'error', close any workflow obligation, and broadcast the change.
 *
 * Call once during server boot, after initDatabase() and before any services start.
 *
 * @returns {{ recovered: number }} Count of sessions recovered.
 */
export function recoverOrphanedStartingSessions() {
  const stale = sessions.getOrphanedStartingSessions();

  for (const session of stale) {
    const errorMessage = 'Recovered orphaned starting session after server restart. Startup likely failed before the agent launched.';
    sessions.update(session.id, {
      status: 'error',
      error: errorMessage,
    });

    // Startup work cannot survive this process restart. A participating
    // session must also close its durable obligation so the lane run can
    // reconcile instead of leaving the card pinned to a vanished worker.
    // allowTransition:false guarantees boot recovery can never reach
    // attemptLaneRunTransition — even if the close outcome were ever to look
    // 'succeeded' — so it cannot move a card or create a successor run before
    // preflight has audited the board.
    closeOwnWork(session.id, 'closed_failed', 'orphaned_startup_at_boot', { allowTransition: false });
    const updatedSession = sessions.getById(session.id);

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
    sessions.update(session.id, {
      status: 'stopped',
      executionState: 'stopped',
    });

    // A stopped row is not a closed workflow obligation. Closing it also
    // reconciles the lane run, releasing its card rather than pinning it to a
    // worker which disappeared with the previous server process.
    // allowTransition:false guarantees boot recovery can never reach
    // attemptLaneRunTransition — even if the close outcome were ever to look
    // 'succeeded' — so it cannot move a card or create a successor run before
    // preflight has audited the board.
    closeOwnWork(session.id, 'cancelled', 'orphaned_at_boot', { allowTransition: false });
    const updatedSession = sessions.getById(session.id);

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

/**
 * Clear the durable `pendingAgentInput` mirror on every session that still
 * has it set.
 *
 * promptStore.js's parked-prompt queue (the actual source of truth for
 * "is the agent blocked on AskUserQuestion/permission") is an in-process
 * Map that is always empty immediately after boot — nothing repopulates it
 * from durable storage. A row left with pendingAgentInput=1 from a previous
 * process is therefore permanently stale: it can never be answered or
 * cleared by the normal settle() path, since that path only fires for
 * prompts the new process itself parked. Without this sweep, a project (or
 * workspace) that had a genuinely blocked session at the moment of a crash
 * or restart would show as "waiting" forever, even though every other
 * pendingAgentInput read in the app (which all derive live from
 * hasPendingPrompt()) correctly shows false the moment the process restarts.
 *
 * Call once during boot, after initDatabase() and before any services or
 * clients can observe the stale flag.
 *
 * @returns {{ cleared: number }} Count of sessions cleared.
 */
export function clearStalePendingAgentInput() {
  const cleared = sessions.clearStalePendingAgentInput();

  if (cleared > 0) {
    console.log(`[sessionStartupRecovery] Cleared stale pending_agent_input on ${cleared} session(s).`);
  }

  return { cleared };
}
