import { Router } from 'express';
import { sessions, sessionTemplates, modelProviders } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import * as summaryService from '../services/summaryService.js';
import { requireSession } from '../middleware/sessionLookup.js';

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
  { field: 'model' },
  { field: 'pendingModel' },
  { field: 'autoSendPendingPrompt', transform: Boolean },
  { field: 'providerId', validate: validateProviderId },
  { field: 'prUrl', validate: validatePrUrl },
  // Scheduling fields
  { field: 'scheduledAt' },
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

// PATCH /api/sessions/:id - Update session settings
router.patch('/:id', requireSession, (req, res) => {
  const { updateData, error } = buildUpdateData(req.body);

  if (error) {
    return res.status(400).json({ error });
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const updated = sessions.update(req.params.id, updateData);

  // Propagate PR URL to parent session if set (not when clearing)
  if (updateData.prUrl) {
    summaryService.propagatePrUrlToParent(req.params.id, updateData.prUrl);
  }

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
