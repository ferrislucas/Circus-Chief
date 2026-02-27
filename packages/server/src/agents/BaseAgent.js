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
