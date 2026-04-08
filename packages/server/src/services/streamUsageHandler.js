import { sessions, conversations } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { updateTurnUsage, currentTurnUsage, estimatedOutputTokens, estimateTokens } from './usageTracker.js';
import { activeConversationIds, currentModels } from './streamEventHandler.js';

// ── Stream usage helpers ────────────────────────────────────────────────────
// Extracted from streamEventHandler.js to keep it under the max-lines limit.

/**
 * Handle stream_event > message_start — initial usage (input tokens)
 * @param {string} sessionId
 * @param {Object} event
 */
export function handleMessageStart(sessionId, event) {
  const usage = event.event?.message?.usage;
  if (usage) {
    const conversationId = activeConversationIds.get(sessionId);
    const turnUsage = updateTurnUsage(conversationId, usage, 'message_start');
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE, {
      sessionId,
      conversationId,
      usage: turnUsage,
      isFinal: false,
    });
  }
}

/**
 * Handle stream_event > message_delta — streaming output tokens
 * @param {string} sessionId
 * @param {Object} event
 */
export function handleMessageDelta(sessionId, event) {
  const usage = event.event?.usage;
  if (usage) {
    const conversationId = activeConversationIds.get(sessionId);
    const turnUsage = updateTurnUsage(conversationId, usage, 'message_delta');
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE, {
      sessionId,
      conversationId,
      usage: turnUsage,
      isFinal: false,
    });
  }
}

/**
 * Handle text_delta within content_block_delta — accumulate text and estimate tokens
 * @param {string} sessionId
 * @param {Object} delta
 * @param {Map} textAccumulators
 */
export function handleTextDelta(sessionId, delta, textAccumulators) {
  // Accumulate text content
  const current = textAccumulators.get(sessionId) || '';
  const accumulated = current + delta.text;
  textAccumulators.set(sessionId, accumulated);

  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_PARTIAL, {
    sessionId,
    text: accumulated,
  });

  // Estimate tokens from streamed content for real-time output token updates
  const conversationId = activeConversationIds.get(sessionId);
  if (!conversationId) return;

  const currentEstimate = estimatedOutputTokens.get(conversationId) || 0;
  const newEstimate = currentEstimate + estimateTokens(delta.text);
  estimatedOutputTokens.set(conversationId, newEstimate);

  // Get current turn usage and add estimated output
  const turnData = currentTurnUsage.get(conversationId) || {
    inputTokens: 0,
    outputTokens: 0,
    lastMessageOutput: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };

  // Broadcast usage update with estimated tokens
  const broadcastUsage = {
    inputTokens: turnData.inputTokens,
    outputTokens: turnData.outputTokens + Math.max(turnData.lastMessageOutput, newEstimate),
    cacheReadInputTokens: turnData.cacheReadInputTokens,
    cacheCreationInputTokens: turnData.cacheCreationInputTokens,
  };

  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE, {
    sessionId,
    conversationId,
    usage: broadcastUsage,
    isFinal: false,
    isEstimate: true,  // Flag so UI can show "~" prefix if desired
  });
}

/**
 * Extract turn usage from result event's modelUsage or usage fields
 * @param {string} sessionId
 * @param {Object} event
 * @returns {Object} turnUsage
 */
export function extractTurnUsage(sessionId, event) {
  // Extract from modelUsage if available (has more detail)
  const modelUsageEntry = event.modelUsage
    ? Object.values(event.modelUsage)[0]
    : null;

  // Use the model from system.init (stored in currentModels) rather than modelUsage keys
  // because modelUsage can contain multiple models when sub-agents are used (e.g., Opus using Haiku)
  // and Object.keys()[0] would pick the wrong model
  const primaryModel = currentModels.get(sessionId) || Object.keys(event.modelUsage || {})[0] || null;

  return {
    inputTokens: modelUsageEntry?.inputTokens || event.usage?.input_tokens || 0,
    outputTokens: modelUsageEntry?.outputTokens || event.usage?.output_tokens || 0,
    cacheReadInputTokens: modelUsageEntry?.cacheReadInputTokens || event.usage?.cache_read_input_tokens || 0,
    cacheCreationInputTokens: modelUsageEntry?.cacheCreationInputTokens || event.usage?.cache_creation_input_tokens || 0,
    webSearchRequests: modelUsageEntry?.webSearchRequests || 0,
    contextWindow: modelUsageEntry?.contextWindow || 200000,
    model: primaryModel,
  };
}

