/**
 * Queue presentation state for workspace cards.
 *
 * Mirrors the board's two queue derivations (`kanbanBoardResponse.js`): the
 * `entry_queued` marker in a limited, automated lane (with its 1-based
 * position) and the `queued` entry-event of a disabled lane. Both surface as
 * `entryState: 'queued'` so list and board can never disagree; the
 * disabled-lane path additionally keeps `entryStatus: 'queued'` so clients
 * can explain the cause. Running entries, off-board and archived workspaces
 * carry no queue fields (absent, not null — absence means "not queued").
 *
 * Read-only and batched: one statement per table for the visible page, and
 * zero statements when no visible card is on a board. Queue state degrades
 * to "nothing queued" on databases that predate the entry-events table.
 *
 * Kept out of workspace-queries.js so the card query stays within the
 * project's file line budget. Takes the caller's `db` handle (never the
 * singleton) so isolated test databases keep working.
 */
export function attachQueueState(db, cards) {
  const boarded = cards.filter((card) => card.kanban && !card.archived);
  if (!boarded.length) return;
  const snapshot = readQueueSnapshot(db, boarded);
  if (!snapshot) return;
  for (const row of snapshot.cardRows) {
    const card = snapshot.byCardId.get(row.id);
    const kanban = queuedKanban(card?.kanban, row, snapshot);
    if (card && kanban) card.kanban = kanban;
  }
}

/** Batched read of every queue input for the visible boarded cards. */
function readQueueSnapshot(db, boarded) {
  const byCardId = new Map(boarded.map((card) => [card.kanban.cardId, card]));
  const cardIds = [...byCardId.keys()];
  const cardRows = db.prepare(
    `SELECT id, lane_id, active_lane_run_id, entry_queued, lane_entry_event_id
     FROM kanban_cards WHERE id IN (${cardIds.map(() => '?').join(',')})`
  ).all(...cardIds);
  if (!cardRows.length) return null;
  const lanes = readQueueLanes(db, cardRows);
  return {
    byCardId,
    cardRows,
    lanes,
    openRuns: readOpenRunIds(db, cardRows),
    queuedEvents: readQueuedEventIds(db, cardRows),
    positions: readQueuePositions(db, lanes),
  };
}

function readQueueLanes(db, cardRows) {
  const laneIds = [...new Set(cardRows.map((row) => row.lane_id))];
  const rows = db.prepare(
    `SELECT id, concurrency_limit, completion_target_lane_id, on_enter_template_id, on_enter_prompt
     FROM kanban_lanes WHERE id IN (${laneIds.map(() => '?').join(',')})`
  ).all(...laneIds);
  return new Map(rows.map((row) => [row.id, row]));
}

function readOpenRunIds(db, cardRows) {
  const runIds = cardRows.map((row) => row.active_lane_run_id).filter(Boolean);
  if (!runIds.length) return new Set();
  const rows = db.prepare(
    `SELECT id FROM kanban_lane_runs WHERE id IN (${runIds.map(() => '?').join(',')}) AND status = 'open'`
  ).all(...runIds);
  return new Set(rows.map((row) => row.id));
}

function readQueuedEventIds(db, cardRows) {
  const eventIds = cardRows.map((row) => row.lane_entry_event_id).filter(Boolean);
  if (!eventIds.length) return new Set();
  try {
    const rows = db.prepare(
      `SELECT id FROM kanban_lane_entry_events WHERE id IN (${eventIds.map(() => '?').join(',')}) AND status = 'queued'`
    ).all(...eventIds);
    return new Set(rows.map((row) => row.id));
  } catch {
    return new Set();
  }
}

function readQueuePositions(db, lanes) {
  const positions = new Map();
  for (const lane of lanes.values()) {
    if (lane.concurrency_limit == null || !isStructuredLane(lane)) continue;
    db.prepare(`SELECT id FROM kanban_cards
      WHERE lane_id = ? AND entry_queued = 1 ORDER BY sort_order, created_at, id`)
      .all(lane.id)
      .forEach((row, index) => positions.set(row.id, index + 1));
  }
  return positions;
}

/**
 * The queued `kanban` object for one card row, or null when the entry is
 * not queued. An open run wins over every queue marker: the entry is
 * running, so no queue fields are returned.
 */
function queuedKanban(current, row, snapshot) {
  if (!current) return null;
  if (row.active_lane_run_id && snapshot.openRuns.has(row.active_lane_run_id)) return null;
  let next = limitedLaneQueuedKanban(current, row, snapshot);
  if (row.lane_entry_event_id && snapshot.queuedEvents.has(row.lane_entry_event_id)) {
    next = { ...(next || current), entryState: 'queued', entryStatus: 'queued' };
  }
  return next;
}

function limitedLaneQueuedKanban(current, row, snapshot) {
  const lane = snapshot.lanes.get(row.lane_id);
  if (row.entry_queued !== 1 || lane?.concurrency_limit == null || !isStructuredLane(lane)) return null;
  const position = snapshot.positions.get(row.id) ?? null;
  if (position == null) return null;
  return { ...current, entryState: 'queued', queuePosition: position };
}

/** Raw-lane equivalent of `isStructured` (workflowSessionService.js). */
function isStructuredLane(lane) {
  return Boolean(lane?.completion_target_lane_id || lane?.on_enter_template_id || lane?.on_enter_prompt);
}
