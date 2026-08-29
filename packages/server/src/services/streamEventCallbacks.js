import { sessions, conversations, messages } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as summaryService from './summaryService.js';
import { createVisibleFinalErrorMessage } from './visibleFinalErrorMessage.js';
import { turnEndedDueToLimitOrOutage } from './sessionErrors.js';
import {
  lastMessageIds,
  activeSessions,
  activeConversationIds,
  finalErrorSessionIds,
  associateAndBroadcastWorkLogs,
  broadcastSessionStatus,
  broadcastChangesUpdate,
  getResultEvent,
} from './streamEventHandler.js';
import { applyPendingWakeup, clearPendingWakeup } from './scheduleWakeupBridge.js';
import { withActiveLaneRunOwnership } from './workflowSessionService.js';
import { broadcastSessionUpdate } from './summaryBroadcast.js';

/**
 * Broadcast the session- and project-scoped updates for a status transition to
 * 'scheduled'. Consolidates the three hand-rolled calls previously inlined here
 * onto `broadcastSessionUpdate` (summaryBroadcast.js), which itself emits the
 * session-scoped SESSION_STATUS event when the payload carries a status.
 * @param {string} sessionId
 * @param {object} updated
 */
function broadcastScheduledStatus(sessionId, updated) {
  broadcastSessionUpdate(sessionId, updated?.projectId, updated);
}

/**
 * Re-apply scheduled status after a turn ends if the session was scheduled
 * mid-turn — either by the agent calling POST /api/sessions/:id/schedule, or
 * by it calling the SDK's built-in ScheduleWakeup tool (translated into the
 * same scheduledAt/pendingPrompt fields by scheduleWakeupBridge).
 *
 * Invariant this predicate relies on: the scheduler clears scheduledAt and
 * pendingPrompt when it starts a scheduled run (`schedulerService.startScheduledSession`
 * / `startFreshScheduledSession`). That clearing — not a status guard — is what
 * guarantees a normally-running turn never carries a stray scheduledAt into
 * completion.
 *
 * This predicate is intentionally status-agnostic. It is invoked from the
 * completion path (after the `waiting` write) and from the error path (while
 * status is still `running`). Do NOT add a status guard here — it would silently
 * break the error path.
 *
 * Returns true when it fires (status flipped to 'scheduled') so callers can skip
 * automatic side effects (auto-send, error reschedule, template triggers) for this turn.
 *
 * @param {string} sessionId
 * @param {AbortController} controller
 * @param {{ applyWakeup?: boolean }} options
 * @returns {Promise<boolean>}
 */
async function handleScheduledContinuationIfNeeded(sessionId, controller, { applyWakeup = true } = {}) {
  // Materialize a ScheduleWakeup call made during this turn into the same
  // scheduledAt/pendingPrompt fields the REST endpoint writes, so the predicate
  // below treats both origins identically. No-op when none was captured, and a
  // no-op when an explicit REST schedule already exists (that one wins).
  if (applyWakeup) applyPendingWakeup(sessionId, controller);

  const session = sessions.getById(sessionId);
  if (!session) return false;
  const hasPendingPrompt = typeof session.pendingPrompt === 'string' && session.pendingPrompt.trim() !== '';
  // Require a strictly positive finite timestamp so a zero/negative persisted value
  // can never accidentally flip the session to 'scheduled'.
  if (Number.isFinite(session.scheduledAt) && session.scheduledAt > 0 && hasPendingPrompt) {
    const transition = () => (session.status === 'scheduled'
      ? sessions.getById(sessionId) // already scheduled by applyPendingWakeup — no-op write
      : sessions.update(sessionId, { status: 'scheduled', error: null }));
    // Mirror the REST endpoint's and the bridge's lane-run fencing so a
    // superseded worker cannot be flipped back to 'scheduled' by a leftover
    // schedule row on either the completion or the error path.
    const updated = session.laneRunId
      ? withActiveLaneRunOwnership(sessionId, transition)
      : transition();
    if (!updated) {
      console.warn(
        `[handleScheduledContinuationIfNeeded] Session ${sessionId}: refusing to restore 'scheduled' status; lane run was superseded.`
      );
      return false;
    }
    broadcastScheduledStatus(sessionId, updated);
    return true;
  }
  return false;
}

/**
 * Associate work logs with the last message and clean up tracking state.
 * @param {string} sessionId
 */
