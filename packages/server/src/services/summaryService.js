import { query } from '@anthropic-ai/claude-agent-sdk';
import { sessions, messages, sessionSummaries, conversations, projects, settings } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import * as ghService from './ghService.js';
import { agentCallLogger } from './agentCallLogger.js';
// Note: prStatusService is imported dynamically in onSessionComplete to avoid circular dependency

// Debounce timers per session
const debounceTimers = new Map();

// Debounce delay in milliseconds (60 seconds - optimized for token efficiency and responsiveness)
const DEBOUNCE_DELAY = 60000;

// Minimum number of messages before generating a summary (skip trivial sessions)
const MIN_MESSAGES_FOR_SUMMARY = 3;

// Maximum number of recent messages to include in generation (optimized for token efficiency)
const MAX_MESSAGES = 10;

// Maximum retry attempts for failed parsing
const MAX_RETRIES = 2;

// Check if mock mode is enabled
const isMockMode = () => process.env.MOCK_CLAUDE === 'true';

// Default prompt for strategic session titles
const DEFAULT_SESSION_TITLE_PROMPT = `Guidelines for generating session titles:
- The title should capture the SESSION'S STRATEGIC GOAL, not current tactical activity
- Focus on WHAT the user ultimately wants to achieve (e.g., "Add dark mode support")
- NOT the current step (e.g., "Fix TypeScript error", "Update tests")
- If a PR was created, format as "PR #N: <strategic goal>"
- PRESERVE the existing title if it still reflects the strategic goal
- Only change the title if the session's fundamental purpose has changed
- Keep titles concise (max 60 characters)`;

// System prompt for summary generation (static instructions that benefit from prompt caching)
const SUMMARY_SYSTEM_PROMPT = `You are updating a session summary for a Claude Code session.

Generate an updated summary that:
1. Preserves important context from the existing summary
2. Incorporates new actions and progress from recent messages
3. Updates the outcome status if changed
4. Maintains a coherent narrative of the full session

Outcome guidelines:
- "completed": Task was fully accomplished
- "partial": Some progress made but task incomplete
- "failed": Task encountered errors and couldn't proceed
- "ongoing": Session is still active/waiting for user input`;

// System prompt for conversation summary generation
const CONVERSATION_SUMMARY_SYSTEM_PROMPT = `You are generating a brief summary for a conversation thread within a Claude Code session.

Generate a concise summary of this conversation. Focus on:
1. The main topic or goal discussed
2. Key actions taken or decisions made
3. Current status (completed, in progress, blocked, etc.)`;

// Combined system prompt for generating both session and conversation summaries in one call
const COMBINED_SUMMARY_SYSTEM_PROMPT = `You are generating summaries for a Claude Code session.

Generate TWO summaries:

1. SESSION SUMMARY - An overview of the entire session:
   - Preserves important context from the existing summary
   - Incorporates new actions and progress from recent messages
   - Updates the outcome status if changed
   - Maintains a coherent narrative of the full session

   Session outcome guidelines:
   - "completed": Task was fully accomplished
   - "partial": Some progress made but task incomplete
   - "failed": Task encountered errors and couldn't proceed
   - "ongoing": Session is still active/waiting for user input

2. CONVERSATION SUMMARY - A brief summary of the active conversation thread:
   - The main topic or goal discussed
   - Key actions taken or decisions made
   - Current status (completed, in progress, blocked, etc.)`;

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
 * @param {Object} logMeta - Logging metadata
 * @param {string} systemPrompt - Optional system prompt for prompt caching
 * @returns {Promise<string>} The text response
 */
async function callClaude(prompt, recentMessages, sessionStatus, logMeta = null, systemPrompt = null) {
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
 * Format messages for the prompt
 * @param {Array} messageList - List of messages
 * @returns {string}
 */
function formatMessages(messageList) {
  return messageList
    .map((msg) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      let content = msg.content;

      // Truncate very long messages (optimized for token efficiency)
      if (content.length > 500) {
        content = content.substring(0, 500) + '... [truncated]';
      }

      // Add tool use info if present
      if (msg.toolUse && msg.toolUse.length > 0) {
        const tools = msg.toolUse.map((t) => t.name).join(', ');
        content += `\n[Tools used: ${tools}]`;
      }

      return `${role}: ${content}`;
    })
    .join('\n\n');
}

