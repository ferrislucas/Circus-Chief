import { sessions, messages, conversations, projects } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as summaryService from './summaryService.js';
import { checkAndTriggerNextTemplate } from './templateTriggerService.js';
import { resolveProviderFromModel, buildSessionEnv } from './sessionProvider.js';
import {
  shouldRescheduleOnError,
  _checkProactiveReschedule,
  matchesTokenLimitError,
  matchesServiceError,
} from './sessionErrors.js';
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
  cleanupSessionState,
  broadcastSessionStatus,
} from './streamEventHandler.js';
// Import execution helpers from sessionExecution.js
import {
  createAgentForSession,
  buildQueryParams,
  _executeSession,
  runSessionCore,
  continueSessionCore,
} from './sessionExecution.js';

// Re-export prompt-related functions for backward compatibility
export { buildSystemPromptConfig, PLAN_MODE_PROMPT, getPermissionModeForSession, getSessionAttachmentsContext, buildPromptWithAttachments, getApiBaseUrl };

// Re-export error detection and rescheduling functions for backward compatibility
export { shouldRescheduleOnError, _checkProactiveReschedule, matchesTokenLimitError, matchesServiceError };

/**
 * Determine if context needs to be rebuilt for a conversation.
 * @param {Object} conversation
 * @param {boolean} modelChanged
 * @returns {{needsContext: boolean, contextType: 'modelSwitch'|'branch'|null}}
 */
function determineContextNeed(conversation, modelChanged) {
  if (modelChanged) {
    return { needsContext: true, contextType: 'modelSwitch' };
  }
  const isBranchedWithoutSession = conversation.parentConversationId && !conversation.claudeSessionId;
  if (isBranchedWithoutSession) {
    return { needsContext: true, contextType: 'branch' };
  }
  return { needsContext: false, contextType: null };
}

/**
 * Build conversation context based on context type.
 * @param {string} conversationId
 * @param {'modelSwitch'|'branch'|null} contextType
 * @returns {string}
 */
function buildContextForType(conversationId, contextType) {
  if (contextType === 'modelSwitch') {
    return buildConversationContextForModelSwitch(conversationId);
  }
  if (contextType === 'branch') {
    return buildConversationContextForBranch(conversationId);
  }
  return '';
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
    sessionId,
    session: { ...session, nextTemplateId: null }
  });
}

/**
 * Auto-send queued prompt if enabled after a model turn completes.
 * Exported for unit testing (same pattern as _checkProactiveReschedule).
 * @param {string} sessionId
 */
export async function handleAutoSendIfNeeded(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session || !session.autoSendPendingPrompt || !session.pendingPrompt) {
    return false;
  }

  // Clear the auto-send flag and pending prompt BEFORE sending
  // to prevent double-sends on race conditions
  const promptToSend = session.pendingPrompt;
  const modelToUse = session.pendingModel || null;
  const updatedSession = sessions.update(sessionId, {
    autoSendPendingPrompt: false,
    pendingPrompt: null,
  });

  // Broadcast the cleared state so the UI updates
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    sessionId,
    session: updatedSession,
  });

  // Re-check status — template trigger may have changed it
  const currentSession = sessions.getById(sessionId);
  if (currentSession?.status !== 'waiting') {
    return true;
  }

  // Clean up the current session's active state before calling continueSession.
  // handleAutoSendIfNeeded runs inside _executeSession's try block, so the session
  // is still in activeSessions. continueSession guards against this with
  // "Session is already processing". Cleaning up here is safe because:
  // 1. The agent stream has already ended
  // 2. cleanupSessionState just deletes Map entries (all idempotent)
  // 3. The finally block's redundant call is a harmless no-op
  cleanupSessionState(sessionId);

  // Send the queued prompt (reuses existing continueSession logic)
  try {
    const project = projects.getById(session.projectId);
    const systemPrompt = project?.systemPrompt || null;
    await continueSession(sessionId, promptToSend, session.gitWorktree || project?.workingDirectory, { systemPrompt, model: modelToUse });
  } catch (error) {
    console.error(`[AUTO-SEND] Failed to auto-send for session ${sessionId}:`, error);
  }
  return true;
}

// buildQueryParams and _executeSession moved to sessionExecution.js

