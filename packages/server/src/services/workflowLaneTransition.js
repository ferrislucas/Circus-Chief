import crypto from 'crypto';
import { kanbanCards } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

const id = () => crypto.randomUUID();

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

export function enqueueTargetLaneTrigger(db, { run, card, targetLaneId, time }) {
  const eventId = id();
  db.prepare(`INSERT INTO kanban_lane_entry_events
    (id,idempotency_key,project_id,workspace_id,card_id,lane_id,cause,caused_by_run_id,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'pending',?,?)`)
    .run(eventId, `completion:${run.id}`, run.project_id, run.workspace_id, card.id,
      targetLaneId, 'completion', run.id, time, time);
  return eventId;
}
