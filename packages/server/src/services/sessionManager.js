import { query } from '@anthropic-ai/claude-agent-sdk';
import { sessions, messages, workLogs } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES, DEFAULT_SERVER_PORT, DEFAULT_SYSTEM_PROMPT } from '@claudetools/shared';
import { updateTodos } from './todoStore.js';
import * as summaryService from './summaryService.js';

/** @type {Map<string, string|null>} Track current message ID for work log association */
const currentMessageIds = new Map();

/** @type {Map<string, string>} Accumulate thinking content per session */
const thinkingAccumulators = new Map();

/** @type {Map<string, { controller: AbortController }>} */
const activeSessions = new Map();

/** Check if mock mode is enabled (for E2E testing) */
const isMockMode = () => process.env.MOCK_CLAUDE === 'true';

/**
 * Mock query generator for E2E testing
 * Simulates the Claude SDK's behavior for multi-turn conversations
 * @param {Object} params
 * @param {string} params.prompt - The prompt string
 */
async function* mockQuery({ prompt }) {
  // Yield system init event
  yield {
    type: 'system',
    subtype: 'init',
    session_id: 'mock-session-' + Date.now(),
    model: 'claude-sonnet-4-5-20250929',
  };

  // Small delay to simulate processing
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Generate a mock response based on the user's message
  const responseText = `Mock response to: "${prompt}"`;

  // Yield assistant message
  yield {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: responseText }],
    },
  };

  // Yield result event
  yield {
    type: 'result',
    subtype: 'success',
    total_cost_usd: 0.001,
  };
}

/**
 * Build system prompt with canvas instructions
 * @param {string} sessionId
 * @returns {string}
 */
function buildCanvasSystemPrompt(sessionId) {
  const apiUrl = process.env.CLAUDETOOLS_API_URL || `http://localhost:${process.env.PORT || DEFAULT_SERVER_PORT}`;
  return `When you generate artifacts that should be displayed on the canvas (images, markdown documents, code snippets, data visualizations), POST them to:
POST ${apiUrl}/api/sessions/${sessionId}/canvas
Body: {"type": "image|markdown|text|json", "content": "...", "title": "..."}

For images, use base64 encoding in the content field.`;
}

/**
 * Build environment variables for Claude SDK based on session settings
 * @param {Object} session
 * @returns {Object|undefined}
 */
function buildSessionEnv(session) {
  if (!session.thinkingEnabled) {
    return undefined; // Let SDK use process.env by default
  }
  // Merge with process.env to preserve PATH and other essential env vars
  return {
    ...process.env,
    MAX_THINKING_TOKENS: '10240',
  };
}

/**
 * Build the full system prompt configuration
 * @param {string} sessionId
 * @param {string|null} customSystemPrompt - Custom system prompt from project settings
 * @returns {string} System prompt string
 */
function buildSystemPromptConfig(sessionId, customSystemPrompt) {
  const canvasInstructions = buildCanvasSystemPrompt(sessionId);
  const basePrompt = customSystemPrompt || DEFAULT_SYSTEM_PROMPT;
  return `${basePrompt}\n\n${canvasInstructions}`;
}

/**
 * Run a Claude session
 * @param {string} sessionId
 * @param {string} prompt
 * @param {string} workingDirectory
 * @param {string|null} systemPrompt - Custom system prompt from project settings
 */
export async function runSession(sessionId, prompt, workingDirectory, systemPrompt = null) {
  const controller = new AbortController();
  activeSessions.set(sessionId, { controller });

  // Reset message tracking for this turn - ensures work logs start as unassociated
  currentMessageIds.set(sessionId, null);

  try {
    // Get session for settings
    const session = sessions.getById(sessionId);

    // Update status to running
    sessions.update(sessionId, { status: 'running' });
    broadcastSessionStatus(sessionId, 'running');

    // Note: Initial user message is already created in SessionRepository.create()

    // Choose between mock and real query based on environment
    const queryFn = isMockMode() ? mockQuery : query;

    // Build environment variables for thinking mode
    const sessionEnv = buildSessionEnv(session);

    const queryParams = isMockMode()
      ? { prompt }
      : {
          prompt,
          options: {
            cwd: workingDirectory,
            abortController: controller,
            includePartialMessages: true,
            permissionMode: 'bypassPermissions',
            ...(sessionEnv && { env: sessionEnv }),
            systemPrompt: buildSystemPromptConfig(sessionId, systemPrompt),
          },
        };

    // Run the query with the SDK (or mock)
    for await (const event of queryFn(queryParams)) {
      if (controller.signal.aborted) break;

      await handleStreamEvent(sessionId, event);
    }

    // Session ready for follow-up - set to waiting instead of completed
    const activeSession = activeSessions.get(sessionId);
    if (activeSession && !controller.signal.aborted) {
      sessions.update(sessionId, { status: 'waiting' });
      broadcastSessionStatus(sessionId, 'waiting');
      // Trigger summary generation when session completes a turn
      summaryService.onSessionActivity(sessionId);
    }
  } catch (error) {
    console.error('Session error:', error);
    console.error('Error stack:', error.stack);
    if (!controller.signal.aborted) {
      sessions.update(sessionId, { status: 'error', error: error.message });
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: error.message });
      // Trigger summary generation on error
      summaryService.onSessionComplete(sessionId);
    }
    throw error;
  } finally {
    activeSessions.delete(sessionId);
  }
}