function associateAndCleanupWorkLogs(sessionId) {
  const lastMessageId = lastMessageIds.get(sessionId);
  if (lastMessageId) {
    associateAndBroadcastWorkLogs(sessionId, lastMessageId);
    lastMessageIds.delete(sessionId);
  }
}

/**
 * Handle post-turn activities for a session that's ready for follow-up.
 * @param {string} sessionId
 * @param {string} workingDirectory
 * @param {{ checkProactiveReschedule?: Function, handleAutoSendIfNeeded?: Function, handleTemplateTriggerIfNeeded?: Function }} callbacks
 * @returns {Promise<{wasRescheduled: boolean, heldForLimit: boolean}>}
 */
async function handleActiveSessionCompletion(sessionId, workingDirectory, callbacks, controller) {
  // Apply first, then decide whether to suppress the waiting transition. A
  // merely captured wakeup is not sufficient: deferred-loop resolution and
  // lane ownership can still reject it at this boundary.
  const wasScheduledMidTurn = await handleScheduledContinuationIfNeeded(sessionId, controller);

  if (!wasScheduledMidTurn) {
    sessions.update(sessionId, { status: 'waiting', error: null });
    broadcastSessionStatus(sessionId, 'waiting');
  }

  // Applying a wakeup can create a diagnostic work log when it loses to a
  // later explicit schedule or its lane run was superseded. Associate only
  // after that work so the diagnostic belongs to this turn's final message.
  associateAndCleanupWorkLogs(sessionId);

  // Check if session should be proactively rescheduled based on token threshold.
  // Explicit mid-turn continuations win over automatic token-management reschedules.
  // A proactively-rescheduled turn — held or not — never advances the card and
  // must not run any other normal-completion side effect either: the session is
  // about to be re-run automatically, so PR extraction, summary activity, changes
  // broadcast, auto-send, and the next-template trigger belong to the *continued*
  // turn, not this one. Running them here would let the next-template trigger
  // double-drive a session that's simultaneously scheduled to retry (Issue 3).
  const { checkProactiveReschedule } = callbacks;
  let wasProactivelyRescheduled = false;
  if (!wasScheduledMidTurn && checkProactiveReschedule) {
    wasProactivelyRescheduled = await checkProactiveReschedule(sessionId);
    if (wasProactivelyRescheduled) {
      return { wasRescheduled: true, heldForLimit: false }; // Session was rescheduled, don't continue with normal completion
    }
  }

  // Extract PR URL immediately (lightweight, no API call)
  summaryService.extractPrUrlIfNeeded(sessionId);
  // Trigger debounced summary generation on turn completion (not complete yet)
  summaryService.onSessionActivity(sessionId);

  // Broadcast changes update when turn completes (real-time indicator)
  const currentSession = sessions.getById(sessionId);
  if (currentSession) {
    await broadcastChangesUpdate(sessionId, currentSession.projectId, workingDirectory);
  }

  // A card transition is now owned exclusively by workflowSessionService.
  // Keep provider limits visible to the caller so a participating obligation
  // remains open instead of being treated as a completed turn.
  const shouldHoldKanbanCompletion = turnEndedDueToLimitOrOutage(sessionId, getResultEvent(sessionId));

  // Auto-send queued prompt if enabled (runs BEFORE template trigger)
  const { handleAutoSendIfNeeded, handleTemplateTriggerIfNeeded } = callbacks;
  let autoSendFired = false;
  if (!wasScheduledMidTurn && handleAutoSendIfNeeded) {
    autoSendFired = await handleAutoSendIfNeeded(sessionId);
  }

  // Only trigger next template if auto-send did NOT fire
  // (if auto-send fired, template will trigger after that turn completes)
  if (!wasScheduledMidTurn && !autoSendFired && handleTemplateTriggerIfNeeded) {
    await handleTemplateTriggerIfNeeded(sessionId);
  }

  // Both a deliberate mid-turn schedule and a proactive token reschedule leave
  // a continuation obligation open. Propagate either outcome to the execution
  // layer so it cannot finalize participating lane work as successful.
  return {
    wasRescheduled: wasScheduledMidTurn || wasProactivelyRescheduled,
    heldForLimit: shouldHoldKanbanCompletion,
  };
}

/**
 * Handle post-turn completion logic (after stream loop ends successfully)
 * Encapsulates the duplicated completion block from runSession/continueSession/continueSessionWithExistingMessage
 * @param {string} sessionId
 * @param {string} workingDirectory
 * @param {{ handleTemplateTriggerIfNeeded?: Function, checkProactiveReschedule?: Function, handleAutoSendIfNeeded?: Function }} callbacks
 */
