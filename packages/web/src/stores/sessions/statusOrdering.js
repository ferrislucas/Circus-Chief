/**
 * Client-side ordering guard for session status (FR-5 of the running-state
 * FRD): a snapshot fetched from the REST API must never overwrite a NEWER
 * lifecycle status the client has already applied — whether from a socket
 * `session:status` frame, a `session:updated` frame, or the local optimistic
 * acknowledgement of a successful Send/Start.
 *
 * Mechanism: every status mutation on the store bumps a per-session
 * generation counter. `fetchSession()` captures the generation when the
 * request is ISSUED. If the generation has advanced by the time the response
 * arrives, the snapshot's status is stale; the locally-known (newer) status
 * is re-applied over the merged snapshot instead. A snapshot issued AFTER the
 * event still applies normally — it is the authoritative reconciliation.
 *
 * This mixin is spread into both the main sessions store and the overlay
 * sessions stores, so each store instance guards its own `currentSession`
 * with its own generation counter.
 */

/**
 * Development diagnostic for session lifecycle status transitions.
 * Logs the selected session id, the source of the status, the status itself,
 * and the client ordering generation. Never logs prompt contents.
 *
 * @param {'optimistic'|'socket'|'snapshot'} source - Where the status came from
 * @param {string} sessionId - The session the status applies to
 * @param {string} status - The status value
 * @param {number} generation - The store's status generation for the session
 */
export function debugSessionStatus(source, sessionId, status, generation) {
  console.debug(`[session-status] source=${source} session=${sessionId} status=${status} gen=${generation}`);
}

/**
 * Additional Pinia state tracking per-session status generations.
 */
export const statusOrderingState = () => ({
  // sessionId -> monotonic counter of lifecycle status mutations applied by
  // this store instance. Used by fetchSession() to detect that a snapshot
  // was superseded while in flight. Kept in state (not module scope) so the
  // main store and every overlay instance guard independently.
  sessionStatusGenerations: {},
});

/**
 * Actions shared by the main sessions store and overlay sessions stores.
 * Spread directly into the Pinia store actions, so `this` is the store.
 */
export const statusOrderingActions = {
  /**
   * Record a lifecycle status mutation for ordering purposes. Called from the
   * store's status-mutating choke points (`_updateSessionInAllLists` when a
   * status is present, and `updateSession` for socket-driven merges).
   * @param {string} sessionId
   */
  _bumpStatusGeneration(sessionId) {
    if (!sessionId) return;
    this.sessionStatusGenerations = {
      ...this.sessionStatusGenerations,
      [sessionId]: (this.sessionStatusGenerations[sessionId] || 0) + 1,
    };
  },

  /**
   * Read the current status generation for a session.
   * @param {string} sessionId
   * @returns {number}
   */
  _statusGeneration(sessionId) {
    if (!sessionId) return 0;
    return this.sessionStatusGenerations[sessionId] || 0;
  },

  /**
   * Guard a fetched snapshot against a lifecycle status that superseded it
   * while the request was in flight. When the generation advanced between
   * request and response, the snapshot's status is stale: the locally-known
   * status (from currentSession or the session lists) is re-applied over the
   * snapshot so the returned payload can be merged/applied unchanged.
   *
   * @param {string} sessionId - The session the snapshot was fetched for
   * @param {Object|null} fetchedSession - The raw API response
   * @param {number} generationAtRequest - Generation captured before the fetch
   * @returns {Object|null} The payload to apply (possibly status-corrected)
   */
  _reconcileSnapshotWithStatusOrdering(sessionId, fetchedSession, generationAtRequest) {
    if (!fetchedSession) return fetchedSession;
    if (this._statusGeneration(sessionId) === generationAtRequest) return fetchedSession;

    // A lifecycle event superseded this snapshot while it was in flight.
    const known = (this.currentSession?.id === sessionId && this.currentSession)
      || this.sessions.find((s) => s.id === sessionId)
      || this.archivedSessions.find((s) => s.id === sessionId)
      || null;

    debugSessionStatus('snapshot-superseded', sessionId, known?.status ?? fetchedSession.status, this._statusGeneration(sessionId));

    if (!known?.status) return fetchedSession;
    return { ...fetchedSession, status: known.status };
  },
};
