import { agentCallLogger } from '../services/agentCallLogger.js';

/**
 * Extract usage data from a result event
 * @param {Object} event - The result event
 * @returns {Object|null} Usage data or null
 */
function extractUsageFromEvent(event) {
  const modelUsageEntry = event.modelUsage
    ? Object.values(event.modelUsage)[0]
    : null;

  if (!modelUsageEntry && !event.usage) {
    return null;
  }

  return {
    inputTokens: modelUsageEntry?.inputTokens || event.usage?.input_tokens || 0,
    outputTokens: modelUsageEntry?.outputTokens || event.usage?.output_tokens || 0,
    thinkingTokens: 0,
    cacheReadInputTokens: modelUsageEntry?.cacheReadInputTokens || event.usage?.cache_read_input_tokens || 0,
    cacheCreationInputTokens: modelUsageEntry?.cacheCreationInputTokens || event.usage?.cache_creation_input_tokens || 0,
  };
}

/**
 * Decorator that wraps a BaseAgent's execute() to log call start/end/errors.
 * The wrapper is transparent to the consumer -- it yields the same events.
 */
export class LoggingAgentWrapper {
  /**
   * @param {import('./BaseAgent.js').BaseAgent} agent - The agent to wrap
   */
  constructor(agent) {
    this.agent = agent;
  }

  /**
   * Wraps agent.execute() with logging.
   * @param {import('./types.js').AgentQueryParams} queryParams
   * @param {import('./types.js').AgentCallMeta} meta - Logging metadata (sessionId, callType, etc.)
   * @returns {AsyncGenerator<Object>} Same events as the inner agent
   */
  async *execute(queryParams, meta) {
    const callId = agentCallLogger.startCall(meta);

    try {
      for await (const event of this.agent.execute(queryParams, meta)) {
        // Capture final usage from 'result' events
        const usage = (event.type === 'result' && event.subtype !== 'error')
          ? extractUsageFromEvent(event)
          : null;
        if (usage) agentCallLogger.updateUsage(callId, usage);

        yield event;
      }

      agentCallLogger.completeCall(callId, { success: true });
    } catch (error) {
      agentCallLogger.completeCall(callId, { success: false, error });
      throw error;
    }
  }

  // Proxy capability methods
  supportsResume() {
    return this.agent.supportsResume();
  }

  getCapabilities() {
    return this.agent.getCapabilities();
  }
}
