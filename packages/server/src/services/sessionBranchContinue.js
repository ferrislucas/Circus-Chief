/**
 * sessionBranchContinue.js — branch-continuation turns (the user message
 * already exists: branch auto-start, scheduled/agent continuations).
 *
 * Lives apart from sessionManager.js so the branch-continue orchestration
 * (model resolution, prompt building, the §5.2 same-turn failover retry)
 * stays within module-size budgets. sessionManager.js re-exports the entry
 * point as a lazy delegate: this module imports `sessionExecution.js`, which
 * is reachable from sessionManager through `kanbanService -> kanbanTriggers
 * -> sessionManager`, so a static edge back would close that cycle (see the
 * `triggerStructuredTransitionAutomation` docs in kanbanService.js).
 */
import { sessions, conversations } from '../database.js';
import { resolveDispatchProvider, resolveDurableProviderId, resolveProviderFromModel, buildSessionEnv } from './sessionProvider.js';
import { notifyOwnBindingFallback, resolveTierRefForContinueWithStaleFallback } from './sessionStaleTierFallback.js';
import {
  buildAdvanceAwareAgentTypeUpdate, buildLastExecutedUpdate, checkContinuationDispatchKind,
  checkCrossKindSwitch, createCrossKindDispatchError, hasDispatchPairChanged,
} from './sessionAgentGuard.js';
import { buildConversationContextForModelSwitch, buildConversationContextForBranch, buildConversationContextForContinuation } from './conversationContext.js';
import { activeConversationIds, broadcastSessionStatus } from './streamEventHandler.js';
import { claimSessionExecution } from './sessionExecutionOwnership.js';
import { validateAndFetchContinueContext } from './sessionContinuation.js';
import { activeLaneRunOwnsSession } from './workflowSessionService.js';
import { rejectedSessionExecution, startedSessionExecution } from './sessionStartResult.js';
import { createAgentForSession, handlePreparationFailure, _executeSession } from './sessionExecution.js';
import { buildAgentEnv } from './sessionAgentConfig.js';
import { buildQueryParams } from './queryParamBuilder.js';

/**
 * Lazily resolve the continuation-failover orchestration behind the
 * sessionExecution seam (see module docs above). Resolution happens at turn
 * time, long after module evaluation, so the static graph shape is unchanged.
 */
async function loadBranchFailoverDeps() {
  const [failover, dispatch] = await Promise.all([
    import('./sessionContinueFailover.js'),
    import('./sessionContinueDispatch.js'),
  ]);
  return {
    buildContinueTierContext: failover.buildContinueTierContext,
    considerContinueFailoverRetry: failover.considerContinueFailoverRetry,
    armContinueFailoverRetry: failover.armContinueFailoverRetry,
    findHealthyContinueRetryMember: failover.findHealthyContinueRetryMember,
    resolveFrozenContinueRetryMember: failover.resolveFrozenContinueRetryMember,
    emitContinueFailoverDispatched: failover.emitContinueFailoverDispatched,
    resolvesToFailedMember: failover.resolvesToFailedMember,
    settleUnsettledContinueError: failover.settleUnsettledContinueError,
    isSameBindingSelection: dispatch.isSameBindingSelection,
    settleOrThrowContinueError: dispatch.settleOrThrowContinueError,
  };
}

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

