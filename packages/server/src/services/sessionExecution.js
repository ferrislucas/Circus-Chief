import { sessions, messages, attachments, conversations } from '../database.js';
import { createClaudeCodeSpawner } from './nodeSpawnHelper.js';
import { resolveProviderFromModel, buildSessionEnv } from './sessionProvider.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { LoggingAgentWrapper } from '../agents/LoggingAgentWrapper.js';
import { VCRAgentAdapter } from '../agents/vcr/VCRAgentAdapter.js';
import {
  buildSystemPromptConfig,
  getPermissionModeForSession,
  buildPromptWithAttachments,
} from './sessionPrompts.js';
import {
  activeSessions,
  activeConversationIds,
  handleStreamEvent,
  handleTurnCompletion,
  handleSessionError,
  cleanupSessionState,
  broadcastSessionStatus,
} from './streamEventHandler.js';
import { shouldRescheduleOnError, _checkProactiveReschedule } from './sessionErrors.js';
import { schedulerService } from './schedulerService.js';

/**
 * Create the agent for a session, using gateway + logging + VCR.
 *
 * @param {string} agentType - The agent type (e.g., 'claude-code')
 * @returns {{ execute: (queryParams: any, meta?: any) => AsyncGenerator }}
 */
export function createAgentForSession(agentType = 'claude-code') {
  const baseAgent = agentGateway.createAgent(agentType);

  // Wrap with VCR adapter if in VCR mode
  const agent = process.env.VCR_MODE
    ? new VCRAgentAdapter(baseAgent, { cassetteDir: 'tests/e2e/cassettes' })
    : baseAgent;

  // Always wrap with logging
  return new LoggingAgentWrapper(agent);
}

/**
 * Build query parameters for executing a session via the Claude agent.
 * Shared by runSession, continueSession, and continueSessionWithExistingMessage.
 * @param {Object} options
 * @param {string} options.prompt - The prompt text to send
 * @param {string} options.workingDirectory - Session working directory
 * @param {AbortController} options.controller - Abort controller for the session
 * @param {Object} options.session - Session object from DB
 * @param {string} options.sessionId - Session ID
 * @param {string|null} options.systemPrompt - Custom system prompt from project settings
 * @param {string|null} options.model - Model to use
 * @param {Object} options.sessionEnv - Environment variables for the session
 * @param {string|null} [options.resumeSessionId] - Claude session ID to resume (null for new session)
 * @returns {Object} Query parameters for agent.execute()
 */
export function buildQueryParams({ prompt, workingDirectory, controller, session, sessionId, systemPrompt, model, sessionEnv, resumeSessionId = null }) {
  // Determine model (force Haiku in VCR mode to minimize cost)
  const isVCR = Boolean(process.env.VCR_MODE);
  const effectiveModel = isVCR ? 'claude-haiku-4-5-20251001' : model;

  return {
    prompt,
    options: {
      cwd: workingDirectory,
      abortController: controller,
      includePartialMessages: true,
      permissionMode: getPermissionModeForSession(session.mode),
      settingSources: ['project'],
      ...(resumeSessionId && { resume: resumeSessionId }),
      env: sessionEnv,
      spawnClaudeCodeProcess: createClaudeCodeSpawner(),
      model: effectiveModel,
      systemPrompt: buildSystemPromptConfig(sessionId, session.projectId, systemPrompt, session.mode),
    },
  };
}

/**
 * Execute the agent stream loop and handle post-turn completion, errors, and cleanup.
 * This is the shared core of runSession, continueSession, and continueSessionWithExistingMessage.
 * @param {Object} options
 * @param {string} options.sessionId - Session ID
 * @param {Object} options.agent - Agent instance with execute() method
 * @param {Object} options.queryParams - Query parameters for agent.execute()
 * @param {Object} options.agentCallMeta - Logging metadata for agent call tracking
 * @param {AbortController} options.controller - Abort controller
 * @param {string} options.workingDirectory - Session working directory
 * @param {Object} options.callbacks - Callback functions passed from sessionManager
 * @param {Function} options.callbacks.handleTemplateTriggerIfNeeded - Template trigger handler
 * @param {Function} options.callbacks.handleAutoSendIfNeeded - Auto-send handler
 * @param {boolean} [options.broadcastConversationStateOnError] - Whether to broadcast conversation state on error
 * @param {boolean} [options.cleanupConversationId] - Whether to clean up activeConversationIds in finally
 * @param {string} [options.errorLabel] - Label for error logging
 */