/**
 * Build cumulative session-level usage by adding turn usage to existing session usage
 * @param {string} sessionId
 * @param {Object} turnUsage
 * @returns {Object} cumulativeSessionUsage
 */
export function buildCumulativeSessionUsage(sessionId, turnUsage) {
  const currentSession = sessions.getById(sessionId);
  return {
    inputTokens: (currentSession.inputTokens || 0) + turnUsage.inputTokens,
    outputTokens: (currentSession.outputTokens || 0) + turnUsage.outputTokens,
    cacheReadInputTokens: (currentSession.cacheReadInputTokens || 0) + turnUsage.cacheReadInputTokens,
    cacheCreationInputTokens: (currentSession.cacheCreationInputTokens || 0) + turnUsage.cacheCreationInputTokens,
    webSearchRequests: (currentSession.webSearchRequests || 0) + turnUsage.webSearchRequests,
    contextWindow: turnUsage.contextWindow,
  };
}

/**
 * Update conversation with cumulative usage from turn
 * @param {string|undefined} conversationId
 * @param {Object|null} currentConversation
 * @param {Object} turnUsage
 * @returns {Object|null} updatedConversation
 */
export function updateConversationUsage(conversationId, currentConversation, turnUsage) {
  if (!currentConversation) return null;

  const cumulativeConversationUsage = {
    inputTokens: (currentConversation.inputTokens || 0) + turnUsage.inputTokens,
    outputTokens: (currentConversation.outputTokens || 0) + turnUsage.outputTokens,
    cacheReadInputTokens: (currentConversation.cacheReadInputTokens || 0) + turnUsage.cacheReadInputTokens,
    cacheCreationInputTokens: (currentConversation.cacheCreationInputTokens || 0) + turnUsage.cacheCreationInputTokens,
    webSearchRequests: (currentConversation.webSearchRequests || 0) + turnUsage.webSearchRequests,
    contextWindow: turnUsage.contextWindow,
  };

  return conversations.updateUsage(conversationId, cumulativeConversationUsage);
}

/**
 * Handle final usage stats from result event — update conversation and session usage
 * @param {string} sessionId
 * @param {Object} event
 */
export function handleResultUsage(sessionId, event) {
  const turnUsage = extractTurnUsage(sessionId, event);

  // Get the conversation ID for this session's current turn
  const conversationId = activeConversationIds.get(sessionId);
  const currentConversation = conversationId ? conversations.getById(conversationId) : null;

  // Update conversation with cumulative usage (add to existing)
  const updatedConversation = updateConversationUsage(conversationId, currentConversation, turnUsage);

  // Also update session-level usage (aggregate of all conversations) for backward compatibility
  const cumulativeSessionUsage = buildCumulativeSessionUsage(sessionId, turnUsage);
  const updatedSession = sessions.updateUsage(sessionId, cumulativeSessionUsage);

  // Broadcast final usage update with conversationId
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE, {
    sessionId,
    conversationId,
    usage: updatedConversation ? {
      inputTokens: updatedConversation.inputTokens,
      outputTokens: updatedConversation.outputTokens,
      cacheReadInputTokens: updatedConversation.cacheReadInputTokens,
      cacheCreationInputTokens: updatedConversation.cacheCreationInputTokens,
      webSearchRequests: updatedConversation.webSearchRequests,
      contextWindow: updatedConversation.contextWindow,
    } : cumulativeSessionUsage,
    turnUsage,
    isFinal: true,
  });

  // Also broadcast session update for session list
  broadcastToProject(updatedSession.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: updatedSession.projectId,
    sessionId,
    session: updatedSession,
  });

  // Broadcast conversation update for real-time UI updates
  if (updatedConversation) {
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.CONVERSATION_UPDATED, {
      sessionId,
      conversation: updatedConversation,
    });
  }

  // Clean up turn usage and estimated tokens
  currentTurnUsage.delete(conversationId);
  estimatedOutputTokens.delete(conversationId);
  activeConversationIds.delete(sessionId);
}
