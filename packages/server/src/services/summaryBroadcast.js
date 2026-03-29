/**
 * Broadcast helpers for summary-related WebSocket events.
 * Consolidates repeated broadcast patterns from summaryService.
 */

import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

/**
 * Broadcast summary update to session and project subscribers
 * @param {string} sessionId - The session ID
 * @param {string|null} projectId - The project ID (null skips project broadcast)
 * @param {Object} summary - The summary object
 */
export function broadcastSummaryUpdate(sessionId, projectId, summary) {
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
    sessionId,
    summary,
  });

  if (projectId) {
    broadcastToProject(projectId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
      projectId,
      sessionId,
      summary,
    });
  }
}

/**
 * Broadcast generating status to session subscribers
 * @param {string} sessionId - The session ID
 * @param {boolean} generating - Whether generation is in progress
 */
export function broadcastGeneratingStatus(sessionId, generating) {
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
    sessionId,
    generating,
  });
}

/**
 * Broadcast session update to session and project subscribers
 * @param {string} sessionId - The session ID
 * @param {string|null} projectId - The project ID (null skips project broadcast)
 * @param {Object} session - The session object
 */
export function broadcastSessionUpdate(sessionId, projectId, session) {
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    sessionId,
    session,
  });

  if (projectId) {
    broadcastToProject(projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId,
      sessionId,
      session,
    });
  }
}
