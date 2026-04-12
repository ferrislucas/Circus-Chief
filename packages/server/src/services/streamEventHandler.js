import { sessions, messages, workLogs, conversations } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { updateTodos } from './todoStore.js';
import * as summaryService from './summaryService.js';
import * as diffService from './diffService.js';
import {
  handleMessageStart,
  handleMessageDelta,
  handleTextDelta as _handleTextDelta,
  handleResultUsage,
} from './streamUsageHandler.js';

// ── Shared module-level state ──────────────────────────────────────────────

/** @type {Map<string, string|null>} Track last message ID for end-of-turn work log association */
export const lastMessageIds = new Map();

/** @type {Map<string, string>} Accumulate thinking content per session */
export const thinkingAccumulators = new Map();

/** @type {Map<string, string>} Accumulate text content per session */
export const textAccumulators = new Map();

/** @type {Map<string, { controller: AbortController }>} */
export const activeSessions = new Map();

/** @type {Map<string, string>} Map sessionId -> conversationId for current turn */
export const activeConversationIds = new Map();

/** @type {Map<string, string>} Track current model per session (updated on system.init) */
export const currentModels = new Map();

/** @type {Map<string, Set<string>>} Track tool_use IDs that have already been logged per session */
export const loggedToolUseIds = new Map();

// ── Helper functions ───────────────────────────────────────────────────────

/**
 * Create and broadcast a work log entry
 * Work logs are always created as unassociated during the turn,
 * then associated with the message when the turn completes.
 * @param {string} sessionId
 * @param {string} type - 'thinking', 'tool_input', or 'tool_output'
 * @param {string} content
 * @param {string|null} toolName
 */
export function createWorkLog(sessionId, type, content, toolName = null) {
  // Always create as unassociated - will be associated at end of turn
  const log = workLogs.create(sessionId, type, content, { messageId: null, toolName });
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_WORK_LOG, {
    sessionId,
    log
  });
  return log;
}

/**
 * Associate pending work logs with a message and broadcast the event
 * @param {string} sessionId
 * @param {string} messageId
 */
export function associateAndBroadcastWorkLogs(sessionId, messageId) {
  const associatedCount = workLogs.associatePendingLogs(sessionId, messageId);
  if (associatedCount > 0) {
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_WORK_LOGS_ASSOCIATED, {
      sessionId,
      messageId,
    });
  }
  return associatedCount;
}

/**
 * Broadcast session status update
 * @param {string} sessionId
 * @param {string} status
 */
export function broadcastSessionStatus(sessionId, status) {
  // Broadcast to session subscribers (for session detail view)
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId, status });

  // Also broadcast SESSION_UPDATED to project subscribers (for session list updates)
  const session = sessions.getById(sessionId);
  if (session) {
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId: session.projectId,
      sessionId,
      session: { ...session, status },
    });
  }
}

/**
 * Compute and broadcast changes state when turn completes
 * Called after status is set to "waiting" to provide real-time changes update
 * @param {string} sessionId
 * @param {string} projectId
 * @param {string} workingDirectory
 */
export async function broadcastChangesUpdate(sessionId, projectId, workingDirectory) {
  try {
    const changes = await diffService.getChanges(workingDirectory);
    const hasChanges = Boolean(changes.staged || changes.unstaged || changes.untracked);

    // Count total files with changes
    // Parse diff output to count unique files
    const parseFilesFromDiff = (diff) => {
      if (!diff) return 0;
      const matches = diff.match(/^diff --git a\/(.+) b\//gm) || [];
      return matches.length;
    };

    const stagedCount = parseFilesFromDiff(changes.staged);
    const unstagedCount = parseFilesFromDiff(changes.unstaged);
    const untrackedCount = parseFilesFromDiff(changes.untracked);
    const changeCount = stagedCount + unstagedCount + untrackedCount;

    // Broadcast to session subscribers
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.CHANGES_UPDATE, {
      sessionId,
      hasChanges,
      changeCount,
    });
  } catch (error) {
    // Silently fail - changes indicator is not critical
    // This handles cases like non-git directories or permission errors
    console.error(`Failed to compute changes for session ${sessionId}:`, error.message);
  }
}

// ── Event-type-specific handlers ────────────────────────────────────────────

/**
 * Handle 'system' events (e.g. system.init)
 * @param {string} sessionId
 * @param {Object} event
 */
function handleSystemEvent(sessionId, event) {
  // Store Claude's session info
  if (event.subtype !== 'init') return;

  // Save Claude session ID to the active conversation for context isolation
  const activeConversation = conversations.getActiveBySessionId(sessionId);
  if (activeConversation) {
    conversations.update(activeConversation.id, {
      claudeSessionId: event.session_id,
    });
  }
  // Track current model for this session (used when creating messages)
  currentModels.set(sessionId, event.model);
  // Capture available slash commands (do NOT update model here — session.model
  // tracks the user-requested short format; this SDK model is stored in currentModels)
  sessions.update(sessionId, {
    slashCommands: JSON.stringify(event.slash_commands || []),
  });
  // Reset message tracking for new session
  lastMessageIds.delete(sessionId);
}

