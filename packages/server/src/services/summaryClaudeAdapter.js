/**
 * Summary Claude Adapter
 * SDK query wrapper, mock mode, structured output parsing, markdown stripping
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { agentCallLogger } from './agentCallLogger.js';

// Check if mock mode is enabled
export const isMockMode = () => process.env.MOCK_CLAUDE === 'true';

/**
 * Mock query generator for summary generation in test mode
 * Mirrors the Claude Code SDK's async generator pattern
 * @param {Object} params
 * @param {string} params.prompt - The prompt string
 * @param {Array} params.recentMessages - Messages for mock context
 * @param {string} params.sessionStatus - Session status for mock outcome
 */
async function* mockSummaryQuery({ prompt: _prompt, recentMessages, sessionStatus }) {
  // Yield system init event (matches SDK pattern)
  yield {
    type: 'system',
    subtype: 'init',
    session_id: 'mock-summary-' + Date.now(),
  };

  // Small delay to simulate processing
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Derive outcome from session status
  let outcome = 'ongoing';
  if (sessionStatus === 'stopped') outcome = 'partial';
  else if (sessionStatus === 'error') outcome = 'failed';

  // Create contextual mock response
  const lastMessage = recentMessages[recentMessages.length - 1];
  const shortPreview = lastMessage ? lastMessage.content.substring(0, 100) : 'testing session';

  const mockResponse = JSON.stringify({
    short_summary: `Mock summary: ${shortPreview}...`.substring(0, 150),
    full_summary: `This is a mock summary for testing purposes. The session has ${recentMessages.length} messages and is currently ${sessionStatus}.`,
    key_actions: ['Mock action 1', 'Mock action 2'],
    files_modified: ['mock-file.js'],
    outcome: outcome,
    pr_url: null,
    session_title: `Mock: ${shortPreview}`.substring(0, 60),
  });

  // Yield assistant message with mock response
  yield {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: mockResponse }],
    },
  };

  // Yield result event
  yield {
    type: 'result',
    subtype: 'success',
    total_cost_usd: 0.0001,
  };
}

/**
 * Call Claude via SDK and extract text response
 * @param {string} prompt - The prompt to send
 * @param {Array} recentMessages - Messages (for mock mode context)
 * @param {string} sessionStatus - Session status (for mock mode context)
 * @param {Object|null} logMeta - Optional metadata for agent call logging
 * @param {string|null} systemPrompt - Optional system prompt for prompt caching
 * @returns {Promise<string>} The text response
 */
export async function callClaude(prompt, recentMessages, sessionStatus, logMeta = null, systemPrompt = null) {
  const queryFn = isMockMode() ? mockSummaryQuery : query;

  // JSON Schema for structured output
  const summarySchema = {
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

  const queryParams = isMockMode()
    ? { prompt, recentMessages, sessionStatus }
    : {
        prompt,
        options: {
          cwd: process.cwd(),
          permissionMode: 'bypassPermissions',
          maxTurns: 1,
          model: 'claude-haiku-4-5-20251001',
          ...(systemPrompt && { systemPrompt }),
          outputFormat: {
            type: 'json_schema',
            schema: summarySchema,
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
      model: isMockMode() ? 'mock' : 'claude-haiku-4-5-20251001',
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

/**
 * Parse the Claude API response into a summary object
 * Handles markdown code block wrapping (```json ... ```) that Claude sometimes returns
 * @param {string} responseText
 * @returns {Object}
 */
export function parseSummaryResponse(responseText) {
  let textToParse = responseText.trim();

  // Only strip markdown if detected (starts with ```)
  if (textToParse.startsWith('```')) {
    const codeBlockMatch = textToParse.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    if (codeBlockMatch) {
      textToParse = codeBlockMatch[1].trim();
      console.log('[SummaryService] Stripped markdown code block from response');
    }
  }

  try {
    const parsed = JSON.parse(textToParse);
    return {
      shortSummary: parsed.short_summary || 'Summary generation failed',
      fullSummary: parsed.full_summary || 'Unable to generate summary',
      keyActions: parsed.key_actions || [],
      filesModified: parsed.files_modified || [],
      outcome: parsed.outcome || 'ongoing',
      prUrl: parsed.pr_url || null,
      sessionTitle: parsed.session_title || null,
      _parseFailed: false,
    };
  } catch {
    // If JSON parsing fails, return fallback with flag for retry logic
    console.warn('[SummaryService] Failed to parse summary response as JSON, using fallback');
    return {
      shortSummary: responseText.substring(0, 150),
      fullSummary: responseText.substring(0, 500),
      keyActions: [],
      filesModified: [],
      outcome: 'ongoing',
      prUrl: null,
      sessionTitle: null,
      _parseFailed: true,
    };
  }
}

/**
 * Parse conversation summary response
 * @param {string} responseText
 * @returns {string} The summary text
 */
export function parseConversationSummaryResponse(responseText) {
  let textToParse = responseText.trim();

  // Strip markdown if detected
  if (textToParse.startsWith('```')) {
    const codeBlockMatch = textToParse.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    if (codeBlockMatch) {
      textToParse = codeBlockMatch[1].trim();
    }
  }

  try {
    const parsed = JSON.parse(textToParse);
    return parsed.summary || 'Summary generation failed';
  } catch {
    // If parsing fails, return the raw text truncated
    return textToParse.substring(0, 200);
  }
}
