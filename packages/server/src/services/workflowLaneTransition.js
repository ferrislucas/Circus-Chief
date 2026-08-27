import { kanbanCards } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

export function moveCardForTransition(run, card, sortOrder = undefined) {
  // The FK covers new databases, but older rows can contain a dangling
  // declaration from before that constraint existed. Do not let one block a
  // terminal transition: use the configured completion target instead.
  const chosenLaneExists = run.chosen_exit_lane_id
    && kanbanCards.db.prepare('SELECT 1 FROM kanban_lanes WHERE id=?').get(run.chosen_exit_lane_id);
  const targetLaneId = (chosenLaneExists ? run.chosen_exit_lane_id : null)
    || run.completion_target_lane_id || null;
  if (!targetLaneId) return null;
  return kanbanCards.moveToLane(card.id, targetLaneId, sortOrder);
}

/** Broadcast a card move captured while its database transaction was open. */
export function broadcastCardTransition(event) {
  if (event?.projectId) {
    broadcastToProject(event.projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: event.projectId, cardId: event.cardId, fromLaneId: event.fromLaneId, toLaneId: event.toLaneId, card: event.card,
    });
  }
}
