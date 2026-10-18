import { Router } from 'express';
import { sessions, sessionSummaries } from '../database.js';
import { buildUpdateData } from './sessions-patch-validation.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES, isTierRef } from '@circuschief/shared';
import * as summaryService from '../services/summaryService.js';
import { setSessionNameFromPr } from '../services/prUrlService.js';
import { checkSessionCiStatusNow } from '../services/prStatusService.js';
import { broadcastSummaryUpdate } from '../services/summaryBroadcast.js';
import { requireSession } from '../middleware/sessionLookup.js';
import { validateModelAndProvider } from './model-validation.js';
import { withActiveLaneRunOwnership } from '../services/workflowSessionService.js';
import { clearedPendingSchedule } from '../services/pendingSchedule.js';
import {
  agentLabel,
  checkCrossKindSwitch,
  sessionHasNoAssistantMessages,
  deriveAgentTypeUpdate,
  resolveModelForAgentKind,
  deriveCrossKindAgentTypeUpdate,
  isCrossKindBlockLiftable,
  pendingModelClearanceForKindSwitch,
  clearResumeChainOnKindSwitch,
} from '../services/sessionAgentGuard.js';
import { resolveAgentTypeFromModel } from '../services/sessionProvider.js';

const router = Router();


/**
 * Broadcast session update to both session and project subscribers.
 * NOTE: duplicate of summaryBroadcast.broadcastSessionUpdate; consolidate in a follow-up.
 * @param {string} sessionId
 * @param {string} projectId
 * @param {object} updated - The updated session object
 * @param {object} updateData - The fields that were updated
 */
function broadcastSessionUpdate(sessionId, projectId, updated, updateData) {
  // Broadcast status update if status changed
  if (updateData.status) {
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_STATUS, {
      sessionId,
      status: updateData.status,
    });
  }

  // Broadcast session update to session subscribers (e.g. detail view)
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    sessionId,
    session: updated,
  });

  // Broadcast session update to project subscribers for real-time list updates
  broadcastToProject(projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId,
    sessionId,
    session: updated,
  });
}

/**
 * Reset all PR state fields in the session summary when the PR URL changes or is cleared.
 * This ensures stale PR state (e.g., "merged") doesn't persist for a different PR
 * and doesn't block summary regeneration.
 * @param {string} sessionId
 * @param {string|null} projectId - For broadcasting to project subscribers
 */
function resetPrStateForSession(sessionId, projectId) {
  const existingSummary = sessionSummaries.getBySessionId(sessionId);
  if (!existingSummary) return;

  sessionSummaries.upsert(sessionId, {
    prState: null,
    prMerged: false,
    hasMergeConflicts: false,
    ciStatus: null,
    ciFailures: [],
  });

  // Broadcast the reset to both session and project subscribers
  const updatedSummary = sessionSummaries.getBySessionId(sessionId);
  broadcastSummaryUpdate(sessionId, projectId, updatedSummary);
}

/**
 * Reject a PATCH that supplies `model` and `pendingModel` resolving to
 * different agent kinds: no single `agentType` can agree with both persisted
 * fields, and the follow-up turn would run adapter-kind ≠ model-kind.
 * Skipped unless both fields are non-empty strings (anything else cannot
 * resolve to an authoritative kind).
 * @param {Object} updateData
 * @returns {{ error: string, message: string }|null} 400-body on block, or null to allow.
 */
function checkDivergentModelKinds(updateData) {
  const { model, pendingModel } = updateData;
  if (typeof model !== 'string' || model === '' || typeof pendingModel !== 'string' || pendingModel === '') {
    return null;
  }
  const modelKind = resolveAgentTypeFromModel(model);
  const pendingKind = resolveAgentTypeFromModel(pendingModel);
  if (modelKind === pendingKind) return null;
  return {
    error: 'DIVERGENT_MODEL_KINDS',
    message: `Cannot set model and pendingModel to different agent kinds (${agentLabel(modelKind)} → ${agentLabel(pendingKind)})`,
  };
}

/**
 * Reject a pendingModel-only change that crosses agent kinds on a started
 * session (has prior assistant turns). Persisting it would strand
 * model/agentType on different kinds — the next plain turn runs the adapter
 * for session.agentType with env rebuilt from session.model (FR8). Skipped
 * unless pendingModel is the only model field supplied as a non-empty
 * string (anything else cannot strand the row), and skipped on drafts (the
 * draft re-derivation path below owns those). Same-kind pendingModel-only
 * changes pass through (checkCrossKindSwitch returns null for them).
 * @param {Object} session
 * @param {string} sessionId
 * @param {Object} updateData
 * @returns {{ error: string, message: string }|null} 400-body on block, or null to allow.
 */
