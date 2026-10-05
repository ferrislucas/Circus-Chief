/**
 * sessions-patch-validation.js — PATCH /:id body validation/normalization.
 *
 * Extracted from sessions-patch.js so the route module stays within its
 * size budget. Pure request-body shaping: no session reads, no writes.
 */
import { sessionTemplates, modelProviders } from '../database.js';
import { isTierRef } from '@circuschief/shared';
import { validateModelId } from './model-validation.js';
import { validateScheduledAt } from './scheduledAtValidation.js';

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
  { field: 'model', validate: validateModelId },
  { field: 'pendingModel', validate: (value) => validateModelId(value, { fieldName: 'pendingModel' }) },
  { field: 'pendingProviderId' },
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

function applyTierProviderRule(updateData) {
  if (!Object.hasOwn(updateData, 'model') || !isTierRef(updateData.model)) {
    return { updateData };
  }

  if (Object.hasOwn(updateData, 'providerId') && updateData.providerId !== null) {
    return { updateData: {}, error: 'providerId must be null when model is a tier reference' };
  }

  return { updateData: { ...updateData, providerId: null } };
}

/**
 * Build update data object from request body using field definitions.
 * Returns { updateData, error } where error is a string if validation failed.
 * @param {object} body - The request body
 * @returns {{ updateData: object, error?: string }}
 */
export function buildUpdateData(body) {
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

  // A tier binding has no single owning provider — the concrete provider is
  // resolved per-run from the active tier member (Work Item 1). Reject an
  // explicit concrete providerId submitted alongside a tier-bound `model`,
  // and otherwise normalize the companion providerId to null so a stale
  // concrete value can never shadow the tier's own resolution.
  return applyTierProviderRule(updateData);
}