/**
 * Get all child sessions of a parent session
 * @param {string} parentSessionId - The parent session ID
 * @returns {Array} Array of child sessions
 */
function getChildSessions(parentSessionId) {
  // Use the SessionRepository's getChildSessions method
  return sessions.getChildSessions(parentSessionId);
}

/**
 * Build child session context for workflow-aware summaries
 * @param {string} sessionId - The session ID
 * @returns {string} Context string describing child sessions
 */
function buildChildSessionContext(sessionId) {
  const children = getChildSessions(sessionId);
  if (children.length === 0) return '';

  const childContexts = children.map(child => {
    const childSummary = sessionSummaries.getBySessionId(child.id);
    return `- ${child.name} (${child.status}): ${childSummary?.shortSummary || 'No summary yet'}`;
  });

  return `
CHILD SESSIONS (${children.length}):
${childContexts.join('\n')}`;
}

/**
 * Aggregate file counts from this session and all child sessions
 * @param {string} sessionId - The session ID
 * @param {Array} currentFiles - Files from the current session
 * @returns {Array} Deduplicated list of all files modified
 */
function aggregateFilesModified(sessionId, currentFiles = []) {
  const allFiles = new Set(currentFiles);

  const children = getChildSessions(sessionId);
  for (const child of children) {
    const childSummary = sessionSummaries.getBySessionId(child.id);
    if (childSummary?.filesModified) {
      for (const file of childSummary.filesModified) {
        allFiles.add(file);
      }
    }
    // Recursively aggregate from grandchildren
    const grandchildFiles = aggregateFilesModified(child.id, []);
    for (const file of grandchildFiles) {
      allFiles.add(file);
    }
  }

  return Array.from(allFiles);
}

/**
 * Build the prompt for incremental summary generation
 * @param {Object|null} existingSummary - Existing summary if any
 * @param {Array} recentMessages - Recent messages to summarize
 * @param {string} sessionStatus - Current session status
 * @param {string|null} projectTitlePrompt - Custom prompt for session titles (uses default if null)
 * @param {string|null} childContext - Context about child sessions (for workflow-aware summaries)
 * @returns {string}
 */
function buildIncrementalPrompt(existingSummary, recentMessages, sessionStatus, projectTitlePrompt = null, childContext = '') {
  const existingContext = existingSummary
    ? `EXISTING SUMMARY:
${existingSummary.fullSummary}

Key actions so far: ${JSON.stringify(existingSummary.keyActions || [])}
Files modified: ${JSON.stringify(existingSummary.filesModified || [])}
Previous outcome: ${existingSummary.outcome}
Previous title: ${existingSummary.sessionTitle || 'Not set'}`
    : 'EXISTING SUMMARY:\nNo previous summary - this is the first generation.';

  const formattedMessages = formatMessages(recentMessages);

  // Use custom prompt if provided, otherwise use default
  const sessionTitlePrompt = projectTitlePrompt || DEFAULT_SESSION_TITLE_PROMPT;

  // Return only dynamic content - static instructions are in SUMMARY_SYSTEM_PROMPT
  return `Current session status: ${sessionStatus}

${existingContext}
${childContext}
RECENT CONVERSATION:
${formattedMessages}

Session title guidelines:
${sessionTitlePrompt}`;
}

/**
 * Extract PR URL from session messages by scanning for GitHub PR links
 * @param {string} sessionId - The session ID
 * @returns {string|null} - The PR URL if found, null otherwise
 */
