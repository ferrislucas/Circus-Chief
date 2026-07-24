import { sessions, modelTiers } from '../database.js';
import { reconcileAgentTypeForRun, sessionHasNoAssistantMessages } from './sessionAgentGuard.js';
import { parseTierRef, WS_MESSAGE_TYPES, DEFAULT_MAX_FAILOVER_ATTEMPTS } from '@circuschief/shared';
import {
  getTierMembersResolved,
  markUnhealthy,
  findNextHealthyTierMember,
  isUnhealthy,
} from './tierResolutionService.js';
import { matchesStartFailoverEligibleError } from './sessionErrors.js';
import { broadcastToSession } from '../websocket.js';
import { buildQueryParams } from './queryParamBuilder.js';
import { activeSessions } from './streamEventHandler.js';
import {
  createAgentForSession,
  resolveInitialSessionModelEnv,
  _executeSession,
} from './sessionExecution.js';
import { agentCallLogger } from './agentCallLogger.js';
import { resolveAgentTypeFromModel } from './sessionProvider.js';

/**
 * Execute a single attempt with a concrete (model, providerId) pair.
 * Extracted so the tier failover loop can call it with different members.
 */
async function attemptRunWithModel(
  sessionId,
  promptWithAttachments,
  workingDirectory,
  { systemPrompt, activeConversation, controller, callbacks, tierContext }
) {
  // Re-derive session from DB in case a previous attempt updated it
  const currentSession = sessions.getById(sessionId);

  // Fix 4: thread the exact member providerId through — never re-derive the
  // agent type / env from modelId alone, which would be ambiguous whenever
  // two tier members share the same modelId across different providers.
  const memberModelId = tierContext ? tierContext.currentMemberId : null;
  const memberProviderId = tierContext ? tierContext.currentMemberProviderId : null;

  // Reconcile agent type for this concrete model (supports cross-provider switches)
  const reconciledSession = reconcileAgentTypeForRun(
    currentSession,
    sessionId,
    memberModelId,
    memberProviderId
  );

  const agentType = reconciledSession.agentType || 'claude-code';
  const agent = createAgentForSession(agentType);

  const { effectiveModel, sessionEnv, commitAttributionOverride } =
    await resolveInitialSessionModelEnv(reconciledSession, memberModelId, memberProviderId);

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

  console.log(
    `[SessionManager] runSession: model=${queryParams.options?.model || '[default]'} baseUrl=${queryParams.options?.env?.ANTHROPIC_BASE_URL || '[not set]'}`
  );

  const agentCallMeta = {
    sessionId,
    conversationId: activeConversation.id,
    callType: 'runSession',
    agentType,
    model: effectiveModel,
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
    tierContext,
  });
}

/**
 * Handle a failed tier-member attempt.
 *
 * When the failure is failover-eligible (a start-only service/token error before
 * the conversation has produced any assistant output) and another healthy member
 * exists, marks the member unhealthy, emits a failover event and returns so the
 * caller can advance to the next member. Otherwise rethrows the original error
 * (without emitting a failover event — there is nothing to fail over *to*, so
 * the existing error/auto-reschedule handling, already applied upstream in
 * `_executeSession`, is the correct terminal behavior).
 *
 * @param {Error} error
 * @param {{ sessionId: string, member: Object, tierRef: string, tierName: string, attemptsUsed: number, maxAttempts: number }} ctx
 */
function handleTierMemberFailure(error, { sessionId, member, tierRef, tierName, attemptsUsed, maxAttempts }) {
  const errMsg = error.message?.toLowerCase() || '';
  // Use the tighter failover-specific matcher (Fix 4) to avoid spurious failover
  // on non-quota errors (e.g. "Unexpected token in JSON" contains "token").
  const isEligible = matchesStartFailoverEligibleError(errMsg);
  const isPreConversation = sessionHasNoAssistantMessages(sessionId);

  // Non-eligible error (auth, bad request, abort) or mid-conversation — don't advance
  if (!isEligible || !isPreConversation) {
    throw error;
  }

  // Find the member that will actually be attempted next (Fix 5): a single
  // ordered scan that only considers members after this one's position, skips
  // cooldown, and respects the attempt cap — so the notice never names a
  // member the loop won't really try.
  const nextMember = findNextHealthyTierMember(tierRef, member, { attemptsUsed, maxAttempts });

  if (!nextMember) {
    // Nothing will actually be attempted next — rethrow WITHOUT cooling down so
    // the terminal member stays resolvable for the reschedule-retry path.
    // The existing error/auto-reschedule path already ran inside _executeSession.
    throw error;
  }

  // There IS a next healthy, attemptable member — cool down the failed one so
  // new session starts are steered past it (F21), then emit the failover event.
  markUnhealthy(member.providerId, member.modelId);
  emitTierFailoverEvent(error, { sessionId, member, tierRef, tierName, nextMember });
}

