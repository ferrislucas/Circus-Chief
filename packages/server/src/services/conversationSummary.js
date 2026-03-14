/**
 * Conversation-specific summary generation.
 * Handles generating summaries for individual conversations within a session,
 * as well as combined session+conversation summary generation.
 */

import { sessions, messages, sessionSummaries, conversations, projects, settings } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { callClaude } from './summaryClaudeClient.js';
import {
  MAX_MESSAGES,
  MIN_MESSAGES_FOR_SUMMARY,
  DEFAULT_SESSION_TITLE_PROMPT,
  CONVERSATION_SUMMARY_SYSTEM_PROMPT,
  COMBINED_SUMMARY_SYSTEM_PROMPT,
  formatMessages,
  buildConversationSummaryPrompt,
  parseConversationSummaryResponse,
  trackMessageMetadata,
} from './summaryPrompts.js';
import { enrichPrData } from './prUrlService.js';
import { aggregateFilesModified, buildChildSessionContext } from './childSessionContext.js';
import { isSummaryStale } from './summaryService.js';

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
    if (conversationMessages.length < 4) {
      console.log(`[SummaryService] Conversation ${conversationId} has only ${conversationMessages.length} messages, skipping summary`);
      return null;
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
    }, CONVERSATION_SUMMARY_SYSTEM_PROMPT);

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

/**
 * Internal implementation of generateSessionAndConversationSummary
 * Generates both session and conversation summaries in a single API call.
 * @param {string} sessionId
 * @param {string} conversationId
 * @param {Function} generateSummaryFn - Reference to generateSummary to avoid circular dependency
 * @returns {Promise<Object>}
 */
