import { ClaudeCodeAdapter } from './adapters/ClaudeCodeAdapter.js';
import { CodexAdapter } from './adapters/CodexAdapter.js';

/**
 * Factory/registry for agent adapters.
 * Session Manager uses this to get the appropriate adapter for a session's agent type.
 */
export class AgentGateway {
  constructor() {
    /** @type {Map<string, typeof import('./BaseAgent.js').BaseAgent>} */
    this.adapters = new Map();
    /** @type {Map<string, Object>} */
    this._capabilitiesCache = new Map();
    this._registerDefaultAdapters();
  }

  _registerDefaultAdapters() {
    this.registerAdapter('claude-code', ClaudeCodeAdapter);
    this.registerAdapter('codex', CodexAdapter);
  }

  /**
   * Register an adapter class for a given agent type.
   * @param {string} agentType
   * @param {typeof import('./BaseAgent.js').BaseAgent} AdapterClass
   */
  registerAdapter(agentType, AdapterClass) {
    this.adapters.set(agentType, AdapterClass);
    // Invalidate any cached capabilities for this type.
    this._capabilitiesCache.delete(agentType);
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
   * Prefers the adapter's static `capabilities` field (no instantiation),
   * falling back to constructing an empty instance and calling
   * `getCapabilities()` for backward compatibility with adapters that
   * haven't migrated yet.
   *
   * @param {string} agentType
   * @returns {Object|null}
   */
  getAgentCapabilities(agentType) {
    const cached = this._capabilitiesCache.get(agentType);
    if (cached) return cached;

    const AdapterClass = this.adapters.get(agentType);
    if (!AdapterClass) return null;

    let caps;
    if (AdapterClass.capabilities) {
      caps = { ...AdapterClass.capabilities };
    } else {
      caps = new AdapterClass({}).getCapabilities();
    }
    this._capabilitiesCache.set(agentType, caps);
    return caps;
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
