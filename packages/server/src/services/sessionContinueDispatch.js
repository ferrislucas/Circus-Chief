import { sessions } from '../database.js';
import { isTierRef } from '@circuschief/shared';
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
  emitContinueFailoverDispatched, findHealthyContinueRetryMember, resolveFrozenContinueRetryMember,
  resolvesToFailedMember, settleUnsettledContinueError,
} from './sessionContinueFailover.js';
import { shouldRethrowForTierFailover } from './tierFailureHealth.js';

/**
 * Whether an explicit (model, providerId) request matches the session's own
 * binding — a keep-current echo, not a move off the binding. Tier-ref echoes
 * match regardless of provider hint (mirrors normalizeRequestedSelection in
 * api/sessions-messages.js); concrete requests must match the exact pair.
 *
 * Shared with the branch-continue path (`prepareBranchContinueTurn`), which
 * applies the same keep-current-vs-move contract to its tier context.
 */
export function isSameBindingSelection(session, model, providerId) {
  return model === session.model
    && (isTierRef(model) || providerId == null || providerId === session.providerId);
}

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
export function buildContinueModelAndEnv(session, sessionId, model, {
  providerId = null, suppressAdvanceNotice = false, retryMember = null,
} = {}) {
  // Stale-binding tolerance (PRD E3/D6): a truly-stale tier binding degrades
  // (snapshot or server default, tier:failover notice) instead of throwing —
  // matching the start path's `_runTierBoundSession` behavior.
  // The second dispatch of a same-turn failover is bound to the member chosen
  // from that turn's frozen membership snapshot. Validate its live identity,
  // but do not reload/reorder the tier or turn the tier binding into a
  // concrete user selection.
  const resolution = retryMember
    ? resolveFrozenContinueRetryMember(retryMember)
    : resolveTierRefForContinueWithStaleFallback(sessionId, session, model, providerId);
  const { effectiveModel, providerIdHint, persist } = resolution;

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
  // previously executed member (review issue 1), or advanced off a cooled
  // snapshot (§5.1). Suppressed on a same-turn retry's second attempt — its
  // advance was already announced when the retry armed.
  notifyOwnBindingFallback(session, model, dispatchedPair, { suppressAdvanceNotice });

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

  // An explicit request that moves OFF the session's own (model, providerId)
  // binding (a concrete-model pick, a different tier ref, or a provider-only
  // switch keeping the same model string — the duplicate-model-id scenario in
  // FRD E1/E4). Same-binding echoes stay keep-current: the exact pair, or any
  // tier-ref echo (mirrors normalizeRequestedSelection in
  // api/sessions-messages.js, where a provider hint never turns a tier echo
  // into a move). The failover machinery uses this to run the attempt
  // tier-free (review #1), so a same-turn retry can never silently replace an
  // explicit provider choice with a tier successor (PR Review.md Fix #4).
  const explicitOffBindingMove = !retryMember && model != null && !isSameBindingSelection(session, model, providerId);

  return { effectiveModel, providerIdHint, sessionEnv, commitAttributionOverride, modelChanged, session: updatedSession, dispatchedPair, explicitOffBindingMove };
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
  // only on the turn's first attempt (§5.2). Attribution follows the
  // actually-dispatched pair (never a lagging snapshot), and an explicit move
  // off the own binding runs tier-free (review #1).
  const tierContext = buildContinueTierContext(session, modelEnv.effectiveModel, authorizeFailover, {
    dispatchedPair: modelEnv.dispatchedPair,
    explicitOffBindingMove: modelEnv.explicitOffBindingMove,
  });
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
  return { tierContext, agentType, agent, queryParams, agentCallMeta, dispatchedPair: modelEnv.dispatchedPair };
}

/** Resolve the retry's selected member from its frozen cycle snapshot. */
function resolveRetryMemberForAttempt(turn, firstAttempt) {
  if (firstAttempt) return null;
  const retryMember = findHealthyContinueRetryMember(turn.session, turn.retry);
  if (!retryMember) throw turn.unsettledError.error;
  return retryMember;
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
    const retryMember = resolveRetryMemberForAttempt(turn, firstAttempt);
    const modelEnv = buildContinueModelAndEnv(
      turn.session, sessionId, firstAttempt ? model : null,
      {
        providerId: firstAttempt ? providerId : null,
        suppressAdvanceNotice: !firstAttempt,
        retryMember,
      }
    );
    if (!firstAttempt && resolvesToFailedMember(modelEnv, turn.unsettledError)) {
      throw turn.unsettledError.error;
    }
    const dispatch = await prepareContinueDispatch({
      session: modelEnv.session, modelEnv, model, systemPrompt, activeConversation,
      promptWithAttachments, workingDirectory, controller,
      failoverBoundary: turn.failoverBoundary, authorizeFailover: firstAttempt,
    });
    if (!firstAttempt && turn.unsettledError) {
      // The retry's second attempt resolved successfully: emit the deferred
      // failover event naming the member that actually dispatches (review
      // #2). A settling path (resolvesToFailedMember / prep throw) emits
      // nothing — no successful switch happened.
      emitContinueFailoverDispatched(sessionId, turn.unsettledError, dispatch.dispatchedPair);
    }
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
 * Settle a terminal attempt failure or rethrow it. Only a pre-settlement
 * rethrow — `_executeSession` exited via `shouldRethrowForTierFailover`
 * before running the terminal pipeline, and the retry never materialized
 * (its successor cooled mid-turn) — settles through the normal failure path.
 * An already-settled throw (the pipeline ran inside `_executeSession`)
 * propagates unchanged; re-entering `handleTurnFailure` would run member
 * cooling, reschedule evaluation, and the visible error a second time.
 *
 * Shared with the branch-continue path, whose retry loop settles a declined
 * pre-settlement rethrow through the identical decision.
 */
export async function settleOrThrowContinueError({ sessionId, error, tierContext, controller, callbacks, interactive, firstAttempt }) {
  if (firstAttempt && tierContext?.allowFailover === true && !isUserStopAbort(controller)
    && shouldRethrowForTierFailover(sessionId, error, tierContext)) {
    const settled = await settleUnsettledContinueError({ sessionId, error, callbacks, controller, interactive });
    if (settled) return { completed: true, result: settled };
  }
  throw error;
}
