/** @type {Map<string, {inputTokens: number, outputTokens: number, lastMessageOutput: number, cacheReadInputTokens: number, cacheCreationInputTokens: number}>}
 * Current turn usage - accumulates across multiple messages within a turn
 * Keyed by conversationId (Issue #175)
 * - inputTokens: MAX seen across all messages (larger context with tool results)
 * - outputTokens: ACCUMULATED across all messages
 * - lastMessageOutput: Current message's output (to detect resets on message_start)
 */
const currentTurnUsage = new Map();

/** @type {Map<string, number>} Estimated output tokens from streamed content (for real-time updates) */
const estimatedOutputTokens = new Map();

/**
 * Rough token estimation: ~4 characters per token (standard for English text)
 * @param {string} text
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Update current turn usage from stream events
 * Accumulates across multiple messages within a single turn
 * @param {string} conversationId
 * @param {Object} usage - Usage from stream event (snake_case)
 * @param {string} eventType - 'message_start' or 'message_delta'
 * @returns {Object} Total turn usage (accumulated + current message)
 */
function updateTurnUsage(conversationId, usage, eventType) {
  const current = currentTurnUsage.get(conversationId) || {
    inputTokens: 0,
    outputTokens: 0,
    lastMessageOutput: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };

  if (eventType === 'message_start') {
    // NEW MESSAGE STARTING
    // 1. Finalize previous message's output
    current.outputTokens += current.lastMessageOutput;
    // 2. Reset tracker for new message
    current.lastMessageOutput = 0;
    // 3. Reset estimated output when actual message starts
    estimatedOutputTokens.delete(conversationId);
    // 4. For input tokens, keep the MAX (larger context with tool results)
    current.inputTokens = Math.max(current.inputTokens, usage.input_tokens || 0);
    current.cacheReadInputTokens = Math.max(current.cacheReadInputTokens, usage.cache_read_input_tokens || 0);
    current.cacheCreationInputTokens = Math.max(current.cacheCreationInputTokens, usage.cache_creation_input_tokens || 0);
  } else if (eventType === 'message_delta') {
    // OUTPUT STREAMING - output_tokens is cumulative within this message
    current.lastMessageOutput = usage.output_tokens || 0;
    // Clear estimate when actual output tokens arrive
    estimatedOutputTokens.delete(conversationId);
  }

  currentTurnUsage.set(conversationId, current);

  // Return the TOTAL (accumulated + current message's output)
  return {
    inputTokens: current.inputTokens,
    outputTokens: current.outputTokens + current.lastMessageOutput,
    cacheReadInputTokens: current.cacheReadInputTokens,
    cacheCreationInputTokens: current.cacheCreationInputTokens,
  };
}

export { estimateTokens, updateTurnUsage, currentTurnUsage, estimatedOutputTokens };