function checkPendingModelOnlyKindSwitch(session, sessionId, updateData) {
  if (sessionHasNoAssistantMessages(sessionId)) return null;
  // Only a non-empty string `model` counts as "model supplied": an explicit
  // null/'' clear carries no kind, so a cross-kind `pendingModel` alongside
  // it is still a pendingModel-only kind switch and must be rejected.
  if (typeof updateData.model === 'string' && updateData.model !== '') return null;
  const { pendingModel } = updateData;
  if (typeof pendingModel !== 'string' || pendingModel === '') return null;
  return checkCrossKindSwitch(session, pendingModel);
}

/**
 * First model-kind invariant gate for a pending update: the both-fields
 * divergent-pair rejection, then the pendingModel-only cross-kind rejection
 * (Option A — 4xx with no mutation; the UI always sends `model` together
 * with `pendingModel`, so the latter only affects direct API callers).
 */
function checkModelKindInvariant(session, sessionId, updateData) {
  return checkDivergentModelKinds(updateData)
    ?? checkPendingModelOnlyKindSwitch(session, sessionId, updateData);
}

/**
 * Apply the cross-kind agent/model drift guard to a pending update.
 * Each normalized (model, providerId) pair is validated with its OWN
 * provider — never a lookup-preferred owner, and never one pair's provider
 * standing in for the other's. Current and pending changes are validated
 * independently so neither can hide the other; a rejection leaves the entire
 * record unchanged (validation runs before any persistence).
 * Returns the error payload (for started sessions) or the agentType update (for drafts).
 * Does NOT mutate updateData — caller merges the returned agentTypeUpdate.
 * @param {Object} session
 * @param {string} sessionId
 * @param {Object} updateData - Normalized pairs (see normalizeSessionSelectionPairs).
 * @returns {{ driftError: Object|null, agentTypeUpdate: Object }}
 */
function applyModelDriftGuard(session, sessionId, updateData, suppliedProviderId) {
  const driftError = checkModelKindInvariant(session, sessionId, updateData);
  if (driftError) return { driftError, agentTypeUpdate: {} };
  const currentChanged = Object.hasOwn(updateData, 'model') || Object.hasOwn(updateData, 'providerId');
  const pendingChanged = Object.hasOwn(updateData, 'pendingModel') || Object.hasOwn(updateData, 'pendingProviderId');
  if (!currentChanged && !pendingChanged) return { driftError: null, agentTypeUpdate: {} };
  const newModel = updateData.pendingModel ?? updateData.model ?? null;
  if (sessionHasNoAssistantMessages(sessionId)) {
    // Drafts stay mutable: re-derive the agent kind from the CURRENT binding
    // only. A pending selection is a future dispatch, not the present
    // identity — it must never redefine the draft's agent kind.
    const agentTypeUpdate = currentChanged
      ? deriveAgentTypeUpdate(session, sessionId, updateData.model, { providerId: updateData.providerId })
      : {};
    return { driftError: null, agentTypeUpdate: withStalePendingModelClearance(session, updateData, agentTypeUpdate) };
  }
  // Started session: validate each changed pair with its OWN provider —
  // never a lookup-preferred owner, and never one pair's provider standing
  // in for the other's — so neither change can hide the other. In-scope
  // MODEL switches proceed (FR1/FR2); gemini, provider-only rebinds,
  // tier-kind changes and dead tiers stay rejected here.
  const pairError = checkStartedSelectionPairs(session, updateData);
  if (pairError) return { driftError: pairError, agentTypeUpdate: {} };
  if (!checkCrossKindSwitch(session, newModel)) {
    return { driftError: null, agentTypeUpdate: {} };
  }
  // Allowed in-place switch: persist the re-derived kind (+ auto providerId
  // when the caller didn't supply one explicitly).
  return {
    driftError: null,
    agentTypeUpdate: withStalePendingModelClearance(
      session, updateData, deriveCrossKindAgentTypeUpdate(session, newModel, suppliedProviderId),
    ),
  };
}

/**
 * Validate each changed (model, providerId) pair of a started session with
 * its OWN provider. Returns the first unliftable block payload, or null when
 * every changed pair either stays in-kind or is an allowed in-scope MODEL
 * switch (lifted via isCrossKindBlockLiftable).
 * @param {Object} session - Current session row.
 * @param {Object} updateData - Normalized pairs.
 * @returns {{ error: string }|null} Block payload, or null.
 */
function checkStartedSelectionPairs(session, updateData) {
  for (const [modelField, providerField] of [['model', 'providerId'], ['pendingModel', 'pendingProviderId']]) {
    if (!Object.hasOwn(updateData, modelField) && !Object.hasOwn(updateData, providerField)) continue;
    const fieldError = checkCrossKindSwitch(session, updateData[modelField], updateData[providerField]);
    if (fieldError && !isCrossKindBlockLiftable(session, updateData[modelField], updateData[providerField], fieldError)) {
      return fieldError;
    }
  }
  return null;
}