function extractPrUrlFromMessages(sessionId) {
  const allMessages = messages.getBySessionId(sessionId);
  if (!allMessages || allMessages.length === 0) return null;

  // Get recent messages (last 20) to scan for PR URLs
  const recentMessages = allMessages.slice(-20);

  // GitHub PR URL pattern: https://github.com/{owner}/{repo}/pull/{number}
  const prUrlPattern = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/g;

  // Scan messages in reverse order (most recent first) to find the latest PR URL
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const message = recentMessages[i];
    const matches = message.content?.match(prUrlPattern);

    if (matches && matches.length > 0) {
      // Return the most recent PR URL found
      return matches[matches.length - 1];
    }
  }

  return null;
}

/**
 * Extract PR URL from recent messages immediately after a turn completes.
 * This is lightweight (no Claude API call) - just scans messages for URLs.
 * @param {string} sessionId - The session ID
 */
export async function extractPrUrlIfNeeded(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session) return;

  // Skip if session already has a PR URL
  if (session.prUrl) return;

  // Extract PR URL from messages
  const prUrl = extractPrUrlFromMessages(sessionId);
  if (prUrl) {
    sessions.update(sessionId, { prUrl });
    console.log(`[SummaryService] Extracted PR URL for session ${sessionId}: ${prUrl}`);

    // Broadcast session update so UI shows PR URL immediately
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      sessionId,
      session: sessions.getById(sessionId),
    });

    // Also broadcast to project subscribers
    if (session.projectId) {
      broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
        projectId: session.projectId,
        sessionId,
        session: sessions.getById(sessionId),
      });
    }
  }
}

/**
 * Parse a GitHub PR URL into components
 * @param {string} prUrl - GitHub PR URL
 * @returns {Object|null} - { owner, repo, number } or null if invalid format
 */
function parsePrUrl(prUrl) {
  if (!prUrl) return null;

  try {
    // Match GitHub PR URL pattern: https://github.com/{owner}/{repo}/pull/{number}
    const match = prUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
    if (!match) {
      console.warn(`[SummaryService] Invalid PR URL format: ${prUrl}`);
      return null;
    }

    return {
      owner: match[1],
      repo: match[2],
      number: parseInt(match[3], 10),
    };
  } catch (error) {
    console.warn(`[SummaryService] Failed to parse PR URL ${prUrl}:`, error.message);
    return null;
  }
}

/**
 * Validate that a PR URL belongs to the expected repository
 * @param {string} prUrl - GitHub PR URL
 * @param {string} expectedRepoUrl - Expected repository URL
 * @returns {Object} - { valid: boolean, prComponents: Object|null, mismatch: boolean, error: string|null }
 */
function validatePrUrl(prUrl, expectedRepoUrl) {
  if (!prUrl) {
    return { valid: false, prComponents: null, mismatch: false, error: 'No PR URL provided' };
  }

  // Parse the PR URL
  const prComponents = parsePrUrl(prUrl);
  if (!prComponents) {
    return { valid: false, prComponents: null, mismatch: false, error: 'Invalid PR URL format' };
  }

  // If no expected repo URL, we can't validate the match - accept it but log a warning
  if (!expectedRepoUrl) {
    console.warn(`[SummaryService] No expected repo URL to validate against PR: ${prUrl}`);
    return { valid: true, prComponents, mismatch: false, error: null };
  }

  // Extract owner/repo from expected repo URL
  const expectedMatch = expectedRepoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/);
  if (!expectedMatch) {
    console.warn(`[SummaryService] Invalid expected repo URL format: ${expectedRepoUrl}`);
    return { valid: true, prComponents, mismatch: false, error: null };
  }

  const expectedOwner = expectedMatch[1];
  const expectedRepo = expectedMatch[2];

  // Validate that the PR belongs to the expected repository
  const ownerMatch = prComponents.owner === expectedOwner;
  const repoMatch = prComponents.repo === expectedRepo;

  if (!ownerMatch || !repoMatch) {
    console.warn(
      `[SummaryService] PR repository mismatch: ` +
      `PR is from ${prComponents.owner}/${prComponents.repo}, ` +
      `but expected ${expectedOwner}/${expectedRepo}`
    );
    return {
      valid: false,
      prComponents,
      mismatch: true,
      error: `PR from ${prComponents.owner}/${prComponents.repo} does not match expected ${expectedOwner}/${expectedRepo}`
    };
  }

  return { valid: true, prComponents, mismatch: false, error: null };
}

