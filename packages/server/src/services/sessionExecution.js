import { sessions, messages, attachments, conversations } from '../database.js';
import { createCodexSpawner } from './codexSpawnHelper.js';
import { createGeminiSpawner } from './geminiSpawnHelper.js';
import { resolveProviderFromModel, resolveProviderMetadataFromModel, buildSessionEnv } from './sessionProvider.js';
import { reconcileAgentTypeForRun } from './sessionAgentGuard.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { LoggingAgentWrapper } from '../agents/LoggingAgentWrapper.js';
import { VCRAgentAdapter } from '../agents/vcr/VCRAgentAdapter.js';
import { isE2ESpawnCaptureEnabled } from './e2eSpawnCapture.js';
export { buildQueryParams } from './queryParamBuilder.js';
import { buildQueryParams } from './queryParamBuilder.js';
import {
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
import { shouldRescheduleOnError, isTierFailoverEligibleError, _checkProactiveReschedule } from './sessionErrors.js';
import { isTierRef } from '@circuschief/shared';
import { runSessionWithTierFailover } from './sessionTierFailover.js';
import { schedulerService } from './schedulerService.js';
import { ensureWorktreeCommitAttributionHook } from './gitService.js';
// continueSessionCore lives in sessionContinuation.js (extracted to keep this
// file under the max-lines limit); re-exported here so sessionManager.js's
// existing `from './sessionExecution.js'` import keeps working unchanged.
export { continueSessionCore } from './sessionContinuation.js';

/**
 * Build the adapter-specific default config object for
 * {@link createAgentForSession}. Callers may pass an explicit `config` to
 * override these defaults.
 * @param {string} agentType
 * @returns {Object}
 */
function buildAgentConfig(agentType) {
  if (agentType === 'codex') {
    return { spawnCodexProcess: createCodexSpawner() };
  }
  if (agentType === 'gemini') {
    return { spawnGeminiProcess: createGeminiSpawner() };
  }
  return {};
}

export function buildAgentEnv(sessionEnv, commitAttributionOverride) {
  const env = { ...(sessionEnv || {}) };
  if (commitAttributionOverride) {
    env.CIRCUSCHIEF_COMMIT_ATTRIBUTION = commitAttributionOverride;
  } else {
    delete env.CIRCUSCHIEF_COMMIT_ATTRIBUTION;
  }
  return env;
}

export async function resolveInitialSessionModelEnv(session, model) {
  const effectiveModel = model || session.model;
  const provider = resolveProviderFromModel(effectiveModel);
  const providerMetadata = resolveProviderMetadataFromModel(effectiveModel);
  const commitAttributionOverride = providerMetadata?.commitAttributionOverride ?? null;

  if (session.gitWorktree && commitAttributionOverride) {
    await ensureWorktreeCommitAttributionHook(session.gitWorktree);
  }

  const baseSessionEnv = buildSessionEnv(provider, session.thinkingEnabled, session.effortLevel);
  return {
    effectiveModel,
    sessionEnv: buildAgentEnv(baseSessionEnv, commitAttributionOverride),
    commitAttributionOverride,
  };
}

/**
 * Create the agent for a session, using gateway + logging + VCR.
 *
 * If `config` is empty, the adapter-specific default config is applied
 * (e.g. codex receives a fresh `spawnCodexProcess` spawner). Explicit
 * `config` keys win over defaults.
 *
 * @param {string} agentType - The agent type (e.g., 'claude-code', 'codex')
 * @param {Object} [config] - Optional adapter config forwarded to the gateway.
 * @returns {{ execute: (queryParams: any, meta?: any) => AsyncGenerator }}
 */
export function createAgentForSession(agentType = 'claude-code', config = {}) {
  const mergedConfig = { ...buildAgentConfig(agentType), ...config };
  const baseAgent = agentGateway.createAgent(agentType, mergedConfig);

  // Wrap with VCR adapter if in VCR mode
  const agent = process.env.VCR_MODE && !isE2ESpawnCaptureEnabled()
    ? new VCRAgentAdapter(baseAgent, { cassetteDir: 'tests/e2e/cassettes' })
    : baseAgent;

  // Always wrap with logging
  return new LoggingAgentWrapper(agent);
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
 * @param {Object|null} [options.tierContext] - Tier failover context passed to shouldRescheduleOnError
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
  tierContext = null,
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
    // Tier failover: if this attempt is part of a tier failover loop AND the
    // error is failover-eligible, skip the normal error-handling side effects
    // entirely (status=error, visible error message, SESSION_ERROR broadcast,
    // summary generation) — those would be misleading since we're about to
    // transparently retry on the next tier member. Just rethrow so the
    // failover loop in sessionTierFailover.js can catch it and advance.
    if (tierContext) {
      const currentSession = sessions.getById(sessionId);
      if (currentSession && isTierFailoverEligibleError(currentSession, error, sessionId, tierContext)) {
        throw error;
      }
    }

    const rescheduled = await handleSessionError(sessionId, error, {
      controller,
      shouldRescheduleOnError: (session, err, sid) =>
        shouldRescheduleOnError(session, err, sid, tierContext),
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

  // ── Tier failover path ────────────────────────────────────────────────────
  const effectiveModelField = model || session.model;
  if (isTierRef(effectiveModelField)) {
    await runSessionWithTierFailover(sessionId, promptWithAttachments, workingDirectory, {
      systemPrompt,
      activeConversation,
      controller,
      callbacks,
      tierRef: effectiveModelField,
    });
    return;
  }

  // ── Standard (non-tier) path ──────────────────────────────────────────────
  await _runStandardSession(sessionId, promptWithAttachments, workingDirectory, {
    session,
    model,
    systemPrompt,
    activeConversation,
    controller,
    callbacks,
  });
}

/**
 * Standard (non-tier) session start path: reconcile the agent kind, resolve the
 * model/provider environment, and execute the agent stream.
 * @param {string} sessionId
 * @param {string} promptWithAttachments
 * @param {string} workingDirectory
 * @param {Object} ctx
 */
async function _runStandardSession(
  sessionId,
  promptWithAttachments,
  workingDirectory,
  { session, model, systemPrompt, activeConversation, controller, callbacks }
) {
  // Defense in depth: re-derive and persist the correct agent kind before creating
  // the adapter — self-heals legacy corrupted rows and any entry point that
  // bypasses the PATCH guard.
  const reconciledSession = reconcileAgentTypeForRun(session, sessionId, model);

  // Create agent via gateway (or mock agent in mock mode)
  const agentType = reconciledSession.agentType || 'claude-code';
  const agent = createAgentForSession(agentType);

  const { effectiveModel, sessionEnv, commitAttributionOverride } =
    await resolveInitialSessionModelEnv(reconciledSession, model);

  const queryParams = buildQueryParams({
    prompt: promptWithAttachments,
    workingDirectory,
    controller,
    session: reconciledSession,
    sessionId,
    systemPrompt,
    model: effectiveModel,
    sessionEnv,
    agentType,
    commitAttributionOverride,
  });

  // Log query params for debugging third-party provider issues
  console.log(`[SessionManager] runSession: model=${queryParams.options?.model || '[default]'} baseUrl=${queryParams.options?.env?.ANTHROPIC_BASE_URL || '[not set]'}`);

  // Logging metadata for agent call tracking
  const agentCallMeta = {
    sessionId,
    conversationId: activeConversation.id,
    callType: 'runSession',
    agentType,
    model,
    effortLevel: reconciledSession.effortLevel,
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