function buildModelAndProvider(session, sessionId, model, {
  providerId = null, suppressAdvanceNotice = false, retryMember = null, retryResolution = null,
} = {}) {
  // Stale-binding tolerance (PRD E3/D6): a truly-stale tier binding degrades
  // (snapshot or server default, tier:failover notice) instead of throwing —
  // matching the start path's `_runTierBoundSession` behavior.
  const resolution = retryMember
    ? retryResolution
    : resolveTierRefForContinueWithStaleFallback(sessionId, session, model, providerId);
  const { effectiveModel, providerIdHint, persist } = resolution;

  // Enforce the cross-kind policy on the exact pair about to be dispatched —
  // shared contract with `sessionContinuation.buildContinueModelAndEnv`
  // (explicit selections and catalog-fallback live resolutions alike).
  // Throws before any persistence, agent construction, or dispatch.
  const dispatchDrift = checkContinuationDispatchKind(session, sessionId, model, { effectiveModel, providerIdHint });
  if (dispatchDrift) {
    throw createCrossKindDispatchError(dispatchDrift);
  }

  const { provider } = resolveDispatchProvider(session, model, effectiveModel, providerIdHint);

  // The dispatched concrete pair, resolved through the single dispatch rule —
  // shared durable identity with sessionContinuation.buildContinueModelAndEnv.
  const dispatchedProviderId = provider?.id
    ?? resolveDurableProviderId(effectiveModel, providerIdHint)
    ?? providerIdHint ?? null;
  const dispatchedPair = { model: effectiveModel, providerId: dispatchedProviderId };

  // Adapter env carries the resolved (provider, session) identity for the E2E
  // spawn-capture seam (queue matching + capture records) — shared contract
  // with `sessionContinuation.buildContinueModelAndEnv`, whose dispatches
  // populate the same metadata. Without it a branch turn's spawn cannot be
  // scripted or attributed per member.
  const sessionEnv = buildAgentEnv(
    buildSessionEnv(provider, session.thinkingEnabled, session.effortLevel),
    null,
    { providerId: dispatchedProviderId ?? null, sessionId }
  );

  // Visible fallback notice when the own binding silently moved off its
  // previously executed member (review issue 1) — shared contract with
  // `sessionContinuation.buildContinueModelAndEnv`. Suppressed on a
  // same-turn retry's second attempt — its advance is announced once, with
  // the failure reason, when the retry dispatches.
  notifyOwnBindingFallback(session, model, dispatchedPair, { suppressAdvanceNotice });

  // A switch is determined from the previous EXECUTED concrete (providerId,
  // modelId) pair and the newly validated candidate — shared contract with
  // `sessionContinuation.buildContinueModelAndEnv`. A provider-only switch
  // starts a fresh provider thread (no resume, replay history); distinct tier
  // bindings resolving to the same concrete pair stay on the same thread.
  const modelChanged = hasDispatchPairChanged(session, sessionId, dispatchedPair);

  let updatedSession = session;
  // Defense in depth: if this is still a draft (no assistant messages),
  // re-derive agentType so it stays in sync with the effective model. After
  // the first assistant turn this is locked. Only reconcile agentType here —
  // providerId is managed by PATCH and SessionRepository.create for non-tier
  // sessions. Suppress providerId auto-set by passing the resolved hint (or
  // the current value) as the explicit override (mirrors sessionExecution.js).
  //
  // Work Item 4: gate on `effectiveModel`, not the raw `model` override param.
  // A tier-bound draft session may have been created with a wrong initial
  // agentType (e.g. a template/lane/draft path that resolved the tier's kind
  // incorrectly before Work Item 2 closed that gap) — that must still be
  // corrected on its very first continuation, even when the caller passes no
  // explicit model override and is simply continuing on the existing
  // binding. This mirrors `sessionContinuation.buildContinueModelAndEnv`,
  // which already reconciles unconditionally on `effectiveModel`.
  // Advance-aware agentType reconciliation (§5.1): shared with
  // sessionContinuation.buildContinueModelAndEnv.
  const agentTypeUpdate = buildAdvanceAwareAgentTypeUpdate({ session, sessionId, effectiveModel, providerIdHint, persist });
  // Record the durable last-executed identity alongside any other persistence
  // (see sessionContinuation.js). Written only when it differs.
  const updatePayload = { ...persist, ...agentTypeUpdate, ...buildLastExecutedUpdate(session, effectiveModel, dispatchedProviderId) };
  if (Object.keys(updatePayload).length > 0) {
    sessions.update(sessionId, updatePayload);
    updatedSession = sessions.getById(sessionId);
  }

  // The dispatched concrete pair and provider hint, shared with the
  // branch-continue tier context (failover authorization + attribution) and
  // the same-turn retry's failed-member guard — the same durable identity
  // `sessionContinuation.buildContinueModelAndEnv` returns.
  return { effectiveModel, providerIdHint, sessionEnv, modelChanged, session: updatedSession, dispatchedPair };
}

/**
 * Build query params for continueSessionWithExistingMessage.
 * Handles context building (model switch / branch) and resume detection.
 * @returns {{ queryParams: Object, agentCallMeta: Object }}
 */
