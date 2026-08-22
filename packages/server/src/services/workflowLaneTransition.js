import { kanbanCards } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

export function moveCardForTransition(run, card) {
  // The FK covers new databases, but older rows can contain a dangling
  // declaration from before that constraint existed. Do not let one block a
  // terminal transition: use the configured completion target instead.
  const chosenLaneExists = run.chosen_exit_lane_id
    && kanbanCards.db.prepare('SELECT 1 FROM kanban_lanes WHERE id=?').get(run.chosen_exit_lane_id);
  const targetLaneId = (chosenLaneExists ? run.chosen_exit_lane_id : null)
    || run.completion_target_lane_id || null;
  if (!targetLaneId) return null;
  return kanbanCards.moveToLane(card.id, targetLaneId);
}

/** Broadcast a card move. On the primary lane-run path this is reached from
 * inside finalizeOwnWorkCompletion/closeOwnWork's outer transaction, so the
 * broadcast fires on savepoint release and can precede the durable commit.
 * See the note at reconcileLaneRun in workflowSessionService.js.
 */
export function broadcastCardTransition(run, card, movedCard) {
  if (run.project_id) {
    broadcastToProject(run.project_id, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: run.project_id, cardId: card.id, fromLaneId: card.lane_id, toLaneId: movedCard.laneId, card: movedCard,
    });
  }
}