/**
 * Merge a stale-`pendingModel` clearance into an applied kind-change update.
 * Only acts when the update actually flips `agentType`: the effective
 * override (explicitly supplied, else the stored row value) is dropped when
 * it resolves to a different kind than the new one, so a later scheduled
 * fire cannot strand the row or silently switch it back. A same-new-kind
 * override stays coherent and is kept; same-kind switches (no `agentType`
 * in the update) are untouched.
 * @param {Object} session - The session row before the update.
 * @param {Object} updateData - The pending PATCH fields.
 * @param {Object} agentTypeUpdate - The kind-change update being applied.
 * @returns {Object} The update with clearance merged in (possibly unchanged).
 */
function withStalePendingModelClearance(session, updateData, agentTypeUpdate) {
  if (!agentTypeUpdate.agentType) return agentTypeUpdate;
  const effectivePendingModel = updateData.pendingModel ?? session.pendingModel ?? null;
  return {
    ...agentTypeUpdate,
    ...pendingModelClearanceForKindSwitch(effectivePendingModel, agentTypeUpdate.agentType),
  };
}

/**
 * Handle PR URL side effects: reset stale PR state on URL change, propagate to
 * parent, fire-and-forget name update, and trigger CI check.
 * @param {Object} session - Current session object (before update)
 * @param {string} sessionId
 * @param {Object} updateData
 */
function handlePrUrlSideEffects(session, sessionId, updateData) {
  const previousPrUrl = session.prUrl;
  const prUrlProvided = Object.prototype.hasOwnProperty.call(updateData, 'prUrl');
  const prUrlChanged = prUrlProvided && previousPrUrl && previousPrUrl !== updateData.prUrl;
  if (prUrlChanged) {
    resetPrStateForSession(sessionId, session.projectId);
  }
  if (!updateData.prUrl) return;
  summaryService.propagatePrUrlToParent(sessionId, updateData.prUrl);
  setSessionNameFromPr(sessionId, updateData.prUrl).catch(err => {
    console.error(`[Sessions API] Failed to set session name from PR:`, err);
  });
  checkSessionCiStatusNow(sessionId).catch(err => {
    console.error(`[Sessions API] Failed to check PR status after URL change:`, err);
  });
}

function normalizeSessionSelectionPairs(input, session) {
  const updateData = { ...input };
  const pairs = [
    ['model', 'providerId', session.model, session.providerId],
    ['pendingModel', 'pendingProviderId', session.pendingModel, session.pendingProviderId],
  ];
  for (const [modelField, providerField, currentModel, currentProvider] of pairs) {
    if (!Object.hasOwn(updateData, modelField) && !Object.hasOwn(updateData, providerField)) continue;
    const modelSupplied = Object.hasOwn(updateData, modelField);
    const providerSupplied = Object.hasOwn(updateData, providerField);
    const model = modelSupplied ? updateData[modelField] : currentModel;
    // A supplied model without a provider must NOT inherit the current
    // provider for validation: the pair may be switching kinds (FR1/FR2),
    // and ownership against the stale provider would wrongly reject it.
    // Leaving the provider absent lets validation check the model alone and
    // the drift guard re-derive the provider on a real switch; persistence
    // skips absent fields so the stored provider is preserved otherwise.
    // A tier ref still clears the provider (no single owning provider).
    const providerId = providerSupplied ? updateData[providerField] : (modelSupplied ? undefined : currentProvider);
    const normalized = validateModelAndProvider(model, providerId, { fieldName: modelField });
    if (normalized.error) return { error: normalized.error };
    updateData[modelField] = normalized.model;
    if (providerSupplied || isTierRef(normalized.model)) {
      updateData[providerField] = normalized.providerId;
    }
  }
  return { updateData };
}

/**
 * Reconcile the tier snapshot (`resolvedModel`/`resolvedProviderId`) with a
 * normalized current-binding change, merged into the SAME atomic repository
 * update as the binding itself.
 *
 * - Concrete model or cleared selection: a concrete binding owns no snapshot,
 *   so both fields are cleared.
 * - Unchanged tier binding with a snapshot: preserved untouched.
 * - Newly selected tier: the dispatch candidate is resolved NOW (the step-2
 *   concrete-pair contract) and committed as the snapshot. An unresolvable
 *   new tier on a draft stores a cleared snapshot; established rows never
 *   reach this branch for such tiers because the drift guard rejects them.
 * - Untouched binding or pending-only changes: no snapshot fields returned.
 * @param {Object} session - Pre-update session row.
 * @param {Object} updateData - Normalized update (see normalizeSessionSelectionPairs).
 * @returns {Object} Snapshot fields to merge into the update, or {}.
 */
