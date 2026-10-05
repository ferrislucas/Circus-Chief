import { sessions, messages, attachments, conversations } from '../database.js';
import { resolveDispatchProvider, buildSessionEnv } from './sessionProvider.js';
import { buildLastExecutedUpdate, checkExplicitTierDispatchKind, createCrossKindDispatchError, deriveAgentTypeUpdate, hasDispatchPairChanged } from './sessionAgentGuard.js';
import { buildConversationContextForModelSwitch, buildConversationContextForContinuation } from './conversationContext.js';
import { ensureWorktreeCommitAttributionHook } from './gitService.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { buildQueryParams } from './queryParamBuilder.js';
import { activeConversationIds, broadcastSessionStatus } from './streamEventHandler.js';
import { claimSessionExecution, createExecutionConflictError, getSessionExecutionConflict } from './sessionExecutionOwnership.js';
import { buildPromptWithAttachments } from './sessionPrompts.js';
import { createAgentForSession, buildAgentEnv, _executeSession, handlePreparationFailure } from './sessionExecution.js';
import { resolveTierRefForContinueWithStaleFallback } from './sessionStaleTierFallback.js';
import { buildTierHealthContext } from './tierResolutionService.js';
import { activeLaneRunOwnsSession } from './workflowSessionService.js';
import { rejectedSessionExecution, startedSessionExecution } from './sessionStartResult.js';

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
 * Validate the ownership claim for a branch continue, then fetch the session,
 * conversation, and last user message it needs. Shared with sessionManager's
 * branch path so both continue entries enforce the same admission contract.
 */
