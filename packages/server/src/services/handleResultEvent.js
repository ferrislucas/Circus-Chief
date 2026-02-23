import { sessions, conversations } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import * as summaryService from './summaryService.js';
import { activeConversationIds, currentModels, currentTurnUsage, estimatedOutputTokens } from './sessionState.js';
import { broadcastSessionStatus } from './sessionExecutor.js';

/**
 * Handle 'result' event from Claude SDK stream
 * Processes turn completion: usage rollup, persistence, cleanup
 * @param {string} sessionId
 * @param {Object} event
 */
export function handleResultEvent(sessionId, event) {
  if (event.subtype === 'error') {
    sessions.update(sessionId, { status: 'error', error: event.error });
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: event.error });
    // Broadcast error status to project subscribers for session list updates
    broadcastSessionStatus(sessionId, 'error');
    // Generate summary on error
    summaryService.onSessionComplete(sessionId);
  } else {
    // Store cost info and broadcast to project subscribers
    if (event.total_cost_usd !== undefined) {
      sessions.update(sessionId, { costUsd: event.total_cost_usd });
    }

    // Store final usage stats to conversation (Issue #175)
    if (event.usage || event.modelUsage) {
      // Extract from modelUsage if available (has more detail)
      const modelUsageEntry = event.modelUsage
        ? Object.values(event.modelUsage)[0]
        : null;

      // Use the model from system.init (stored in currentModels) rather than modelUsage keys
      // because modelUsage can contain multiple models when sub-agents are used (e.g., Opus using Haiku)
      // and Object.keys()[0] would pick the wrong model
      const primaryModel = currentModels.get(sessionId) || Object.keys(event.modelUsage || {})[0] || null;

      const turnUsage = {
        inputTokens: modelUsageEntry?.inputTokens || event.usage?.input_tokens || 0,
        outputTokens: modelUsageEntry?.outputTokens || event.usage?.output_tokens || 0,
        cacheReadInputTokens: modelUsageEntry?.cacheReadInputTokens || event.usage?.cache_read_input_tokens || 0,
        cacheCreationInputTokens: modelUsageEntry?.cacheCreationInputTokens || event.usage?.cache_creation_input_tokens || 0,
        webSearchRequests: modelUsageEntry?.webSearchRequests || 0,
        contextWindow: modelUsageEntry?.contextWindow || 200000,
        model: primaryModel,
      };

      // [MODEL AUDIT] Log model from result event
      console.log(`[MODEL AUDIT - Result Event] Turn usage model extraction:`, {
        modelUsageKeys: Object.keys(event.modelUsage || {}),
        primaryModelFromInit: currentModels.get(sessionId),
        extractedModel: turnUsage.model,
        rawModelUsage: event.modelUsage,
      });

      // Get the conversation ID for this session's current turn
      const conversationId = activeConversationIds.get(sessionId);
      const currentConversation = conversationId ? conversations.getById(conversationId) : null;

      // Update conversation with cumulative usage (add to existing)
      let updatedConversation = null;
      if (currentConversation) {
        // [MODEL AUDIT] Log conversation model before update
        console.log(`[MODEL AUDIT - Conversation Update] Before updateUsage:`, {
          conversationId,
          currentConversationModel: currentConversation.model,
          newModelFromUsage: turnUsage.model,
        });

        const cumulativeConversationUsage = {
          inputTokens: (currentConversation.inputTokens || 0) + turnUsage.inputTokens,
          outputTokens: (currentConversation.outputTokens || 0) + turnUsage.outputTokens,
          cacheReadInputTokens: (currentConversation.cacheReadInputTokens || 0) + turnUsage.cacheReadInputTokens,
          cacheCreationInputTokens: (currentConversation.cacheCreationInputTokens || 0) + turnUsage.cacheCreationInputTokens,
          webSearchRequests: (currentConversation.webSearchRequests || 0) + turnUsage.webSearchRequests,
          contextWindow: turnUsage.contextWindow,
        };

        updatedConversation = conversations.updateUsage(conversationId, cumulativeConversationUsage);
        // [MODEL AUDIT] Log conversation model after update
        console.log(`[MODEL AUDIT - Conversation Update] After updateUsage:`, {
          conversationId,
          updatedConversationModel: updatedConversation?.model,
        });
      }

      // Also update session-level usage (aggregate of all conversations) for backward compatibility
      const currentSession = sessions.getById(sessionId);
      const cumulativeSessionUsage = {
        inputTokens: (currentSession.inputTokens || 0) + turnUsage.inputTokens,
        outputTokens: (currentSession.outputTokens || 0) + turnUsage.outputTokens,
        cacheReadInputTokens: (currentSession.cacheReadInputTokens || 0) + turnUsage.cacheReadInputTokens,
        cacheCreationInputTokens: (currentSession.cacheCreationInputTokens || 0) + turnUsage.cacheCreationInputTokens,
        webSearchRequests: (currentSession.webSearchRequests || 0) + turnUsage.webSearchRequests,
        contextWindow: turnUsage.contextWindow,
      };

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
  }
  // Note: Don't clear lastMessageIds here - let the post-loop association code handle it.
  // Clearing here was causing work logs to never be associated because the 'result' event
  // arrives before the loop ends, deleting the messageId before association can happen.
}