export async function handleTurnCompletion(sessionId, workingDirectory, callbacks = {}, { controller } = {}) {
  // Sessions with final errors should not transition to waiting
  if (finalErrorSessionIds.has(sessionId)) {
    finalErrorSessionIds.delete(sessionId);
    clearPendingWakeup(sessionId, controller || activeSessions.get(sessionId)?.controller);
    associateAndCleanupWorkLogs(sessionId);
    return { wasRescheduled: false, heldForLimit: false };
  }

  // Session ready for follow-up - set to waiting instead of completed
  const activeSession = activeSessions.get(sessionId);
  const turnController = controller || activeSession?.controller;
  if (activeSession && activeSession.controller === turnController && !turnController?.signal?.aborted) {
    return handleActiveSessionCompletion(sessionId, workingDirectory, callbacks, turnController);
  }

  clearPendingWakeup(sessionId, turnController);
  associateAndCleanupWorkLogs(sessionId);
  finalizeAbortedTurnStatus(sessionId, turnController);
  return { wasRescheduled: false, heldForLimit: false };
}

/**
 * A turn may take time to unwind after abort(). Do not let it overwrite a
 * newer turn that has registered itself for the same session in the meantime.
 */
function turnStillOwnsStatusWrite(sessionId, controller) {
  const activeSession = activeSessions.get(sessionId);
  if (activeSession) return activeSession.controller === controller;
  return Boolean(controller && sessions.getById(sessionId)?.status === 'running');
}

/**
 * Land a terminal status for a turn that ended without one.
 *
 * An aborted turn is not ready for follow-up, so it must not land 'waiting' —
 * but it still has to land somewhere. An abort makes the stream loop exit
 * gracefully rather than throw, so the error path never runs either, and a
 * turn returning from handleTurnCompletion without a status write stayed
 * 'running' forever.
 *
 * Guarded on 'running' so this only closes out a turn nobody else accounted
 * for: callers that already recorded an outcome (stopSession, lane-run
 * supersession) and sessions restarted since the abort keep the status they
 * were given.
 *
 * @param {string} sessionId
 */
export function finalizeAbortedTurnStatus(sessionId, controller) {
  if (!turnStillOwnsStatusWrite(sessionId, controller)) return;
  sessions.update(sessionId, { status: 'stopped', executionState: 'stopped' });
  broadcastSessionStatus(sessionId, 'stopped');
}

/**
 * Determine retry mode for a session error reschedule.
 * Returns { retryExistingMessage, conversationId }.
 *
 * If the active conversation has a last user message and no assistant message
 * after it, we retry the existing user message (no duplicate). Otherwise we
 * schedule a "Continue" prompt.
 *
 * @param {string} sessionId
 * @returns {{ retryExistingMessage: boolean, conversationId: string|null }}
 */