function buildExistingMessageQueryParams({
  sessionId, conversationId, session, systemPrompt,
  effectiveModel, sessionEnv, modelChanged, conversation,
  lastUserMessage, workingDirectory, controller, agentType, agent,
  failoverBoundary = null,
}) {
  // Determine context needs and build context
  const { needsContext, contextType } = determineContextNeed(conversation, modelChanged);
  if (needsContext) {
    console.log(`[SESSION] ${contextType === 'modelSwitch' ? 'Model changed' : 'Branched conversation'} - including context`);
  }
  let conversationContext = buildContextForType(conversationId, contextType);

  // Fallback: if no specific context was built but the adapter needs
  // conversation context (i.e. it can't resume), inject continuation history.
  if (!conversationContext && agent.needsConversationContext()) {
    conversationContext = buildConversationContextForContinuation(conversationId);
  }

  // A same-turn failover retry carries the boundary marker between the
  // replayed transcript and the message being continued, so the successor
  // continues the failed turn instead of re-executing it (§5.2 — mirrors
  // `buildPromptForContinue`'s marker placement on the new-message path).
  const promptWithContext = conversationContext + (failoverBoundary ?? '') + lastUserMessage.content;

  // Only resume if we have a session ID AND model hasn't changed AND the
  // agent supports resume.
  const canResume = conversation.claudeSessionId && !modelChanged && agent.supportsResume();

  const queryParams = buildQueryParams({
    prompt: promptWithContext,
    workingDirectory,
    controller,
    session,
    sessionId,
    systemPrompt,
    model: effectiveModel,
    sessionEnv,
    conversationId,
    resumeSessionId: canResume ? conversation.claudeSessionId : null,
  });

  // Log the RESOLVED member (effectiveModel) actually dispatched — not the
  // raw caller override, which may be a tier sentinel or null.
  const agentCallMeta = {
    sessionId,
    conversationId,
    callType: 'continueSessionWithExistingMessage',
    agentType,
    model: effectiveModel,
    effortLevel: session.effortLevel,
    isResume: canResume,
    promptLength: promptWithContext.length,
  };

  return { queryParams, agentCallMeta };
}

/**
 * Claim ownership and prepare a branch-continuation turn (the user message
 * already exists). Releases the claim if setup fails before _executeSession
 * takes over, so a setup failure can never wedge the session.
 * @returns {{ session: Object, queryParams: Object, agentCallMeta: Object, agent: Object }}
 */
