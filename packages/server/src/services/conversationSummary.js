/**
 * Conversation-specific summary generation.
 * Handles generating summaries for individual conversations within a session,
 * as well as combined session+conversation summary generation.
 */

import { sessions, messages, sessionSummaries, conversations, projects, settings } from '../database.js';
import { callClaude } from './summaryClaudeClient.js';
import { broadcastSummaryUpdate, broadcastGeneratingStatus, broadcastConversationSummaryUpdate } from './summaryBroadcast.js';
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
import { isSummaryStale } from './summaryStaleCheck.js';

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
      console.warn(`[ConversationSummary] Session ${sessionId} not found for conversation summary generation`);
      return null;
    }

    // Check if conversation summaries are disabled globally
    const globalSettings = settings.getSummarySettings();
    if (globalSettings?.disableConversationSummaries) {
      console.log(`[ConversationSummary] Conversation summaries disabled globally, skipping generation`);
      return null;
    }

    const conversation = conversations.getById(conversationId);
    if (!conversation || conversation.sessionId !== sessionId) {
      console.warn(`[ConversationSummary] Conversation ${conversationId} not found for session ${sessionId}`);
      return null;
    }

    // Get messages for this conversation
    const conversationMessages = messages.getByConversationId(conversationId);

    if (conversationMessages.length === 0) {
      console.warn(`[ConversationSummary] No messages found for conversation ${conversationId}`);
      return null;
    }

    // Skip very short conversations
    if (conversationMessages.length < 4) {
      console.log(`[ConversationSummary] Conversation ${conversationId} has only ${conversationMessages.length} messages, skipping summary`);
      return null;
    }

    // Take recent messages (limit to MAX_MESSAGES)
    const recentMessages = conversationMessages.slice(-MAX_MESSAGES);

    // Build prompt
    const prompt = buildConversationSummaryPrompt(recentMessages);

    // Call Claude
    const responseText = await callClaude(prompt, recentMessages, 'waiting', {
      logMeta: {
        sessionId,
        conversationId,
        callType: 'generateConversationSummary',
      },
      systemPrompt: CONVERSATION_SUMMARY_SYSTEM_PROMPT,
    });

    // Parse response
    const summary = parseConversationSummaryResponse(responseText);

    // Update conversation with summary
    const updatedConversation = conversations.update(conversationId, {
      summary,
      summaryGeneratedAt: Date.now(),
    });

    // Broadcast conversation summary updated
    broadcastConversationSummaryUpdate(sessionId, {
      conversationId,
      conversation: updatedConversation,
    });

    console.log(`[ConversationSummary] Successfully generated summary for conversation ${conversationId}`);
    return summary;
  } catch (error) {
    console.error(`[ConversationSummary] Failed to generate conversation summary:`, {
      error: error.message,
      sessionId,
      conversationId,
    });
    return null;
  }
}

/** @type {{ earlyReturn?: Object, sessionSummary?: Object }} */

/**
 * Fetch all data needed for combined summary generation.
 * Returns an earlyReturn result if the summary should be skipped, or the loaded context.
 * @param {string} sessionId
 * @param {string} conversationId
 * @param {Function} generateSummaryFn - Reference to generateSummary to avoid circular dependency
 * @returns {Promise<Object>} Context data or earlyReturn
 */
