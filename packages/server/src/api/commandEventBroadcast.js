import { broadcastToSessionAndProject, broadcastCommandRunOutput } from '../websocket.js';

/**
 * Broadcast a command-run lifecycle event (output/complete/error/deleted) to the
 * union of session and project subscribers as a single frame per socket.
 *
 * Shared by commandButtons.js and sessions-commands.js so both production
 * code paths and their tests exercise the exact same broadcast seam (a plain
 * module boundary, not a runtime check on test internals like `.mock`).
 *
 * @param {string} sessionId
 * @param {string} projectId
 * @param {string} type - one of WS_MESSAGE_TYPES.COMMAND_RUN_*
 * @param {Object} payload
 */
export function broadcastCommandEvent(sessionId, projectId, type, payload) {
  broadcastToSessionAndProject(sessionId, projectId, type, payload);
}

export function broadcastCommandOutput(runId, chunk) {
  broadcastCommandRunOutput(runId, chunk);
}
