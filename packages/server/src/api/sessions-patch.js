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
  checkCrossKindSwitch,
  sessionHasNoAssistantMessages,
  deriveAgentTypeUpdate,
  resolveModelForAgentKind,
} from '../services/sessionAgentGuard.js';

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
function applyModelDriftGuard(session, sessionId, updateData) {
  const currentChanged = Object.hasOwn(updateData, 'model') || Object.hasOwn(updateData, 'providerId');
  const pendingChanged = Object.hasOwn(updateData, 'pendingModel') || Object.hasOwn(updateData, 'pendingProviderId');
  if (!currentChanged && !pendingChanged) return { driftError: null, agentTypeUpdate: {} };
  if (sessionHasNoAssistantMessages(sessionId)) {
    // Drafts stay mutable: re-derive the agent kind from the CURRENT binding
    // only. A pending selection is a future dispatch, not the present
    // identity — it must never redefine the draft's agent kind.
    const agentTypeUpdate = currentChanged
      ? deriveAgentTypeUpdate(session, sessionId, updateData.model, { providerId: updateData.providerId })
      : {};
    return { driftError: null, agentTypeUpdate };
  }
  if (currentChanged) {
    const driftError = checkCrossKindSwitch(session, updateData.model, updateData.providerId);
    if (driftError) return { driftError, agentTypeUpdate: {} };
  }
  if (pendingChanged) {
    const driftError = checkCrossKindSwitch(session, updateData.pendingModel, updateData.pendingProviderId);
    if (driftError) return { driftError, agentTypeUpdate: {} };
  }
  return { driftError: null, agentTypeUpdate: {} };
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
    const model = Object.hasOwn(updateData, modelField) ? updateData[modelField] : currentModel;
    const providerId = Object.hasOwn(updateData, providerField) ? updateData[providerField] : currentProvider;
    const normalized = validateModelAndProvider(model, providerId, { fieldName: modelField });
    if (normalized.error) return { error: normalized.error };
    updateData[modelField] = normalized.model;
    updateData[providerField] = normalized.providerId;
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
function applyGuardedSessionUpdate(sessionRow, sessionId, updateData) {
  const { driftError, agentTypeUpdate } = applyModelDriftGuard(sessionRow, sessionId, updateData);
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
  return { updated };
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

  const guarded = applyGuardedSessionUpdate(req.session_, req.params.id, updateData);
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
