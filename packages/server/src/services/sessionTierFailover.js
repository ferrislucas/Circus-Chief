import { sessions, modelTiers } from '../database.js';
import { reconcileAgentTypeForRun, sessionHasNoAssistantMessages } from './sessionAgentGuard.js';
import { parseTierRef, WS_MESSAGE_TYPES, DEFAULT_MAX_FAILOVER_ATTEMPTS } from '@circuschief/shared';
import {
  getTierMembersResolved,
  markUnhealthy,
  hasNextHealthyMember,
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

  // Reconcile agent type for this concrete model (supports cross-provider switches)
  const reconciledSession = reconcileAgentTypeForRun(
    currentSession,
    sessionId,
    tierContext ? tierContext.currentMemberId : null
  );

  const agentType = reconciledSession.agentType || 'claude-code';
  const agent = createAgentForSession(agentType);

  const { effectiveModel, sessionEnv, commitAttributionOverride } =
    await resolveInitialSessionModelEnv(reconciledSession, tierContext ? tierContext.currentMemberId : null);

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
 * @param {{ sessionId: string, member: Object, tierRef: string, tierName: string, members: Array }} ctx
 */
function handleTierMemberFailure(error, { sessionId, member, tierRef, tierName, members }) {
  const errMsg = error.message?.toLowerCase() || '';
  // Use the tighter failover-specific matcher (Fix 4) to avoid spurious failover
  // on non-quota errors (e.g. "Unexpected token in JSON" contains "token").
  const isEligible = matchesStartFailoverEligibleError(errMsg);
  const isPreConversation = sessionHasNoAssistantMessages(sessionId);

  // Non-eligible error (auth, bad request, abort) or mid-conversation — don't advance
  if (!isEligible || !isPreConversation) {
    throw error;
  }

  // Check whether there is another healthy member to steer toward (Fix 2).
  // Cooldown is only useful when it can redirect new sessions to a healthy
  // alternative.  Cooling a terminal member (no successor) creates a dead-end:
  // resolveActiveModel returns null, blocking both new starts and the
  // reschedule-retry path until the cooldown expires.
  const hasNext = hasNextHealthyMember(tierRef, {
    excludeModelId: member.modelId,
    excludeProviderId: member.providerId,
  });

  if (!hasNext) {
    // All members exhausted — rethrow WITHOUT cooling down so the terminal
    // member stays resolvable for the reschedule-retry path (Fix 1 + Fix 2).
    // The existing error/auto-reschedule path already ran inside _executeSession.
    throw error;
  }

  // There IS a next healthy member — cool down the failed one so new session
  // starts are steered past it (F21), then emit the failover event.
  markUnhealthy(member.providerId, member.modelId);
  emitTierFailoverEvent(error, { sessionId, member, tierRef, tierName, members });
}

/**
 * Emit the tier-failover side effects (WebSocket broadcast + agent-call log entry)
 * once a member has been confirmed as an eligible failure with a healthy successor.
 *
 * @param {Error} error
 * @param {{ sessionId: string, member: Object, tierRef: string, tierName: string, members: Array }} ctx
 */
function emitTierFailoverEvent(error, { sessionId, member, tierRef, tierName, members }) {
  // Identify the next healthy member for the payload (Fix 5)
  const nextMember = members
    ? members.find(
        (m) =>
          !(m.modelId === member.modelId && m.providerId === member.providerId) &&
          !isUnhealthy(m.providerId, m.modelId)
      )
    : null;

  console.log(
    `[SessionManager] Tier failover: member ${member.modelId} (provider ${member.providerId}) failed; marking unhealthy and advancing to ${nextMember?.modelId || 'next member'}`
  );

  // Emit failover event via WebSocket — only fires when we're actually advancing (Fix 2/Fix 5).
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.TIER_FAILOVER, {
    tierRef,
    tierName,
    fromModel: member.modelId,
    fromProviderId: member.providerId,
    toModel: nextMember?.modelId || null,
    toProviderId: nextMember?.providerId || null,
    reason: error.message,
    timestamp: Date.now(),
  });

  // Write the failover event to the agent log stream (Fix 4 — F26)
  try {
    agentCallLogger._logFailoverEvent(sessionId, {
      fromModel: member.modelId,
      fromProviderId: member.providerId,
      toModel: nextMember?.modelId || null,
      toProviderId: nextMember?.providerId || null,
      tierRef,
      tierName,
      reason: error.message,
      // Issue 4: derive the source member's agent type instead of assuming
      // 'claude-code' — a failover away from a Codex/Gemini member must log
      // its own agent type.
      agentType: resolveAgentTypeFromModel(member.modelId),
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
      handleTierMemberFailure(error, { sessionId, member, tierRef, tierName, members });
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
