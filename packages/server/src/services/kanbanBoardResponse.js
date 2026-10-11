import { kanbanCards, kanbanLanes, commandRuns, sessions, databaseManager } from '../database.js';
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

/**
 * Count queued lane-entry events per lane. Returns an empty map when the
 * queue state predates the feature (no entry-events table or no status
 * column), so old databases read as "nothing queued".
 */
function buildQueuedCountsByLane() {
  try {
    const db = databaseManager.get();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kanban_lane_entry_events'").get();
    if (!tables) return new Map();
    // Count only valid owning queued entries: an orphan left behind by a
    // deletion must never inflate the badge (FR-3).
    const rows = db.prepare(`SELECT e.lane_id AS lane_id, COUNT(*) AS queued FROM kanban_lane_entry_events e
      WHERE e.status='queued'
        AND EXISTS (SELECT 1 FROM kanban_cards c WHERE c.id=e.card_id AND c.lane_id=e.lane_id)
      GROUP BY e.lane_id`).all();
    return new Map(rows.map((row) => [row.lane_id, row.queued]));
  } catch {
    return new Map();
  }
}

/**
 * Resolve each card's linked entry-event status. Only 'queued' is surfaced
 * (as `entryStatus: 'queued'`) so the board can render a paused chip;
 * other states stay internal outbox detail.
 */
function buildQueuedEntryStatusByEventId(cards) {
  const eventIds = [...new Set(cards.map((card) => card.laneEntryEventId).filter(Boolean))];
  if (!eventIds.length) return new Map();
  try {
    const db = databaseManager.get();
    const placeholders = eventIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, status FROM kanban_lane_entry_events WHERE id IN (${placeholders})`)
      .all(...eventIds);
    return new Map(rows.filter((row) => row.status === 'queued').map((row) => [row.id, row.status]));
  } catch {
    return new Map();
  }
}

/** Build the canonical full Kanban board response used by route and service callers. */
export function buildFullBoardResponse(board) {
  if (!board) return null;
  const lanes = kanbanLanes.getByBoardId(board.id);
  const cardsByLane = Object.fromEntries(lanes.map(lane => [lane.id, []]));
  const allCards = kanbanCards.getByBoardId(board.id);
  const queuedCounts = buildQueuedCountsByLane();
  const queuedStatusByEventId = buildQueuedEntryStatusByEventId(allCards);
  for (const card of allCards) {
    cardsByLane[card.laneId]?.push(card);
  }
  const runsBySession = buildBoardRunsBySession(board.projectId, allCards);
  return {
    id: board.id,
    projectId: board.projectId,
    lanes: lanes.map(lane => ({
      ...lane,
      queuedCount: queuedCounts.get(lane.id) || 0,
      cards: cardsByLane[lane.id].map(card => ({
        ...withSessionDetails(card, runsBySession),
        activeLaneRun: card.activeLaneRunId ? getRun(card.activeLaneRunId) : null,
        ...(queuedStatusByEventId.get(card.laneEntryEventId) ? { entryStatus: 'queued' } : {}),
      })),
    })),
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}