export async function doGenerateSessionAndConversationSummary(sessionId, conversationId, generateSummaryFn) {
  try {
    const session = sessions.getById(sessionId);
    if (!session) {
      console.warn(`[SummaryService] Session ${sessionId} not found for combined summary generation`);
      return { sessionSummary: null, conversationSummary: null };
    }

    const conversation = conversations.getById(conversationId);
    if (!conversation || conversation.sessionId !== sessionId) {
      console.warn(`[SummaryService] Conversation ${conversationId} not found for session ${sessionId}`);
      return { sessionSummary: null, conversationSummary: null };
    }

    // Skip conversation summary if this is the only conversation — summaries only add value
    // when the user is navigating between multiple conversations
    const allSessionConversations = conversations.getBySessionId(sessionId);
    if (allSessionConversations.length < 2) {
      console.log(`[SummaryService] Session ${sessionId} has only 1 conversation, falling back to session-only summary`);
      return { sessionSummary: await generateSummaryFn(sessionId), conversationSummary: null };
    }

    // Check if session summaries are disabled globally
    const globalSettings = settings.getSummarySettings();
    if (globalSettings?.disableSessionSummaries) {
      console.log(`[SummaryService] Session summaries disabled globally, skipping combined generation`);
      return { sessionSummary: null, conversationSummary: null };
    }

    // Get existing session summary and recent messages
    const existingSummary = sessionSummaries.getBySessionId(sessionId);

    // Staleness check: skip combined generation if summary is current
    if (!isSummaryStale(sessionId)) {
      console.log(`[SummaryService] Summary for ${sessionId} is current, skipping combined generation`);
      return { sessionSummary: existingSummary, conversationSummary: null };
    }

    const allMessages = messages.getBySessionId(sessionId);
    const conversationMessages = messages.getByConversationId(conversationId);

    // Check minimum message threshold
    if (allMessages.length < MIN_MESSAGES_FOR_SUMMARY) {
      console.log(
        `[SummaryService] Session ${sessionId} has only ${allMessages.length} messages (minimum ${MIN_MESSAGES_FOR_SUMMARY}), skipping combined summary generation`
      );
      return { sessionSummary: null, conversationSummary: null };
    }

    // Get recent messages for session summary
    const recentMessages = allMessages.slice(-MAX_MESSAGES);

    // Broadcast that we're generating
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
      sessionId,
      generating: true,
    });

    // Build child session context
    const childContext = buildChildSessionContext(sessionId);

    // Build existing summary context
    const existingContext = existingSummary
      ? `EXISTING SESSION SUMMARY:
${existingSummary.fullSummary}

Key actions so far: ${JSON.stringify(existingSummary.keyActions || [])}
Files modified: ${JSON.stringify(existingSummary.filesModified || [])}
Previous outcome: ${existingSummary.outcome}
Previous title: ${existingSummary.sessionTitle || 'Not set'}`
      : 'EXISTING SESSION SUMMARY:\nNo previous summary - this is the first generation.';

    // Build combined prompt with both session and conversation context
    const formattedSessionMessages = formatMessages(recentMessages);
    const formattedConversationMessages = formatMessages(conversationMessages);

    const combinedPrompt = `Current session status: ${session.status}

${existingContext}
${childContext}
RECENT SESSION CONVERSATION:
${formattedSessionMessages}

ACTIVE CONVERSATION THREAD:
${formattedConversationMessages}

Session title guidelines:
${globalSettings?.sessionTitlePrompt || DEFAULT_SESSION_TITLE_PROMPT}`;

    // Combined JSON schema with both session and conversation summary fields
    const combinedSchema = {
      type: 'object',
      properties: {
        // Session summary fields
        short_summary: { type: 'string', description: '1-2 sentence preview for list view (max 150 characters)' },
        full_summary: { type: 'string', description: 'Detailed summary with key accomplishments (max 500 characters)' },
        key_actions: { type: 'array', items: { type: 'string' }, description: 'List of key actions taken' },
        files_modified: { type: 'array', items: { type: 'string' }, description: 'List of files modified' },
        outcome: { type: 'string', enum: ['completed', 'partial', 'failed', 'ongoing'], description: 'Session outcome' },
        pr_url: { type: ['string', 'null'], description: 'GitHub PR URL if created' },
        session_title: { type: ['string', 'null'], description: 'Concise session title (max 60 chars)' },
        // Conversation summary field
        conversation_summary: { type: 'string', description: '2-3 sentence summary of conversation (max 200 chars)' },
      },
      required: ['short_summary', 'full_summary', 'key_actions', 'files_modified', 'outcome', 'conversation_summary'],
    };

    // Call Claude with combined schema
    const responseText = await callClaude(
      combinedPrompt,
      recentMessages,
      session.status,
      {
        sessionId,
        conversationId,
        callType: 'generateCombinedSummary',
      },
      COMBINED_SUMMARY_SYSTEM_PROMPT,
      combinedSchema
    );

    // Parse response and convert from snake_case to camelCase
    let summaryData;
    let conversationSummaryText;
    try {
      const parsed = JSON.parse(responseText);

      // Convert snake_case to camelCase to match repository expectations
      summaryData = {
        shortSummary: parsed.short_summary,
        fullSummary: parsed.full_summary,
        keyActions: parsed.key_actions || [],
        filesModified: parsed.files_modified || [],
        outcome: parsed.outcome || 'ongoing',
        prUrl: parsed.pr_url || null,
        sessionTitle: parsed.session_title || null,
      };

      // Extract conversation summary
      conversationSummaryText = parsed.conversation_summary || 'Conversation summary generation failed';
    } catch (parseError) {
      console.error(`[SummaryService] Failed to parse combined summary response:`, parseError.message);
      console.error(`[SummaryService] Response text:`, responseText);
      return { sessionSummary: null, conversationSummary: null };
    }

    // Verify required fields exist
    if (!summaryData.shortSummary || !summaryData.fullSummary) {
      console.error(`[SummaryService] Combined summary missing required fields:`, Object.keys(summaryData));
      return { sessionSummary: null, conversationSummary: null };
    }

    // Add message count and last message ID for staleness tracking
    trackMessageMetadata(summaryData, allMessages);

    // For root sessions, aggregate files from child sessions
    if (!session.parentSessionId) {
      summaryData.filesModified = aggregateFilesModified(sessionId, summaryData.filesModified);
    }

    // Validate and enrich PR URL
    const prUrl = summaryData.prUrl || session.prUrl;
    if (prUrl) {
      const project = projects.getById(session.projectId);
      await enrichPrData(summaryData, prUrl, project?.repoUrl, sessionId);
    } else {
      summaryData.prUrl = null;
    }

    // Save session summary
    const savedSessionSummary = sessionSummaries.upsert(sessionId, summaryData);

    // Save conversation summary
    conversations.update(conversationId, { summary: conversationSummaryText });

    // Broadcast updates
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
      sessionId,
      summary: savedSessionSummary,
    });

    broadcastToSession(sessionId, WS_MESSAGE_TYPES.CONVERSATION_SUMMARY_UPDATED, {
      sessionId,
      conversationId,
      summary: conversationSummaryText,
    });

    // Clear the generating flag so the UI knows generation is complete
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
      sessionId,
      generating: false,
    });

    return {
      sessionSummary: savedSessionSummary,
      conversationSummary: conversationSummaryText,
    };
  } catch (error) {
    console.error(`[SummaryService] Error generating combined summary for session ${sessionId}:`, error);

    // Clear the generating flag on error
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
      sessionId,
      generating: false,
    });

    return { sessionSummary: null, conversationSummary: null };
  }
}
