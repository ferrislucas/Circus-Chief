import { kanbanCards } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

export function moveCardForTransition(run, card) {
  const targetLaneId = run.completion_target_lane_id || null;
  if (!targetLaneId) return null;
  const movedCard = kanbanCards.moveToLane(card.id, targetLaneId);
  if (run.project_id) {
    broadcastToProject(run.project_id, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: run.project_id, cardId: card.id, fromLaneId: card.lane_id, toLaneId: targetLaneId, card: movedCard,
    });
  }
  return targetLaneId;
}
