import { databaseManager } from '../db/DatabaseManager.js';

function laneRunCounts(rows) {
  const open = rows.filter((session) => session.own_work_state === 'open');
  const scheduled = open.filter((session) => session.scheduled_at).sort((a, b) => a.scheduled_at - b.scheduled_at);
  const retrying = open.filter((session) => session.execution_state === 'retrying');
  const paused = open.filter((session) => session.execution_state === 'paused');
  return {
    open, scheduled, retrying, paused,
    failedCount: rows.filter((session) => session.own_work_state === 'closed_failed').length,
    cancelledCount: rows.filter((session) => session.own_work_state === 'cancelled').length,
    failedSessionId: rows.find((session) => session.own_work_state === 'closed_failed')?.id || null,
  };
}

function blockerDetails({ scheduled, retrying, paused, open }) {
  const groups = [[scheduled, 'Waiting for scheduled work'], [retrying, 'Retrying automation'], [paused, 'Paused — provider limit or outage'], [open, 'Waiting for descendants']];
  const [sessions, reason] = groups.find(([members]) => members.length) || [];
  return { session: sessions?.[0] || null, reason: reason || null };
}

export function getRun(runId) {
  const db = databaseManager.get(); const run = db.prepare('SELECT * FROM kanban_lane_runs WHERE id=?').get(runId);
  if (!run) return null; const rows = db.prepare('SELECT * FROM sessions WHERE lane_run_id=?').all(runId);
  const { open, scheduled, retrying, paused, failedCount, cancelledCount, failedSessionId } = laneRunCounts(rows);
  const names = db.prepare(`SELECT (SELECT name FROM kanban_lanes WHERE id=?) AS source_name,
    (SELECT name FROM kanban_lanes WHERE id=?) AS target_name`).get(run.source_lane_id, run.completion_target_lane_id);
  const blocker = blockerDetails({ scheduled, retrying, paused, open });
  return { id: run.id, laneEntryEventId: run.lane_entry_event_id, status: run.status, sourceLaneId: run.source_lane_id, sourceLaneName: names?.source_name || null,
    targetLaneId: run.completion_target_lane_id, targetLaneName: names?.target_name || null,
    rootSessionId: run.root_session_id, rootOwnWorkState: rows.find((session) => session.id === run.root_session_id)?.own_work_state || null,
    failureReason: run.failure_reason, createdAt: run.created_at,
    succeededAt: run.succeeded_at, failedAt: run.failed_at, cancelledAt: run.cancelled_at, supersededAt: run.superseded_at,
    openCount: open.length, scheduledCount: open.filter((session) => session.scheduled_at).length,
    retryingCount: retrying.length, pausedCount: paused.length, nextScheduledAt: scheduled[0]?.scheduled_at || null,
    failedCount, failedSessionId, cancelledCount,
    blockingSessionIds: open.map((session) => session.id), blockingSessionId: blocker.session?.id || null,
    blockingReason: blocker.reason };
}
