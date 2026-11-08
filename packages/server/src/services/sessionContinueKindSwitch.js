import { sessions } from '../database.js';
import {
  buildAdvanceAwareAgentTypeUpdate,
  checkCrossKindSwitch,
  clearResumeChainOnKindSwitch,
  createCrossKindDispatchError,
  deriveCrossKindAgentTypeUpdate,
  isCrossKindBlockLiftable,
  pendingModelClearanceForKindSwitch,
} from './sessionAgentGuard.js';

/**
 * Agent-kind decision for one continuation resolution.
 *
 * An explicit off-binding selection whose kind differs is either applied or
 * rejected before the caller writes the row. Interactive in-scope concrete
 * switches retarget the agent the way PATCH does. Every other kind mismatch
 * throws, so a Codex row cannot be saved with a Claude model id. Same-binding
 * requests, including a null model, keep the tier-advance path.
 *
 * `sessionTurnSetup.prepareContinueTurn` enforces the same interactive gate
 * on its own resolver. This is the decision the live continue path runs.
 *
 * @param {Object} args
 * @param {Object} args.session
 * @param {string} args.sessionId
 * @param {string|null} args.requestedModel
 * @param {string|null} args.requestedProviderId
 * @param {boolean} args.interactive
 * @param {boolean} args.sameBinding
 * @param {string|null} args.effectiveModel
 * @param {string|null} args.providerIdHint
 * @param {Object} args.persist
 * @returns {Object} Partial session update (`agentType` and maybe `pendingModel`).
 */
export function resolveContinueAgentTypeUpdate({
  session,
  sessionId,
  requestedModel,
  requestedProviderId,
  interactive,
  sameBinding,
  effectiveModel,
  providerIdHint,
  persist,
}) {
  const block = explicitKindBlock(session, requestedModel, requestedProviderId, sameBinding);
  if (!block) {
    return buildAdvanceAwareAgentTypeUpdate({ session, sessionId, effectiveModel, providerIdHint, persist });
  }
  if (!(interactive && isCrossKindBlockLiftable(session, requestedModel, requestedProviderId, block))) {
    throw createCrossKindDispatchError(block);
  }
  const suppliedProviderId = requestedProviderId == null ? undefined : requestedProviderId;
  const update = deriveCrossKindAgentTypeUpdate(session, requestedModel, suppliedProviderId);
  return { ...update, ...pendingModelClearanceForKindSwitch(session.pendingModel, update.agentType) };
}

/**
 * Persist a continuation resolution, then drop the native resume chain when
 * the update actually flips `agentType`. The chain clear runs only after the
 * row write so a rejected kind switch leaves the resume id in place.
 *
 * @param {Object} args
 * @param {Object} args.session - Pre-update session row.
 * @param {string} args.sessionId
 * @param {Object} args.persist
 * @param {Object} args.agentTypeUpdate
 * @param {Object} args.lastExecutedUpdate
 * @returns {Object} The session row after the write.
 */
export function applyContinueResolution({
  session,
  sessionId,
  persist,
  agentTypeUpdate,
  lastExecutedUpdate,
}) {
  const updatePayload = { ...persist, ...agentTypeUpdate, ...lastExecutedUpdate };
  let updatedSession = session;
  if (Object.keys(updatePayload).length > 0) {
    sessions.update(sessionId, updatePayload);
    updatedSession = sessions.getById(sessionId);
  }
  clearResumeChainOnKindSwitch(session, sessionId, agentTypeUpdate);
  return updatedSession;
}

function explicitKindBlock(session, requestedModel, requestedProviderId, sameBinding) {
  if (requestedModel == null || sameBinding) return null;
  return checkCrossKindSwitch(session, requestedModel, requestedProviderId);
}
