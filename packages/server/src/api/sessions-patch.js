import { Router } from 'express';
import { sessions, sessionTemplates, modelProviders, sessionSummaries } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as summaryService from '../services/summaryService.js';
import { setSessionNameFromPr } from '../services/prUrlService.js';
import { checkSessionCiStatusNow } from '../services/prStatusService.js';
import { broadcastSummaryUpdate } from '../services/summaryBroadcast.js';
import { requireSession } from '../middleware/sessionLookup.js';
import { validateModelId } from './model-validation.js';
import {
  checkCrossKindSwitch,
  sessionHasNoAssistantMessages,
  deriveAgentTypeUpdate,
} from '../services/sessionAgentGuard.js';

const router = Router();

/**
 * Validate effortLevel field
 * @param {*} value
 * @returns {{ error?: string, value: * }}
 */
function validateEffortLevel(value) {
  if (value === null) return { value };
  const valid = ['low', 'medium', 'high', 'max', 'auto'];
  if (!valid.includes(value)) {
    return { error: 'Invalid effort level. Must be one of: low, medium, high, max, auto' };
  }
  // Normalize 'auto' to null
  return { value: value === 'auto' ? null : value };
}

/**
 * Validate status field
 * @param {*} value
 * @returns {{ error?: string, value: * }}
 */
function validateStatus(value) {
  const valid = ['starting', 'running', 'waiting', 'error', 'stopped', 'scheduled'];
  if (!valid.includes(value)) {
    return { error: 'Invalid status' };
  }
  return { value };
}

/**
 * Validate mode field
 * @param {*} value
 * @returns {{ error?: string, value: * }}
 */
function validateMode(value) {
  const valid = ['plan', 'standard', 'yolo'];
  if (!valid.includes(value)) {
    return { error: 'Invalid mode. Must be one of: plan, standard, yolo' };
  }
  return { value };
}

/**
 * Validate nextTemplateId field
 * @param {*} value
 * @returns {{ error?: string, value: * }}
 */
function validateNextTemplateId(value) {
  if (value !== null) {
    const template = sessionTemplates.getById(value);
    if (!template) {
      return { error: 'Template not found' };
    }
  }
  return { value };
}

/**
 * Validate providerId field
 * @param {*} value
 * @returns {{ error?: string, value: * }}
 */
function validateProviderId(value) {
  if (value !== null) {
    const provider = modelProviders.getById(value);
    if (!provider) {
      return { error: 'Provider not found' };
    }
  }
  return { value };
}

/**
 * Validate and normalize scheduledAt field.
 * Accepts null (clear), numeric epoch milliseconds, or an ISO 8601 string.
 * Rejects anything that cannot be unambiguously converted to a finite integer.
 * @param {*} value
 * @returns {{ error?: string, value: * }}
 */
function validateScheduledAt(value) {
  if (value === null) return { value: null };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { error: 'Invalid scheduledAt' };
    return { value: Math.trunc(value) };
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return { error: 'Invalid scheduledAt' };
    return { value: parsed };
  }
  return { error: 'Invalid scheduledAt' };
}

/**
 * Validate prUrl field
 * @param {*} value
 * @returns {{ error?: string, value: * }}
 */
function validatePrUrl(value) {
  if (value === null || value === '') {
    return { value: null };
  }
  if (typeof value !== 'string') {
    return { error: 'prUrl must be a string or null' };
  }
  const prUrlPattern = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;
  if (!prUrlPattern.test(value)) {
    return { error: 'Invalid PR URL format. Must be a valid GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)' };
  }
  return { value };
}

/**
 * Field definitions for PATCH /:id with optional validators and transforms.
 * Each entry maps a request body field name to its processing config.
 */