/**
 * Parse the Claude API response into a summary object
 * Handles markdown code block wrapping (```json ... ```) that Claude sometimes returns
 * @param {string} responseText
 * @returns {Object}
 */
function parseSummaryResponse(responseText) {
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
 * Generate summary for a session using Claude Code SDK
 * @param {string} sessionId
 * @param {number} retryCount - Internal retry counter (do not set manually)
 * @param {boolean} force - Force generation even if summary is current (skips debounce/staleness check, default: false)
 * @param {boolean} userInitiated - Whether this was triggered by an explicit user action (e.g. clicking "regenerate" in the UI). When true, bypasses the global disable setting. (default: false)
 * @returns {Promise<Object|null>}
 */
export async function generateSummary(sessionId, retryCount = 0, force = false, userInitiated = false) {
  try {
    // Get session info
    const session = sessions.getById(sessionId);
    if (!session) {
      console.warn(`[SummaryService] Session ${sessionId} not found for summary generation`);
      return null;
    }

    // Check if session summaries are disabled globally
    // Only user-initiated regeneration (explicit UI action) bypasses this check.
    // force=true (used by onSessionComplete) still respects the disable setting.
    const globalSettings = settings.getSummarySettings();
    if (!userInitiated && globalSettings?.disableSessionSummaries) {
      console.log(`[SummaryService] Session summaries disabled globally, skipping generation`);
      return null;
    }

    // Get existing summary for incremental generation
    const existingSummary = sessionSummaries.getBySessionId(sessionId);

    // Skip regeneration for merged PRs (work is complete)
    if (existingSummary?.prMerged) {
      console.log(`[SummaryService] Session ${sessionId} has merged PR, skipping regeneration`);
      return existingSummary;
    }

    // Get recent messages
    const allMessages = messages.getBySessionId(sessionId);

    // Skip if summary is current and not forced to regenerate
    if (!force && !isSummaryStale(sessionId)) {
      console.log(`[SummaryService] Summary for ${sessionId} is current, skipping regeneration`);
      return existingSummary;
    }
    const recentMessages = allMessages.slice(-MAX_MESSAGES);

    // Broadcast that we're generating (do this early so UI always gets the event)
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
      sessionId,
      generating: true,
    });

    // Handle sessions with too few messages - create a minimal summary instead of skipping
    if (allMessages.length < MIN_MESSAGES_FOR_SUMMARY) {
      console.log(`[SummaryService] Session ${sessionId} has only ${allMessages.length} messages (minimum ${MIN_MESSAGES_FOR_SUMMARY}), creating minimal summary`);

      const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;

      // Create a minimal summary based on available messages
      const minimalSummary = {
        shortSummary: 'Session in progress',
        fullSummary: `Session with ${allMessages.length} message${allMessages.length !== 1 ? 's' : ''}`,
        keyActions: [],
        filesModified: [],
        outcome: session.status === 'stopped' ? 'partial' : session.status === 'error' ? 'failed' : 'ongoing',
        messageCount: allMessages.length,
        lastSummarizedMessageId: lastMessage ? lastMessage.id : null,
      };

      const summary = sessionSummaries.upsert(sessionId, minimalSummary);

      // Broadcast the minimal summary
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
        sessionId,
        summary,
      });

      // Also broadcast to project subscribers
      if (session.projectId) {
        broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
          projectId: session.projectId,
          sessionId,
          summary,
        });

        // Also broadcast session:updated to project subscribers so session lists update
        broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
          projectId: session.projectId,
          sessionId,
          session: sessions.getById(sessionId),
        });
      }

      // Clear the generating flag
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
        sessionId,
        generating: false,
      });

      return summary;
    }

    // Build child session context for workflow-aware summaries
    const childContext = buildChildSessionContext(sessionId);

    // Build prompt with global title prompt and child context
    const prompt = buildIncrementalPrompt(existingSummary, recentMessages, session.status, globalSettings?.sessionTitlePrompt, childContext);

    // Call Claude via SDK (or mock in test mode)
    const responseText = await callClaude(prompt, recentMessages, session.status, {
      sessionId,
      callType: 'generateSessionSummary',
    }, SUMMARY_SYSTEM_PROMPT);

    // Parse response
    const summaryData = parseSummaryResponse(responseText);

    // Retry if parsing failed and we haven't exhausted retries
    if (summaryData._parseFailed && retryCount < MAX_RETRIES) {
      console.log(
        `[SummaryService] Parse failed for session ${sessionId}, retrying (attempt ${retryCount + 2}/${MAX_RETRIES + 1})`
      );
      const backoffMs = 1000 * (retryCount + 1); // 1s, 2s
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return generateSummary(sessionId, retryCount + 1, force, userInitiated);
    }

    // Clean up internal flag before saving
    delete summaryData._parseFailed;

    // Add message count and last message ID for staleness tracking (Phase 6)
    summaryData.messageCount = allMessages.length;
    const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
    summaryData.lastSummarizedMessageId = lastMessage ? lastMessage.id : null;

    // For root sessions (no parent), aggregate files from all child sessions
    if (!session.parentSessionId) {
      summaryData.filesModified = aggregateFilesModified(sessionId, summaryData.filesModified);
    }

    // Validate and enrich PR URL
    const prUrl = summaryData.prUrl || session.prUrl;
    if (prUrl) {
      // Validate PR URL against project repository
      const project = projects.getById(session.projectId);
      const projectRepoUrl = project?.repoUrl;
      const validation = validatePrUrl(prUrl, projectRepoUrl);

      if (!validation.valid) {
        console.warn(`[SummaryService] PR URL validation failed for session ${sessionId}:`, validation.error);
        // Don't save the invalid PR URL
        summaryData.prUrl = null;
      } else {
        // Enrich with GitHub PR status if validation passed
        try {
          const prInfo = await ghService.getPrInfo(prUrl);
          if (prInfo) {
            summaryData.prState = prInfo.state;
            summaryData.prMerged = prInfo.merged;
            summaryData.hasMergeConflicts = prInfo.hasMergeConflicts;
            summaryData.ciStatus = prInfo.ciStatus;
            summaryData.ciFailures = prInfo.ciFailures;
          }
        } catch (error) {
          console.warn(`[SummaryService] Failed to get PR info for ${prUrl}:`, error.message);
        }
      }
    }

    // Upsert summary
    const summary = sessionSummaries.upsert(sessionId, summaryData);

    // Auto-populate project repo URL if not already set
    const project = projects.getById(session.projectId);
    if (!project.repoUrl && (summaryData.prUrl || summaryData.repositoryUrl)) {
      let extractedRepoUrl = summaryData.repositoryUrl;

      // If we have a PR URL, extract the repository base URL
      if (!extractedRepoUrl && summaryData.prUrl) {
        const prMatch = summaryData.prUrl.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)(?:\/|$)/);
        if (prMatch) {
          extractedRepoUrl = prMatch[1];
        }
      }

      // Update project with the extracted repo URL if valid
      if (extractedRepoUrl) {
        try {
          projects.update(session.projectId, { repoUrl: extractedRepoUrl });
          console.log(`[SummaryService] Auto-populated repo URL for project ${session.projectId}: ${extractedRepoUrl}`);
        } catch (error) {
          console.warn(`[SummaryService] Failed to auto-populate repo URL for project ${session.projectId}:`, error.message);
        }
      }
    }

    // Update session name and prUrl if we have new data
    if (summaryData.sessionTitle || summaryData.prUrl) {
      const updateData = {};
      if (summaryData.sessionTitle) {
        updateData.name = summaryData.sessionTitle;
      }
      if (summaryData.prUrl) {
        updateData.prUrl = summaryData.prUrl;
      }
      const updatedSession = sessions.update(sessionId, updateData);

      // Broadcast session update for real-time UI sync (session detail view)
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
        sessionId,
        session: updatedSession,
      });

      // Also broadcast to project subscribers for session list updates
      if (session.projectId) {
        broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
          projectId: session.projectId,
          sessionId,
          session: updatedSession,
        });
      }
    } else {
      // Even if name/PR URL didn't change, broadcast SESSION_UPDATED so project subscribers know summary was generated
      if (session.projectId) {
        broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
          projectId: session.projectId,
          sessionId,
          session: sessions.getById(sessionId),
        });
      }
    }

    // Broadcast updated summary to session subscribers
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
      sessionId,
      summary,
    });

    // Also broadcast to project subscribers so session lists update in real-time
    if (session.projectId) {
      broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
        projectId: session.projectId,
        sessionId,
        summary,
      });
    }

    // Clear the generating flag so the UI knows generation is complete
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
      sessionId,
      generating: false,
    });

    console.log(`[SummaryService] Successfully generated summary for session ${sessionId}`);

    // Propagate summary updates to parent sessions (workflow-aware)
    if (session.parentSessionId) {
      // Don't await - let this run asynchronously
      propagateToParent(sessionId);
    }

    return summary;
  } catch (error) {
    console.error(`[SummaryService] Failed to generate summary for session ${sessionId}:`, {
      error: error.message,
      stack: error.stack,
      sessionId,
    });

    // Broadcast that generation stopped
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
      sessionId,
      generating: false,
    });

    return null;
  }
}

