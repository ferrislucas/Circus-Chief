import { sessions } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as summaryService from './summaryService.js';
import { createVisibleFinalErrorMessage, normalizeFinalErrorMessage } from './visibleFinalErrorMessage.js';
import { handleResultUsage } from './streamUsageHandler.js';

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
    const streamError = Object.assign(new Error(message),
      event.error && typeof event.error === 'object' ? event.error : {},
      Number.isFinite(event.status) ? { status: event.status } : {});
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
