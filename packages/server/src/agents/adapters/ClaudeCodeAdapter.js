import { query } from '@anthropic-ai/claude-agent-sdk';
import { BaseAgent } from '../BaseAgent.js';

/**
 * Adapter for Claude Code SDK. Wraps the SDK's `query()` function
 * which returns an async generator of events.
 *
 * The adapter does NOT transform events -- it passes through raw SDK events.
 * Event handling remains in sessionManager's handleStreamEvent().
 */
export class ClaudeCodeAdapter extends BaseAgent {
  /**
   * Execute a query against the Claude Code SDK.
   * @param {import('../types.js').AgentQueryParams} queryParams - { prompt, options? }
   * @yields {Object} Raw SDK events (system, assistant, tool_result, stream_event, result)
   */
  async *execute(queryParams) {
    yield* query(queryParams);
  }

  supportsResume() {
    return true;
  }

  getCapabilities() {
    return {
      streaming: true,
      thinking: true,
      toolUse: true,
      resume: true,
    };
  }
}
