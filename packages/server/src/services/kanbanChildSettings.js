import { sessions } from '../database.js';
import { DEFAULT_RESCHEDULE_DELAY_MINUTES } from '@circuschief/shared';
import { resolveAgentTypeFromModel } from './sessionProvider.js';

/**
 * Build the reschedule policy update for a lane-entry child session.
 * Returns an empty object when the lane does not enable auto-reschedule,
 * leaving the child's default scheduling untouched.
 * @param {Object} lane
 * @returns {Object}
 */
export function buildLaneRescheduleUpdates(lane) {
  if (!lane.onEnterAutoRescheduleEnabled) return {};
  return {
    autoRescheduleEnabled: true,
    rescheduleDelayMinutes: lane.onEnterRescheduleDelayMinutes || DEFAULT_RESCHEDULE_DELAY_MINUTES,
    rescheduleOnTokenLimit: lane.onEnterRescheduleOnTokenLimit ?? true,
    rescheduleOnServiceError: lane.onEnterRescheduleOnServiceError ?? true,
    maxRescheduleCount: lane.onEnterMaxRescheduleCount || null,
    maxTotalTokens: lane.onEnterMaxTotalTokens || null,
    rescheduleAtTokenCount: lane.onEnterRescheduleAtTokenCount || null,
  };
}

/**
 * Build the reschedule policy update for a PRESERVED lane-entry child.
 * Unlike buildLaneRescheduleUpdates, a lane with auto-reschedule off
 * explicitly disables and clears the policy instead of returning {} — a
 * preserved child may carry a previously enabled policy that must be
 * withdrawn when the lane is edited while paused.
 * @param {Object} lane
 * @returns {Object}
 */
export function buildPreservedChildRescheduleUpdates(lane) {
  if (lane.onEnterAutoRescheduleEnabled) return buildLaneRescheduleUpdates(lane);
  return {
    autoRescheduleEnabled: false,
    rescheduleDelayMinutes: null,
    rescheduleOnTokenLimit: false,
    rescheduleOnServiceError: false,
    maxRescheduleCount: null,
    maxTotalTokens: null,
    rescheduleAtTokenCount: null,
  };
}

/**
 * Refresh the effective execution settings on a preserved (reused) child
 * before starting it, so pause → edit → resume replays the latest config
 * (FRD latest-config replay). Identity and workflow ownership are untouched:
 * no new row, no re-attach, no prompt re-render — only the settings refresh.
 * Fields absent from the effective settings (e.g. effortLevel on the
 * template path, which never sets it) are left alone; present-but-null
 * fields explicitly clear stale values.
 * @param {string} childId
 * @param {Object} settings - Effective settings (getLaneSessionSettings / getTemplateSessionSettings)
 * @param {Object} lane
 * @returns {Object} the refreshed child row
 */
export function refreshPreservedChildSettings(childId, settings, lane) {
  const updates = {};
  if (settings.mode !== undefined) updates.mode = settings.mode;
  if (settings.thinkingEnabled !== undefined) updates.thinkingEnabled = settings.thinkingEnabled;
  if (settings.effortLevel !== undefined) updates.effortLevel = settings.effortLevel;
  if (settings.model) {
    updates.model = settings.model;
    updates.agentType = resolveAgentTypeFromModel(settings.model);
  }
  Object.assign(updates, buildPreservedChildRescheduleUpdates(lane));
  sessions.update(childId, updates);
  return sessions.getById(childId);
}
