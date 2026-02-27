import { BaseAgent } from '../BaseAgent.js';

/**
 * Stub adapter for OpenAI Codex / future agents.
 * When implemented, this would:
 * 1. Transform AgentQueryParams into Codex API format
 * 2. Call the Codex API
 * 3. Yield events normalized to the SDK event format (system, assistant, tool_result, stream_event, result)
 *
 * Phase 7 note: A NormalizedEvent format should be introduced at this point,
 * along with refactoring handleStreamEvent to consume normalized events.
 */
export class CodexAdapter extends BaseAgent {
  async *execute(_queryParams) { // eslint-disable-line require-yield
    throw new Error('CodexAdapter is not yet implemented');
  }

  getCapabilities() {
    return {
      streaming: true,
      thinking: false, // Codex doesn't have explicit thinking
      toolUse: true,
      resume: false, // Codex may not support session resume
    };
  }
}
