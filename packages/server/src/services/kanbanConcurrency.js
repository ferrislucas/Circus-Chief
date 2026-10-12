/**
 * Per-lane concurrency limits with visible queueing (FRD: Kanban Lane
 * Concurrency Limits).
 *
 * Queue state is stored, not inferred: a card in a limited, automated
 * (`isStructured`) lane whose `entry_queued` marker is set is queued; a card
 * whose pointer references an open run is running; anything else (finished,
 * failed, cancelled, intentionally unautomated) is neither. A NULL
 * `active_lane_run_id` alone never means queued, so clearing a terminal
 * pointer (success, failure, recovery) cannot manufacture phantom queue
 * entries. This module is deliberately free of kanbanService.js imports so
 * workflow-adjacent callers (recovery) and kanbanService alike can use it
 * without an import cycle.
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
 * Ordered ids of deferred cards in a lane: cards physically in the lane with
 * the pending-entry marker set, top of lane first (sort_order, created_at,
 * id). The marker survives limit changes, so this deliberately ignores the
 * lane's current limit; use getQueuedCardIds for the capacity-gated view.
 * @param {import('better-sqlite3').Database} db
 * @param {string} laneId
 * @returns {string[]}
 */
export function getDeferredCardIds(db, laneId) {
  return db.prepare(`SELECT id FROM kanban_cards
    WHERE lane_id = ? AND entry_queued = 1
    ORDER BY sort_order, created_at, id`).all(laneId).map((row) => row.id);
}

/**
 * Ordered ids of queued cards in a lane: deferred cards in a lane that is
 * currently limited and automated, top of lane first (sort_order,
 * created_at, id). Empty for unlimited or non-automated lanes.
 * @param {import('better-sqlite3').Database} db
 * @param {string} laneId
 * @returns {string[]}
 */