/**
 * Continue a session with a follow-up message
 * @param {string} sessionId
 * @param {string} content
 * @param {string} workingDirectory
 * @param {string|null} systemPrompt - Custom system prompt from project settings
 */
export async function continueSession(sessionId, content, workingDirectory, systemPrompt = null) {
  // Check if session is already running
  if (activeSessions.has(sessionId)) {
    throw new Error('Session is already processing');
  }

  // Get the session to retrieve the Claude session ID and settings
  const session = sessions.getById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  if (!session.claudeSessionId && !isMockMode()) {
    throw new Error('Session has no Claude session ID - cannot resume');
  }

  const controller = new AbortController();
  activeSessions.set(sessionId, { controller });

  // Reset message tracking for this turn - ensures work logs start as unassociated
  currentMessageIds.set(sessionId, null);

  try {
    // Store the user message
    const message = messages.create(sessionId, 'user', content);
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, { message });

    // Update status to running
    sessions.update(sessionId, { status: 'running' });
    broadcastSessionStatus(sessionId, 'running');

    // Choose between mock and real query based on environment
    const queryFn = isMockMode() ? mockQuery : query;

    // Build environment variables for thinking mode
    const sessionEnv = buildSessionEnv(session);

    const queryParams = isMockMode()
      ? { prompt: content }
      : {
          prompt: content,
          options: {
            cwd: workingDirectory,
            abortController: controller,
            includePartialMessages: true,
            permissionMode: 'bypassPermissions',
            resume: session.claudeSessionId,
            ...(sessionEnv && { env: sessionEnv }),
            systemPrompt: buildSystemPromptConfig(sessionId, systemPrompt),
          },
        };

    // Resume the session with the new message
    for await (const event of queryFn(queryParams)) {
      if (controller.signal.aborted) break;

      await handleStreamEvent(sessionId, event);
    }

    // Session ready for more follow-ups
    const activeSession = activeSessions.get(sessionId);
    if (activeSession && !controller.signal.aborted) {
      sessions.update(sessionId, { status: 'waiting' });
      broadcastSessionStatus(sessionId, 'waiting');
      // Trigger summary generation when session completes a turn
      summaryService.onSessionActivity(sessionId);
    }
  } catch (error) {
    console.error('Continue session error:', error);
    console.error('Error stack:', error.stack);
    if (!controller.signal.aborted) {
      sessions.update(sessionId, { status: 'error', error: error.message });
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: error.message });
      // Trigger summary generation on error
      summaryService.onSessionComplete(sessionId);
    }
    throw error;
  } finally {
    activeSessions.delete(sessionId);
  }
}

/**
 * Stop a running or waiting session
 * @param {string} sessionId
 */
export async function stopSession(sessionId) {
  const sessionData = activeSessions.get(sessionId);

  if (sessionData) {
    // Session is actively processing - abort it
    sessionData.controller.abort();
    activeSessions.delete(sessionId);
  }
  // If not in activeSessions, session may have crashed or be waiting
  // Either way, we can still update the status to stopped

  sessions.update(sessionId, { status: 'stopped' });
  broadcastSessionStatus(sessionId, 'stopped');
}

/**
 * Restart a completed or errored session (set back to stopped so it can receive messages)
 * @param {string} sessionId
 */
export function restartSession(sessionId) {
  // Clear any error and set status to stopped (allows sending new messages)
  sessions.update(sessionId, { status: 'stopped', error: null });
  broadcastSessionStatus(sessionId, 'stopped');
}

/**
 * Clean up an active session before deletion
 * @param {string} sessionId
 * @returns {boolean} true if session was active and cleaned up
 */
export function cleanupActiveSession(sessionId) {
  const sessionData = activeSessions.get(sessionId);
  if (sessionData) {
    sessionData.controller.abort();
    activeSessions.delete(sessionId);
    return true;
  }
  return false;
}

/**
 * Create and broadcast a work log entry
 * @param {string} sessionId
 * @param {string} type - 'thinking', 'tool_input', or 'tool_output'
 * @param {string} content
 * @param {string|null} toolName
 */
function createWorkLog(sessionId, type, content, toolName = null) {
  const messageId = currentMessageIds.get(sessionId) || null;
  const log = workLogs.create(sessionId, type, content, messageId, toolName);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_WORK_LOG, {
    sessionId,
    log
  });
  return log;
}

