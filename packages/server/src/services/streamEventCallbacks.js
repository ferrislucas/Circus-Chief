import { sessions, conversations } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as summaryService from './summaryService.js';
import * as kanbanService from './kanbanService.js';
import { createVisibleFinalErrorMessage } from './visibleFinalErrorMessage.js';
import {
  lastMessageIds,
  activeSessions,
  activeConversationIds,
  finalErrorSessionIds,
  associateAndBroadcastWorkLogs,
  broadcastSessionStatus,
  broadcastChangesUpdate,
} from './streamEventHandler.js';

/**
 * Handle post-turn completion logic (after stream loop ends successfully)
 * Encapsulates the duplicated completion block from runSession/continueSession/continueSessionWithExistingMessage
 * @param {string} sessionId
 * @param {string} workingDirectory
 * @param {{ handleTemplateTriggerIfNeeded?: Function, checkProactiveReschedule?: Function, handleAutoSendIfNeeded?: Function }} callbacks
 */
export async function handleTurnCompletion(sessionId, workingDirectory, callbacks = {}) {
  const { handleTemplateTriggerIfNeeded, checkProactiveReschedule: _checkProactiveReschedule, handleAutoSendIfNeeded } = callbacks;
  // Associate work logs with the last message now that the turn is complete
  const lastMessageId = lastMessageIds.get(sessionId);
  if (lastMessageId) {
    associateAndBroadcastWorkLogs(sessionId, lastMessageId);
    lastMessageIds.delete(sessionId);
  }

  if (finalErrorSessionIds.has(sessionId)) {
    finalErrorSessionIds.delete(sessionId);
    return false;
  }

  // Session ready for follow-up - set to waiting instead of completed
  const activeSession = activeSessions.get(sessionId);
  if (activeSession && !activeSession.controller?.signal?.aborted) {
    sessions.update(sessionId, { status: 'waiting', error: null });
    broadcastSessionStatus(sessionId, 'waiting');

    // Check if session should be proactively rescheduled based on token threshold
    if (_checkProactiveReschedule) {
      const wasRescheduled = await _checkProactiveReschedule(sessionId);
      if (wasRescheduled) {
        return true; // Session was rescheduled, don't continue with normal completion
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

    // Handle kanban lane movements based on targetLaneId
    await kanbanService.handleTurnCompletion(sessionId);

    // Auto-send queued prompt if enabled (runs BEFORE template trigger)
    let autoSendFired = false;
    if (handleAutoSendIfNeeded) {
      autoSendFired = await handleAutoSendIfNeeded(sessionId);
    }

    // Only trigger next template if auto-send did NOT fire
    // (if auto-send fired, template will trigger after that turn completes)
    if (!autoSendFired && handleTemplateTriggerIfNeeded) {
      await handleTemplateTriggerIfNeeded(sessionId);
    }
  }
  return false;
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
  const rescheduled = await schedulerService.rescheduleSession(sessionId, error.message);
  if (rescheduled) {
    console.log(`[SessionManager] Session ${sessionId} rescheduled due to error`);
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

  if (controller.signal.aborted) {
    return false;
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
