import { sessions } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

/**
 * Custom error class for schedule operations, includes HTTP status code.
 */
export class ScheduleError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   */
  constructor(message, statusCode) {
    super(message);
    this.name = 'ScheduleError';
    this.statusCode = statusCode;
  }
}

/**
 * Configures a schedule for a follow-up message on an existing session.
 *
 * @param {object} session - The session object (from req.session_)
 * @param {object} scheduleData
 * @param {number} scheduleData.scheduledAt - Future timestamp in ms
 * @param {string} [scheduleData.pendingModel] - Model to use when scheduled run fires
 * @param {boolean} [scheduleData.autoRescheduleEnabled] - Enable auto-rescheduling
 * @param {number} [scheduleData.rescheduleDelayMinutes] - Delay between reschedules
 * @param {boolean} [scheduleData.rescheduleOnTokenLimit] - Reschedule on token limit errors
 * @param {boolean} [scheduleData.rescheduleOnServiceError] - Reschedule on service errors
 * @param {number|null} [scheduleData.maxRescheduleCount] - Max number of reschedules
 * @param {number|null} [scheduleData.maxTotalTokens] - Max total tokens before stopping
 * @param {number|null} [scheduleData.rescheduleAtTokenCount] - Token count trigger for reschedule
 * @returns {object} The updated session
 */
export function configureSchedule(session, scheduleData) {
  // Validate session status
  if (!['waiting', 'stopped', 'error'].includes(session.status)) {
    throw new ScheduleError('Session must be in waiting, stopped, or error state to schedule', 400);
  }

  const { scheduledAt } = scheduleData;

  // DEBUG: Log incoming scheduledAt value
  console.log('[DEBUG] Schedule API - scheduledAt from request:', scheduledAt, 'type:', typeof scheduledAt);
  console.log('[DEBUG] Schedule API - Date.now():', Date.now());

  // Validate scheduledAt is provided and in the future
  if (!scheduledAt || scheduledAt <= Date.now()) {
    throw new ScheduleError('scheduledAt must be a future timestamp', 400);
  }

  // Validate that pendingPrompt exists and is not empty
  if (!session.pendingPrompt || session.pendingPrompt.trim() === '') {
    throw new ScheduleError('pendingPrompt must be set before scheduling', 400);
  }

  // Build update data
  const updateData = {
    status: 'scheduled',
    scheduledAt,
  };

  // Apply scheduling options if provided
  if (scheduleData.autoRescheduleEnabled !== undefined) {
    updateData.autoRescheduleEnabled = Boolean(scheduleData.autoRescheduleEnabled);
  }
  if (scheduleData.rescheduleDelayMinutes !== undefined) {
    updateData.rescheduleDelayMinutes = parseInt(scheduleData.rescheduleDelayMinutes, 10);
  }
  if (scheduleData.rescheduleOnTokenLimit !== undefined) {
    updateData.rescheduleOnTokenLimit = Boolean(scheduleData.rescheduleOnTokenLimit);
  }
  if (scheduleData.rescheduleOnServiceError !== undefined) {
    updateData.rescheduleOnServiceError = Boolean(scheduleData.rescheduleOnServiceError);
  }
  if (scheduleData.maxRescheduleCount !== undefined) {
    updateData.maxRescheduleCount = scheduleData.maxRescheduleCount ? parseInt(scheduleData.maxRescheduleCount, 10) : null;
  }
  if (scheduleData.maxTotalTokens !== undefined) {
    updateData.maxTotalTokens = scheduleData.maxTotalTokens ? parseInt(scheduleData.maxTotalTokens, 10) : null;
  }
  if (scheduleData.rescheduleAtTokenCount !== undefined) {
    updateData.rescheduleAtTokenCount = scheduleData.rescheduleAtTokenCount ? parseInt(scheduleData.rescheduleAtTokenCount, 10) : null;
  }
  if (scheduleData.pendingModel !== undefined) {
    updateData.pendingModel = scheduleData.pendingModel;
  }

  const updated = sessions.update(session.id, updateData);

  // Broadcast status update
  broadcastToSession(session.id, WS_MESSAGE_TYPES.SESSION_STATUS, {
    sessionId: session.id,
    status: 'scheduled',
  });

  // Broadcast session update to project subscribers
  broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: session.projectId,
    sessionId: session.id,
    session: updated,
  });

  return updated;
}
