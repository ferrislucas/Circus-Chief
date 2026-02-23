import { sessions, messages, conversations } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { updateTodos } from './todoStore.js';
import * as summaryService from './summaryService.js';
import { activeSessions, currentModels, lastMessageIds } from './sessionState.js';
import { createWorkLog, associateAndBroadcastWorkLogs } from './workLogHelpers.js';
import { handleStreamDeltaEvent } from './handleStreamDeltaEvent.js';
import { handleResultEvent } from './handleResultEvent.js';

// Re-export work log helpers for external consumers (e.g. sessionExecutor.js)
export { createWorkLog, associateAndBroadcastWorkLogs } from './workLogHelpers.js';

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
        const message = messages.create(sessionId, 'assistant', textContent, toolUse, conversationId, currentModel);
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

        // Trigger debounced summary generation on new message
        summaryService.onSessionActivity(sessionId);
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
      handleStreamDeltaEvent(sessionId, event);
      break;
    }

    case 'result': {
      handleResultEvent(sessionId, event);
      break;
    }
  }
}