function prepareBranchContinueTurn({ session, sessionId, conversationId, conversation, lastUserMessage, workingDirectory, options, controller, failoverDeps, authorizeFailover = false, failoverBoundary = null, skipClaim = false, settleArmedError = false, suppressAdvanceNotice = false, retryMember = null, retryResolution = null }) {
  const { systemPrompt = null, model = null, providerId = null } = options;
  // Fail closed on cross-kind model overrides (FR9): the branch-continue
  // path never re-derives the kind, so a kind change here would strand
  // the row (adapter-kind != model-kind). Reject with the existing
  // CROSS_KIND_MODEL_SWITCH semantics BEFORE claiming execution or writing
  // anything — no model/agentType/providerId/pendingModel update, no
  // adapter creation, no status side effects left behind.
  //
  // Only enforce for positively-known models: an unregistered id carries
  // no kind information (resolution merely guesses 'claude-code'), and the
  // established branch-continue contract lets such overrides proceed on
  // the existing adapter.
  const crossKindError = model && resolveProviderFromModel(model) && checkCrossKindSwitch(session, model);
  if (crossKindError) {
    throw Object.assign(new Error(crossKindError.message), { code: crossKindError.error, statusCode: 400 });
  }
  // The retry's second attempt reuses the turn's ownership (re-armed by
  // `armContinueFailoverRetry` after the failed attempt released it) —
  // re-claiming would conflict with the turn itself.
  if (!skipClaim) claimSessionExecution(sessionId, controller);
  try {
    // Make sure this conversation is active
    if (!conversation.isActive) {
      conversations.update(conversationId, { isActive: true });
    }
    activeConversationIds.set(sessionId, conversationId);

    // Update status to running
    sessions.update(sessionId, { status: 'running' });
    broadcastSessionStatus(sessionId, 'running');

    // Resolve model/provider and detect model changes BEFORE creating the
    // agent: for a tier-bound draft, `buildModelAndProvider` may reconcile
    // and persist a new `session.agentType`. Creating the agent from the
    // stale pre-reconciliation agentType would dispatch the wrong adapter.
    const modelEnv = buildModelAndProvider(session, sessionId, model, {
      providerId, suppressAdvanceNotice, retryMember, retryResolution,
    });
    const updatedSession = modelEnv.session;

    // Tier context for this attempt, built AFTER resolution so a backfilled
    // snapshot is visible. Health attribution always; failover authorization
    // only on the turn's first keep-current attempt (§5.2 — checked tiers with
    // a healthy liftable successor retry once in-turn instead of
    // rescheduling). Attribution follows the actually-dispatched pair (never
    // a lagging snapshot), and an explicit move off the own binding runs
    // tier-free — the shared contract with the new-message path, so a
    // same-turn retry can never silently replace an explicit choice.
    const explicitOffBindingMove = !retryMember
      && model != null && !failoverDeps.isSameBindingSelection(session, model, providerId);
    const tierContext = failoverDeps.buildContinueTierContext(updatedSession, modelEnv.effectiveModel, authorizeFailover, {
      dispatchedPair: modelEnv.dispatchedPair,
      explicitOffBindingMove,
    });

    // Create agent via gateway (or mock agent in mock mode), using the
    // reconciled agentType.
    const agentType = updatedSession.agentType || 'claude-code';
    const agent = createAgentForSession(agentType, {}, updatedSession);

    // Build query params and agent call meta
    const { queryParams, agentCallMeta } = buildExistingMessageQueryParams({
      sessionId, conversationId, session: updatedSession, model, systemPrompt,
      effectiveModel: modelEnv.effectiveModel, sessionEnv: modelEnv.sessionEnv,
      modelChanged: modelEnv.modelChanged, conversation,
      lastUserMessage, workingDirectory, controller, agentType, agent,
      failoverBoundary,
    });
    return { session: updatedSession, queryParams, agentCallMeta, agent, tierContext, modelEnv, dispatchedPair: modelEnv.dispatchedPair };
  } catch (error) {
    // A second-attempt preparation failure settles the armed original error
    // through the normal failure path (mirrors `prepareContinueAttempt`) —
    // the caller owns settlement, so rethrow untouched here. Any other
    // preparation failure fails the turn explicitly (sanitized visible error,
    // error status, workflow failure, controller-aware cleanup) instead of
    // wedging the session as running.
    if (settleArmedError) throw error;
    handlePreparationFailure({ sessionId, controller, error, includeConversationId: true });
  }
}
/**
 * Prepare one branch-continuation attempt: resolve, then build the dispatch.
 * A retry that resolves back onto the failed member (concurrent tier edit
 * emptied the tier mid-turn) or that cannot prepare at all settles the
 * original failure through the normal path instead of wedging the session.
 * Returns `{ dispatch, session }`, or `{ settled }` when the turn ended in
 * settlement — mirrors `prepareContinueAttempt`.
 */
async function prepareBranchContinueAttempt(sessionId, turn, opts) {
  const { conversationId, conversation, lastUserMessage, workingDirectory, controller,
    options, callbacks, interactive, firstAttempt, failoverDeps } = opts;
  try {
    const retryMember = firstAttempt ? null : failoverDeps.findHealthyContinueRetryMember(turn.session, turn.retry);
    if (!firstAttempt && !retryMember) throw turn.unsettledError.error;
    const retryResolution = retryMember ? failoverDeps.resolveFrozenContinueRetryMember(retryMember) : null;
    const prepared = await prepareBranchContinueTurn({
      session: turn.session, sessionId, conversationId, conversation, lastUserMessage,
      workingDirectory, options, controller, failoverDeps,
      authorizeFailover: firstAttempt,
      failoverBoundary: turn.failoverBoundary,
      skipClaim: !firstAttempt,
      settleArmedError: !firstAttempt,
      suppressAdvanceNotice: !firstAttempt,
      retryMember,
      retryResolution,
    });
    if (!firstAttempt && turn.unsettledError && failoverDeps.resolvesToFailedMember(
      { effectiveModel: prepared.modelEnv.effectiveModel, providerIdHint: prepared.modelEnv.providerIdHint },
      turn.unsettledError
    )) {
      throw turn.unsettledError.error;
    }
    return { dispatch: prepared, session: prepared.session };
  } catch (prepError) {
    // A retry that resolves back onto the failed member or that cannot
    // prepare at all settles the original failure through the normal path
    // instead of wedging the session — mirrors `prepareContinueAttempt`.
    if (!turn.unsettledError) throw prepError;
    const settled = await failoverDeps.settleUnsettledContinueError({
      sessionId, error: turn.unsettledError.error, callbacks, controller, interactive,
    });
    if (settled) return { settled };
    throw prepError;
  }
}