/**
 * Emit the tier-failover side effects (WebSocket broadcast + agent-call log entry)
 * once a member has been confirmed as an eligible failure with a healthy successor.
 * Both the WebSocket payload and the agent-log entry are built from the SAME
 * `nextMember` value computed once by `handleTierMemberFailure` (Fix 5) — they
 * cannot disagree.
 *
 * @param {Error} error
 * @param {{ sessionId: string, member: Object, tierRef: string, tierName: string, nextMember: Object }} ctx
 */
function emitTierFailoverEvent(error, { sessionId, member, tierRef, tierName, nextMember }) {
  console.log(
    `[SessionManager] Tier failover: member ${member.modelId} (provider ${member.providerId}) failed; marking unhealthy and advancing to ${nextMember.modelId}`
  );

  // Emit failover event via WebSocket — only fires when we're actually advancing.
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.TIER_FAILOVER, {
    tierRef,
    tierName,
    fromModel: member.modelId,
    fromProviderId: member.providerId,
    toModel: nextMember.modelId,
    toProviderId: nextMember.providerId,
    reason: error.message,
    timestamp: Date.now(),
  });

  // Write the failover event to the agent log stream (F26)
  try {
    agentCallLogger._logFailoverEvent(sessionId, {
      fromModel: member.modelId,
      fromProviderId: member.providerId,
      toModel: nextMember.modelId,
      toProviderId: nextMember.providerId,
      tierRef,
      tierName,
      reason: error.message,
      // Derive the source member's agent type from its OWN providerId (Fix 1 /
      // Issue 4) instead of assuming 'claude-code' or looking it up by modelId
      // alone — a failover away from a Codex/Gemini member (possibly sharing a
      // modelId with an Anthropic member) must log its own agent type.
      agentType: resolveAgentTypeFromModel(member.modelId, member.providerId),
    });
  } catch (_logErr) {
    // Non-fatal — failover proceeds even if logging fails
  }
}

/**
 * Snapshot the member that successfully ran (Fix 5 / Fix 3).
 *
 * Snapshot when EITHER:
 *   a) The session completed normally (status is not 'scheduled'), OR
 *   b) The session ran (produced ≥1 assistant message) and was then
 *      proactively rescheduled — in that case status is 'scheduled' but a
 *      turn genuinely completed, so the snapshot should be recorded for the
 *      badge/continue path (Fix 3).
 *
 * Do NOT snapshot when the session was rescheduled without ever producing
 * output (i.e. failed at start and rescheduled by _executeSession) — that
 * would record the failing member as the "active" model.
 *
 * @param {string} sessionId
 * @param {string} tierRef
 * @param {{ modelId: string, providerId: string }} member
 */
function snapshotSuccessfulMember(sessionId, tierRef, member) {
  const currentSession = sessions.getById(sessionId);
  const wasRescheduled = currentSession?.status === 'scheduled';
  const didRun = !sessionHasNoAssistantMessages(sessionId);
  if (!wasRescheduled || didRun) {
    sessions.update(sessionId, {
      model: tierRef,
      resolvedModel: member.modelId,
      resolvedProviderId: member.providerId,
    });
  }
}

/**
 * Tier failover loop for `runSessionCore`.
 * Iterates healthy tier members in position order, retrying on eligible start failures.
 */
export async function runSessionWithTierFailover(
  sessionId,
  promptWithAttachments,
  workingDirectory,
  { systemPrompt, activeConversation, controller, callbacks, tierRef }
) {
  const tierId = parseTierRef(tierRef);
  if (!tierId) {
    throw new Error(`Invalid tier ref: ${tierRef}`);
  }

  const members = getTierMembersResolved(tierId);
  const tierName = _getTierName(tierId);

  if (members.length === 0) {
    throw new Error(
      `No members configured for tier "${tierName}" — cannot start session`
    );
  }

  // Ensure the model stored on the session is the tier ref
  sessions.update(sessionId, { model: tierRef });

  let attemptsUsed = 0;
  const maxAttempts = Math.min(members.length, DEFAULT_MAX_FAILOVER_ATTEMPTS);

  for (const member of members) {
    // Skip members already in cooldown
    if (isUnhealthy(member.providerId, member.modelId)) continue;

    // Hard cap on failover attempts (Fix 7)
    if (attemptsUsed >= maxAttempts) break;
    attemptsUsed++;

    const tierContext = {
      currentMemberId: member.modelId,
      currentMemberProviderId: member.providerId,
      // Fix 5: carry the same cap-aware bookkeeping the loop uses to decide
      // whether to advance, so the suppression check in sessionErrors.js
      // (isTierFailoverEligibleError) can use the identical resolver and can
      // never disagree with this loop about whether a next member will
      // actually be attempted.
      attemptsUsed,
      maxAttempts,
    };

    // _executeSession's finally block removes sessionId from activeSessions after
    // every attempt (success or failure). Re-register it before each retry so
    // concurrency guards (e.g. continueSessionCore's "already processing" check)
    // and abort-signal plumbing stay consistent across the failover loop.
    activeSessions.set(sessionId, { controller });

    try {
      await attemptRunWithModel(sessionId, promptWithAttachments, workingDirectory, {
        systemPrompt,
        activeConversation,
        controller,
        callbacks,
        tierContext,
      });

      snapshotSuccessfulMember(sessionId, tierRef, member);
      return; // done
    } catch (error) {
      // Advances to the next member (loop continue) or rethrows on terminal errors.
      handleTierMemberFailure(error, { sessionId, member, tierRef, tierName, attemptsUsed, maxAttempts });
    }
  }

  // All members were in cooldown or exhausted
  throw new Error(
    `All tier members exhausted for tier "${tierName}" — no healthy member could start the session`
  );
}