export async function _executeSession({
  sessionId,
  agent,
  queryParams,
  agentCallMeta,
  controller,
  workingDirectory,
  callbacks,
  broadcastConversationStateOnError = false,
  cleanupConversationId = false,
  errorLabel = 'Session error',
}) {
  const { handleTemplateTriggerIfNeeded, handleAutoSendIfNeeded } = callbacks;

  try {
    // Run the query with the agent (SDK via gateway, or mock)
    for await (const event of agent.execute(queryParams, agentCallMeta)) {
      if (controller.signal.aborted) break;

      await handleStreamEvent(sessionId, event);
    }

    // Handle post-turn completion (work log association, status transition, summary, etc.)
    const wasRescheduled = await handleTurnCompletion(
      sessionId,
      workingDirectory,
      { handleTemplateTriggerIfNeeded, checkProactiveReschedule: _checkProactiveReschedule, handleAutoSendIfNeeded }
    );
    if (wasRescheduled) {
      return;
    }
  } catch (error) {
    const rescheduled = await handleSessionError(sessionId, error, {
      controller,
      shouldRescheduleOnError,
      schedulerService,
      broadcastConversationState: broadcastConversationStateOnError,
      errorLabel,
      handleTemplateTriggerIfNeeded,
    });
    if (rescheduled) {
      return; // Don't throw - session was rescheduled
    }
    throw error;
  } finally {
    cleanupSessionState(sessionId, cleanupConversationId);
  }
}

/**
 * Continue a session with a follow-up message (core implementation)
 * @param {string} sessionId
 * @param {string} content
 * @param {string} workingDirectory
 * @param {Object} config - Session options and callbacks
 * @param {Object} [config.options] - Session options (systemPrompt, fileAttachments, model)
 * @param {Object} config.callbacks - Callback functions from sessionManager
 */
export async function continueSessionCore(sessionId, content, workingDirectory, config = {}) {
  const { options = {}, callbacks } = config;
  const { systemPrompt = null, fileAttachments = [], model = null } = options;
  // Check if session is already running
  if (activeSessions.has(sessionId)) {
    throw new Error('Session is already processing');
  }

  // Get the session to retrieve the Claude session ID and settings
  let session = sessions.getById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  const controller = new AbortController();
  activeSessions.set(sessionId, { controller });

  // Ensure there's an active conversation for this session
  const activeConversation = conversations.ensureActiveConversation(sessionId);
  activeConversationIds.set(sessionId, activeConversation.id);
  console.log(`[SESSION] continueSession: ensured active conversation ${activeConversation.id} for session ${sessionId}`);

  // Each conversation has its own Claude session context
  // If null, Claude will start a fresh session (no resume)

  // Store the user message with conversation ID
  const { broadcastToSession } = await import('../websocket.js');
  const { WS_MESSAGE_TYPES } = await import('@claudetools/shared');
  const message = messages.create(sessionId, 'user', content, { toolUse: null, conversationId: activeConversation.id });
  console.log(`[SESSION] continueSession: created user message ${message.id} in conversation ${activeConversation.id}`);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, {
    message,
    conversationId: activeConversation.id, // Include conversation context
  });
  console.log(`[SESSION] continueSession: broadcast user message ${message.id} to conversation ${activeConversation.id}`);

  // Associate any pending attachments with the message
  if (fileAttachments.length > 0) {
    attachments.updateMessageIdForSession(sessionId, message.id);
  }

  // Build prompt with attachment context
  const promptWithAttachments = buildPromptWithAttachments(content, fileAttachments);

  // Update status to running
  sessions.update(sessionId, { status: 'running' });
  broadcastSessionStatus(sessionId, 'running');

  // Create agent via gateway (or mock agent in mock mode)
  const agentType = session.agentType || 'claude-code';
  const agent = createAgentForSession(agentType);

  // Derive provider from the model ID (returns null for Anthropic/SDK defaults)
  // Fall back to session.model so that resuming without an explicit model still
  // resolves the correct provider (e.g. third-party base URL and auth tokens).
  const provider = resolveProviderFromModel(model || session.model);
  const sessionEnv = buildSessionEnv(provider, session.thinkingEnabled, session.effortLevel);

  // Check if model changed from the session's last requested model
  // When model changes, we can't resume the previous session - thinking blocks and
  // session context may be incompatible between different models/providers
  const modelChanged = model && session.model && model !== session.model;

  // Update session.model to track the user-requested model (short format)
  // This must happen AFTER modelChanged detection so we compare old vs new
  if (model) {
    sessions.update(sessionId, { model });
    session = sessions.getById(sessionId); // refresh
  }

  // Only resume if we have a session ID AND model hasn't changed
  const canResume = activeConversation.claudeSessionId && !modelChanged;

  // When model changes, include conversation history as context so the new model
  // can continue naturally without needing to resume the incompatible session
  const { buildConversationContextForModelSwitch } = await import('./conversationContext.js');
  const conversationContext = modelChanged
    ? buildConversationContextForModelSwitch(activeConversation.id)
    : '';
  const promptWithContext = conversationContext + promptWithAttachments;

  const queryParams = buildQueryParams({
    prompt: promptWithContext,
    workingDirectory,
    controller,
    session,
    sessionId,
    systemPrompt,
    model: model || session.model,
    sessionEnv,
    resumeSessionId: canResume ? activeConversation.claudeSessionId : null,
  });

  // Logging metadata for agent call tracking
  const agentCallMeta = {
    sessionId,
    conversationId: activeConversation.id,
    callType: 'continueSession',
    agentType,
    model,
    effortLevel: session.effortLevel,
    isResume: canResume,
    promptLength: promptWithContext.length,
  };

  await _executeSession({
    sessionId,
    agent,
    queryParams,
    agentCallMeta,
    controller,
    workingDirectory,
    callbacks,
    broadcastConversationStateOnError: true,
    cleanupConversationId: true,
    errorLabel: 'Continue session error',
  });
}

