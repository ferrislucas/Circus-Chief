import { sessions, modelTiers } from '../database.js';
import { reconcileAgentTypeForRun, sessionHasNoAssistantMessages } from './sessionAgentGuard.js';
import { parseTierRef, WS_MESSAGE_TYPES, DEFAULT_MAX_FAILOVER_ATTEMPTS } from '@circuschief/shared';
import {
  getTierMembersResolved,
  markUnhealthy,
  hasNextHealthyMember,
  isUnhealthy,
} from './tierResolutionService.js';
import { matchesServiceError, matchesTokenLimitError } from './sessionErrors.js';
import { broadcastToSession } from '../websocket.js';
import { buildQueryParams } from './queryParamBuilder.js';
import { activeSessions } from './streamEventHandler.js';
import {
  createAgentForSession,
  resolveInitialSessionModelEnv,
  _executeSession,
} from './sessionExecution.js';
import { agentCallLogger } from './agentCallLogger.js';

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
  const isEligible = matchesServiceError(errMsg) || matchesTokenLimitError(errMsg);
  const isPreConversation = sessionHasNoAssistantMessages(sessionId);

  // Non-eligible error (auth, bad request, abort) or mid-conversation — don't advance
  if (!isEligible || !isPreConversation) {
    throw error;
  }

  // The member genuinely failed with an eligible error — cool it down regardless
  // of whether we can advance, so future session starts skip it too.
  markUnhealthy(member.providerId, member.modelId);

  // If there is no next healthy member, all members are exhausted — rethrow
  // without emitting a failover event (nothing to fail over to). The existing
  // error/auto-reschedule path already ran inside _executeSession for this case.
  const hasNext = hasNextHealthyMember(tierRef, {
    excludeModelId: member.modelId,
    excludeProviderId: member.providerId,
  });
  if (!hasNext) {
    throw error;
  }

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

  const now = Date.now();

  // Emit failover event via WebSocket — only fires when we're actually advancing (Fix 2/Fix 5).
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.TIER_FAILOVER, {
    tierRef,
    tierName,
    fromModel: member.modelId,
    fromProviderId: member.providerId,
    toModel: nextMember?.modelId || null,
    toProviderId: nextMember?.providerId || null,
    reason: error.message,
    timestamp: now,
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
      timestamp: now,
    });
  } catch (_logErr) {
    // Non-fatal — failover proceeds even if logging fails
  }

  // Return so the caller advances to the next member.
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

      // Success — but only snapshot if the session actually ran (not rescheduled).
      // A rescheduled session has status 'scheduled', not 'waiting'. Snapshotting
      // a member that was rescheduled (rather than completing successfully) would
      // incorrectly record the failing member as the "active" model. (Fix 5)
      const currentSession = sessions.getById(sessionId);
      const wasRescheduled = currentSession?.status === 'scheduled';
      if (!wasRescheduled) {
        sessions.update(sessionId, {
          model: tierRef,
          resolvedModel: member.modelId,
          resolvedProviderId: member.providerId,
        });
      }
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
