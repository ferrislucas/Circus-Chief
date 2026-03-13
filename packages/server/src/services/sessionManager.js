import { sessions, messages, attachments, conversations } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import * as summaryService from './summaryService.js';
import { checkAndTriggerNextTemplate } from './templateTriggerService.js';
import { createClaudeCodeSpawner } from './nodeSpawnHelper.js';
import { schedulerService } from './schedulerService.js';
import { resolveProviderFromModel, buildSessionEnv } from './sessionProvider.js';
import {
  shouldRescheduleOnError,
  _checkProactiveReschedule,
  matchesTokenLimitError,
  matchesServiceError,
} from './sessionErrors.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { LoggingAgentWrapper } from '../agents/LoggingAgentWrapper.js';
import { VCRAgentAdapter } from '../agents/vcr/VCRAgentAdapter.js';
import {
  buildSystemPromptConfig,
  PLAN_MODE_PROMPT,
  getPermissionModeForSession,
  getSessionAttachmentsContext,
  buildPromptWithAttachments,
  getApiBaseUrl,
} from './sessionPrompts.js';
import { buildConversationContextForModelSwitch, buildConversationContextForBranch } from './conversationContext.js';
import {
  activeSessions,
  activeConversationIds,
  handleStreamEvent,
  handleTurnCompletion,
  handleSessionError,
  cleanupSessionState,
  broadcastSessionStatus,
} from './streamEventHandler.js';

// Re-export prompt-related functions for backward compatibility
export { buildSystemPromptConfig, PLAN_MODE_PROMPT, getPermissionModeForSession, getSessionAttachmentsContext, buildPromptWithAttachments, getApiBaseUrl };

// Re-export error detection and rescheduling functions for backward compatibility
export { shouldRescheduleOnError, _checkProactiveReschedule, matchesTokenLimitError, matchesServiceError };

/**
 * Create the agent for a session, using gateway + logging + VCR.
 *
 * @param {string} agentType - The agent type (e.g., 'claude-code')
 * @returns {{ execute: (queryParams: any, meta?: any) => AsyncGenerator }
 */
function createAgentForSession(agentType = 'claude-code') {
  const baseAgent = agentGateway.createAgent(agentType);

  // Wrap with VCR adapter if in VCR mode
  const agent = process.env.VCR_MODE
    ? new VCRAgentAdapter(baseAgent, { cassetteDir: 'tests/e2e/cassettes' })
    : baseAgent;

  // Always wrap with logging
  return new LoggingAgentWrapper(agent);
}

/**
 * Handle template triggering if a session has a nextTemplateId configured
 * Called after Claude finishes any turn (runSession or continueSession)
 * @param {string} sessionId
 */
