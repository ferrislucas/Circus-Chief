import { sessions } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as summaryService from './summaryService.js';
import { createVisibleFinalErrorMessage, normalizeFinalErrorMessage } from './visibleFinalErrorMessage.js';
import { handleResultUsage } from './streamUsageHandler.js';

/**
 * Resolve the HTTP status to attribute to a stream result error. Provider
 * SDKs nest the status on the error object (`event.error.status`); that
 * nested value is authoritative. A top-level `event.status` is only a
 * fallback for producers that set it there instead.
 * @param {Object} event - Stream result event.
 * @returns {number|undefined} Finite status, or undefined when absent.
 */
function resolveStreamErrorStatus(event) {
  const nestedStatus = event.error && typeof event.error === 'object' ? event.error.status : undefined;
  if (Number.isFinite(nestedStatus)) return nestedStatus;
  if (Number.isFinite(event.status)) return event.status;
  return undefined;
}

/** Route terminal stream result events without leaking retryable tier failures. */
export function handleStreamResultEvent(sessionId, event, {
  shouldThrowOnResultError,
  finalResultEvents,
  finalErrorSessionIds,
  activeConversationIds,
  broadcastSessionStatus,
} = {}) {
  if (event.subtype === 'error') {
    const message = normalizeFinalErrorMessage(event.error);
    const status = resolveStreamErrorStatus(event);
    const streamError = Object.assign(new Error(message),
      event.error && typeof event.error === 'object' ? event.error : {},
      status !== undefined ? { status } : {});
    if (shouldThrowOnResultError?.(streamError)) throw streamError;
  }

  finalResultEvents.set(sessionId, {
    subtype: event.subtype,
    isError: Boolean(event.is_error),
    resultText: typeof event.result === 'string' ? event.result : '',
  });

  if (event.subtype !== 'error') {
    if (event.total_cost_usd !== undefined) sessions.update(sessionId, { costUsd: event.total_cost_usd });
    if (event.usage || event.modelUsage) handleResultUsage(sessionId, event);
    return;
  }

  const errorMessage = normalizeFinalErrorMessage(event.error);
  finalErrorSessionIds.add(sessionId);
  sessions.update(sessionId, { status: 'error', error: errorMessage });
  createVisibleFinalErrorMessage(sessionId, errorMessage, activeConversationIds);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: errorMessage });
  broadcastSessionStatus(sessionId, 'error');
  summaryService.extractPrUrlIfNeeded(sessionId);
  summaryService.onSessionComplete(sessionId);
}
