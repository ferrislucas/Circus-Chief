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
 * Session statuses a preserved child can hold without ever reaching the
 * provider boundary: freshly allocated (`starting`, e.g. setup failed before
 * dispatch) or fence-parked (`stopped`, lane disabled before the provider
 * call). Any other status means the child reached or passed provider
 * dispatch, so its follow-up chain must never be rewritten. This is
 * defense-in-depth: the drain path only reuses a child when its entry event
 * carries no dispatch intent (`resolveDeliveryState` in kanbanService.js
 * routes intent-bearing entries to `ambiguous_dispatch` instead of
 * redelivery), so a dispatched child never reaches this refresh.
 */
const UNDISPATCHED_CHILD_STATUSES = new Set(['starting', 'stopped']);

/**
 * Refresh the effective execution settings on a preserved (reused) child
 * before starting it, so pause → edit → resume replays the latest config
 * (FRD latest-config replay). Identity and workflow ownership are untouched:
 * no new row, no re-attach, no prompt re-render — only the settings refresh.
 * Fields absent from the effective settings (e.g. effortLevel on the
 * template path, which never sets it) are left alone; present-but-null
 * fields explicitly clear stale values.
 * The follow-up chain (`nextTemplateId`) replays the same way when `chain`
 * carries it: the current template's follow-up (possibly null, which
 * explicitly clears a removed chain) on the template path, or null on the
 * prompt path (prompt automation has no template chaining). The chain write
 * applies only to a demonstrably undispatched child; a child past the
 * provider boundary keeps its chain untouched.
 * @param {string} childId
 * @param {Object} settings - Effective settings (getLaneSessionSettings / getTemplateSessionSettings)
 * @param {Object} lane
 * @param {Object} [chain] - Follow-up chain refresh; omit or leave
 *   `nextTemplateId` undefined to leave the chain untouched
 * @param {string|null} [chain.nextTemplateId]
 * @returns {Object} the refreshed child row
 */
export function refreshPreservedChildSettings(childId, settings, lane, chain = {}) {
  const updates = {};
  if (settings.mode !== undefined) updates.mode = settings.mode;
  if (settings.thinkingEnabled !== undefined) updates.thinkingEnabled = settings.thinkingEnabled;
  if (settings.effortLevel !== undefined) updates.effortLevel = settings.effortLevel;
  if (settings.model) {
    updates.model = settings.model;
    updates.agentType = resolveAgentTypeFromModel(settings.model);
  }
  Object.assign(updates, buildPreservedChildRescheduleUpdates(lane));
  if (chain.nextTemplateId !== undefined) {
    const child = sessions.getById(childId);
    if (child && UNDISPATCHED_CHILD_STATUSES.has(child.status)) {
      updates.nextTemplateId = chain.nextTemplateId || null;
    } else {
      console.warn(
        `Kanban: Not rewriting follow-up chain on child ${childId} with status ${child?.status}; ` +
        'it may have passed provider dispatch'
      );
    }
  }
  sessions.update(childId, updates);
  return sessions.getById(childId);
}