/**
 * Handle a stream event from Claude SDK
 * @param {string} sessionId
 * @param {Object} event
 */
async function handleStreamEvent(sessionId, event) {
  switch (event.type) {
    case 'system': {
      // Store Claude's session info
      if (event.subtype === 'init') {
        sessions.update(sessionId, {
          claudeSessionId: event.session_id,
          model: event.model,
        });
        // Reset message tracking for new session
        currentMessageIds.set(sessionId, null);
      }
      break;
    }

    case 'assistant': {
      // Extract text content from assistant message
      const textContent = event.message?.content
        ?.filter((c) => c.type === 'text')
        ?.map((c) => c.text)
        ?.join('\n');

      // Extract tool use for logging
      const toolUseBlocks = event.message?.content?.filter((c) => c.type === 'tool_use') || [];

      if (textContent) {
        const toolUse = toolUseBlocks.length > 0 ? toolUseBlocks : null;
        const message = messages.create(sessionId, 'assistant', textContent, toolUse);

        // Update current message ID for work log association
        currentMessageIds.set(sessionId, message.id);

        // Associate any pending work logs with this message
        const associatedCount = workLogs.associatePendingLogs(sessionId, message.id);

        // Broadcast message first
        broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, { message });

        // Check for TodoWrite tool and update todos
        if (toolUse) {
          const todoWrite = toolUse.find((t) => t.name === 'TodoWrite');
          if (todoWrite?.input?.todos) {
            updateTodos(sessionId, todoWrite.input.todos);
          }
        }

        // Notify client to re-associate work logs in their state
        if (associatedCount > 0) {
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_WORK_LOGS_ASSOCIATED, {
            sessionId,
            messageId: message.id,
          });
        }

        // Trigger debounced summary generation on new message
        summaryService.onSessionActivity(sessionId);
      }

      // Note: Thinking content is logged via stream_event -> content_block_stop
      // to avoid duplicates (since includePartialMessages is always enabled)

      // Log tool use inputs
      for (const toolUse of toolUseBlocks) {
        const toolInput = JSON.stringify(toolUse.input, null, 2);
        createWorkLog(sessionId, 'tool_input', toolInput, toolUse.name);
      }
      break;
    }

    case 'tool_result': {
      // Log tool results/outputs
      const content = event.content || event.result || '';
      const toolName = event.tool_name || event.name || 'unknown';

      // Handle different content formats
      let logContent;
      if (typeof content === 'string') {
        logContent = content;
      } else if (Array.isArray(content)) {
        logContent = content
          .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
          .join('\n');
      } else {
        logContent = JSON.stringify(content, null, 2);
      }

      if (logContent) {
        createWorkLog(sessionId, 'tool_output', logContent, toolName);
      }
      break;
    }

    case 'stream_event': {
      // Real-time streaming - handle content_block_delta events
      if (event.event?.type === 'content_block_delta') {
        const delta = event.event.delta;

        if (delta?.type === 'text_delta' && delta.text) {
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_PARTIAL, {
            sessionId,
            text: delta.text,
          });
        }

        // Handle thinking delta - accumulate and broadcast partial (don't create work log yet)
        if (delta?.type === 'thinking_delta' && delta.thinking) {
          const current = thinkingAccumulators.get(sessionId) || '';
          const accumulated = current + delta.thinking;
          thinkingAccumulators.set(sessionId, accumulated);

          // Broadcast partial thinking for real-time display
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_THINKING_PARTIAL, {
            sessionId,
            thinking: accumulated,
          });
        }
      }

      // Handle content_block_stop - finalize accumulated thinking
      if (event.event?.type === 'content_block_stop') {
        const accumulated = thinkingAccumulators.get(sessionId);
        if (accumulated) {
          // Create a single work log entry with the complete thinking content
          createWorkLog(sessionId, 'thinking', accumulated);
          thinkingAccumulators.delete(sessionId);

          // Clear partial thinking on client
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_THINKING_PARTIAL, {
            sessionId,
            thinking: null,
          });
        }
      }
      break;
    }

    case 'result': {
      if (event.subtype === 'error') {
        sessions.update(sessionId, { status: 'error', error: event.error });
        broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: event.error });
        // Generate summary on error
        summaryService.onSessionComplete(sessionId);
      } else {
        // Store cost info
        if (event.total_cost_usd !== undefined) {
          sessions.update(sessionId, { costUsd: event.total_cost_usd });
        }
      }
      // Clear message tracking when session completes
      currentMessageIds.delete(sessionId);
      break;
    }
  }
}

/**
 * Broadcast session status update
 * @param {string} sessionId
 * @param {string} status
 */
function broadcastSessionStatus(sessionId, status) {
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId, status });
}