function reconcileBindingSnapshot(session, updateData) {
  if (!Object.hasOwn(updateData, 'model') && !Object.hasOwn(updateData, 'providerId')) {
    return {};
  }
  const newModel = updateData.model;
  if (!isTierRef(newModel)) {
    return { resolvedModel: null, resolvedProviderId: null };
  }
  if (newModel === session.model && session.resolvedModel) {
    return {};
  }
  const candidate = resolveModelForAgentKind(newModel, null, session);
  if (candidate.unresolved || !candidate.modelId) {
    return { resolvedModel: null, resolvedProviderId: null };
  }
  return { resolvedModel: candidate.modelId, resolvedProviderId: candidate.providerIdHint };
}

function applyImplicitScheduledStatus(updateData, requestStatus, sessionStatus) {
  if (updateData.scheduledAt != null && requestStatus === undefined && !['running', 'starting'].includes(sessionStatus)) {
    return { ...updateData, status: 'scheduled' };
  }
  return updateData;
}

function canEditLiveUserSchedule(session) {
  return session.status === 'scheduled' && session.pendingInteractive;
}

function normalizeScheduleCancellation(updateData) {
  if (updateData.scheduledAt === null) {
    Object.assign(updateData, clearedPendingSchedule, { status: 'waiting' });
  }
}

// PATCH /api/sessions/:id - Update session settings
// Run the drift guard, snapshot reconcile, and lane-ownership-gated update as
// one unit. Returns { updated } or { driftError } / { updated: null } for the
// handler to map to 400 / 409.
function applyGuardedSessionUpdate(sessionRow, sessionId, updateData, suppliedProviderId) {
  const { driftError, agentTypeUpdate } = applyModelDriftGuard(sessionRow, sessionId, updateData, suppliedProviderId);
  if (driftError) return { driftError };
  Object.assign(updateData, agentTypeUpdate);
  Object.assign(updateData, reconcileBindingSnapshot(sessionRow, updateData));

  const schedulingMutation = Object.hasOwn(updateData, 'scheduledAt') || updateData.status === 'scheduled';
  normalizeScheduleCancellation(updateData);
  const update = () => sessions.update(sessionId, updateData);
  const userScheduleLive = canEditLiveUserSchedule(sessionRow);
  const updated = schedulingMutation && sessionRow.laneRunId && !userScheduleLive
    ? withActiveLaneRunOwnership(sessionId, update)
    : update();
  return { updated, agentTypeUpdate };
}

// Validate and normalize the PATCH body into the update payload. Returns
// { updateData } or { error } for the handler to map to 400.
function buildValidatedPatchUpdate(req) {
  const built = buildUpdateData(req.body);
  if (built.error) return { error: built.error };
  if (Object.keys(built.updateData).length === 0) {
    return { error: 'No valid fields to update' };
  }

  const normalizedPairs = normalizeSessionSelectionPairs(built.updateData, req.session_);
  if (normalizedPairs.error) return { error: normalizedPairs.error };
  return {
    updateData: applyImplicitScheduledStatus(normalizedPairs.updateData, req.body.status, req.session_.status),
  };
}

router.patch('/:id', requireSession, (req, res) => {
  const validated = buildValidatedPatchUpdate(req);
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }
  const updateData = validated.updateData;

  const guarded = applyGuardedSessionUpdate(req.session_, req.params.id, updateData, req.body.providerId);
  if (guarded.driftError) {
    return res.status(400).json(guarded.driftError);
  }
  const updated = guarded.updated;
  if (!updated) {
    return res.status(409).json({
      error: 'Session no longer owns an active lane run',
      code: 'LANE_RUN_OWNERSHIP_LOST',
    });
  }
  clearResumeChainOnKindSwitch(req.session_, req.params.id, guarded.agentTypeUpdate);
  handlePrUrlSideEffects(req.session_, req.params.id, updateData);
  broadcastSessionUpdate(req.params.id, req.session_.projectId, updated, updateData);
  res.json(updated);
});

// PATCH /api/sessions/:id/pending-prompt - Update pending prompt for auto-save
router.patch('/:id/pending-prompt', requireSession, (req, res) => {
  const { pendingPrompt } = req.body;

  // Allow null or string (including empty string for clearing)
  if (pendingPrompt !== null && typeof pendingPrompt !== 'string') {
    return res.status(400).json({ error: 'pendingPrompt must be a string or null' });
  }

  const updated = sessions.update(req.params.id, { pendingPrompt });

  // Broadcast update to session subscribers
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    sessionId: req.params.id,
    session: updated,
  });

  // Broadcast to project subscribers for real-time updates
  broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: req.session_.projectId,
    sessionId: req.params.id,
    session: updated,
  });

  res.json(updated);
});

export default router;

// Export for testing (validation internals re-exported from their module).
export { broadcastSessionUpdate };
export { buildUpdateData, FIELD_DEFINITIONS } from './sessions-patch-validation.js';
