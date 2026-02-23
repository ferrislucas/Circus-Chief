import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { thinkingAccumulators, textAccumulators, activeConversationIds, estimatedOutputTokens, currentTurnUsage } from './sessionState.js';
import { estimateTokens, updateTurnUsage } from './tokenUsageTracker.js';
import { createWorkLog } from './workLogHelpers.js';

/**
 * Handle 'stream_event' events from Claude SDK stream
 * Real-time streaming: text accumulation, thinking accumulation, token estimation
 * @param {string} sessionId
 * @param {Object} event
 */
export function handleStreamDeltaEvent(sessionId, event) {
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
}
