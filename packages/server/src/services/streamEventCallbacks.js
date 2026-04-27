import { sessions, conversations, messages } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as summaryService from './summaryService.js';
import * as kanbanService from './kanbanService.js';
import {
  lastMessageIds,
  activeSessions,
  activeConversationIds,
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

function normalizeMessageContent(content) {
  return (content || '').trim().replace(/\s+/g, ' ');
}

function buildVisibleErrorContent(agentType, errorMessage) {
  if (agentType === 'codex') {
    return `Codex failed before completing this turn:\n\n${errorMessage}`;
  }
  if (agentType === 'claude-code') {
    return `Claude Code failed before completing this turn:\n\n${errorMessage}`;
  }
  return `The agent failed before completing this turn:\n\n${errorMessage}`;
}

function hasExistingVisibleFailure(conversationMessages, generatedContent, rawErrorMessage) {
  const normalizedGenerated = normalizeMessageContent(generatedContent);
  const normalizedError = normalizeMessageContent(rawErrorMessage);
  const latestMessage = conversationMessages[conversationMessages.length - 1];

  if (
    latestMessage?.role === 'assistant' &&
    normalizeMessageContent(latestMessage.content) === normalizedGenerated
  ) {
    return true;
  }

  let latestUserIndex = -1;
  for (let i = conversationMessages.length - 1; i >= 0; i -= 1) {
    if (conversationMessages[i].role === 'user') {
      latestUserIndex = i;
      break;
    }
  }

  return conversationMessages
    .slice(latestUserIndex + 1)
    .some((message) => {
      if (message.role !== 'assistant') {
        return false;
      }
      const normalizedContent = normalizeMessageContent(message.content);
      return normalizedContent === normalizedGenerated ||
        (normalizedError && normalizedContent.includes(normalizedError));
    });
}

function resolveErrorConversationId(sessionId) {
  const activeConversationId = activeConversationIds.get(sessionId);
  if (activeConversationId) {
    return activeConversationId;
  }
  const activeConversation = conversations.ensureActiveConversation(sessionId);
  if (activeConversation?.id) {
    activeConversationIds.set(sessionId, activeConversation.id);
    return activeConversation.id;
  }
  return null;
}

function createVisibleSessionErrorMessage(sessionId, error) {
  const conversationId = resolveErrorConversationId(sessionId);
  if (!conversationId) {
    return null;
  }

  const session = sessions.getById(sessionId);
  const errorMessage = error?.message || String(error);
  const content = buildVisibleErrorContent(session?.agentType, errorMessage);
  const conversationMessages = messages.getByConversationId(conversationId) || [];

  if (hasExistingVisibleFailure(conversationMessages, content, errorMessage)) {
    return null;
  }

  const message = messages.create(sessionId, 'assistant', content, { conversationId });
  sessions.touch(sessionId);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, {
    message,
    conversationId,
  });
  return message;
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
  createVisibleSessionErrorMessage(sessionId, error);
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
