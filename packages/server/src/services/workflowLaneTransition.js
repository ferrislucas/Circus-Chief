import { kanbanCards } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

export function moveCardForTransition(run, card, sortOrder = undefined) {
  const db = kanbanCards.db;
  const laneExists = (laneId) => laneId && db.prepare('SELECT 1 FROM kanban_lanes WHERE id=?').get(laneId);
  // An explicit chosen exit declared by the run itself always wins. The FK
  // covers new databases, but older rows can contain a dangling declaration
  // from before that constraint existed: never let one block a terminal
  // transition, fall through to the configured target instead.
  if (laneExists(run.chosen_exit_lane_id)) {
    return kanbanCards.moveToLane(card.id, run.chosen_exit_lane_id, sortOrder);
  }
  // FR-5: the configured fallback is the source lane's CURRENT target, read
  // at completion time inside the guarded transition — not the drain-time
  // snapshot stored on the run. A cleared target routes nowhere; a deleted
  // target leaves no dangling move.
  const sourceLane = run.source_lane_id && db.prepare(
    'SELECT completion_target_lane_id FROM kanban_lanes WHERE id=?').get(run.source_lane_id);
  if (laneExists(sourceLane?.completion_target_lane_id)) {
    return kanbanCards.moveToLane(card.id, sourceLane.completion_target_lane_id, sortOrder);
  }
  // No current config to consult (the source lane row itself is gone):
  // honor the validated snapshot so legacy rows still complete.
  if (!sourceLane && laneExists(run.completion_target_lane_id)) {
    return kanbanCards.moveToLane(card.id, run.completion_target_lane_id, sortOrder);
  }
  return null;
}

/**
 * Enrich a just-transitioned card with its committed queue presentation
 * state, re-reading committed rows: the payload captured inside the
 * transition transaction predates the successor run. Cycle-safe by design —
 * this module must not import kanbanConcurrency.js or
 * workflowSessionService.js (both lead back here), so the limited-lane check
 * and queue ordering are read inline and kept identical to theirs.
 */
function enrichTransitionCard(card, targetLaneId) {
  try {
    const db = kanbanCards.db;
    const current = db.prepare('SELECT active_lane_run_id, entry_queued FROM kanban_cards WHERE id=?').get(card.id);
    if (current?.active_lane_run_id) {
      const run = db.prepare('SELECT status FROM kanban_lane_runs WHERE id=?').get(current.active_lane_run_id);
      if (run?.status === 'open') return { ...card, entryState: 'running', queuePosition: null };
      return card;
    }
    const lane = db.prepare(`SELECT concurrency_limit, completion_target_lane_id,
      on_enter_template_id, on_enter_prompt FROM kanban_lanes WHERE id=?`).get(targetLaneId);
    const limitedAutomated = lane && lane.concurrency_limit != null
      && Boolean(lane.completion_target_lane_id || lane.on_enter_template_id || lane.on_enter_prompt);
    if (current?.entry_queued === 1 && limitedAutomated) {
      const position = db.prepare(`SELECT id FROM kanban_cards
        WHERE lane_id=? AND entry_queued=1 ORDER BY sort_order, created_at, id`)
        .all(targetLaneId).findIndex((row) => row.id === card.id) + 1 || null;
      if (position != null) return { ...card, entryState: 'queued', queuePosition: position };
    }
  } catch (error) {
    console.error(`Kanban transition broadcast enrichment for card ${card?.id} failed; sending raw card:`, error);
  }
  return card;
}

/** Broadcast a card move captured while its database transaction was open. */
export function broadcastCardTransition(event) {
  if (event?.projectId) {
    broadcastToProject(event.projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: event.projectId, cardId: event.cardId, fromLaneId: event.fromLaneId, toLaneId: event.toLaneId,
      card: event.toLaneId ? enrichTransitionCard(event.card, event.toLaneId) : event.card,
    });
  }
}

/** Broadcast a queued lane entry captured while its database transaction was open. */
export function broadcastQueuedEntryEvent(event) {
  if (event?.projectId) {
    broadcastToProject(event.projectId, WS_MESSAGE_TYPES.KANBAN_ENTRY_QUEUED, {
      projectId: event.projectId, cardId: event.cardId, laneId: event.laneId,
      queuePosition: event.queuePosition, queueDepth: event.queueDepth,
    });
  }
}