/**
 * Run a Claude session (initial session start)
 * @param {string} sessionId
 * @param {string} prompt
 * @param {string} workingDirectory
 * @param {Object} config - Session options and callbacks
 * @param {Object} [config.options] - Session options (systemPrompt, fileAttachments, model)
 * @param {Object} config.callbacks - Callback functions from sessionManager
 */
export async function runSessionCore(sessionId, prompt, workingDirectory, config = {}) {
  const { options = {}, callbacks } = config;
  const { systemPrompt = null, fileAttachments = [], model = null } = options;
  const controller = new AbortController();
  activeSessions.set(sessionId, { controller });

  // Get session for settings
  let session = sessions.getById(sessionId);

  // Get the active conversation for this session (created in SessionRepository.create)
  const activeConversation = conversations.ensureActiveConversation(sessionId);
  activeConversationIds.set(sessionId, activeConversation.id);
  console.log(`[SESSION] runSession: ensured active conversation ${activeConversation.id} for session ${sessionId}`);

  // Update status to running and track the user-requested model (short format) on the session
  sessions.update(sessionId, { status: 'running', ...(model && { model }) });
  session = sessions.getById(sessionId);
  broadcastSessionStatus(sessionId, 'running');

  // Note: Initial user message is already created in SessionRepository.create()
  // Associate any pending attachments with the initial message
  const initialMessage = messages.getBySessionId(sessionId)[0];
  if (initialMessage && fileAttachments.length > 0) {
    attachments.updateMessageIdForSession(sessionId, initialMessage.id);
  }

  // Build prompt with attachment context
  const promptWithAttachments = buildPromptWithAttachments(prompt, fileAttachments);

  // Create agent via gateway (or mock agent in mock mode)
  const agentType = session.agentType || 'claude-code';
  const agent = createAgentForSession(agentType);

  // Derive provider from the model ID (returns null for Anthropic/SDK defaults)
  // Fall back to session.model as defense-in-depth (draftSessionService already
  // resolves the model upstream, but this ensures correctness if called directly).
  const provider = resolveProviderFromModel(model || session.model);
  const sessionEnv = buildSessionEnv(provider, session.thinkingEnabled, session.effortLevel);

  const queryParams = buildQueryParams({
    prompt: promptWithAttachments,
    workingDirectory,
    controller,
    session,
    sessionId,
    systemPrompt,
    model: model || session.model,
    sessionEnv,
  });

  // Log query params for debugging third-party provider issues
  console.log(`[SessionManager] runSession query params:`, {
    model: queryParams.options?.model || '[not set - using SDK default]',
    hasEnv: Boolean(queryParams.options?.env),
    envBaseUrl: queryParams.options?.env?.ANTHROPIC_BASE_URL || '[not set]',
    envApiKey: queryParams.options?.env?.ANTHROPIC_API_KEY ? '[SET]' : '[not set]',
    envAuthToken: queryParams.options?.env?.ANTHROPIC_AUTH_TOKEN ? '[SET]' : '[not set]',
  });

  // Logging metadata for agent call tracking
  const agentCallMeta = {
    sessionId,
    conversationId: activeConversation.id,
    callType: 'runSession',
    agentType,
    model,
    effortLevel: session.effortLevel,
    promptLength: promptWithAttachments.length,
  };

  await _executeSession({
    sessionId,
    agent,
    queryParams,
    agentCallMeta,
    controller,
    workingDirectory,
    callbacks,
    errorLabel: 'Session error',
  });
}
