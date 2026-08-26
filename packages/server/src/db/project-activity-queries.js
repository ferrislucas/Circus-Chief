// Aggregates per-project "active workspace" data for the project list.
//
// This is a sibling of workspace-queries.js's WORKSPACE_AGGREGATES_CTE: that CTE
// is parameterized by a single project and is on the Kanban/workspace-list hot
// path, so its query *shape* (the recursive tree walk, the join strategy) is
// deliberately left untouched here. This query groups roots by project_id
// across *all* projects in one pass instead.
//
// "Waiting" is s.pending_agent_input = 1 (persisted by promptStore.js), NOT
// s.status = 'waiting'. The status value 'waiting' means "turn ended
// normally, idle, ready for follow-up" — it is set on essentially every
// session that has ever completed a turn (streamEventCallbacks.js) or was
// created without startImmediately (projects-session-helpers.js), so treating
// it as "needs an answer" made nearly every idle session match. A session
// genuinely blocked on AskUserQuestion/permission stays status='running' for
// the whole time it's blocked; pending_agent_input is the only signal for
// that. Because a session can be both running AND pending_agent_input at the
// same time, running_count and waiting_count are NOT disjoint — active_count
// is computed with an OR, not a sum, to avoid double-counting that session.
// WORKSPACE_AGGREGATES_CTE's waiting_count uses this same pending_agent_input
// definition (not status='waiting') so the project-list "waiting" pill and its
// embedded per-project workspace-card list agree on which sessions match.
//
// Performance constraint (see the header comment on workspace-queries.js): do
// not reintroduce correlated subqueries over messages/command_runs/
// session_summaries. This statement reads `sessions` only. The EXPLAIN QUERY
// PLAN unit test asserts that invariant on every CI pass.
export const PROJECT_ACTIVITY_SQL = `
  WITH RECURSIVE tree(root_id, project_id, id, path) AS (
    SELECT id, project_id, id, '/' || id || '/'
    FROM sessions WHERE parent_session_id IS NULL AND archived = 0
    UNION ALL
    SELECT tree.root_id, tree.project_id, s.id, tree.path || s.id || '/'
    FROM sessions s
    JOIN tree ON s.parent_session_id = tree.id AND s.project_id = tree.project_id
    WHERE instr(tree.path, '/' || s.id || '/') = 0
  ), agg AS (
    SELECT tree.root_id, tree.project_id, r.name,
      SUM(CASE WHEN s.status IN ('running', 'starting') THEN 1 ELSE 0 END) AS running_count,
      SUM(CASE WHEN s.pending_agent_input = 1 THEN 1 ELSE 0 END) AS waiting_count,
      SUM(CASE WHEN s.status IN ('running', 'starting') OR s.pending_agent_input = 1 THEN 1 ELSE 0 END) AS active_count,
      MAX(MAX(COALESCE(s.last_activity_at, 0), COALESCE(s.updated_at, 0), COALESCE(s.created_at, 0))) AS last_activity_at
    FROM tree
    JOIN sessions s ON s.id = tree.id
    JOIN sessions r ON r.id = tree.root_id
    GROUP BY tree.root_id
  )
  SELECT root_id AS rootId, project_id AS projectId, name,
    running_count AS runningCount, waiting_count AS waitingCount, active_count AS activeCount,
    last_activity_at AS lastActivityAt
  FROM agg
  WHERE active_count > 0
  ORDER BY project_id, last_activity_at DESC, root_id DESC
`;

/**
 * Aggregate per-project active-workspace data across all projects.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Map<string, {
 *   runningSessionCount: number,
 *   waitingSessionCount: number,
 *   runningWorkspaces: Array<{ id: string, name: string, activeCount: number }>
 * }>}
 */
export function getProjectActivityAggregates(db) {
  const rows = db.prepare(PROJECT_ACTIVITY_SQL).all();
  const map = new Map();
  for (const row of rows) {
    let project = map.get(row.projectId);
    if (!project) {
      project = { runningSessionCount: 0, waitingSessionCount: 0, runningWorkspaces: [] };
      map.set(row.projectId, project);
    }
    project.runningSessionCount += row.runningCount;
    project.waitingSessionCount += row.waitingCount;
    project.runningWorkspaces.push({
      id: row.rootId,
      name: row.name,
      activeCount: row.activeCount,
    });
  }
  return map;
}