/**
 * Base agent interface. All adapters must implement `execute()` which returns
 * an async generator of SDK events.
 */
export class BaseAgent {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Execute a query and yield events as an async generator.
   * This mirrors the SDK's `query()` contract: callers consume with `for await...of`.
   *
   * @param {import('./types.js').AgentQueryParams} queryParams - { prompt, options? }
   * @returns {AsyncGenerator<Object>} - Yields raw SDK events
   */
  async *execute(_queryParams) { // eslint-disable-line require-yield
    throw new Error('execute() must be implemented by adapter');
  }

  /**
   * Check if agent supports session resumption via `options.resume`
   * @returns {boolean}
   */
  supportsResume() {
    return false;
  }

  /**
   * Whether the adapter needs conversation history explicitly prepended
   * to the prompt on continuation. Adapters that support resume (like
   * Claude Code) maintain their own server-side context and return false.
   * Adapters without resume capability return true — the execution layer
   * must inject history as text so the model has context.
   *
   * @returns {boolean}
   */
  needsConversationContext() {
    return !this.supportsResume();
  }

  /**
   * Get agent capabilities
   * @returns {{ streaming: boolean, thinking: boolean, toolUse: boolean, resume: boolean }}
   */
  getCapabilities() {
    return {
      streaming: false,
      thinking: false,
      toolUse: false,
      resume: false,
    };
  }
}
