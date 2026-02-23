/** @type {Map<string, string|null>} Track last message ID for end-of-turn work log association */
export const lastMessageIds = new Map();

/** @type {Map<string, string>} Accumulate thinking content per session */
export const thinkingAccumulators = new Map();

/** @type {Map<string, string>} Accumulate text content per session */
export const textAccumulators = new Map();

/** @type {Map<string, { controller: AbortController }>} */
export const activeSessions = new Map();

/** @type {Map<string, {inputTokens: number, outputTokens: number, lastMessageOutput: number, cacheReadInputTokens: number, cacheCreationInputTokens: number}>}
 * Current turn usage - accumulates across multiple messages within a turn
 * Keyed by conversationId (Issue #175)
 * - inputTokens: MAX seen across all messages (larger context with tool results)
 * - outputTokens: ACCUMULATED across all messages
 * - lastMessageOutput: Current message's output (to detect resets on message_start)
 */
export const currentTurnUsage = new Map();

/** @type {Map<string, string>} Map sessionId -> conversationId for current turn */
export const activeConversationIds = new Map();

/** @type {Map<string, string>} Track current model per session (updated on system.init) */
export const currentModels = new Map();

/** @type {Map<string, number>} Estimated output tokens from streamed content (for real-time updates) */
export const estimatedOutputTokens = new Map();

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
