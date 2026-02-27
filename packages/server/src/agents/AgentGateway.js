import { ClaudeCodeAdapter } from './adapters/ClaudeCodeAdapter.js';

/**
 * Factory/registry for agent adapters.
 * Session Manager uses this to get the appropriate adapter for a session's agent type.
 */
export class AgentGateway {
  constructor() {
    /** @type {Map<string, typeof import('./BaseAgent.js').BaseAgent>} */
    this.adapters = new Map();
    this._registerDefaultAdapters();
  }

  _registerDefaultAdapters() {
    this.registerAdapter('claude-code', ClaudeCodeAdapter);
  }

  /**
   * Register an adapter class for a given agent type.
   * @param {string} agentType
   * @param {typeof import('./BaseAgent.js').BaseAgent} AdapterClass
   */
  registerAdapter(agentType, AdapterClass) {
    this.adapters.set(agentType, AdapterClass);
  }

  /**
   * Create an agent instance for the given type.
   * @param {string} agentType - e.g., 'claude-code'
   * @param {import('./types.js').AgentConfig} [config]
   * @returns {import('./BaseAgent.js').BaseAgent}
   */
  createAgent(agentType, config = {}) {
    const AdapterClass = this.adapters.get(agentType);
    if (!AdapterClass) {
      throw new Error(
        `Unknown agent type: "${agentType}". Available: ${this.getAvailableAgents().join(', ')}`
      );
    }
    return new AdapterClass({ ...config, agentType });
  }

  /**
   * @returns {string[]} List of registered agent type names
   */
  getAvailableAgents() {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get capabilities for an agent type (uses a static check, no instantiation).
   * @param {string} agentType
   * @returns {Object|null}
   */
  getAgentCapabilities(agentType) {
    const AdapterClass = this.adapters.get(agentType);
    if (!AdapterClass) return null;
    // Capabilities are static per adapter class
    return new AdapterClass({}).getCapabilities();
  }
}

// Singleton instance
export const agentGateway = new AgentGateway();
