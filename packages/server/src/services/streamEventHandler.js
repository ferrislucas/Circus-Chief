import { sessions, messages, workLogs, conversations } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { updateTodos } from './todoStore.js';
import * as summaryService from './summaryService.js';
import * as diffService from './diffService.js';
import { updateTurnUsage, currentTurnUsage, estimatedOutputTokens, estimateTokens } from './usageTracker.js';

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
    const hasChanges = !!(changes.staged || changes.unstaged || changes.untracked);

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

  switch (event.type) {
    case 'system': {
      // Store Claude's session info
      if (event.subtype === 'init') {
        // [MODEL AUDIT] Log model reported by SDK in system.init
        console.log(`[MODEL AUDIT - SDK Event] system.init received:`, {
          sessionId,
          sdkSessionId: event.session_id,
          modelFromSDK: event.model,
        });

        // Save Claude session ID to the active conversation for context isolation
        const activeConversation = conversations.getActiveBySessionId(sessionId);
        if (activeConversation) {
          conversations.update(activeConversation.id, {
            claudeSessionId: event.session_id,
          });
          console.log(`[MODEL AUDIT - SDK Event] Updated conversation ${activeConversation.id} claudeSessionId to ${event.session_id}`);
        }
        // Track current model for this session (used when creating messages)
        currentModels.set(sessionId, event.model);
        console.log(`[MODEL AUDIT - SDK Event] Set currentModels[${sessionId}] = "${event.model}"`);
        // Capture available slash commands (do NOT update model here — session.model
        // tracks the user-requested short format; this SDK model is stored in currentModels)
        sessions.update(sessionId, {
          slashCommands: JSON.stringify(event.slash_commands || []),
        });
        // Reset message tracking for new session
        lastMessageIds.delete(sessionId);
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

      // NOTE: Do NOT use assistant event usage for broadcasting
      // The stream events already provide real-time usage updates via message_start and message_delta
      // Using assistant event would double-count the usage

      if (textContent) {
        const toolUse = toolUseBlocks.length > 0 ? toolUseBlocks : null;
        const activeConversation = conversations.getActiveBySessionId(sessionId);
        const conversationId = activeConversation?.id || null;
        const currentModel = currentModels.get(sessionId) || null;
        // [MODEL AUDIT] Log model being saved with message
        console.log(`[MODEL AUDIT - Message Save] Creating assistant message with model: "${currentModel}"`);
        const message = messages.create(sessionId, 'assistant', textContent, { toolUse, conversationId, model: currentModel });
        console.log(`[MODEL AUDIT - Message Save] Created message ${message.id} in conversation ${conversationId} with model: "${currentModel}"`);
        console.log(`[SESSION] assistant event: created assistant message ${message.id} in conversation ${conversationId} with model ${currentModel}`);

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
        console.log(`[SESSION] assistant event: broadcast assistant message ${message.id} to conversation ${conversationId}`);

        // Clear partial text on client now that complete message has been sent
        broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_PARTIAL, {
          sessionId,
          text: '',
        });

        // Note: Per-message onSessionActivity removed to reduce redundant summary generation.
        // Summary generation is triggered only on turn completion (waiting state) and session complete.
      }

      // Check for TodoWrite tool and update todos
      // NOTE: This must be OUTSIDE the if (textContent) block because Claude can call
      // TodoWrite without any accompanying text content (tool-only messages)
      if (toolUseBlocks.length > 0) {
        const todoWrite = toolUseBlocks.find((t) => t.name === 'TodoWrite');
        if (todoWrite?.input?.todos) {
          // Get active conversation to scope todos to it
          const activeConv = conversations.getActiveBySessionId(sessionId);
          if (activeConv) {
            updateTodos(sessionId, activeConv.id, todoWrite.input.todos);
          }
        }
      }

      // Note: Thinking content is logged via stream_event -> content_block_stop
      // to avoid duplicates (since includePartialMessages is always enabled)

      // Log tool use inputs (dedup by tool_use ID to prevent duplicates from partial assistant events)
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
      // Handle message_start for initial usage (input tokens) - enables real-time token updates
      if (event.event?.type === 'message_start') {
        // Clear text accumulator for fresh message
        textAccumulators.delete(sessionId);

        const usage = event.event?.message?.usage;
        if (usage) {
          const conversationId = activeConversationIds.get(sessionId);
          const turnUsage = updateTurnUsage(conversationId, usage, 'message_start');
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE, {
            sessionId,
            conversationId,
            usage: turnUsage,
            isFinal: false,
          });
        }
      }

      // Handle message_delta for streaming output tokens
      if (event.event?.type === 'message_delta') {
        const usage = event.event?.usage;
        if (usage) {
          const conversationId = activeConversationIds.get(sessionId);
          const turnUsage = updateTurnUsage(conversationId, usage, 'message_delta');
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE, {
            sessionId,
            conversationId,
            usage: turnUsage,
            isFinal: false,
          });
        }
      }

      // Real-time streaming - handle content_block_delta events
      if (event.event?.type === 'content_block_delta') {
        const delta = event.event.delta;

        if (delta?.type === 'text_delta' && delta.text) {
          // Accumulate text content
          const current = textAccumulators.get(sessionId) || '';
          const accumulated = current + delta.text;
          textAccumulators.set(sessionId, accumulated);

          broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_PARTIAL, {
            sessionId,
            text: accumulated,
          });

          // ISSUE 2: Estimate tokens from streamed content for real-time output token updates
          const conversationId = activeConversationIds.get(sessionId);
          if (conversationId) {
            const currentEstimate = estimatedOutputTokens.get(conversationId) || 0;
            const newEstimate = currentEstimate + estimateTokens(delta.text);
            estimatedOutputTokens.set(conversationId, newEstimate);

            // Get current turn usage and add estimated output
            const turnData = currentTurnUsage.get(conversationId) || {
              inputTokens: 0,
              outputTokens: 0,
              lastMessageOutput: 0,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
            };

            // Broadcast usage update with estimated tokens
            const broadcastUsage = {
              inputTokens: turnData.inputTokens,
              outputTokens: turnData.outputTokens + Math.max(turnData.lastMessageOutput, newEstimate),
              cacheReadInputTokens: turnData.cacheReadInputTokens,
              cacheCreationInputTokens: turnData.cacheCreationInputTokens,
            };

            broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE, {
              sessionId,
              conversationId,
              usage: broadcastUsage,
              isFinal: false,
              isEstimate: true,  // Flag so UI can show "~" prefix if desired
            });
          }
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

      // Handle content_block_stop - finalize accumulated thinking and text
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

        // Clear text accumulator when content block finishes
        // The text has been finalized into a message
        textAccumulators.delete(sessionId);
      }
      break;
    }

    case 'result': {
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
      break;
    }
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