function computeRetryMode(sessionId) {
  const activeConversationId = activeConversationIds.get(sessionId);
  if (!activeConversationId) {
    return { retryExistingMessage: false, conversationId: null };
  }

  const convMessages = messages.getByConversationId(activeConversationId);
  // Find the last user message index and whether an assistant message follows it
  let lastUserIndex = -1;
  for (let i = convMessages.length - 1; i >= 0; i--) {
    if (convMessages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  if (lastUserIndex === -1) {
    // No user message found — can't retry existing message
    return { retryExistingMessage: false, conversationId: null };
  }

  const hasAssistantAfterLastUser = convMessages
    .slice(lastUserIndex + 1)
    .some(m => m.role === 'assistant');

  if (!hasAssistantAfterLastUser) {
    // The turn hasn't started yet: retry the existing user message
    return { retryExistingMessage: true, conversationId: activeConversationId };
  }

  // Partial turn already has assistant content: next attempt should Continue
  return { retryExistingMessage: false, conversationId: null };
}

/**
 * Try to reschedule the session due to an error.
 * Returns true if rescheduled, false otherwise.
 * @param {string} sessionId
 * @param {Error} error
 * @param {Function} shouldRescheduleOnError
 * @param {Object} schedulerService
 * @returns {Promise<boolean>}
 */
async function tryRescheduleOnError(sessionId, error, shouldRescheduleOnError, schedulerService) {
  const session = sessions.getById(sessionId);
  if (!session || !shouldRescheduleOnError(session, error, sessionId)) {
    return false;
  }

  // Determine retry mode: re-use existing user message or send "Continue"
  const { retryExistingMessage, conversationId } = computeRetryMode(sessionId);

  const rescheduled = await schedulerService.rescheduleSession(
    sessionId,
    error.message,
    { retryExistingMessage, conversationId }
  );
  if (rescheduled) {
    console.log(`[SessionManager] Session ${sessionId} rescheduled due to error (retryExistingMessage=${retryExistingMessage})`);
    return true;
  }
  return false;
}

/**
 * Broadcast the final conversation state for error handling.
 * @param {string} sessionId
 */
function broadcastFinalConversationState(sessionId) {
  const errorConversationId = activeConversationIds.get(sessionId);
  const finalConversation = errorConversationId
    ? conversations.getById(errorConversationId)
    : null;
  if (finalConversation) {
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.CONVERSATION_UPDATED, {
      sessionId,
      conversation: finalConversation,
    });
  }
  broadcastSessionStatus(sessionId, 'error');
}

/**
 * Safely trigger the template handler, catching any errors.
 * @param {string} sessionId
 * @param {Function} handleTemplateTriggerIfNeeded
 */
async function safeTriggerTemplate(sessionId, handleTemplateTriggerIfNeeded) {
  try {
    await handleTemplateTriggerIfNeeded(sessionId);
  } catch (templateError) {
    console.error(`[handleSessionError] Template trigger failed for session ${sessionId}:`, templateError);
  }
}

/**
 * Handle session error with optional rescheduling
 * Encapsulates the duplicated error handling block from runSession/continueSession/continueSessionWithExistingMessage
 * @param {string} sessionId
 * @param {Error} error
 * @param {{ controller: AbortController, shouldRescheduleOnError: Function, schedulerService: Object, errorLabel?: string, broadcastConversationState?: boolean, handleTemplateTriggerIfNeeded?: Function }} options
 */
export async function handleSessionError(sessionId, error, options = {}) {
  const { controller, shouldRescheduleOnError, schedulerService } = options;
  const errorLabel = options.errorLabel || 'Session error';
  console.error(`${errorLabel}:`, error);
  console.error('Error stack:', error.stack);

  // ScheduleWakeup is success-only. An explicit REST schedule remains on the
  // row and is still honoured below, but this turn's captured SDK wakeup must
  // not survive an error or be inherited by a replacement turn.
  clearPendingWakeup(sessionId, controller);

  if (controller.signal.aborted) {
    // A user-initiated stop is intentional. A mid-turn-scheduled session that the
    // user stops will have its schedule cleared by the stop handler; we honour that
    // by not preserving the schedule here.
    finalizeAbortedTurnStatus(sessionId, controller);
    return false;
  }

  // Explicit mid-turn schedule wins over automatic error reschedule, just as it
  // wins over proactive reschedule on the normal completion path.
  // Log the underlying error for diagnostics even when we preserve the schedule.
  const wasScheduledMidTurn = await handleScheduledContinuationIfNeeded(sessionId, controller, { applyWakeup: false });
  if (wasScheduledMidTurn) {
    // Error is noted in the log but the session remains 'scheduled' — no visible
    // error message, no error-reschedule, no template trigger.
    return true;
  }

  // Check if we should reschedule instead of marking as error
  const rescheduled = await tryRescheduleOnError(sessionId, error, shouldRescheduleOnError, schedulerService);
  if (rescheduled) {
    return true;
  }

  // Normal error handling (no reschedule or reschedule limits reached)
  sessions.update(sessionId, { status: 'error', error: error.message });
  createVisibleFinalErrorMessage(sessionId, error, activeConversationIds);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: error.message });

  // Optionally broadcast final conversation state (continueSession does this)
  if (options.broadcastConversationState) {
    broadcastFinalConversationState(sessionId);
  }

  // Extract PR URL before generating summary (PR may have been created before error)
  summaryService.extractPrUrlIfNeeded(sessionId);
  // Trigger summary generation on error
  summaryService.onSessionComplete(sessionId);

  // Trigger next template if configured (e.g., session completed work but process exited with error code)
  if (options.handleTemplateTriggerIfNeeded) {
    await safeTriggerTemplate(sessionId, options.handleTemplateTriggerIfNeeded);
  }

  return false; // Not rescheduled
}
