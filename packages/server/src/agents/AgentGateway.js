import { ClaudeCodeAdapter } from './adapters/ClaudeCodeAdapter.js';
import { CodexAdapter } from './adapters/CodexAdapter.js';
import { GeminiAdapter } from './adapters/GeminiAdapter.js';

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
    this.registerAdapter('codex', CodexAdapter);
    this.registerAdapter('gemini', GeminiAdapter);
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
   * Get capabilities for an agent type.
   *
   * Capabilities come from an adapter instance. Some transports (notably
   * Codex's direct API fallback) are selected from runtime configuration, so
   * static metadata can advertise capabilities the active transport lacks.
   *
   * @param {string} agentType
   * @returns {Object|null}
   */
  getAgentCapabilities(agentType) {
    const AdapterClass = this.adapters.get(agentType);
    if (!AdapterClass) return null;
    return new AdapterClass({}).getCapabilities();
  }

  /**
   * Get capabilities for every registered adapter.
   * @returns {Array<{ agentType: string, capabilities: Object }>}
   */
  getAllAgentCapabilities() {
    return this.getAvailableAgents().map((agentType) => ({
      agentType,
      capabilities: this.getAgentCapabilities(agentType),
    }));
  }
}

// Singleton instance
export const agentGateway = new AgentGateway();
