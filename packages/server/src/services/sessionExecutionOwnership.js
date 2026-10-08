/**
 * In-memory provider-execution ownership.
 *
 * `activeSessions` is the authoritative execution-ownership record: it is
 * claimed atomically when a turn starts and released only by that turn's own
 * finalizer after the provider generator has settled. The database `status`
 * is never an execution lock.
 *
 * Kept in its own module (rather than streamEventHandler.js) so the
 * claim/mark-stopping/release operations have no import cycle with either
 * lifecycle caller (sessionExecution.js, sessionManager.js) or any HTTP
 * surface that needs admission checks.
 */

/**
 * Lifecycle phase of an in-memory provider execution.
 */
export const SESSION_EXECUTION_PHASES = Object.freeze({
  RUNNING: 'running',
  STOPPING: 'stopping',
});

/** Stable admission-conflict codes returned while an execution owns a session. */
export const SESSION_EXECUTION_ACTIVE_CODE = 'SESSION_EXECUTION_ACTIVE';
export const SESSION_STOPPING_CODE = 'SESSION_STOPPING';

/** User-facing explanation while a stopped turn's provider is still shutting down. */
export const SESSION_STOPPING_MESSAGE =
  'The previous provider turn is still shutting down. Try again once it has stopped.';

/**
 * @typedef {Object} SessionExecutionEntry
 * @property {AbortController} controller - Owns this turn; identity-fences cleanup.
 * @property {number} [turnStartedAt]
 * @property {number} [lastEventAt]
 * @property {number|null} stopRequestedAt - Set when a user Stop arrives mid-turn.
 * @property {'running'|'stopping'} phase
 */

/** @type {Map<string, SessionExecutionEntry>} */
export const activeSessions = new Map();

/**
 * Build a fresh execution entry in the `running` phase.
 * @param {AbortController} controller
 * @returns {SessionExecutionEntry}
 */
export function createSessionExecutionEntry(controller) {
  const now = Date.now();
  return { controller, turnStartedAt: now, lastEventAt: now, stopRequestedAt: null, phase: SESSION_EXECUTION_PHASES.RUNNING };
}

/**
 * Resolve the lifecycle phase of an entry, tolerating entries created before
 * the phase field existed (or set directly by tests).
 * @param {SessionExecutionEntry|null|undefined} entry
 * @returns {'running'|'stopping'}
 */
export function resolveExecutionPhase(entry) {
  return entry?.phase === SESSION_EXECUTION_PHASES.STOPPING
    ? SESSION_EXECUTION_PHASES.STOPPING
    : SESSION_EXECUTION_PHASES.RUNNING;
}

/**
 * Build the admission-conflict error for a session owned by a live execution.
 * The `running` message preserves the long-standing contract; the `stopping`
 * message explains why Continue is temporarily unavailable after a Stop.
 * @param {string} sessionId
 * @param {'running'|'stopping'} phase
 * @returns {Error & { code: string, sessionId: string, executionPhase: string, statusCode: number }}
 */
export function createExecutionConflictError(sessionId, phase) {
  const stopping = phase === SESSION_EXECUTION_PHASES.STOPPING;
  const error = new Error(stopping ? SESSION_STOPPING_MESSAGE : 'Session is already processing');
  error.code = stopping ? SESSION_STOPPING_CODE : SESSION_EXECUTION_ACTIVE_CODE;
  error.sessionId = sessionId;
  error.executionPhase = phase;
  error.statusCode = 409;
  return error;
}

/**
 * Atomically claim execution ownership. Throws a 409-coded conflict when a
 * live turn (running or still shutting down) already owns the session.
 * @param {string} sessionId
 * @param {AbortController} controller
 */
export function claimSessionExecution(sessionId, controller) {
  const existing = activeSessions.get(sessionId);
  if (existing) {
    throw createExecutionConflictError(sessionId, resolveExecutionPhase(existing));
  }
  activeSessions.set(sessionId, createSessionExecutionEntry(controller));
}

/**
 * Describe why a new turn cannot be admitted right now, or null when the
 * session is free. Used by HTTP surfaces to answer 409 before any side
 * effect (message, attachments, schedule cancellation).
 * @param {string} sessionId
 * @returns {{ phase: string, code: string, message: string } | null}
 */
export function getSessionExecutionConflict(sessionId) {
  const existing = activeSessions.get(sessionId);
  if (!existing) return null;
  const phase = resolveExecutionPhase(existing);
  const stopping = phase === SESSION_EXECUTION_PHASES.STOPPING;
  return {
    phase,
    code: stopping ? SESSION_STOPPING_CODE : SESSION_EXECUTION_ACTIVE_CODE,
    message: stopping ? SESSION_STOPPING_MESSAGE : 'Session is already processing',
  };
}

/** Whether a provider turn still owns this session's execution lifecycle. */
export function isSessionExecutionActive(sessionId) {
  return activeSessions.has(sessionId);
}

/** Whether the owning turn was stopped and its provider is still shutting down. */
export function isSessionStopping(sessionId) {
  return activeSessions.has(sessionId)
    && resolveExecutionPhase(activeSessions.get(sessionId)) === SESSION_EXECUTION_PHASES.STOPPING;
}

/**
 * Mark the owning entry `stopping` after a user Stop. The entry is retained:
 * only the turn's own finalizer may release it, after the provider generator
 * has settled. Idempotent; never touches a replacement turn's entry.
 * @param {string} sessionId
 * @param {AbortController|null} [expectedController]
 * @returns {boolean} Whether a matching live entry was (or already is) stopping.
 */
export function markSessionStopping(sessionId, expectedController = null) {
  const entry = activeSessions.get(sessionId);
  if (!entry) return false;
  if (expectedController && entry.controller !== expectedController) return false;
  if (entry.phase !== SESSION_EXECUTION_PHASES.STOPPING) {
    entry.phase = SESSION_EXECUTION_PHASES.STOPPING;
    entry.stopRequestedAt = Date.now();
  }
  return true;
}
