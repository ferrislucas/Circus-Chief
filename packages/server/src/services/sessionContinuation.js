import { sessions, messages, attachments, conversations } from '../database.js';
import { resolveProviderFromModel, resolveProviderMetadataFromModel, buildSessionEnv } from './sessionProvider.js';
import { deriveAgentTypeUpdate } from './sessionAgentGuard.js';
import { buildConversationContextForModelSwitch, buildConversationContextForContinuation } from './conversationContext.js';
import { ensureWorktreeCommitAttributionHook } from './gitService.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { buildQueryParams } from './queryParamBuilder.js';
import { activeSessions, activeConversationIds, broadcastSessionStatus } from './streamEventHandler.js';
import { buildPromptWithAttachments } from './sessionPrompts.js';
import { createAgentForSession, buildAgentEnv, _executeSession } from './sessionExecution.js';

/**
 * Build prompt with conversation context for a continuation.
 * When the model changes, we can't resume the previous session, so we include
 * conversation history as context so the new model can continue naturally.
 * When the adapter cannot resume, we include conversation history so the
 * model has context of previous turns.
 * @param {Object} opts
 * @param {boolean} opts.modelChanged
 * @param {Object} opts.agent - Agent instance
 * @param {string} opts.conversationId
 * @param {string} opts.prompt
 * @returns {Promise<string>}
 */
async function buildPromptForContinue({ modelChanged, agent, conversationId, prompt }) {
  if (modelChanged) {
    return buildConversationContextForModelSwitch(conversationId) + prompt;
  }
  if (agent.needsConversationContext()) {
    return buildConversationContextForContinuation(conversationId) + prompt;
  }
  return prompt;
}

/**
 * Resolve model/provider and build session environment for a continue operation.
 * Also detects model changes and updates the session record.
 * @param {Object} session - Current session object
 * @param {string} sessionId - Session ID
 * @param {string|null} model - Requested model (null to keep current)
 * @returns {{ effectiveModel: string|null, sessionEnv: Object, modelChanged: boolean, session: Object }}
 */
function buildContinueModelAndEnv(session, sessionId, model) {
  // Resolve the effective model: fall back to session.model so that resuming
  // without an explicit model still resolves the correct provider (e.g.
  // third-party base URL and auth tokens).
  const effectiveModel = model || session.model;

  // Derive provider from the effective model ID (returns null for Anthropic/SDK defaults)
  const provider = resolveProviderFromModel(effectiveModel);
  const providerMetadata = resolveProviderMetadataFromModel(effectiveModel);
  const commitAttributionOverride = providerMetadata?.commitAttributionOverride ?? null;
  const sessionEnv = buildAgentEnv(
    buildSessionEnv(provider, session.thinkingEnabled, session.effortLevel),
    commitAttributionOverride
  );

  // Check if model changed from the session's last requested model
  // When model changes, we can't resume the previous session - thinking blocks and
  // session context may be incompatible between different models/providers
  const modelChanged = Boolean(model && session.model && model !== session.model);

  // Update session.model to track the user-requested model (short format)
  // This must happen AFTER modelChanged detection so we compare old vs new.
  // Defense in depth: re-derive agentType using the effective model so that a
  // stale stored agentType is corrected even when no explicit model is passed.
  let updatedSession = session;
  // Only reconcile agentType here — providerId is managed by PATCH and SessionRepository.create.
  const agentTypeUpdate = effectiveModel ? deriveAgentTypeUpdate(session, sessionId, effectiveModel, { providerId: session.providerId }) : {};
  if (model || Object.keys(agentTypeUpdate).length > 0) {
    sessions.update(sessionId, { ...(model && { model }), ...agentTypeUpdate });
    updatedSession = sessions.getById(sessionId);
  }

  return {
    effectiveModel,
    sessionEnv,
    commitAttributionOverride,
    modelChanged,
    session: updatedSession,
  };
}

/**
 * Build query params and agent call meta for a continue session operation.
 * @param {Object} opts
 * @returns {{ queryParams: Object, agentCallMeta: Object }}
 */
async function buildContinueParams({
  sessionId, session, model, systemPrompt, effectiveModel, sessionEnv,
  modelChanged, activeConversation, promptWithAttachments,
  workingDirectory, controller, agentType, agent, commitAttributionOverride,
}) {
  // Only resume if we have a session ID AND model hasn't changed AND the
  // agent supports resume.
  const canResume = activeConversation.claudeSessionId && !modelChanged && agent.supportsResume();

  // Build prompt with conversation context when model changes or adapter needs it
  const promptWithContext = await buildPromptForContinue({
    modelChanged, agent, conversationId: activeConversation.id, prompt: promptWithAttachments,
  });

  const queryParams = buildQueryParams({
    prompt: promptWithContext,
    workingDirectory,
    controller,
    session,
    sessionId,
    systemPrompt,
    model: effectiveModel,
    sessionEnv,
    resumeSessionId: canResume ? activeConversation.claudeSessionId : null,
    agentType,
    commitAttributionOverride,
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

  return { queryParams, agentCallMeta };
}

/**
 * Set up the active conversation, create the user message, broadcast it,
 * associate attachments, and build the prompt with attachment context.
 * @returns {{ activeConversation: Object, promptWithAttachments: string }}
 */
async function setupConversationAndMessage(sessionId, content, fileAttachments) {
  const activeConversation = conversations.ensureActiveConversation(sessionId);
  activeConversationIds.set(sessionId, activeConversation.id);

  const message = messages.create(sessionId, 'user', content, { toolUse: null, conversationId: activeConversation.id });

  // Touch the session to update its updated_at timestamp so it sorts to the top
  sessions.touch(sessionId);

  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, {
    message,
    conversationId: activeConversation.id,
  });

  if (fileAttachments.length > 0) {
    attachments.updateMessageIdForSession(sessionId, message.id);
  }

  const promptWithAttachments = buildPromptWithAttachments(content, fileAttachments);
  return { activeConversation, promptWithAttachments };
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

  // Ensure there's an active conversation and create the user message
  const { activeConversation, promptWithAttachments } = await setupConversationAndMessage(
    sessionId, content, fileAttachments
  );

  // Update status to running
  sessions.update(sessionId, { status: 'running' });
  broadcastSessionStatus(sessionId, 'running');

  // Create agent via gateway (or mock agent in mock mode)
  const agentType = session.agentType || 'claude-code';
  const agent = createAgentForSession(agentType);

  // Resolve model/provider and detect model changes
  const modelEnv = buildContinueModelAndEnv(session, sessionId, model);
  session = modelEnv.session;
  if (session.gitWorktree && modelEnv.commitAttributionOverride) {
    await ensureWorktreeCommitAttributionHook(session.gitWorktree);
  }

  // Build query params and agent call meta
  const { queryParams, agentCallMeta } = await buildContinueParams({
    sessionId, session, model, systemPrompt,
    effectiveModel: modelEnv.effectiveModel, sessionEnv: modelEnv.sessionEnv,
    commitAttributionOverride: modelEnv.commitAttributionOverride,
    modelChanged: modelEnv.modelChanged, activeConversation, promptWithAttachments,
    workingDirectory, controller, agentType, agent,
  });

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