/**
 * Called on every new message - debounces summary generation
 * @param {string} sessionId
 */
export function onSessionActivity(sessionId) {
  // Cancel existing timer
  if (debounceTimers.has(sessionId)) {
    clearTimeout(debounceTimers.get(sessionId));
  }

  // Get project-specific debounce delay
  const session = sessions.getById(sessionId);
  if (!session) return;

  const project = projects.getById(session.projectId);
  const debounceDelay = project?.summaryDebounceMs || DEBOUNCE_DELAY;

  // Set new debounce timer with project-specific delay
  const timer = setTimeout(() => {
    generateSummary(sessionId);
    debounceTimers.delete(sessionId);
  }, debounceDelay);

  debounceTimers.set(sessionId, timer);
}

/**
 * Generate summary immediately and wait for completion (synchronous)
 * Used by template trigger to ensure summary is ready before creating new session
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function generateSummaryNow(sessionId) {
  // Cancel any pending debounced generation for this session
  if (debounceTimers.has(sessionId)) {
    clearTimeout(debounceTimers.get(sessionId));
    debounceTimers.delete(sessionId);
  }
  // Generate summary immediately and wait for completion
  return await generateSummary(sessionId);
}

/**
 * Called when session completes - generate immediately
 * Also schedules follow-up CI checks for sessions with PRs
 * @param {string} sessionId
 */
