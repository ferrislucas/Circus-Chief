/**
 * Per-lane concurrency limits with visible queueing (FRD: Kanban Lane
 * Concurrency Limits).
 *
 * Queue state is derived, not stored: a card in a limited, automated
 * (`isStructured`) lane whose `active_lane_run_id` is NULL is queued; a card
 * whose pointer references an open run is running; a card pointing at a
 * terminal run has finished and is neither. This module is deliberately free
 * of kanbanService.js imports so workflow-adjacent callers (recovery) and
 * kanbanService alike can use it without an import cycle.
 */
import { databaseManager } from '../db/DatabaseManager.js';
import { kanbanCards, kanbanLanes, sessions } from '../database.js';
import { createLaneRunForEntry, isStructured } from './workflowSessionService.js';

/** Queue cause recorded on entry events created by a drain pass. */
export const QUEUE_DRAIN_CAUSE = 'queue_drain';

/**
 * Read a lane's concurrency limit: a positive integer, or null for unlimited.
 * @param {import('better-sqlite3').Database} db
 * @param {string} laneId
 * @returns {number|null}
 */
export function getLaneConcurrencyLimit(db, laneId) {
  const row = db.prepare('SELECT concurrency_limit FROM kanban_lanes WHERE id=?').get(laneId);
  return row?.concurrency_limit ?? null;
}

/**
 * Count running cards in a lane: cards currently in the lane whose active
 * run pointer references an open run. Awaiting auto-reschedule retry keeps
 * its open run and therefore keeps holding its slot (FR-16).
 * @param {import('better-sqlite3').Database} db
 * @param {string} laneId
 * @returns {number}
 */
export function countOpenLaneRuns(db, laneId) {
  const row = db.prepare(`SELECT COUNT(*) AS count
    FROM kanban_cards c
    JOIN kanban_lane_runs r ON r.id = c.active_lane_run_id
    WHERE c.lane_id = ? AND r.status = 'open'`).get(laneId);
  return Number(row?.count || 0);
}

/**
 * Whether a lane may start another entry right now. Unlimited lanes and
 * lanes without on-enter automation always have capacity (FR-15: the limit
 * is inert without automation).
 * @param {import('better-sqlite3').Database} db
 * @param {Object} lane - Mapped lane (with concurrencyLimit)
 * @returns {boolean}
 */
export function laneHasCapacity(db, lane) {
  if (lane?.concurrencyLimit == null) return true;
  if (!isStructured(lane)) return true;
  return countOpenLaneRuns(db, lane.id) < lane.concurrencyLimit;
}

/**
 * Ordered ids of queued cards in a lane: cards physically in the lane with
 * no active run pointer, top of lane first (sort_order, created_at, id).
 * Empty for unlimited or non-automated lanes.
 * @param {import('better-sqlite3').Database} db
 * @param {string} laneId
 * @returns {string[]}
 */
export function getQueuedCardIds(db, laneId) {
  const lane = kanbanLanes.getById(laneId);
  if (!lane || lane.concurrencyLimit == null || !isStructured(lane)) return [];
  return db.prepare(`SELECT id FROM kanban_cards
    WHERE lane_id = ? AND active_lane_run_id IS NULL
    ORDER BY sort_order, created_at, id`).all(laneId).map((row) => row.id);
}

/**
 * 1-based queue positions for every queued card in a lane.
 * @param {import('better-sqlite3').Database} db
 * @param {string} laneId
 * @returns {Map<string, number>} cardId -> position
 */
export function computeQueuePositions(db, laneId) {
  const positions = new Map();
  getQueuedCardIds(db, laneId).forEach((cardId, index) => {
    positions.set(cardId, index + 1);
  });
  return positions;
}

/**
 * Derive a card's queue presentation state. Open run -> running; no active
 * run in a limited automated lane -> queued with position; anything else
 * (finished, unlimited, non-automated) carries no queue state.
 * @param {import('better-sqlite3').Database} db
 * @param {Object} card - Mapped card (with activeLaneRunId)
 * @param {Object} lane - Mapped lane (with concurrencyLimit)
 * @param {Map<string, number>|null} [positions] - Precomputed queue positions
 * @returns {{ entryState?: 'running'|'queued', queuePosition?: number|null }}
 */
export function getCardEntryState(db, card, lane, positions = null) {
  if (card?.activeLaneRunId) {
    const run = db.prepare('SELECT status FROM kanban_lane_runs WHERE id=?').get(card.activeLaneRunId);
    if (!run) {
      // Dangling pointer (cleared by recovery): fall through to the queued check.
    } else if (run.status === 'open') {
      return { entryState: 'running', queuePosition: null };
    } else {
      return {};
    }
  }
  if (lane && lane.concurrencyLimit != null && isStructured(lane)) {
    const position = positions
      ? (positions.get(card.id) ?? null)
      : (getQueuedCardIds(db, lane.id).indexOf(card.id) + 1 || null);
    if (position != null) return { entryState: 'queued', queuePosition: position };
  }
  return {};
}

