import { query } from '@anthropic-ai/claude-agent-sdk';
import { sessions } from '../database.js';
import { agentCallLogger } from './agentCallLogger.js';
import { createVCRQueryFn } from '../agents/vcr/VCRSummaryWrapper.js';

/**
 * Default JSON schema for session summary structured output
 */
export const SESSION_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    short_summary: { type: 'string', description: '1-2 sentence preview for list view (max 150 characters)' },
    full_summary: { type: 'string', description: 'Detailed summary with key accomplishments and current state (max 500 characters)' },
    key_actions: { type: 'array', items: { type: 'string' }, description: 'List of key actions taken' },
    files_modified: { type: 'array', items: { type: 'string' }, description: 'List of files that were modified' },
    outcome: { type: 'string', enum: ['completed', 'partial', 'failed', 'ongoing'], description: 'Session outcome status' },
    pr_url: { type: ['string', 'null'], description: 'GitHub PR URL if one was created' },
    session_title: { type: ['string', 'null'], description: 'Concise title for this session (max 60 characters)' },
  },
  required: ['short_summary', 'full_summary', 'key_actions', 'files_modified', 'outcome'],
};

/**
 * Call Claude via SDK and extract text response.
 * Unified function that handles both default session summary schema
 * and custom schemas (e.g., combined session+conversation summary).
 *
 * @param {string} prompt - The prompt to send
 * @param {Array} recentMessages - Messages (for mock mode context)
 * @param {string} sessionStatus - Session status (for mock mode context)
 * @param {Object} logMeta - Logging metadata { sessionId, conversationId?, callType }
 * @param {string} systemPrompt - Optional system prompt for prompt caching
 * @param {Object} jsonSchema - Optional JSON schema (defaults to SESSION_SUMMARY_SCHEMA)
 * @returns {Promise<string>} The text response (JSON string)
 */
export async function callClaude(prompt, recentMessages, sessionStatus, logMeta = null, systemPrompt = null, jsonSchema = null) {
  // Build stable key for VCR cassette (session prompts are hardcoded strings in E2E tests)
  let keyHint = null;
  if (process.env.VCR_MODE && logMeta?.sessionId) {
    const session = sessions.getById(logMeta.sessionId);
    keyHint = session ? `${logMeta.callType}:${session.prompt}` : null;
  }
  // Use VCR wrapper if in VCR mode, otherwise use real SDK query
  const queryFn = process.env.VCR_MODE
    ? createVCRQueryFn(query, 'tests/e2e/cassettes/summaries', keyHint)
    : query;

  // Default to session summary schema if none provided
  const schema = jsonSchema || SESSION_SUMMARY_SCHEMA;

  const queryParams = {
    prompt,
    options: {
      cwd: process.cwd(),
      permissionMode: 'bypassPermissions',
      maxTurns: 1,
      model: 'claude-haiku-4-5-20251001',
      ...(systemPrompt && { systemPrompt }),
      outputFormat: {
        type: 'json_schema',
        schema,
      },
    },
  };

  // Start logging if metadata provided
  let callId = null;
  if (logMeta) {
    callId = agentCallLogger.startCall({
      sessionId: logMeta.sessionId,
      conversationId: logMeta.conversationId || null,
      agentType: 'summary',
      model: 'claude-haiku-4-5-20251001',
      callType: logMeta.callType,
      promptLength: prompt.length,
    });
  }

  let responseText = '';
  let structuredOutput = null;

  try {
    for await (const event of queryFn(queryParams)) {
      switch (event.type) {
        case 'assistant': {
          const content = event.message?.content || [];
          for (const block of content) {
            // Capture structured output from StructuredOutput tool use
            if (block.type === 'tool_use' && block.name === 'StructuredOutput') {
              structuredOutput = block.input;
            } else if (block.type === 'text') {
              responseText += block.text;
            }
          }
          break;
        }
        case 'result': {
          if (event.subtype === 'error') {
            throw new Error(event.error || 'Claude SDK query failed');
          }
          // Capture usage for logging
          if (callId) {
            const modelUsageEntry = event.modelUsage
              ? Object.values(event.modelUsage)[0]
              : null;
            if (modelUsageEntry || event.usage) {
              agentCallLogger.updateUsage(callId, {
                inputTokens:
                  modelUsageEntry?.inputTokens || event.usage?.input_tokens || 0,
                outputTokens:
                  modelUsageEntry?.outputTokens || event.usage?.output_tokens || 0,
                thinkingTokens: 0,
                cacheReadInputTokens:
                  modelUsageEntry?.cacheReadInputTokens ||
                  event.usage?.cache_read_input_tokens ||
                  0,
                cacheCreationInputTokens:
                  modelUsageEntry?.cacheCreationInputTokens ||
                  event.usage?.cache_creation_input_tokens ||
                  0,
              });
            }
          }
          break;
        }
      }
    }

    // Complete the logged call on success
    if (callId) {
      agentCallLogger.completeCall(callId, { success: true });
    }
  } catch (error) {
    // Complete the logged call on error
    if (callId) {
      agentCallLogger.completeCall(callId, { success: false, error });
    }
    throw error;
  }

  // Prefer structured output (already parsed JSON) over text response
  if (structuredOutput) {
    return JSON.stringify(structuredOutput);
  }
  return responseText;
}
