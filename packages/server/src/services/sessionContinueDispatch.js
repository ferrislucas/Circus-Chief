import { sessions } from '../database.js';
import { resolveDispatchProvider, resolveDurableProviderId, buildSessionEnv } from './sessionProvider.js';
import {
  buildAdvanceAwareAgentTypeUpdate, buildLastExecutedUpdate, checkContinuationDispatchKind,
  createCrossKindDispatchError, hasDispatchPairChanged,
} from './sessionAgentGuard.js';
import { buildConversationContextForModelSwitch, buildConversationContextForContinuation } from './conversationContext.js';
import { ensureWorktreeCommitAttributionHook } from './gitService.js';
import { buildQueryParams } from './queryParamBuilder.js';
import { createAgentForSession, buildAgentEnv, _executeSession } from './sessionExecution.js';
import { notifyOwnBindingFallback, resolveTierRefForContinueWithStaleFallback } from './sessionStaleTierFallback.js';
import { startedSessionExecution } from './sessionStartResult.js';
import { isUserStopAbort } from './sessionAbort.js';
import {
  armContinueFailoverRetry, buildContinueTierContext, considerContinueFailoverRetry,
  resolvesToFailedMember, settleUnsettledContinueError,
} from './sessionContinueFailover.js';

/**
 * Resolve model/provider and build session environment for a continue
 * operation. Also detects model changes and updates the session record.
 *
 * Tier-ref handling (Fix 2): delegates to the shared, provider-aware
 * `resolveTierRefForContinue` helper (also used by
 * `sessionManager.buildModelAndProvider`) so both continuation paths share
 * ONE resolution/persistence contract. That helper guarantees a raw
 * `tier::<id>` sentinel is never forwarded to the agent.
 */
export function buildContinueModelAndEnv(session, sessionId, model, providerId = null) {
  // Stale-binding tolerance (PRD E3/D6): a truly-stale tier binding degrades
  // (snapshot or server default, tier:failover notice) instead of throwing —
  // matching the start path's `_runTierBoundSession` behavior.
  const { effectiveModel, providerIdHint, persist } = resolveTierRefForContinueWithStaleFallback(
    sessionId, session, model, providerId
  );

  // Enforce the cross-kind policy on the exact pair about to be dispatched:
  // explicit tier selections and own-binding live resolutions after catalog
  // changes (review issue 1) share one contract. Throws before any
  // persistence or dispatch.
  const dispatchDrift = checkContinuationDispatchKind(session, sessionId, model, { effectiveModel, providerIdHint });
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
  const dispatchedProviderId = provider?.id
    ?? resolveDurableProviderId(effectiveModel, providerIdHint)
    ?? providerIdHint ?? null;
  const dispatchedPair = { model: effectiveModel, providerId: dispatchedProviderId };

  // Visible fallback notice when the own binding silently moved off its
  // previously executed member (review issue 1).
  notifyOwnBindingFallback(session, model, dispatchedPair);

  // A switch is determined from the previous EXECUTED concrete pair and the
  // newly validated candidate — not the model string or tier sentinel alone.
  const modelChanged = hasDispatchPairChanged(session, sessionId, dispatchedPair);

  // Advance-aware agentType reconciliation (§5.1): shared with
  // sessionManager.buildModelAndProvider.
  const agentTypeUpdate = buildAdvanceAwareAgentTypeUpdate({ session, sessionId, effectiveModel, providerIdHint, persist });

  let updatedSession = session;
  const updatePayload = { ...persist, ...agentTypeUpdate, ...buildLastExecutedUpdate(session, effectiveModel, dispatchedProviderId) };
  if (Object.keys(updatePayload).length > 0) {
    sessions.update(sessionId, updatePayload);
    updatedSession = sessions.getById(sessionId);
  }

  return { effectiveModel, providerIdHint, sessionEnv, commitAttributionOverride, modelChanged, session: updatedSession };
}

/**
 * Build prompt with conversation context for a continuation. On a model
 * change the previous session can't resume, so history is included as
 * context; `failoverBoundary` appends the same-turn retry marker (§5.2).
 */
async function buildPromptForContinue({ modelChanged, agent, conversationId, prompt, failoverBoundary = null }) {
  if (modelChanged) {
    return buildConversationContextForModelSwitch(conversationId) + (failoverBoundary ?? '') + prompt;
  }
  if (agent.needsConversationContext()) {
    return buildConversationContextForContinuation(conversationId) + prompt;
  }
  return prompt;
}

/** Build query params and agent call meta for a continue operation. */
async function buildContinueParams({
  sessionId, session, systemPrompt, effectiveModel, sessionEnv,
  modelChanged, activeConversation, promptWithAttachments,
  workingDirectory, controller, agentType, agent, commitAttributionOverride,
  failoverBoundary = null,
}) {
  const canResume = activeConversation.claudeSessionId && !modelChanged && agent.supportsResume();
  const promptWithContext = await buildPromptForContinue({
    modelChanged, agent, conversationId: activeConversation.id, prompt: promptWithAttachments,
    failoverBoundary,
  });
  const queryParams = buildQueryParams({
    prompt: promptWithContext, workingDirectory, controller, session, sessionId,
    systemPrompt, model: effectiveModel, sessionEnv,
    resumeSessionId: canResume ? activeConversation.claudeSessionId : null,
    agentType, commitAttributionOverride,
  });
  // Log the RESOLVED member — the model actually dispatched — not the raw
  // caller override, which may be a tier sentinel or null.
  const agentCallMeta = {
    sessionId, conversationId: activeConversation.id, callType: 'continueSession',
    agentType, model: effectiveModel, effortLevel: session.effortLevel,
    isResume: canResume, promptLength: promptWithContext.length,
  };
  return { queryParams, agentCallMeta };
}

