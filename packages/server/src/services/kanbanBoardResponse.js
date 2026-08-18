import { kanbanCards, kanbanLanes, commandRuns, sessions } from '../database.js';
import { getRun } from './workflowSessionService.js';
import { hasPendingPrompt } from './promptStore.js';
import { buildRunsBySession } from '../api/projects-helpers.js';
import { commandRunner } from './commandRunner.js';

/**
 * Build the merged latest-run index for every session rendered on the board.
 * Kanban cards show command-status indicators, so the board response is the
 * only load-bearing source for them; without this the indicators never render.
 * @param {string} projectId - Project that owns the board
 * @param {Array} cards - Board cards with their session arrays
 * @returns {Object} sessionId -> { buttonId -> run }
 */
function buildBoardRunsBySession(projectId, cards) {
  const sessionIds = [...new Set(cards.flatMap(card => (card.sessions || []).map(s => s.id)))];
  if (!sessionIds.length) return {};
  const sessionIdSet = new Set(sessionIds);
  return buildRunsBySession(
    // Board indicators render only status/exitCode/buttonId. Output-resume
    // metadata costs two correlated subqueries per run row on every board
    // broadcast, so the board deliberately omits it.
    commandRuns.getLatestRunsForSessions(sessionIds),
    commandRunner.getRunningByProjectId(projectId, ids => sessions.getByIds(ids))
      .filter(run => sessionIdSet.has(run.sessionId))
  );
}

function withSessionDetails(card, runsBySession) {
  return {
    ...card,
    sessions: card.sessions?.map(session => ({
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
  const allCards = kanbanCards.getByBoardId(board.id);
  for (const card of allCards) {
    cardsByLane[card.laneId]?.push(card);
  }
  const runsBySession = buildBoardRunsBySession(board.projectId, allCards);
  return {
    id: board.id,
    projectId: board.projectId,
    lanes: lanes.map(lane => ({
      ...lane,
      cards: cardsByLane[lane.id].map(card => ({
        ...withSessionDetails(card, runsBySession),
        activeLaneRun: card.activeLaneRunId ? getRun(card.activeLaneRunId) : null,
      })),
    })),
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}
