import { sessions, modelTiers } from '../database.js';
import { reconcileAgentTypeForRun, sessionHasNoAssistantMessages } from './sessionAgentGuard.js';
import { parseTierRef, WS_MESSAGE_TYPES } from '@circuschief/shared';
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
 */
function handleTierMemberFailure(error, { sessionId, member, tierRef, tierName }) {
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

  console.log(
    `[SessionManager] Tier failover: member ${member.modelId} (provider ${member.providerId}) failed; marking unhealthy and advancing`
  );

  // Emit failover event via WebSocket — only fires when we're actually advancing.
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.TIER_FAILOVER, {
    tierRef,
    tierName,
    fromModel: member.modelId,
    fromProviderId: member.providerId,
    reason: error.message,
    timestamp: Date.now(),
  });
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

  for (const member of members) {
    // Skip members already in cooldown
    if (isUnhealthy(member.providerId, member.modelId)) continue;

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

      // Success — snapshot the resolved model (ID2) and restore tier ref as model
      sessions.update(sessionId, {
        model: tierRef,
        resolvedModel: member.modelId,
        resolvedProviderId: member.providerId,
      });
      return; // done
    } catch (error) {
      // Advances to the next member (loop continue) or rethrows on terminal errors.
      handleTierMemberFailure(error, { sessionId, member, tierRef, tierName });
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