async function fetchSummaryContext(sessionId, conversationId, generateSummaryFn) {
  const session = sessions.getById(sessionId);
  if (!session) {
    console.warn(`[ConversationSummary] Session ${sessionId} not found for combined summary generation`);
    return { earlyReturn: { sessionSummary: null, conversationSummary: null } };
  }

  const conversation = conversations.getById(conversationId);
  if (!conversation || conversation.sessionId !== sessionId) {
    console.warn(`[ConversationSummary] Conversation ${conversationId} not found for session ${sessionId}`);
    return { earlyReturn: { sessionSummary: null, conversationSummary: null } };
  }

  // Skip conversation summary if this is the only conversation -- summaries only add value
  // when the user is navigating between multiple conversations
  const allSessionConversations = conversations.getBySessionId(sessionId);
  if (allSessionConversations.length < 2) {
    console.log(`[ConversationSummary] Session ${sessionId} has only 1 conversation, falling back to session-only summary`);
    return { earlyReturn: { sessionSummary: await generateSummaryFn(sessionId), conversationSummary: null } };
  }

  // Check if session summaries are disabled globally
  const globalSettings = settings.getSummarySettings();
  if (globalSettings?.disableSessionSummaries) {
    console.log(`[ConversationSummary] Session summaries disabled globally, skipping combined generation`);
    return { earlyReturn: { sessionSummary: null, conversationSummary: null } };
  }

  // Get existing session summary and recent messages
  const existingSummary = sessionSummaries.getBySessionId(sessionId);

  // Staleness check: skip combined generation if summary is current
  if (!isSummaryStale(sessionId)) {
    console.log(`[ConversationSummary] Summary for ${sessionId} is current, skipping combined generation`);
    return { earlyReturn: { sessionSummary: existingSummary, conversationSummary: null } };
  }

  const allMessages = messages.getBySessionId(sessionId);
  const conversationMessages = messages.getByConversationId(conversationId);

  // Check minimum message threshold
  if (allMessages.length < MIN_MESSAGES_FOR_SUMMARY) {
    console.log(
      `[ConversationSummary] Session ${sessionId} has only ${allMessages.length} messages (minimum ${MIN_MESSAGES_FOR_SUMMARY}), skipping combined summary generation`
    );
    return { earlyReturn: { sessionSummary: null, conversationSummary: null } };
  }

  return {
    session,
    globalSettings,
    existingSummary,
    allMessages,
    conversationMessages,
  };
}

/**
 * Build the combined prompt and JSON schema for calling Claude.
 * @param {Object} context - The summary context from fetchSummaryContext
 * @returns {Object} Object containing combinedPrompt, combinedSchema, and recentMessages
 */
function buildSummaryPrompt(context) {
  const { session, globalSettings, existingSummary, allMessages, conversationMessages } = context;

  // Get recent messages for session summary
  const recentMessages = allMessages.slice(-MAX_MESSAGES);

  // Build child session context
  const childContext = buildChildSessionContext(session.id);

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

  return { combinedPrompt, combinedSchema, recentMessages };
}

/**
 * Parse the Claude response, enrich with PR data, save summaries, and broadcast updates.
 * @param {string} sessionId
 * @param {string} conversationId
 * @param {Object} context
 * @param {Object} context.session - The session record
 * @param {string} context.responseText - Raw response from Claude
 * @param {Array} context.allMessages - All session messages (for staleness tracking)
 * @returns {Promise<Object|null>} The result object or null if parsing failed
 */
async function processSummaryResult(sessionId, conversationId, { session, responseText, allMessages }) {
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
    console.error(`[ConversationSummary] Failed to parse combined summary response:`, parseError.message);
    console.error(`[ConversationSummary] Response text:`, responseText);
    return null;
  }

  // Verify required fields exist
  if (!summaryData.shortSummary || !summaryData.fullSummary) {
    console.error(`[ConversationSummary] Combined summary missing required fields:`, Object.keys(summaryData));
    return null;
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
  broadcastSummaryUpdate(sessionId, session.projectId, savedSessionSummary);

  broadcastConversationSummaryUpdate(sessionId, {
    conversationId,
    summary: conversationSummaryText,
  });

  return {
    sessionSummary: savedSessionSummary,
    conversationSummary: conversationSummaryText,
  };
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
    const context = await fetchSummaryContext(sessionId, conversationId, generateSummaryFn);
    if (context.earlyReturn) {
      return context.earlyReturn;
    }

    // Broadcast that we're generating
    broadcastGeneratingStatus(sessionId, true);

    const { combinedPrompt, combinedSchema, recentMessages } = buildSummaryPrompt(context);

    // Call Claude with combined schema
    const responseText = await callClaude(
      combinedPrompt,
      recentMessages,
      context.session.status,
      {
        logMeta: {
          sessionId,
          conversationId,
          callType: 'generateCombinedSummary',
        },
        systemPrompt: COMBINED_SUMMARY_SYSTEM_PROMPT,
        jsonSchema: combinedSchema,
      }
    );

    const result = await processSummaryResult(sessionId, conversationId, { session: context.session, responseText, allMessages: context.allMessages });
    if (!result) {
      return { sessionSummary: null, conversationSummary: null };
    }

    // Clear the generating flag so the UI knows generation is complete
    broadcastGeneratingStatus(sessionId, false);

    return result;
  } catch (error) {
    console.error(`[ConversationSummary] Error generating combined summary for session ${sessionId}:`, error);

    // Clear the generating flag on error
    broadcastGeneratingStatus(sessionId, false);

    return { sessionSummary: null, conversationSummary: null };
  }
}
