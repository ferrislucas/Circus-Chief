import { sessions } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

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
 * Extract and transform scheduling options from request data.
 * @param {object} scheduleData - Raw schedule data from request
 * @returns {object} Transformed scheduling options
 */
function extractSchedulingOptions(scheduleData) {
  const options = {};
  const boolFields = ['autoRescheduleEnabled', 'rescheduleOnTokenLimit', 'rescheduleOnServiceError'];
  const intFields = ['rescheduleDelayMinutes'];
  const nullableIntFields = ['maxRescheduleCount', 'maxTotalTokens', 'rescheduleAtTokenCount'];

  for (const field of boolFields) {
    if (scheduleData[field] !== undefined) {
      options[field] = Boolean(scheduleData[field]);
    }
  }
  for (const field of intFields) {
    if (scheduleData[field] !== undefined) {
      options[field] = parseInt(scheduleData[field], 10);
    }
  }
  for (const field of nullableIntFields) {
    if (scheduleData[field] !== undefined) {
      options[field] = scheduleData[field] ? parseInt(scheduleData[field], 10) : null;
    }
  }
  if (scheduleData.pendingModel !== undefined) {
    options.pendingModel = scheduleData.pendingModel;
  }

  return options;
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

  // Validate scheduledAt is provided and in the future
  if (!scheduledAt || scheduledAt <= Date.now()) {
    throw new ScheduleError('scheduledAt must be a future timestamp', 400);
  }

  // Validate that pendingPrompt exists and is not empty
  if (!session.pendingPrompt || session.pendingPrompt.trim() === '') {
    throw new ScheduleError('pendingPrompt must be set before scheduling', 400);
  }

  // Build update data with scheduling options
  const updateData = {
    status: 'scheduled',
    scheduledAt,
    ...extractSchedulingOptions(scheduleData),
  };

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
