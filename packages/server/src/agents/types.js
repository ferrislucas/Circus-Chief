/**
 * Agent abstraction layer type definitions.
 *
 * @typedef {Object} AgentConfig
 * @property {string} agentType - 'claude-code' | 'codex' | etc.
 * @property {string} [model] - Model identifier
 * @property {Object} [providerConfig] - Provider-specific configuration
 */

/**
 * @typedef {Object} AgentQueryParams
 * @property {string} prompt - The prompt text (may include attachments/context)
 * @property {AgentQueryOptions} [options] - SDK options (omitted in mock mode)
 */

/**
 * @typedef {Object} AgentQueryOptions
 * @property {string} cwd - Working directory
 * @property {AbortController} abortController - Abort controller
 * @property {boolean} includePartialMessages - Whether to include partial messages
 * @property {string} permissionMode - 'default' | 'bypassPermissions'
 * @property {string[]} settingSources - e.g., ['project']
 * @property {string} [resume] - Claude session ID for resumption
 * @property {Object} env - Environment variables
 * @property {Function} spawnClaudeCodeProcess - Process spawner function
 * @property {string} [model] - Model to use
 * @property {string} systemPrompt - System prompt string
 */

/**
 * Agent call metadata for logging purposes
 * @typedef {Object} AgentCallMeta
 * @property {string} sessionId
 * @property {string} [conversationId]
 * @property {string} callType - 'runSession' | 'continueSession' | 'continueSessionWithExistingMessage'
 * @property {string} [agentType]
 * @property {string} [model]
 * @property {string} [effortLevel] - Effort level for the call
 * @property {boolean} [isResume] - Whether this call uses SDK session resume
 * @property {number} promptLength - Character length of prompt
 */

export {};
