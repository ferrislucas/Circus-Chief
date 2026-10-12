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

/** Broadcast a card move captured while its database transaction was open. */
export function broadcastCardTransition(event) {
  if (event?.projectId) {
    broadcastToProject(event.projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: event.projectId, cardId: event.cardId, fromLaneId: event.fromLaneId, toLaneId: event.toLaneId, card: event.card,
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