/**
 * Gate a lane entry behind the lane's concurrency limit. Call inside the
 * caller's entry transaction, after the card move is committed in that
 * transaction. Full lanes defer automation entirely: no run row, and the
 * card pointers are cleared so the card reads as queued.
 * @param {Object} args
 * @returns {{ laneRun: Object|null, queued: boolean, queuePosition: number|null }}
 */
export function createGatedLaneRunForEntry({ projectId, workspaceId, cardId, lane, cause = 'card_added', priorLaneRunId = null }) {
  if (lane?.concurrencyLimit == null || !isStructured(lane)) {
    return {
      laneRun: createLaneRunForEntry({ projectId, workspaceId, cardId, lane, cause, priorLaneRunId }),
      queued: false,
      queuePosition: null,
    };
  }
  const db = databaseManager.get();
  if (countOpenLaneRuns(db, lane.id) >= lane.concurrencyLimit) {
    const time = Date.now();
    db.prepare('UPDATE kanban_cards SET active_lane_run_id=NULL, lane_entry_event_id=NULL, updated_at=? WHERE id=?')
      .run(time, cardId);
    const position = getQueuedCardIds(db, lane.id).indexOf(cardId) + 1 || null;
    console.info(`Kanban lane ${lane.id} at limit ${lane.concurrencyLimit}: card ${cardId} queued at position ${position}`);
    return { laneRun: null, queued: true, queuePosition: position };
  }
  return {
    laneRun: createLaneRunForEntry({ projectId, workspaceId, cardId, lane, cause, priorLaneRunId }),
    queued: false,
    queuePosition: null,
  };
}

/**
 * Resolve the workspace + project that own a queued card for a deferred start.
 * @returns {{ projectId: string, workspaceId: string }|null}
 */
function resolveQueuedCardOwner(cardId) {
  const card = kanbanCards.getByIdWithLane(cardId);
  const sessionId = card?.sessions?.[0]?.id;
  const session = sessionId ? sessions.getById(sessionId) : null;
  if (!card || !session) return null;
  return { projectId: session.projectId, workspaceId: session.id };
}

/**
 * Start one queued card. Returns the new run, or null when the card left the
 * queue, has no owner, or its start failed (recorded; the drain continues).
 */
function startQueuedCard(db, laneId, cardId) {
  // Re-verify queue membership: a concurrent drain on this connection cannot
  // interleave (synchronous), but the card may have moved.
  const current = db.prepare('SELECT lane_id, active_lane_run_id FROM kanban_cards WHERE id=?').get(cardId);
  if (!current || current.lane_id !== laneId || current.active_lane_run_id !== null) return null;
  const owner = resolveQueuedCardOwner(cardId);
  if (!owner) {
    console.warn(`Kanban queue drain skipped card ${cardId}: no owning session`);
    return null;
  }
  try {
    // Start-time automation config: the lane is re-read here so late lane
    // edits apply to not-yet-started cards (FR-14).
    return createLaneRunForEntry({
      projectId: owner.projectId,
      workspaceId: owner.workspaceId,
      cardId,
      lane: kanbanLanes.getById(laneId),
      cause: QUEUE_DRAIN_CAUSE,
    });
  } catch (error) {
    console.error(`Kanban queue drain failed to start card ${cardId} in lane ${laneId}; continuing:`, error);
    return null;
  }
}

/**
 * Fill every free slot in a lane in a single pass, top of lane first
 * (FR-10). Fully synchronous, so concurrent releases serialize on the
 * database and the unique-open-run index backstops double-starts (FR-11).
 * A failed start is recorded and skipped; the drain continues (FR-10).
 * Safe to call inside or outside a caller transaction.
 * @param {string} laneId
 * @returns {Array} Newly created lane runs (each with laneEntryEventId)
 */
export function drainLaneQueue(laneId) {
  return databaseManager.transaction(() => {
    const db = databaseManager.get();
    const lane = kanbanLanes.getById(laneId);
    if (!lane || lane.concurrencyLimit == null || !isStructured(lane)) return [];
    const created = [];
    for (const cardId of getQueuedCardIds(db, laneId)) {
      if (countOpenLaneRuns(db, laneId) >= lane.concurrencyLimit) break;
      const run = startQueuedCard(db, laneId, cardId);
      if (run) created.push(run);
    }
    if (created.length) {
      console.info(`Kanban queue drain started ${created.length} card(s) in lane ${laneId}`);
    }
    return created;
  });
}

/**
 * Recovery/startup pass: re-run the drain per limited lane instead of
 * bulk-starting, so free slots fill in lane order while the limit is
 * respected. Fresh runs stay pending for the retry worker, which starts
 * after preflight — safe to call during boot recovery.
 * @param {import('better-sqlite3').Database} db
 * @returns {number} Newly created lane runs across all limited lanes
 */
export function drainLimitedLaneQueues(db) {
  const limitedLanes = db.prepare('SELECT id FROM kanban_lanes WHERE concurrency_limit IS NOT NULL').all();
  let drained = 0;
  for (const lane of limitedLanes) {
    try {
      drained += drainLaneQueue(lane.id).length;
    } catch (error) {
      console.error(`Kanban recovery drain for lane ${lane.id} failed:`, error);
    }
  }
  return drained;
}
