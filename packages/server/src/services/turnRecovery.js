/**
 * Recovery guards for automated lane-run turns.
 *
 * Two stuck/false-success outcomes share a root cause — the runner has
 * relinquished authority while the persisted row still claims otherwise:
 * a rejected dispatch that leaves status=starting, and a clean provider
 * close that produced no work yet finalizes the lane obligation.
 */
import { sessions } from '../database.js';
import {
  activeSessions,
  broadcastSessionStatus,
  handleSessionError,
} from './streamEventHandler.js';
import { shouldRescheduleOnError } from './sessionErrors.js';
import { schedulerService } from './schedulerService.js';
import { markExecutionState, closeOwnWork } from './workflowSessionService.js';
import { consumeTurnContinuedExternally, consumeTurnHadSubstantiveOutput } from './turnGuard.js';

/**
 * Land a recoverable terminal status for a dispatch that never started.
 *
 * A rejected handoff (lost lane-run ownership, aborted dispatch) must not
 * leave a session parked in 'starting' with an idle execution and no active
 * process: that combination exposes no stop or prompt control. When no
 * replacement turn owns the session, move it to 'stopped' so it stays
 * recoverable. Never touches sessions that already left 'starting' or that
 * have a live turn.
 * @param {string} sessionId
 * @returns {boolean} Whether the session was reconciled
 */
export function reconcileRejectedDispatch(sessionId) {
  if (activeSessions.has(sessionId)) return false;
  const session = sessions.getById(sessionId);
  if (!session || session.status !== 'starting') return false;
  sessions.update(sessionId, { status: 'stopped', executionState: 'stopped' });
  broadcastSessionStatus(sessionId, 'stopped');
  return true;
}

/**
 * Whether an automated lane-run turn ended empty: its provider stream closed
 * cleanly but produced no substantive assistant result (no assistant message,
 * tool activity, or result text/usage) and no explicit verifiable completion
 * artifact (a scheduled continuation, an auto-send/template continuation, or
 * a provider-limit hold). Such a turn must fail its lane obligation instead
 * of counting as successful solely because the stream ended cleanly.
 *
 * Scoped to non-interactive turns on lane-run participants: interactive
 * follow-ups stay human-recoverable, and non-participating sessions keep
 * their legacy waiting behavior.
 * @param {string} sessionId
 * @param {{ interactive?: boolean }} [options]
 * @returns {boolean}
 */
export function isEmptyAutomatedTurn(sessionId, { interactive = false } = {}) {
  if (interactive) return false;
  if (!sessions.getById(sessionId)?.laneRunId) return false;
  if (consumeTurnContinuedExternally(sessionId)) return false;
  return !consumeTurnHadSubstantiveOutput(sessionId);
}

/**
 * Route a cleanly-closed turn that must not succeed — a terminal result
 * error, or an empty automated turn — through the shared retry policy, then
 * fail its lane obligation. A rescheduled turn keeps execution open instead.
 * @param {string} sessionId
 * @param {Error} error
 */
export async function failCleanTurn(sessionId, error, {
  controller,
  broadcastConversationState = false,
  errorLabel = 'Session error',
  handleTemplateTriggerIfNeeded = null,
  errorAlreadyRecorded = false,
  interactive = false,
  turnToken = null,
} = {}) {
  const rescheduled = await handleSessionError(sessionId, error, {
    controller,
    shouldRescheduleOnError,
    schedulerService,
    broadcastConversationState,
    errorLabel,
    handleTemplateTriggerIfNeeded,
    errorAlreadyRecorded,
    interactive,
  });
  if (rescheduled) {
    markExecutionState(sessionId, 'retrying');
    return;
  }
  closeOwnWork(sessionId, 'closed_failed', error.message, { turnToken });
}