/**
 * Run a Claude session
 * @param {string} sessionId
 * @param {string} prompt
 * @param {string} workingDirectory
 * @param {{ systemPrompt?: string|null, fileAttachments?: Array, model?: string|null }} options - Optional parameters
 */
export async function runSession(sessionId, prompt, workingDirectory, options = {}) {
  // Delegate to sessionExecution.js, passing callbacks to avoid circular imports
  await runSessionCore(sessionId, prompt, workingDirectory, {
    options,
    callbacks: { handleTemplateTriggerIfNeeded, handleAutoSendIfNeeded },
  });
}

/**
 * Continue a session with a follow-up message
 * @param {string} sessionId
 * @param {string} content
 * @param {string} workingDirectory
 * @param {{ systemPrompt?: string|null, fileAttachments?: Array, model?: string|null }} options - Optional parameters
 */
export async function continueSession(sessionId, content, workingDirectory, options = {}) {
  // Delegate to sessionExecution.js, passing callbacks to avoid circular imports
  await continueSessionCore(sessionId, content, workingDirectory, {
    options,
    callbacks: { handleTemplateTriggerIfNeeded, handleAutoSendIfNeeded },
  });
}

/**
 * Continue a session when the user message is already stored (e.g., from branching)
 * This triggers Claude's response without creating a new user message
 * @param {string} sessionId
 * @param {string} conversationId - The conversation to continue (must have an existing user message)
 * @param {string} workingDirectory
 * @param {{ systemPrompt?: string|null, model?: string|null }} options - Optional parameters
 */
/**
 * Validate and fetch the session, conversation, and last user message for continuing a session.
 * @returns {{ session: Object, conversation: Object, lastUserMessage: Object }}
 */
function validateAndFetchContinueContext(sessionId, conversationId) {
  if (activeSessions.has(sessionId)) {
    throw new Error('Session is already processing');
  }
  const session = sessions.getById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  const conversation = conversations.getById(conversationId);
  if (!conversation || conversation.sessionId !== sessionId) {
    throw new Error('Conversation not found');
  }
  const conversationMessages = messages.getByConversationId(conversationId);
  const lastUserMessage = [...conversationMessages].reverse().find(m => m.role === 'user');
  if (!lastUserMessage) {
    throw new Error('No user message found in conversation');
  }
  return { session, conversation, lastUserMessage };
}

export async function continueSessionWithExistingMessage(sessionId, conversationId, workingDirectory, options = {}) {
  const { systemPrompt = null, model = null } = options;
  const context = validateAndFetchContinueContext(sessionId, conversationId);
  let session = context.session;
  const { conversation, lastUserMessage } = context;

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

  // Resolve the effective model: fall back to session.model so that resuming
  // without an explicit model still resolves the correct provider (e.g.
  // third-party base URL and auth tokens).
  const effectiveModel = model || session.model;

  // Derive provider from the effective model ID (returns null for Anthropic/SDK defaults)
  const provider = resolveProviderFromModel(effectiveModel);
  const sessionEnv = buildSessionEnv(provider, session.thinkingEnabled, session.effortLevel);

  // Check if model changed (can't resume with different model/provider)
  const modelChanged = model && session.model && model !== session.model;

  // Update session.model after detecting change
  if (model) {
    sessions.update(sessionId, { model });
    session = sessions.getById(sessionId);
  }

  // Determine context needs and build context
  const { needsContext, contextType } = determineContextNeed(conversation, modelChanged);
  if (needsContext) {
    console.log(`[SESSION] ${contextType === 'modelSwitch' ? 'Model changed' : 'Branched conversation'} - including context`);
  }
  const conversationContext = buildContextForType(conversationId, contextType);
  const promptWithContext = conversationContext + lastUserMessage.content;

  // Only resume if we have a session ID AND model hasn't changed
  const canResume = conversation.claudeSessionId && !modelChanged;

  const queryParams = buildQueryParams({
    prompt: promptWithContext,
    workingDirectory,
    controller,
    session,
    sessionId,
    systemPrompt,
    model: effectiveModel,
    sessionEnv,
    resumeSessionId: canResume ? conversation.claudeSessionId : null,
  });

  // Logging metadata for agent call tracking
  const agentCallMeta = {
    sessionId,
    conversationId,
    callType: 'continueSessionWithExistingMessage',
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
    callbacks: { handleTemplateTriggerIfNeeded, handleAutoSendIfNeeded },
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
