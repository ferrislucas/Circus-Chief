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
 * @property {string|null} [effortLevel] - Reasoning effort override, or null/auto for provider default
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
 * @property {ProviderAcceptanceCallback} [onProviderAccepted] - Fired once when
 *   the adapter hands execution to the provider runner. See
 *   {@link ProviderAcceptanceDetail} for the per-adapter boundary contract.
 */

/**
 * Detail accompanying a provider-acceptance signal.
 *
 * Each adapter documents its earliest reliable acceptance boundary — the
 * moment execution is provably handed to the provider runner, not merely
 * constructed locally:
 *
 * - `claude-code` (in-process SDK): the first event yielded by the SDK query
 *   generator (a provider protocol message, e.g. system init). Merely calling
 *   `query()` constructs a lazy generator and proves nothing.
 * - `codex` / `gemini` / `muse` CLI paths: confirmed subprocess start (the
 *   spawn call returned a live child). A first content token is NOT the
 *   boundary — a healthy turn may stay silent for a long time.
 * - `codex` direct-API path: the streaming request was accepted (a stream
 *   object was returned without error).
 *
 * Adapter-synthesized init events emitted before the boundary above (e.g. a
 * locally generated `system/init`) are NOT acceptance evidence.
 *
 * @typedef {Object} ProviderAcceptanceDetail
 * @property {string} adapterType - Adapter that observed acceptance
 * @property {string} boundary - Boundary kind: 'provider_protocol_ack' | 'subprocess_start' | 'stream_accepted' | 'cassette_replay' (VCR test replay only)
 * @property {string} [sessionId] - Executing session id, when known
 * @property {number} [pid] - Provider subprocess pid, for subprocess boundaries
 */

/**
 * @callback ProviderAcceptanceCallback
 * @param {ProviderAcceptanceDetail} detail
 * @returns {void}
 */

export {};