/**
 * Build everything the provider dispatch needs after model resolution:
 * the tier context, the commit-attribution hook, the reconciled-kind agent,
 * and the query params.
 */
async function prepareContinueDispatch({
  session, modelEnv, model, systemPrompt, activeConversation,
  promptWithAttachments, workingDirectory, controller,
  failoverBoundary = null, authorizeFailover = false,
}) {
  // Tier context for this attempt, built AFTER resolution so a backfilled
  // snapshot is visible. Health attribution always; failover authorization
  // only on the turn's first attempt (§5.2).
  const tierContext = buildContinueTierContext(session, modelEnv.effectiveModel, authorizeFailover);
  if (session.gitWorktree && modelEnv.commitAttributionOverride) {
    await ensureWorktreeCommitAttributionHook(session.gitWorktree);
  }
  const agentType = session.agentType || 'claude-code';
  const agent = createAgentForSession(agentType, {}, session);
  const { queryParams, agentCallMeta } = await buildContinueParams({
    sessionId: session.id, session, model, systemPrompt,
    effectiveModel: modelEnv.effectiveModel, sessionEnv: modelEnv.sessionEnv,
    commitAttributionOverride: modelEnv.commitAttributionOverride,
    modelChanged: modelEnv.modelChanged, activeConversation, promptWithAttachments,
    workingDirectory, controller, agentType, agent, failoverBoundary,
  });
  return { tierContext, agentType, agent, queryParams, agentCallMeta };
}

/**
 * Prepare one continuation attempt: resolve, then build the dispatch. A
 * retry that resolves back onto the failed member (concurrent tier edit
 * emptied the tier mid-turn) or that cannot prepare at all settles the
 * original failure through the normal path instead of wedging the session.
 * Returns `{ dispatch }`, or `{ settled }` when the turn ended in settlement.
 */
export async function prepareContinueAttempt(sessionId, turn, opts) {
  const { model, providerId, systemPrompt, activeConversation, promptWithAttachments,
    workingDirectory, controller, callbacks, interactive, firstAttempt } = opts;
  try {
    const modelEnv = buildContinueModelAndEnv(
      turn.session, sessionId, firstAttempt ? model : null, firstAttempt ? providerId : null
    );
    if (!firstAttempt && resolvesToFailedMember(modelEnv, turn.unsettledError)) {
      throw turn.unsettledError.error;
    }
    const dispatch = await prepareContinueDispatch({
      session: modelEnv.session, modelEnv, model, systemPrompt, activeConversation,
      promptWithAttachments, workingDirectory, controller,
      failoverBoundary: turn.failoverBoundary, authorizeFailover: firstAttempt,
    });
    return { dispatch, session: modelEnv.session };
  } catch (prepError) {
    if (!turn.unsettledError) throw prepError;
    const settled = await settleUnsettledContinueError({
      sessionId, error: turn.unsettledError.error, callbacks, controller, interactive,
    });
    if (settled) return { settled };
    throw prepError;
  }
}

/**
 * Execute one prepared continuation attempt. Returns `{ completed: true,
 * result }` on success or normal settlement, `{ completed: false }` when the
 * single failover retry was armed; throws terminal errors.
 */
export async function executeContinueAttempt(sessionId, turn, dispatch, opts) {
  const { workingDirectory, controller, callbacks, interactive, firstAttempt, activeConversation } = opts;
  try {
    const execution = await _executeSession({
      sessionId, agent: dispatch.agent, queryParams: dispatch.queryParams,
      agentCallMeta: dispatch.agentCallMeta, controller, workingDirectory, callbacks,
      broadcastConversationStateOnError: true, cleanupConversationId: true,
      interactive, errorLabel: 'Continue session error', tierContext: dispatch.tierContext,
    });
    // _executeSession only returns when it rejected the dispatch before the
    // provider call; otherwise the handoff was accepted.
    return { completed: true, result: execution || startedSessionExecution(sessionId) };
  } catch (error) {
    const retry = firstAttempt
      ? considerContinueFailoverRetry({ sessionId, error, tierContext: dispatch.tierContext, controller })
      : null;
    if (!retry) {
      return settleOrThrowContinueError({ sessionId, error, tierContext: dispatch.tierContext, controller, callbacks, interactive, firstAttempt });
    }
    Object.assign(turn, armContinueFailoverRetry(sessionId, { retry, error, activeConversation, controller }));
    return { completed: false };
  }
}

/**
 * Settle a terminal attempt failure or rethrow it. A pre-settlement rethrow
 * with no live successor (it cooled mid-turn) settles through the normal
 * failure path; anything else propagates unchanged.
 */
async function settleOrThrowContinueError({ sessionId, error, tierContext, controller, callbacks, interactive, firstAttempt }) {
  if (firstAttempt && tierContext?.allowFailover === true && !isUserStopAbort(controller)) {
    const settled = await settleUnsettledContinueError({ sessionId, error, callbacks, controller, interactive });
    if (settled) return { completed: true, result: settled };
  }
  throw error;
}