export function onSessionComplete(sessionId) {
  // Cancel debounce timer if exists
  if (debounceTimers.has(sessionId)) {
    clearTimeout(debounceTimers.get(sessionId));
    debounceTimers.delete(sessionId);
  }

  // Check if we should use combined generation (more efficient - one API call instead of two)
  const activeConversation = conversations.getActiveBySessionId(sessionId);
  const shouldGenerateConversationSummary = activeConversation && !activeConversation.summary && isConversationSummaryEnabled(sessionId);

  if (shouldGenerateConversationSummary) {
    // Use combined generation - single API call for both summaries
    generateSessionAndConversationSummary(sessionId, activeConversation.id).catch((err) => {
      console.error(`[SummaryService] Failed to generate combined summary on session complete:`, err);
      // Fallback to individual generations if combined fails
      generateSummary(sessionId, 0, true);
      if (activeConversation) {
        generateConversationSummary(sessionId, activeConversation.id).catch((err2) => {
          console.error(`[SummaryService] Failed fallback conversation summary:`, err2);
        });
      }
    });
  } else {
    // Only generate session summary
    generateSummary(sessionId, 0, true);
  }

  // Schedule follow-up CI checks for sessions with PRs
  // CI might still be running after the session completes
  const session = sessions.getById(sessionId);
  if (session?.prUrl) {
    // Use dynamic import to avoid circular dependency with prStatusService
    const scheduleCiCheck = async () => {
      const prStatusService = await import('./prStatusService.js');
      prStatusService.checkSessionCiStatusNow(sessionId);
    };

    // Check after 2 minutes (CI often takes a few minutes)
    setTimeout(scheduleCiCheck, 2 * 60 * 1000);

    // Check again after 5 minutes
    setTimeout(scheduleCiCheck, 5 * 60 * 1000);
  }
}

