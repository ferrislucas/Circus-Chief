import crypto from 'crypto';

/**
 * Durable route decisions are written in the caller's transaction. Counters
 * are process-local diagnostics and must only be recorded after that commit.
 */
class KanbanRoutingMetrics {
  #accepted = new Map();
  #rejected = new Map();
  #overwritten = 0;
  #discarded = 0;

  recordAccepted(outcome) {
    this.#accepted.set(outcome, (this.#accepted.get(outcome) || 0) + 1);
    if (outcome === 'scheduled_overwritten') this.#overwritten += 1;
  }

  recordRejected(reason) {
    this.#rejected.set(reason, (this.#rejected.get(reason) || 0) + 1);
  }

  recordDiscarded() {
    this.#discarded += 1;
  }

  snapshot() {
    return {
      accepted: Object.fromEntries(this.#accepted),
      rejected: Object.fromEntries(this.#rejected),
      overwritten: this.#overwritten,
      discarded: this.#discarded,
    };
  }

  reset() {
    this.#accepted.clear();
    this.#rejected.clear();
    this.#overwritten = 0;
    this.#discarded = 0;
  }
}

export const kanbanRoutingMetrics = new KanbanRoutingMetrics();

/** Queue workflow-terminal metrics until all enclosing SQLite savepoints commit. */
export function publishDiscardedPendingDestination() {
  queueMicrotask(() => kanbanRoutingMetrics.recordDiscarded());
}

export function recordRouteDecision(db, {
  projectId, workspaceId, callerSessionId = null, sourceLaneId, destinationLaneId,
  outcome, laneRunId = null, requestAt, committedAt,
}) {
  db.prepare(`INSERT INTO kanban_routing_audit_events
    (id, project_id, workspace_id, caller_session_id, source_lane_id,
      destination_lane_id, outcome, lane_run_id, request_at, committed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), projectId, workspaceId, callerSessionId, sourceLaneId,
      destinationLaneId, outcome, laneRunId, requestAt, committedAt);
}
