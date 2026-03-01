/**
 * Conversation Summary Service
 * Conversation-level summary generation
 */

import { sessions, messages, conversations, settings } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { callClaude } from './summaryClaudeAdapter.js';
import { buildConversationSummaryPrompt } from './summaryPromptBuilder.js';
import { parseConversationSummaryResponse } from './summaryClaudeAdapter.js';

// Maximum number of recent messages to include in generation (optimized for token efficiency)
const MAX_MESSAGES = 15;

/**
 * Check if conversation summaries are enabled for a session
 * @param {string} sessionId - The session ID
 * @returns {boolean} True if conversation summaries are enabled
 */
export function isConversationSummaryEnabled(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session) return false;

  const globalSettings = settings.getSummarySettings();
  return !globalSettings?.disableConversationSummaries;
}

/**
 * Generate summary for a specific conversation
 * @param {string} sessionId - The session ID
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<string|null>} The generated summary text
 */
export async function generateConversationSummary(sessionId, conversationId) {
  try {
    // Get session to check project settings
    const session = sessions.getById(sessionId);
    if (!session) {
      console.warn(`[SummaryService] Session ${sessionId} not found for conversation summary generation`);
      return null;
    }

    // Check if conversation summaries are disabled globally
    const globalSettings = settings.getSummarySettings();
    if (globalSettings?.disableConversationSummaries) {
      console.log(`[SummaryService] Conversation summaries disabled globally, skipping generation`);
      return null;
    }

    const conversation = conversations.getById(conversationId);
    if (!conversation || conversation.sessionId !== sessionId) {
      console.warn(`[SummaryService] Conversation ${conversationId} not found for session ${sessionId}`);
      return null;
    }

    // Get messages for this conversation
    const conversationMessages = messages.getByConversationId(conversationId);

    if (conversationMessages.length === 0) {
      console.warn(`[SummaryService] No messages found for conversation ${conversationId}`);
      return null;
    }

    // Skip very short conversations
    if (conversationMessages.length < 2) {
      const summary = 'Brief conversation with minimal content.';
      conversations.update(conversationId, {
        summary,
        summaryGeneratedAt: Date.now(),
      });
      return summary;
    }

    // Take recent messages (limit to MAX_MESSAGES)
    const recentMessages = conversationMessages.slice(-MAX_MESSAGES);

    // Build prompt
    const prompt = buildConversationSummaryPrompt(recentMessages);

    // Call Claude
    const responseText = await callClaude(prompt, recentMessages, 'waiting', {
      sessionId,
      conversationId,
      callType: 'generateConversationSummary',
    });

    // Parse response
    const summary = parseConversationSummaryResponse(responseText);

    // Update conversation with summary
    const updatedConversation = conversations.update(conversationId, {
      summary,
      summaryGeneratedAt: Date.now(),
    });

    // Broadcast conversation summary updated
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.CONVERSATION_SUMMARY_UPDATED, {
      sessionId,
      conversationId,
      conversation: updatedConversation,
    });

    console.log(`[SummaryService] Successfully generated summary for conversation ${conversationId}`);
    return summary;
  } catch (error) {
    console.error(`[SummaryService] Failed to generate conversation summary:`, {
      error: error.message,
      sessionId,
      conversationId,
    });
    return null;
  }
}