/**
 * Handle post-turn completion logic (after stream loop ends successfully)
 * Encapsulates the duplicated completion block from runSession/continueSession/continueSessionWithExistingMessage
 * @param {string} sessionId
 * @param {string} workingDirectory
 * @param {Function} handleTemplateTriggerIfNeeded
 * @param {Function} _checkProactiveReschedule
 */
export async function handleTurnCompletion(sessionId, workingDirectory, handleTemplateTriggerIfNeeded, _checkProactiveReschedule, handleAutoSendIfNeeded) {
  // Associate work logs with the last message now that the turn is complete
  const lastMessageId = lastMessageIds.get(sessionId);
  if (lastMessageId) {
    associateAndBroadcastWorkLogs(sessionId, lastMessageId);
    lastMessageIds.delete(sessionId);
  }

  // Session ready for follow-up - set to waiting instead of completed
  const activeSession = activeSessions.get(sessionId);
  if (activeSession && !activeSession.controller?.signal?.aborted) {
    sessions.update(sessionId, { status: 'waiting' });
    broadcastSessionStatus(sessionId, 'waiting');

    // Check if session should be proactively rescheduled based on token threshold
    const wasRescheduled = await _checkProactiveReschedule(sessionId);
    if (wasRescheduled) {
      return true; // Session was rescheduled, don't continue with normal completion
    }

    // Extract PR URL immediately (lightweight, no API call)
    summaryService.extractPrUrlIfNeeded(sessionId);
    // Trigger debounced summary generation on turn completion (not complete yet)
    summaryService.onSessionActivity(sessionId);

    // Broadcast changes update when turn completes (real-time indicator)
    const currentSession = sessions.getById(sessionId);
    if (currentSession) {
      await broadcastChangesUpdate(sessionId, currentSession.projectId, workingDirectory);
    }

    // Auto-send queued prompt if enabled (runs BEFORE template trigger)
    let autoSendFired = false;
    if (handleAutoSendIfNeeded) {
      autoSendFired = await handleAutoSendIfNeeded(sessionId);
    }

    // Only trigger next template if auto-send did NOT fire
    // (if auto-send fired, template will trigger after that turn completes)
    if (!autoSendFired) {
      await handleTemplateTriggerIfNeeded(sessionId);
    }
  }
  return false;
}

/**
 * Handle session error with optional rescheduling
 * Encapsulates the duplicated error handling block from runSession/continueSession/continueSessionWithExistingMessage
 * @param {string} sessionId
 * @param {Error} error
 * @param {AbortController} controller
 * @param {Function} shouldRescheduleOnError
 * @param {Object} schedulerService
 * @param {Object} [options]
 * @param {boolean} [options.broadcastConversationState] - Whether to broadcast final conversation state before error status
 */
export async function handleSessionError(sessionId, error, controller, shouldRescheduleOnError, schedulerService, options = {}) {
  const errorLabel = options.errorLabel || 'Session error';
  console.error(`${errorLabel}:`, error);
  console.error('Error stack:', error.stack);
  if (!controller.signal.aborted) {
    // Check if we should reschedule instead of marking as error
    const session = sessions.getById(sessionId);
    if (session && shouldRescheduleOnError(session, error, sessionId)) {
      const rescheduled = await schedulerService.rescheduleSession(sessionId, error.message);
      if (rescheduled) {
        console.log(`[SessionManager] Session ${sessionId} rescheduled due to error`);
        return true; // Rescheduled, don't throw
      }
      // If rescheduling failed (limits reached), fall through to error handling
    }

    // Normal error handling (no reschedule or reschedule limits reached)
    sessions.update(sessionId, { status: 'error', error: error.message });
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: error.message });

    // Optionally broadcast final conversation state (continueSession does this)
    if (options.broadcastConversationState) {
      const errorConversationId = activeConversationIds.get(sessionId);
      if (errorConversationId) {
        const finalConversation = conversations.getById(errorConversationId);
        if (finalConversation) {
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.CONVERSATION_UPDATED, {
            sessionId,
            conversation: finalConversation,
          });
        }
      }
      // Broadcast error status to project and session subscribers (terminal signal)
      broadcastSessionStatus(sessionId, 'error');
    }

    // Trigger summary generation on error
    summaryService.onSessionComplete(sessionId);
  }
  return false; // Not rescheduled
}