/**
 * Execute one prepared branch-continuation attempt. Returns `{ completed:
 * true, result }` on success or normal settlement, `{ completed: false }`
 * when the single failover retry was armed; throws terminal errors —
 * mirrors `executeContinueAttempt`.
 */
async function executeBranchContinueAttempt(sessionId, turn, dispatch, opts) {
  const { workingDirectory, controller, callbacks, interactive, firstAttempt, conversationId, failoverDeps } = opts;
  try {
    const execution = await _executeSession({
      sessionId,
      agent: dispatch.agent,
      queryParams: dispatch.queryParams,
      agentCallMeta: dispatch.agentCallMeta,
      controller,
      workingDirectory,
      callbacks,
      interactive,
      errorLabel: 'Continue session with existing message error',
      tierContext: dispatch.tierContext,
    });
    // _executeSession only returns when it rejected the dispatch before the
    // provider call; otherwise the handoff was accepted.
    return { completed: true, result: execution || startedSessionExecution(sessionId) };
  } catch (error) {
    const retry = firstAttempt
      ? failoverDeps.considerContinueFailoverRetry({ sessionId, error, tierContext: dispatch.tierContext, controller })
      : null;
    if (!retry) {
      // Only a pre-settlement rethrow whose retry never materialized settles
      // here; an already-settled throw propagates unchanged — the shared
      // decision with the new-message path.
      const settled = await failoverDeps.settleOrThrowContinueError({
        sessionId, error, tierContext: dispatch.tierContext, controller, callbacks, interactive, firstAttempt,
      });
      if (settled) return { completed: true, result: settled.result };
      throw error;
    }
    // Arm the turn for its single retry: cool the failed member, persist the
    // boundary marker, and re-arm running status.
    const armed = failoverDeps.armContinueFailoverRetry(sessionId, { retry, error, activeConversation: { id: conversationId }, controller });
    Object.assign(turn, {
      failoverBoundary: armed.failoverBoundary,
      unsettledError: armed.unsettledError,
      retry: armed.retry,
    });
    return { completed: false };
  }
}

export async function continueSessionWithExistingMessage(sessionId, conversationId, workingDirectory, { options = {}, callbacks }) {
  const { interactive = false } = options;
  const context = validateAndFetchContinueContext(sessionId, conversationId);
  const { session, conversation, lastUserMessage } = context;

  if (!interactive && session.laneRunId && !activeLaneRunOwnsSession(sessionId)) {
    return rejectedSessionExecution(sessionId, 'lane_run_ownership_lost');
  }

  const controller = new AbortController();
  const failoverDeps = await loadBranchFailoverDeps();

  // At most two provider dispatches per turn: the initial attempt plus one
  // tier-failover retry (§5.2 — checked tiers only). The retry re-resolves
  // (the failed member is cooled by then, so §5.1 advances) and carries the
  // failed turn's transcript with a boundary marker instead of re-executing
  // it. Mirrors the new-message retry loop in `continueSessionCore`.
  const turn = { session, failoverBoundary: null, unsettledError: null };
  const attemptOpts = {
    conversationId, conversation, lastUserMessage, workingDirectory,
    controller, callbacks, interactive, options, failoverDeps,
  };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const firstAttempt = attempt === 1;
    const attemptCtx = { ...attemptOpts, firstAttempt };
    const prepared = await prepareBranchContinueAttempt(sessionId, turn, attemptCtx);
    if (prepared.settled) return prepared.settled;
    Object.assign(turn, { session: prepared.session });
    const outcome = await executeBranchContinueAttempt(sessionId, turn, prepared.dispatch, attemptCtx);
    if (outcome.completed) {
      if (!firstAttempt && turn.unsettledError) {
        // The retry's second attempt dispatched successfully: emit the
        // deferred failover event naming the member that actually dispatched.
        failoverDeps.emitContinueFailoverDispatched(sessionId, turn.unsettledError, prepared.dispatch.dispatchedPair);
      }
      return outcome.result;
    }
  }
  throw new Error('Continue session retry loop exited without dispatching');
}
