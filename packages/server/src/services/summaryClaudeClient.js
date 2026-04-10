import { query } from '@anthropic-ai/claude-agent-sdk';
import { sessions } from '../database.js';
import { agentCallLogger } from './agentCallLogger.js';
import { createVCRQueryFn } from '../agents/vcr/VCRSummaryWrapper.js';

/**
 * Default JSON schema for session summary structured output
 */
/**
 * Process a content block from Claude's response
 * @param {Object} block - Content block
 * @param {Object} stateInput - Mutable state object { responseText, structuredOutput }
 */
function processContentBlock(block, stateInput) {
  const state = stateInput;
  if (block.type === 'tool_use' && block.name === 'StructuredOutput') {
    state.structuredOutput = block.input;
  } else if (block.type === 'text') {
    state.responseText += block.text;
  }
}

/**
 * Log usage metrics from a result event
 * @param {string} callId - The call ID for logging
 * @param {Object} event - The result event
 */
function logResultUsage(callId, event) {
  const modelUsageEntry = event.modelUsage
    ? Object.values(event.modelUsage)[0]
    : null;
  if (!modelUsageEntry && !event.usage) return;

  agentCallLogger.updateUsage(callId, {
    inputTokens: modelUsageEntry?.inputTokens || event.usage?.input_tokens || 0,
    outputTokens: modelUsageEntry?.outputTokens || event.usage?.output_tokens || 0,
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

/**
 * Build the query parameters for the Claude SDK call.
 * @param {string} prompt - The prompt to send
 * @param {{ systemPrompt?: string, jsonSchema?: Object }} options
 * @returns {Object} queryParams ready for the SDK query function
 */
function buildClaudeRequest(prompt, options) {
  const { systemPrompt = null, jsonSchema = null } = options || {};
  const schema = jsonSchema || SESSION_SUMMARY_SCHEMA;

  return {
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
}

/**
 * Process the Claude SDK event stream and extract the response.
 * @param {AsyncIterable} eventStream - The async iterable from the SDK query
 * @param {string|null} callId - The agent call logger ID (null if not logging)
 * @returns {Promise<string>} The text response (JSON string)
 */
async function handleClaudeResponse(eventStream, callId) {
  const state = { responseText: '', structuredOutput: null };

  for await (const event of eventStream) {
    switch (event.type) {
      case 'assistant': {
        const content = event.message?.content || [];
        for (const block of content) {
          processContentBlock(block, state);
        }
        break;
      }
      case 'result': {
        if (event.subtype === 'error') {
          throw new Error(event.error || 'Claude SDK query failed');
        }
        if (callId) {
          logResultUsage(callId, event);
        }
        break;
      }
    }
  }

  if (state.structuredOutput) {
    return JSON.stringify(state.structuredOutput);
  }
  return state.responseText;
}

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
 * @param {{ logMeta?: Object, systemPrompt?: string, jsonSchema?: Object }} options - Optional parameters
 * @returns {Promise<string>} The text response (JSON string)
 */
export async function callClaude(prompt, recentMessages, sessionStatus, options = {}) {
  const { logMeta = null } = options || {};
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

  const queryParams = buildClaudeRequest(prompt, options);

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

  try {
    const result = await handleClaudeResponse(queryFn(queryParams), callId);

    // Complete the logged call on success
    if (callId) {
      agentCallLogger.completeCall(callId, { success: true });
    }

    return result;
  } catch (error) {
    // Complete the logged call on error
    if (callId) {
      agentCallLogger.completeCall(callId, { success: false, error });
    }
    throw error;
  }
}