/**
 * Handle 'assistant' events — save messages, update todos, log tool use
 * @param {string} sessionId
 * @param {Object} event
 */
function handleAssistantEvent(sessionId, event) {
  // Extract text content from assistant message
  const textContent = event.message?.content
    ?.filter((c) => c.type === 'text')
    ?.map((c) => c.text)
    ?.join('\n');

  // Extract tool use for logging
  const toolUseBlocks = event.message?.content?.filter((c) => c.type === 'tool_use') || [];

  // NOTE: Do NOT use assistant event usage for broadcasting
  // The stream events already provide real-time usage updates via message_start and message_delta
  // Using assistant event would double-count the usage

  if (textContent) {
    handleAssistantTextContent(sessionId, textContent, toolUseBlocks);
  }

  // Check for TodoWrite tool and update todos
  // NOTE: This must be OUTSIDE the if (textContent) block because Claude can call
  // TodoWrite without any accompanying text content (tool-only messages)
  handleTodoWriteIfPresent(sessionId, toolUseBlocks);

  // Note: Thinking content is logged via stream_event -> content_block_stop
  // to avoid duplicates (since includePartialMessages is always enabled)

  // Log tool use inputs (dedup by tool_use ID to prevent duplicates from partial assistant events)
  logToolUseInputs(sessionId, toolUseBlocks);
}

/**
 * Save assistant text content as a message and broadcast it
 * @param {string} sessionId
 * @param {string} textContent
 * @param {Array} toolUseBlocks
 */
function handleAssistantTextContent(sessionId, textContent, toolUseBlocks) {
  const toolUse = toolUseBlocks.length > 0 ? toolUseBlocks : null;
  const activeConversation = conversations.getActiveBySessionId(sessionId);
  const conversationId = activeConversation?.id || null;
  const currentModel = currentModels.get(sessionId) || null;
  const message = messages.create(sessionId, 'assistant', textContent, { toolUse, conversationId, model: currentModel });

  // Associate pending work logs with this message immediately
  // This ensures work logs are attached to the correct message, not just the last one
  associateAndBroadcastWorkLogs(sessionId, message.id);

  // Track the message ID in case there are trailing work logs after the last message
  lastMessageIds.set(sessionId, message.id);

  // Broadcast message with conversationId for proper routing
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, {
    message,
    conversationId, // Include conversation context to prevent ambiguity
  });

  // Clear partial text on client now that complete message has been sent
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_PARTIAL, {
    sessionId,
    text: '',
  });

  // Note: Per-message onSessionActivity removed to reduce redundant summary generation.
  // Summary generation is triggered only on turn completion (waiting state) and session complete.
}

/**
 * Check for TodoWrite tool in toolUseBlocks and update todos if present
 * @param {string} sessionId
 * @param {Array} toolUseBlocks
 */
function handleTodoWriteIfPresent(sessionId, toolUseBlocks) {
  if (toolUseBlocks.length === 0) return;
  const todoWrite = toolUseBlocks.find((t) => t.name === 'TodoWrite');
  if (!todoWrite?.input?.todos) return;
  // Get active conversation to scope todos to it
  const activeConv = conversations.getActiveBySessionId(sessionId);
  if (activeConv) {
    updateTodos(sessionId, activeConv.id, todoWrite.input.todos);
  }
}

/**
 * Log tool use inputs, deduplicating by tool_use ID
 * @param {string} sessionId
 * @param {Array} toolUseBlocks
 */
function logToolUseInputs(sessionId, toolUseBlocks) {
  if (!loggedToolUseIds.has(sessionId)) {
    loggedToolUseIds.set(sessionId, new Set());
  }
  const loggedIds = loggedToolUseIds.get(sessionId);
  for (const toolUse of toolUseBlocks) {
    if (toolUse.id && loggedIds.has(toolUse.id)) continue;
    if (toolUse.id) loggedIds.add(toolUse.id);
    const toolInput = JSON.stringify(toolUse.input, null, 2);
    createWorkLog(sessionId, 'tool_input', toolInput, toolUse.name);
  }
}

/**
 * Handle 'tool_result' events — log tool outputs
 * @param {string} sessionId
 * @param {Object} event
 */
function handleToolResultEvent(sessionId, event) {
  // Log tool results/outputs
  const content = event.content || event.result || '';
  const toolName = event.tool_name || event.name || 'unknown';

  // Handle different content formats
  const logContent = formatToolResultContent(content);

  if (logContent) {
    createWorkLog(sessionId, 'tool_output', logContent, toolName);
  }
}

/**
 * Format tool result content for logging
 * @param {*} content
 * @returns {string}
 */
function formatToolResultContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
      .join('\n');
  }
  return JSON.stringify(content, null, 2);
}

/**
 * Handle 'stream_event' wrapper — dispatches to sub-handlers based on event.event.type
 * @param {string} sessionId
 * @param {Object} event
 */
function handleStreamEventType(sessionId, event) {
  const innerType = event.event?.type;
  const handler = streamSubHandlers[innerType];
  if (handler) {
    handler(sessionId, event);
  }
}