async function handleTemplateTriggerIfNeeded(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session || !session.nextTemplateId) {
    return;
  }

  // Wait for summary to be generated (templates use summary data)
  await summaryService.generateSummaryNow(sessionId);

  // Trigger the template to create a new session
  await checkAndTriggerNextTemplate(sessionId);

  // Clear the template from the session (it's been triggered)
  sessions.update(sessionId, { nextTemplateId: null });

  // Broadcast the update so UI reflects the cleared template
  broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: session.projectId,
    sessionId: sessionId,
    session: { ...session, nextTemplateId: null }
  });
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
function buildQueryParams({ prompt, workingDirectory, controller, session, sessionId, systemPrompt, model, sessionEnv, resumeSessionId = null }) {
  // Determine model (force Haiku in VCR mode to minimize cost)
  const isVCR = !!process.env.VCR_MODE;
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
 * @param {boolean} [options.broadcastConversationStateOnError] - Whether to broadcast conversation state on error
 * @param {boolean} [options.cleanupConversationId] - Whether to clean up activeConversationIds in finally
 * @param {string} [options.errorLabel] - Label for error logging
 */
async function _executeSession({
  sessionId,
  agent,
  queryParams,
  agentCallMeta,
  controller,
  workingDirectory,
  broadcastConversationStateOnError = false,
  cleanupConversationId = false,
  errorLabel = 'Session error',
}) {
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
      handleTemplateTriggerIfNeeded,
      _checkProactiveReschedule
    );
    if (wasRescheduled) {
      return;
    }
  } catch (error) {
    const rescheduled = await handleSessionError(sessionId, error, controller, shouldRescheduleOnError, schedulerService, {
      broadcastConversationState: broadcastConversationStateOnError,
      errorLabel,
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
 * Run a Claude session
 * @param {string} sessionId
 * @param {string} prompt
 * @param {string} workingDirectory
 * @param {string|null} systemPrompt - Custom system prompt from project settings
 * @param {Array} fileAttachments - File attachments for context
 * @param {string|null} model - Claude model to use
 */
export async function runSession(sessionId, prompt, workingDirectory, systemPrompt = null, fileAttachments = [], model = null) {
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
  const provider = resolveProviderFromModel(model);
  const sessionEnv = buildSessionEnv(provider, session.thinkingEnabled);

  const queryParams = buildQueryParams({
    prompt: promptWithAttachments,
    workingDirectory,
    controller,
    session,
    sessionId,
    systemPrompt,
    model,
    sessionEnv,
  });

  // Log query params for debugging third-party provider issues
  console.log(`[SessionManager] runSession query params:`, {
    model: queryParams.options?.model || '[not set - using SDK default]',
    hasEnv: !!queryParams.options?.env,
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
    promptLength: promptWithAttachments.length,
  };

  await _executeSession({
    sessionId,
    agent,
    queryParams,
    agentCallMeta,
    controller,
    workingDirectory,
    errorLabel: 'Session error',
  });
}

/**
 * Continue a session with a follow-up message
 * @param {string} sessionId
 * @param {string} content
 * @param {string} workingDirectory
 * @param {string|null} systemPrompt - Custom system prompt from project settings
 * @param {Array} fileAttachments - File attachments for context
 * @param {string|null} model - Model to use for this message
 */
export async function continueSession(sessionId, content, workingDirectory, systemPrompt = null, fileAttachments = [], model = null) {
  // [MODEL AUDIT] Log model received in continueSession
  console.log(`[MODEL AUDIT - SessionManager] continueSession called with model: "${model}"`);

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
  const message = messages.create(sessionId, 'user', content, null, activeConversation.id);
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
  const provider = resolveProviderFromModel(model);
  const sessionEnv = buildSessionEnv(provider, session.thinkingEnabled);

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

  // [MODEL AUDIT] Log model change detection
  console.log(`[MODEL AUDIT - SessionManager] Model change check:`, {
    requestedModel: model,
    sessionModel: session.model,
    modelChanged,
    conversationClaudeSessionId: activeConversation.claudeSessionId,
  });

  if (modelChanged) {
    console.log(`[SESSION] Model changed to "${model}" - including conversation context`);
  }

  // Only resume if we have a session ID AND model hasn't changed
  const canResume = activeConversation.claudeSessionId && !modelChanged;

  // [MODEL AUDIT] Log resume decision
  console.log(`[MODEL AUDIT - SessionManager] Resume decision: canResume=${canResume}`);

  // When model changes, include conversation history as context so the new model
  // can continue naturally without needing to resume the incompatible session
  const conversationContext = modelChanged
    ? buildConversationContextForModelSwitch(activeConversation.id)
    : '';
  const promptWithContext = conversationContext + promptWithAttachments;

  // [MODEL AUDIT] Log SDK query options
  console.log(`[MODEL AUDIT - SessionManager] SDK query options:`, {
    model: model,
    resume: canResume ? activeConversation.claudeSessionId : null,
    hasConversationContext: conversationContext.length > 0,
  });

  const queryParams = buildQueryParams({
    prompt: promptWithContext,
    workingDirectory,
    controller,
    session,
    sessionId,
    systemPrompt,
    model,
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
    broadcastConversationStateOnError: true,
    cleanupConversationId: true,
    errorLabel: 'Continue session error',
  });
}

/**
 * Continue a session when the user message is already stored (e.g., from branching)
 * This triggers Claude's response without creating a new user message
 * @param {string} sessionId
 * @param {string} conversationId - The conversation to continue (must have an existing user message)
 * @param {string} workingDirectory
 * @param {string|null} systemPrompt - Custom system prompt from project settings
 * @param {string|null} model - Model to use for this message
 */
export async function continueSessionWithExistingMessage(sessionId, conversationId, workingDirectory, systemPrompt = null, model = null) {
  // Check if session is already running
  if (activeSessions.has(sessionId)) {
    throw new Error('Session is already processing');
  }

  // Get the session to retrieve settings
  let session = sessions.getById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  // Get the conversation
  const conversation = conversations.getById(conversationId);
  if (!conversation || conversation.sessionId !== sessionId) {
    throw new Error('Conversation not found');
  }

  // Get the last user message from the conversation to use as the prompt
  const conversationMessages = messages.getByConversationId(conversationId);
  const lastUserMessage = [...conversationMessages].reverse().find(m => m.role === 'user');
  if (!lastUserMessage) {
    throw new Error('No user message found in conversation');
  }

  const controller = new AbortController();
  activeSessions.set(sessionId, { controller });

  // Make sure this conversation is active
  if (!conversation.isActive) {
    conversations.update(conversationId, { isActive: true });
  }
  activeConversationIds.set(sessionId, conversationId);

  // Update status to running
  sessions.update(sessionId, { status: 'running' });
  broadcastSessionStatus(sessionId, 'running');

  // Use the existing user message content as the prompt
  // Note: We do NOT create a new user message here - it already exists

  // Create agent via gateway (or mock agent in mock mode)
  const agentType = session.agentType || 'claude-code';
  const agent = createAgentForSession(agentType);

  // Derive provider from the model ID (returns null for Anthropic/SDK defaults)
  const provider = resolveProviderFromModel(model);
  const sessionEnv = buildSessionEnv(provider, session.thinkingEnabled);

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

  if (modelChanged) {
    console.log(`[SESSION] Model changed to "${model}" - including conversation context`);
  }

  // Check if this is a branched conversation without a claudeSessionId (can't resume)
  // Branched conversations have a parentConversationId but may not have their own claudeSessionId yet
  const isBranchedWithoutSession = conversation.parentConversationId && !conversation.claudeSessionId;
  if (isBranchedWithoutSession) {
    console.log(`[SESSION] Branched conversation without claudeSessionId - including conversation history`);
  }

  // Only resume if we have a session ID AND model hasn't changed
  const canResume = conversation.claudeSessionId && !modelChanged;

  // Build conversation context when either:
  // 1. Model changed - context needed because we can't resume with incompatible session
  // 2. Branched conversation without session - context needed because there's no session to resume
  let conversationContext = '';
  if (modelChanged) {
    conversationContext = buildConversationContextForModelSwitch(conversationId);
  } else if (isBranchedWithoutSession) {
    conversationContext = buildConversationContextForBranch(conversationId);
  }
  const promptWithContext = conversationContext + lastUserMessage.content;

  const queryParams = buildQueryParams({
    prompt: promptWithContext,
    workingDirectory,
    controller,
    session,
    sessionId,
    systemPrompt,
    model,
    sessionEnv,
    resumeSessionId: canResume ? conversation.claudeSessionId : null,
  });

  // Logging metadata for agent call tracking
  const agentCallMeta = {
    sessionId,
    conversationId: conversationId,
    callType: 'continueSessionWithExistingMessage',
    agentType,
    model,
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
    errorLabel: 'Continue session with existing message error',
  });
}

/**
 * Stop a running or waiting session
 * @param {string} sessionId
 */
export async function stopSession(sessionId) {
  const sessionData = activeSessions.get(sessionId);

  if (sessionData) {
    // Session is actively processing - abort it
    sessionData.controller.abort();
    activeSessions.delete(sessionId);
  }
  // If not in activeSessions, session may have crashed or be waiting
  // Either way, we can still update the status to stopped

  sessions.update(sessionId, { status: 'stopped' });
  broadcastSessionStatus(sessionId, 'stopped');

  // Trigger summary generation on stop (session is truly complete now)
  summaryService.onSessionComplete(sessionId);
}

/**
 * Restart a completed or errored session (set back to stopped so it can receive messages)
 * @param {string} sessionId
 */
export function restartSession(sessionId) {
  // Clear any error and set status to stopped (allows sending new messages)
  sessions.update(sessionId, { status: 'stopped', error: null });
  broadcastSessionStatus(sessionId, 'stopped');
}

/**
 * Clean up an active session before deletion
 * @param {string} sessionId
 * @returns {boolean} true if session was active and cleaned up
 */
export function cleanupActiveSession(sessionId) {
  const sessionData = activeSessions.get(sessionId);
  if (sessionData) {
    sessionData.controller.abort();
    activeSessions.delete(sessionId);
    return true;
  }
  return false;
}