function _getTierName(tierId) {
  try {
    const tier = modelTiers.getByIdWithMembers(tierId);
    return tier?.name || tierId;
  } catch {
    return tierId;
  }
}

/**
 * Check whether a tier ref currently resolves to at least one attemptable
 * member (tier exists, has ≥1 member whose provider/model is still enabled).
 * Used at session start to distinguish a resolvable tier (proceed to
 * {@link runSessionWithTierFailover}) from a stale/emptied/deleted tier ref
 * (Fix 6 — degrade safely instead of failing outright).
 * @param {string} tierRef
 * @returns {boolean}
 */
export function hasResolvableTierMembers(tierRef) {
  const tierId = parseTierRef(tierRef);
  if (!tierId) return false;
  return getTierMembersResolved(tierId).length > 0;
}

/**
 * Fix 6 — safe degradation for a tier ref that no longer resolves to any
 * member (the tier was deleted, emptied, or every member's provider/model was
 * removed) at new/scheduled session start.
 *
 * Falls back to:
 *   1. The session's last-resolved concrete snapshot (`resolvedModel` /
 *      `resolvedProviderId`), when present — a session that has run before on
 *      this tier keeps using the model it last succeeded on.
 *   2. Otherwise, the same server default used elsewhere (a null model /
 *      provider, i.e. whatever the agent adapter's own SDK default resolves
 *      to — there is always a resolvable Anthropic default, so this branch
 *      never itself fails to "resolve").
 *
 * Persists the concrete fallback onto the session — clearing the tier
 * binding entirely, since there is nothing left to fail over to — so future
 * turns are unambiguous, and surfaces a visible notice + log entry naming the
 * stale tier ref and the concrete fallback that was used.
 *
 * @param {string} sessionId
 * @param {Object} session
 * @param {string} staleTierRef
 * @returns {{ model: string|null, session: Object }}
 */
export function applyStaleTierFallback(sessionId, session, staleTierRef) {
  const hasSnapshot = Boolean(session.resolvedModel);
  const fallbackModel = hasSnapshot ? session.resolvedModel : null;
  const fallbackProviderId = hasSnapshot ? session.resolvedProviderId || null : null;
  const tierName = _getTierName(parseTierRef(staleTierRef) || staleTierRef);

  sessions.update(sessionId, {
    model: fallbackModel,
    providerId: fallbackProviderId,
    resolvedModel: null,
    resolvedProviderId: null,
  });
  const updatedSession = sessions.getById(sessionId);

  const reason = `Model tier "${tierName}" is no longer resolvable (deleted or has no enabled members)`;
  console.warn(
    `[SessionManager] ${reason} — falling back to ${fallbackModel || 'the server default'} model for session ${sessionId}`
  );

  broadcastToSession(sessionId, WS_MESSAGE_TYPES.TIER_FAILOVER, {
    tierRef: staleTierRef,
    tierName,
    fromModel: staleTierRef,
    fromProviderId: null,
    toModel: fallbackModel,
    toProviderId: fallbackProviderId,
    reason,
    timestamp: Date.now(),
  });

  try {
    agentCallLogger._logFailoverEvent(sessionId, {
      fromModel: staleTierRef,
      fromProviderId: null,
      toModel: fallbackModel,
      toProviderId: fallbackProviderId,
      tierRef: staleTierRef,
      tierName,
      reason,
      agentType: updatedSession.agentType || 'claude-code',
    });
  } catch (_logErr) {
    // Non-fatal — the fallback proceeds even if logging fails
  }

  return { model: fallbackModel, session: updatedSession };
}