export function getQueuedCardIds(db, laneId) {
  const lane = kanbanLanes.getById(laneId);
  if (!lane || lane.concurrencyLimit == null || !isStructured(lane)) return [];
  return getDeferredCardIds(db, laneId);
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
 * Derive a card's queue presentation state. Open run -> running; pending-entry
 * marker in a limited automated lane -> queued with position; anything else
 * (finished, failed, cancelled, unautomated, unlimited, non-automated)
 * carries no queue state. Pointer absence alone never implies queued.
 * @param {import('better-sqlite3').Database} db
 * @param {Object} card - Mapped card (with activeLaneRunId, entryQueued)
 * @param {Object} lane - Mapped lane (with concurrencyLimit)
 * @param {Map<string, number>|null} [positions] - Precomputed queue positions
 * @returns {{ entryState?: 'running'|'queued', queuePosition?: number|null }}
 */
export function getCardEntryState(db, card, lane, positions = null) {
  if (card?.activeLaneRunId) {
    const run = db.prepare('SELECT status FROM kanban_lane_runs WHERE id=?').get(card.activeLaneRunId);
    if (run?.status === 'open') {
      return { entryState: 'running', queuePosition: null };
    }
    return {};
  }
  // Fall back to the stored marker when the mapped card predates it.
  const queued = card?.entryQueued ?? db.prepare('SELECT entry_queued FROM kanban_cards WHERE id=?').get(card?.id)?.entry_queued === 1;
  if (queued && lane && lane.concurrencyLimit != null && isStructured(lane)) {
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
 * transaction. Full lanes defer automation entirely: no run row is created,
 * and the card's pending-entry marker is set so the card reads as queued.
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
    db.prepare('UPDATE kanban_cards SET active_lane_run_id=NULL, lane_entry_event_id=NULL, entry_queued=1, updated_at=? WHERE id=?')
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
 * Read a queued card's owning session for deferred admission.
 * @returns {{ card: Object|null, session: Object|null }}
 */
function getQueuedCardOwner(cardId) {
  const card = kanbanCards.getByIdWithLane(cardId);
  const sessionId = card?.sessions?.[0]?.id;
  return { card, session: sessionId ? sessions.getById(sessionId) : null };
}

/**
 * Resolve the workspace + project that own a queued card for a deferred start.
 * Archived owners never receive deferred automation (FR-8): an archived
 * workspace's entry is cancelled, so admission resolves to null even when a
 * stale `entry_queued` marker survived.
 * @returns {{ projectId: string, workspaceId: string }|null}
 */
export function resolveQueuedCardOwner(cardId) {
  const { card, session } = getQueuedCardOwner(cardId);
  if (!card || !session || session.archived) return null;
  return { projectId: session.projectId, workspaceId: session.id };
}

/**
 * Consume deferred entries as durable no-ops when a lane has no automation
 * left to run them under (FR-14, edge case 3). Existing runners are
 * untouched; only the pending-entry markers are cleared, so re-enabling
 * automation cannot resurrect stale entries.
 * @param {import('better-sqlite3').Database} db
 * @param {string} laneId
 * @returns {number} Cleared markers
 */
export function consumeDeferredEntriesForUnautomatedLane(db, laneId) {
  const lane = kanbanLanes.getById(laneId);
  if (!lane || isStructured(lane)) return 0;
  const time = Date.now();
  const cleared = db.prepare(`UPDATE kanban_cards SET entry_queued=0, updated_at=?
    WHERE lane_id=? AND entry_queued=1 AND active_lane_run_id IS NULL`).run(time, laneId);
  if (cleared.changes) {
    console.info(`Kanban lane ${laneId} lost automation: consumed ${cleared.changes} deferred entr(ies) as no-ops`);
  }
  return cleared.changes;
}

/**
 * Start one queued card. Returns the new run, or null when the card left the
 * queue, has no owner, is archived, or its start failed (recorded; the drain
 * continues). Recovery and limit-clear drains funnel through here, so the
 * archived-owner refusal below covers every drain path (FR-8).
 */
export function startQueuedCard(db, laneId, cardId) {
  // Re-verify queue membership: a concurrent drain on this connection cannot
  // interleave (synchronous), but the card may have moved or finished.
  const current = db.prepare('SELECT lane_id, active_lane_run_id, entry_queued FROM kanban_cards WHERE id=?').get(cardId);
  if (!current || current.lane_id !== laneId || current.entry_queued !== 1 || current.active_lane_run_id !== null) return null;
  // Late automation removal turns a not-yet-started entry into a no-op
  // (FR-14): consume the marker instead of starting under new config later.
  if (!isStructured(kanbanLanes.getById(laneId))) {
    db.prepare('UPDATE kanban_cards SET entry_queued=0, updated_at=? WHERE id=?').run(Date.now(), cardId);
    return null;
  }
  const owner = resolveQueuedCardOwner(cardId);
  if (!owner) {
    // An archived workspace's entry is cancelled, not deferred: consume a
    // stale marker so a later restart or limit-clear drain cannot revive it.
    if (getQueuedCardOwner(cardId).session?.archived) {
      db.prepare('UPDATE kanban_cards SET entry_queued=0, updated_at=? WHERE id=?').run(Date.now(), cardId);
      console.info(`Kanban queue drain skipped archived card ${cardId}: entry cancelled`);
    } else {
      console.warn(`Kanban queue drain skipped card ${cardId}: no owning session`);
    }
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
 * With `ignoreLimit` (limit cleared, FR-4/FR-5), every deferred entry starts
 * regardless of the lane's current limit.
 * @param {string} laneId
 * @param {{ ignoreLimit?: boolean }} [options]
 * @returns {Array} Newly created lane runs (each with laneEntryEventId)
 */
export function drainLaneQueue(laneId, { ignoreLimit = false } = {}) {
  return databaseManager.transaction(() => {
    const db = databaseManager.get();
    const lane = kanbanLanes.getById(laneId);
    if (!lane || !isStructured(lane)) return [];
    if (!ignoreLimit && lane.concurrencyLimit == null) return [];
    const deferred = ignoreLimit ? getDeferredCardIds(db, laneId) : getQueuedCardIds(db, laneId);
    const created = [];
    for (const cardId of deferred) {
      if (!ignoreLimit && countOpenLaneRuns(db, laneId) >= lane.concurrencyLimit) break;
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
      // Lanes that lost automation while entries were deferred cannot drain:
      // consume those markers as no-ops so recovery never resurrects them.
      drained += consumeDeferredEntriesForUnautomatedLane(db, lane.id);
      drained += drainLaneQueue(lane.id).length;
    } catch (error) {
      console.error(`Kanban recovery drain for lane ${lane.id} failed:`, error);
    }
  }
  // Limit-clear crash path: the config commit survived but its conversion
  // drain never ran, leaving deferred markers in an unlimited lane. Those
  // markers predate the clearing (unlimited lanes never queue), so an
  // automated lane drains them now; an unautomated lane consumes them.
  const stranded = db.prepare(`SELECT l.id FROM kanban_lanes l
    WHERE l.concurrency_limit IS NULL
      AND EXISTS (SELECT 1 FROM kanban_cards c WHERE c.lane_id=l.id AND c.entry_queued=1)`).all();
  for (const lane of stranded) {
    try {
      if (consumeDeferredEntriesForUnautomatedLane(db, lane.id)) continue;
      drained += drainLaneQueue(lane.id, { ignoreLimit: true }).length;
    } catch (error) {
      console.error(`Kanban recovery drain for lane ${lane.id} failed:`, error);
    }
  }
  return drained;
}