const FIELD_DEFINITIONS = [
  { field: 'name' },
  { field: 'manuallyNamed', transform: Boolean },
  { field: 'thinkingEnabled', transform: Boolean },
  { field: 'effortLevel', validate: validateEffortLevel },
  { field: 'status', validate: validateStatus },
  { field: 'mode', validate: validateMode },
  { field: 'nextTemplateId', validate: validateNextTemplateId },
  { field: 'model', validate: validateModelId },
  { field: 'pendingModel', validate: (value) => validateModelId(value, { fieldName: 'pendingModel' }) },
  { field: 'autoSendPendingPrompt', transform: Boolean },
  { field: 'providerId', validate: validateProviderId },
  { field: 'prUrl', validate: validatePrUrl },
  // Git fields
  { field: 'gitWorktree' },
  // Scheduling fields
  { field: 'scheduledAt', validate: validateScheduledAt },
  { field: 'autoRescheduleEnabled', transform: Boolean },
  { field: 'rescheduleDelayMinutes', transform: (v) => parseInt(v, 10) },
  { field: 'rescheduleOnTokenLimit', transform: Boolean },
  { field: 'rescheduleOnServiceError', transform: Boolean },
  { field: 'maxRescheduleCount', transform: (v) => v ? parseInt(v, 10) : null },
  { field: 'maxTotalTokens', transform: (v) => v ? parseInt(v, 10) : null },
  { field: 'rescheduleCount', transform: (v) => parseInt(v, 10) },
  { field: 'rescheduleAtTokenCount', transform: (v) => v ? parseInt(v, 10) : null },
];

/**
 * Build update data object from request body using field definitions.
 * Returns { updateData, error } where error is a string if validation failed.
 * @param {object} body - The request body
 * @returns {{ updateData: object, error?: string }}
 */
function buildUpdateData(body) {
  const updateData = {};

  for (const { field, validate, transform } of FIELD_DEFINITIONS) {
    const value = body[field];
    if (value === undefined) continue;

    if (validate) {
      const result = validate(value);
      if (result.error) return { updateData: {}, error: result.error };
      updateData[field] = result.value;
    } else if (transform) {
      updateData[field] = transform(value);
    } else {
      updateData[field] = value;
    }
  }

  // Special case: auto-set manuallyNamed when name is updated (unless explicitly provided)
  if (body.name !== undefined && body.manuallyNamed === undefined) {
    updateData.manuallyNamed = true;
  }

  if (body.prUrl !== undefined) {
    updateData.prUrlAutoLinkDisabled = updateData.prUrl === null;
  }

  return { updateData };
}

/**
 * Broadcast session update to both session and project subscribers.
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
 * Returns the error payload (for started sessions) or the agentType update (for drafts).
 * Does NOT mutate updateData — caller merges the returned agentTypeUpdate.
 * @param {Object} session
 * @param {string} sessionId
 * @param {Object} updateData
 * @param {string|null} suppliedProviderId
 * @returns {{ driftError: Object|null, agentTypeUpdate: Object }}
 */
function applyModelDriftGuard(session, sessionId, updateData, suppliedProviderId) {
  const newModel = updateData.pendingModel ?? updateData.model ?? null;
  if (!newModel) return { driftError: null, agentTypeUpdate: {} };
  if (sessionHasNoAssistantMessages(sessionId)) {
    const agentTypeUpdate = deriveAgentTypeUpdate(session, sessionId, newModel, { providerId: suppliedProviderId });
    return { driftError: null, agentTypeUpdate };
  }
  return { driftError: checkCrossKindSwitch(session, newModel), agentTypeUpdate: {} };
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

// PATCH /api/sessions/:id - Update session settings
router.patch('/:id', requireSession, (req, res) => {
  const { updateData, error } = buildUpdateData(req.body);

  if (error) {
    return res.status(400).json({ error });
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  if (
    updateData.scheduledAt != null &&
    req.body.status === undefined &&
    !['running', 'starting'].includes(req.session_.status)
  ) {
    updateData.status = 'scheduled';
  }

  const { driftError, agentTypeUpdate } = applyModelDriftGuard(
    req.session_, req.params.id, updateData, req.body.providerId,
  );
  if (driftError) {
    return res.status(400).json(driftError);
  }
  Object.assign(updateData, agentTypeUpdate);

  const updated = sessions.update(req.params.id, updateData);
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

// Export for testing
export { buildUpdateData, broadcastSessionUpdate, FIELD_DEFINITIONS };