/**
 * Get summary for a session, generating if needed
 * @param {string} sessionId
 * @param {boolean} generateIfMissing - Whether to generate if no summary exists
 * @returns {Promise<Object|null>}
 */
export async function getSummary(sessionId, generateIfMissing = false) {
  let summary = sessionSummaries.getBySessionId(sessionId);

  if (!summary && generateIfMissing) {
    summary = await generateSummary(sessionId);
  }

  return summary;
}

/**
 * Force regenerate summary for a session (user-initiated action)
 * This bypasses the global disable setting since the user explicitly requested it.
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function regenerateSummary(sessionId) {
  return generateSummary(sessionId, 0, true, true);
}

/**
 * Check if a summary is stale (message count or last message ID has changed)
 * Phase 6: Enhanced staleness detection using both message count and message ID
 * @param {string} sessionId
 * @returns {boolean}
 */
export function isSummaryStale(sessionId) {
  const summary = sessionSummaries.getBySessionId(sessionId);
  if (!summary) return true;

  const allMessages = messages.getBySessionId(sessionId);

  // Phase 6: Use message ID-based staleness detection if available
  if (summary.lastSummarizedMessageId) {
    // Get the last message ID from the session
    const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
    const lastMessageId = lastMessage ? lastMessage.id : null;

    // Summary is stale if the last message ID doesn't match
    if (lastMessageId !== summary.lastSummarizedMessageId) {
      return true;
    }

    // Also validate count as a secondary check (defensive programming)
    return allMessages.length !== summary.messageCount;
  }

  // Fallback to count-based staleness detection for old summaries
  return allMessages.length !== summary.messageCount;
}

/**
 * Clean up debounce timer for a session (call on session deletion)
 * @param {string} sessionId
 */
export function cleanupSession(sessionId) {
  if (debounceTimers.has(sessionId)) {
    clearTimeout(debounceTimers.get(sessionId));
    debounceTimers.delete(sessionId);
  }
}

/**
 * Build prompt for conversation summary generation
 * @param {Array} conversationMessages - Messages in the conversation
 * @returns {string}
 */
function buildConversationSummaryPrompt(conversationMessages) {
  const formattedMessages = formatMessages(conversationMessages);

  // Return only dynamic content - static instructions are in system prompt
  return `CONVERSATION:
${formattedMessages}`;
}

/**
 * Parse conversation summary response
 * @param {string} responseText
 * @returns {string} The summary text
 */
