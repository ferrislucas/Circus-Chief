import { kanbanCards, kanbanLanes } from '../database.js';
import { getRun } from './workflowSessionService.js';
import { hasPendingPrompt } from './promptStore.js';
import { latestCommandRunsBySession } from './commandRunIndex.js';

// Card sessions carry their own command-run status so the board renders
// indicators from its own bounded payload instead of requiring the client to
// download every session in the project first.
function decorateCardSessions(card, runsBySession) {
  return {
    ...card,
    sessions: card.sessions?.map((session) => ({
      ...session,
      pendingAgentInput: hasPendingPrompt(session.id),
      latestCommandRuns: Object.values(runsBySession[session.id] || {}),
    })) || [],
  };
}

/** Build the canonical full Kanban board response used by route and service callers. */
export function buildFullBoardResponse(board) {
  if (!board) return null;
  const lanes = kanbanLanes.getByBoardId(board.id);
  const cardsByLane = Object.fromEntries(lanes.map(lane => [lane.id, []]));
  const cardSessionIds = [];
  for (const card of kanbanCards.getByBoardId(board.id)) {
    cardsByLane[card.laneId]?.push(card);
    for (const session of card.sessions || []) cardSessionIds.push(session.id);
  }
  const runsBySession = latestCommandRunsBySession(board.projectId, cardSessionIds);
  return {
    id: board.id,
    projectId: board.projectId,
    lanes: lanes.map(lane => ({
      ...lane,
      cards: cardsByLane[lane.id].map(card => ({
        ...decorateCardSessions(card, runsBySession),
        activeLaneRun: card.activeLaneRunId ? getRun(card.activeLaneRunId) : null,
      })),
    })),
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}