export function validateAndFetchContinueContext(sessionId, conversationId) {
  const conflict = getSessionExecutionConflict(sessionId);
  if (conflict) {
    throw createExecutionConflictError(sessionId, conflict.phase);
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
  const lastUserMessage = [...conversationMessages].reverse().find((m) => m.role === 'user');
  if (!lastUserMessage) {
    throw new Error('No user message found in conversation');
  }
  return { session, conversation, lastUserMessage };
}

/**
 * Resolve model/provider and build session environment for a continue operation.
 * Also detects model changes and updates the session record.
 *
 * Tier-ref handling (Fix 2): delegates to the shared, provider-aware
 * `resolveTierRefForContinue` helper (also used by `sessionManager.buildModelAndProvider`)
 * so both continuation paths share ONE resolution/persistence contract instead
 * of duplicating (and re-diverging) the tier-ref logic. That helper guarantees
 * a raw `tier::<id>` sentinel is never forwarded to the agent — whether the
 * session is continuing on its existing tier binding, switching to a
 * different tier, or being pinned to an explicit concrete model.
 *
 * @param {Object} session - Current session object
 * @param {string} sessionId - Session ID
 * @param {string|null} model - Requested model override (null to keep current binding)
 * @returns {{ effectiveModel: string|null, sessionEnv: Object, modelChanged: boolean, session: Object }}
 */
function buildContinueModelAndEnv(session, sessionId, model, providerId = null) {
  // Stale-binding tolerance (PRD E3/D6): a truly-stale tier binding degrades
  // (snapshot or server default, tier:failover notice) instead of throwing —
  // matching the start path's `_runTierBoundSession` behavior.
  const { effectiveModel, providerIdHint, persist } = resolveTierRefForContinueWithStaleFallback(
    sessionId, session, model, providerId
  );

  // Enforce the cross-kind policy on the exact pair about to be dispatched —
  // not the pair the API guard saw. Cooldown can shift the resolved member
  // between HTTP validation and execution, and scheduled continuations bypass
  // the HTTP guard entirely. Throws before any persistence or dispatch.
  const dispatchDrift = checkExplicitTierDispatchKind(session, sessionId, model, { effectiveModel, providerIdHint });
  if (dispatchDrift) {
    throw createCrossKindDispatchError(dispatchDrift);
  }

  // Derive provider through the single dispatch rule: tier-derived bindings
  // resolve strictly (exact owner or typed error — never a cross-provider
  // fallback), concrete bindings keep the legacy fallback.
  const { provider, providerMetadata } = resolveDispatchProvider(session, model, effectiveModel, providerIdHint);
  const commitAttributionOverride = providerMetadata?.commitAttributionOverride ?? null;
  const sessionEnv = buildAgentEnv(
    buildSessionEnv(provider, session.thinkingEnabled, session.effortLevel),
    commitAttributionOverride,
    { providerId: provider?.id ?? providerIdHint ?? null, sessionId }
  );

  // The dispatched concrete pair, resolved through the single dispatch rule.
  const dispatchedProviderId = provider?.id ?? providerIdHint ?? null;
  const dispatchedPair = { model: effectiveModel, providerId: dispatchedProviderId };

  // A switch is determined from the previous EXECUTED concrete (providerId,
  // modelId) pair and the newly validated candidate — not the model string or
  // tier sentinel alone. A provider-only switch (same model id, different
  // provider) starts a fresh provider thread: the old resume handle is
  // meaningless and history must be replayed. Distinct tier bindings
  // resolving to the same concrete pair are the same thread: resume stays
  // valid and no replay happens. A session with no stored binding adopting
  // the caller's model is initialization, not a switch: it must keep
  // resume/context state (the web client always echoes a resolved picker
  // default, and lane on-enter workers are created model-less).
  const modelChanged = hasDispatchPairChanged(session, sessionId, dispatchedPair);

  // Defense in depth: re-derive agentType using the effective model + provider
  // hint so a stale stored agentType is corrected even when no explicit model
  // is passed. Only reconcile agentType here — providerId persistence for
  // non-tier sessions is managed by PATCH and SessionRepository.create.
  const agentTypeUpdate = effectiveModel
    ? deriveAgentTypeUpdate(session, sessionId, effectiveModel, { providerId: providerIdHint ?? session.providerId })
    : {};

  let updatedSession = session;
  // Record the durable last-executed identity alongside any other persistence
  // so a later provider-only PATCH cannot erase the evidence of which pair
  // actually ran.
  const updatePayload = { ...persist, ...agentTypeUpdate, ...buildLastExecutedUpdate(session, effectiveModel, dispatchedProviderId) };
  if (Object.keys(updatePayload).length > 0) {
    sessions.update(sessionId, updatePayload);
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
  sessionId, session, systemPrompt, effectiveModel, sessionEnv,
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

  // Logging metadata for agent call tracking. Log the RESOLVED member
  // (effectiveModel) — the model actually dispatched — not the raw caller
  // override, which may be a tier sentinel or null for a tier-bound session.
  const agentCallMeta = {
    sessionId,
    conversationId: activeConversation.id,
    callType: 'continueSession',
    agentType,
    model: effectiveModel,
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
// Build everything the provider dispatch needs after model resolution:
// the health-reporting tier context, the commit-attribution hook, the
// reconciled-kind agent, and the query params.
async function prepareContinueDispatch({
  session, modelEnv, model, systemPrompt, activeConversation,
  promptWithAttachments, workingDirectory, controller,
}) {
  // Health attribution for tier-bound continuations (mid-conversation
  // cooldown). Built AFTER resolution so a backfilled snapshot is visible.
  // This context can report member health on an eligible failure but can
  // never authorize failover — the continuation stays pinned to this member.
  const tierContext = buildTierHealthContext(session);

  if (session.gitWorktree && modelEnv.commitAttributionOverride) {
    await ensureWorktreeCommitAttributionHook(session.gitWorktree);
  }

  // Create agent via gateway (or mock agent in mock mode), using the
  // reconciled agentType.
  const agentType = session.agentType || 'claude-code';
  const agent = createAgentForSession(agentType);

  // Build query params and agent call meta
  const { queryParams, agentCallMeta } = await buildContinueParams({
    sessionId: session.id, session, model, systemPrompt,
    effectiveModel: modelEnv.effectiveModel, sessionEnv: modelEnv.sessionEnv,
    commitAttributionOverride: modelEnv.commitAttributionOverride,
    modelChanged: modelEnv.modelChanged, activeConversation, promptWithAttachments,
    workingDirectory, controller, agentType, agent,
  });
  return { tierContext, agentType, agent, queryParams, agentCallMeta };
}

export async function continueSessionCore(sessionId, content, workingDirectory, config = {}) {
  const { options = {}, callbacks } = config;
  const { systemPrompt = null, fileAttachments = [], model = null, providerId = null, interactive = false } = options;

  // Get the session to retrieve the Claude session ID and settings
  let session = sessions.getById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  // A scheduled/automatic continuation can race with a manual card move that
  // revokes its lane-run ownership. Reject before registering active state,
  // creating a user message, or changing the session status. _executeSession
  // repeats this immediately before provider dispatch to close the remaining
  // race window.
  if (!interactive && session.laneRunId && !activeLaneRunOwnsSession(sessionId)) {
    return rejectedSessionExecution(sessionId, 'lane_run_ownership_lost');
  }

  const controller = new AbortController();
  // Atomically claim execution ownership. Throws a 409-coded conflict when a
  // live turn (running or still shutting down after a Stop) owns the session.
  claimSessionExecution(sessionId, controller);

  // Preparation runs BEFORE provider dispatch and outside _executeSession's
  // own error/finally boundary: any failure here must fail the turn
  // explicitly (sanitized visible error, error status, workflow failure,
  // controller-aware cleanup) instead of wedging the session as permanently
  // running. The flag keeps _executeSession's own — already handled —
  // failures out of that path: they propagate unchanged.
  let providerDispatched = false;
  try {
    // Ensure there's an active conversation and create the user message
    const { activeConversation, promptWithAttachments } = await setupConversationAndMessage(
      sessionId, content, fileAttachments
    );

    // Update status to running
    sessions.update(sessionId, { status: 'running' });
    broadcastSessionStatus(sessionId, 'running');

    // Resolve model/provider and detect model changes BEFORE creating the agent
    // (Work Item 4): for a tier-bound draft, `buildContinueModelAndEnv` may
    // reconcile and persist a new `session.agentType` (e.g. a tier's first
    // member resolves to Codex although the row still says 'claude-code').
    // Creating the agent from the stale pre-reconciliation agentType would
    // dispatch the wrong adapter for the resolved model.
    const modelEnv = buildContinueModelAndEnv(session, sessionId, model, providerId);
    session = modelEnv.session;

    const { tierContext, agent, queryParams, agentCallMeta } = await prepareContinueDispatch({
      session, modelEnv, model, systemPrompt, activeConversation,
      promptWithAttachments, workingDirectory, controller,
    });

    providerDispatched = true;
    const execution = await _executeSession({
      sessionId,
      agent,
      queryParams,
      agentCallMeta,
      controller,
      workingDirectory,
      callbacks,
      broadcastConversationStateOnError: true,
      cleanupConversationId: true,
      interactive,
      errorLabel: 'Continue session error',
      tierContext,
    });
    // _executeSession only returns a result when it rejected the dispatch before
    // the provider call; otherwise the handoff was accepted.
    return execution || startedSessionExecution(sessionId);
  } catch (error) {
    if (!providerDispatched) {
      handlePreparationFailure({ sessionId, controller, error, includeConversationId: true });
    }
    throw error;
  }
}