/**
 * Handle stream_event > message_start — clear text accumulator, then delegate to streamUsageHandler
 * @param {string} sessionId
 * @param {Object} event
 */
function handleMessageStartWrapper(sessionId, event) {
  // Clear text accumulator for fresh message
  textAccumulators.delete(sessionId);
  handleMessageStart(sessionId, event);
}

/**
 * Handle stream_event > content_block_delta — text and thinking deltas
 * @param {string} sessionId
 * @param {Object} event
 */
function handleContentBlockDelta(sessionId, event) {
  const delta = event.event.delta;

  if (delta?.type === 'text_delta' && delta.text) {
    _handleTextDelta(sessionId, delta, textAccumulators);
  }

  // Handle thinking delta - accumulate and broadcast partial (don't create work log yet)
  if (delta?.type === 'thinking_delta' && delta.thinking) {
    handleThinkingDelta(sessionId, delta);
  }
}

/**
 * Handle thinking_delta within content_block_delta — accumulate thinking
 * @param {string} sessionId
 * @param {Object} delta
 */
function handleThinkingDelta(sessionId, delta) {
  const current = thinkingAccumulators.get(sessionId) || '';
  const accumulated = current + delta.thinking;
  thinkingAccumulators.set(sessionId, accumulated);

  // Broadcast partial thinking for real-time display
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_THINKING_PARTIAL, {
    sessionId,
    thinking: accumulated,
  });
}

/**
 * Handle stream_event > content_block_stop — finalize accumulated thinking and text
 * @param {string} sessionId
 * @param {Object} _event
 */
function handleContentBlockStop(sessionId, _event) {
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

  // Clear text accumulator when content block finishes
  // The text has been finalized into a message
  textAccumulators.delete(sessionId);
}

/**
 * Handle 'result' events — errors and final usage
 * @param {string} sessionId
 * @param {Object} event
 */
function handleResultEvent(sessionId, event) {
  if (event.subtype === 'error') {
    handleResultError(sessionId, event);
  } else {
    handleResultSuccess(sessionId, event);
  }
  // Note: Don't clear lastMessageIds here - let the post-loop association code handle it.
  // Clearing here was causing work logs to never be associated because the 'result' event
  // arrives before the loop ends, deleting the messageId before association can happen.
}

/**
 * Handle result error subtype
 * @param {string} sessionId
 * @param {Object} event
 */
function handleResultError(sessionId, event) {
  sessions.update(sessionId, { status: 'error', error: event.error });
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: event.error });
  // Broadcast error status to project subscribers for session list updates
  broadcastSessionStatus(sessionId, 'error');
  // Extract PR URL before generating summary (PR may have been created before error)
  summaryService.extractPrUrlIfNeeded(sessionId);
  // Generate summary on error
  summaryService.onSessionComplete(sessionId);
}

/**
 * Handle result success subtype — store cost and usage
 * @param {string} sessionId
 * @param {Object} event
 */
function handleResultSuccess(sessionId, event) {
  // Store cost info and broadcast to project subscribers
  if (event.total_cost_usd !== undefined) {
    sessions.update(sessionId, { costUsd: event.total_cost_usd });
  }

  // Store final usage stats to conversation (Issue #175)
  if (event.usage || event.modelUsage) {
    handleResultUsage(sessionId, event);
  }
}


// ── Dispatch maps ───────────────────────────────────────────────────────────

/** @type {Record<string, (sessionId: string, event: Object) => void>} */
const streamSubHandlers = {
  message_start: handleMessageStartWrapper,
  message_delta: handleMessageDelta,
  content_block_delta: handleContentBlockDelta,
  content_block_stop: handleContentBlockStop,
};

/** @type {Record<string, (sessionId: string, event: Object) => void>} */
const eventHandlers = {
  system: handleSystemEvent,
  assistant: handleAssistantEvent,
  tool_result: handleToolResultEvent,
  stream_event: handleStreamEventType,
  result: handleResultEvent,
};

// ── Main stream event handler ──────────────────────────────────────────────

/**
 * Handle a stream event from Claude SDK
 * @param {string} sessionId
 * @param {Object} event
 */
export async function handleStreamEvent(sessionId, event) {
  // Check if session has been cleaned up (aborted/deleted) - don't process events for deleted sessions
  if (!activeSessions.has(sessionId)) {
    return;
  }

  const handler = eventHandlers[event.type];
  if (handler) {
    handler(sessionId, event);
  }
}

/**
 * Clean up all session state from the Maps
 * Called in the finally block of session execution
 * @param {string} sessionId
 * @param {boolean} includeConversationId - Whether to also clean up activeConversationIds
 */
export function cleanupSessionState(sessionId, includeConversationId = false) {
  textAccumulators.delete(sessionId);
  thinkingAccumulators.delete(sessionId);
  currentModels.delete(sessionId);
  loggedToolUseIds.delete(sessionId);
  activeSessions.delete(sessionId);
  if (includeConversationId) {
    activeConversationIds.delete(sessionId);
  }
}

// Re-export callback functions from streamEventCallbacks.js
export { handleTurnCompletion, handleSessionError } from './streamEventCallbacks.js';