function parseConversationSummaryResponse(responseText) {
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

/**
 * Generate both session and conversation summaries in a single API call
 * This is more efficient than calling them separately
 * @param {string} sessionId - The session ID
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object>} Object with sessionSummary and conversationSummary
 */
export async function generateSessionAndConversationSummary(sessionId, conversationId) {
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

    // Check if session summaries are disabled globally
    const globalSettings = settings.getSummarySettings();
    if (globalSettings?.disableSessionSummaries) {
      console.log(`[SummaryService] Session summaries disabled globally, skipping combined generation`);
      return { sessionSummary: null, conversationSummary: null };
    }

    // Get existing session summary and recent messages
    const existingSummary = sessionSummaries.getBySessionId(sessionId);
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
    const responseText = await callClaudeWithCustomSchema(
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

    // Add message count and last message ID for staleness tracking (Phase 6)
    summaryData.messageCount = allMessages.length;
    const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
    summaryData.lastSummarizedMessageId = lastMessage ? lastMessage.id : null;

    // For root sessions, aggregate files from child sessions
    if (!session.parentSessionId) {
      summaryData.filesModified = aggregateFilesModified(sessionId, summaryData.filesModified);
    }

    // Validate and enrich PR URL
    const prUrl = summaryData.prUrl || session.prUrl;
    if (prUrl) {
      const project = projects.getById(session.projectId);
      const projectRepoUrl = project?.repoUrl;
      const validation = validatePrUrl(prUrl, projectRepoUrl);

      if (!validation.valid) {
        console.warn(`[SummaryService] PR URL validation failed for session ${sessionId}:`, validation.error);
        summaryData.prUrl = null;
      } else {
        try {
          const prInfo = await ghService.getPrInfo(prUrl);
          summaryData.prMerged = prInfo.merged;
          summaryData.prState = prInfo.state;
          summaryData.hasMergeConflicts = prInfo.hasMergeConflicts;
          summaryData.ciStatus = prInfo.ciStatus;
        } catch (error) {
          console.warn(`[SummaryService] Failed to fetch PR info for ${prUrl}:`, error.message);
        }
      }
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

/**
 * Mock query generator for combined summary generation in test mode
 * Mirrors the Claude Code SDK's async generator pattern
 * @param {Object} params
 * @param {string} params.prompt - The prompt string
 * @param {Array} params.recentMessages - Messages for mock context
 * @param {string} params.sessionStatus - Session status for mock outcome
 */
async function* mockCombinedSummaryQuery({ prompt: _prompt, recentMessages, sessionStatus }) {
  // Yield system init event (matches SDK pattern)
  yield {
    type: 'system',
    subtype: 'init',
    session_id: 'mock-combined-' + Date.now(),
  };

  // Small delay to simulate processing
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Derive outcome from session status
  let outcome = 'ongoing';
  if (sessionStatus === 'stopped') outcome = 'partial';
  else if (sessionStatus === 'error') outcome = 'failed';

  // Create contextual mock response with both session and conversation summaries
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
    conversation_summary: `Mock conversation summary for testing with ${recentMessages.length} messages.`,
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
 * Call Claude with a custom JSON schema (for combined summaries)
 * @param {string} prompt - The prompt to send
 * @param {Array} recentMessages - Messages for context
 * @param {string} sessionStatus - Session status
 * @param {Object} logMeta - Logging metadata
 * @param {string} systemPrompt - System prompt
 * @param {Object} jsonSchema - Custom JSON schema
 * @returns {Promise<string>} The text response
 */
async function callClaudeWithCustomSchema(prompt, recentMessages, sessionStatus, logMeta, systemPrompt, jsonSchema) {
  const queryFn = isMockMode() ? mockCombinedSummaryQuery : query;

  const queryParams = isMockMode()
    ? { prompt, recentMessages, sessionStatus }
    : {
        prompt,
        options: {
          cwd: process.cwd(),
          permissionMode: 'bypassPermissions',
          maxTurns: 1,
          model: 'claude-haiku-4-5-20251001',
          systemPrompt,
          outputFormat: {
            type: 'json_schema',
            schema: jsonSchema,
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
    if (conversationMessages.length < 3) {
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
 * Propagate summary update to parent sessions
 * When a child session's summary is updated, the parent's summary may need regeneration
 * @param {string} sessionId - The child session ID that was updated
 */
export async function propagateToParent(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session || !session.parentSessionId) return;

  // Trigger a summary regeneration for the parent session
  // This is debounced so multiple child updates don't cause multiple parent regenerations
  onSessionActivity(session.parentSessionId);
}

// Export for testing
export { DEBOUNCE_DELAY, MAX_MESSAGES, MIN_MESSAGES_FOR_SUMMARY, MAX_RETRIES, DEFAULT_SESSION_TITLE_PROMPT, SUMMARY_SYSTEM_PROMPT, CONVERSATION_SUMMARY_SYSTEM_PROMPT, COMBINED_SUMMARY_SYSTEM_PROMPT, isMockMode, callClaude, formatMessages, buildIncrementalPrompt, parseSummaryResponse, parsePrUrl, validatePrUrl, getChildSessions, buildChildSessionContext, aggregateFilesModified };
