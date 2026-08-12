import { kanbanCards, kanbanLanes } from '../database.js';
import { getRun } from './workflowSessionService.js';
import { hasPendingPrompt } from './promptStore.js';

function withPendingAgentInput(card) {
  return {
    ...card,
    sessions: card.sessions?.map((session) => ({ ...session, pendingAgentInput: hasPendingPrompt(session.id) })) || [],
  };
}

/** Build the canonical full Kanban board response used by route and service callers. */
export function buildFullBoardResponse(board) {
  if (!board) return null;
  const lanes = kanbanLanes.getByBoardId(board.id);
  const cardsByLane = Object.fromEntries(lanes.map(lane => [lane.id, []]));
  for (const card of kanbanCards.getByBoardId(board.id)) {
    cardsByLane[card.laneId]?.push(card);
  }
  return {
    id: board.id,
    projectId: board.projectId,
    lanes: lanes.map(lane => ({
      ...lane,
      cards: cardsByLane[lane.id].map(card => ({
        ...withPendingAgentInput(card),
        activeLaneRun: card.activeLaneRunId ? getRun(card.activeLaneRunId) : null,
      })),
    })),
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}
