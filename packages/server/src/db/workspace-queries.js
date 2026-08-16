const WORKSPACE_AGGREGATES_CTE = `
  WITH RECURSIVE tree(root_id, id, project_id, path) AS (
    SELECT id, id, project_id, '/' || id || '/'
    FROM sessions WHERE project_id = ? AND parent_session_id IS NULL
    UNION ALL
    SELECT tree.root_id, s.id, tree.project_id, tree.path || s.id || '/'
    FROM sessions s
    JOIN tree ON s.parent_session_id = tree.id AND s.project_id = tree.project_id
    WHERE instr(tree.path, '/' || s.id || '/') = 0
  ), aggregates AS (
    SELECT tree.root_id,
      SUM(CASE WHEN s.status IN ('running', 'starting') THEN 1 ELSE 0 END) AS running_count,
      GROUP_CONCAT(CASE WHEN s.status IN ('running', 'starting') THEN s.id END) AS running_session_ids,
      GROUP_CONCAT(s.id) AS member_ids,
      SUM(CASE WHEN s.status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled_count,
      MIN(CASE WHEN s.status = 'scheduled' THEN s.scheduled_at END) AS nearest_scheduled_at,
      SUM(CASE WHEN s.status = 'waiting' THEN 1 ELSE 0 END) AS waiting_count,
      COUNT(*) - 1 AS member_count
    FROM tree JOIN sessions s ON s.id = tree.id GROUP BY tree.root_id
  )`;

const WORKSPACE_LAST_ACTIVITY_SQL = `(
  SELECT MAX(activity_at) FROM (
    SELECT cm.timestamp AS activity_at
    FROM conversation_messages cm JOIN tree activity_tree ON activity_tree.id = cm.session_id
    WHERE activity_tree.root_id = s.id
    UNION ALL
    SELECT ss.generated_at
    FROM session_summaries ss JOIN tree activity_tree ON activity_tree.id = ss.session_id
    WHERE activity_tree.root_id = s.id
    UNION ALL
    SELECT ss.updated_at
    FROM session_summaries ss JOIN tree activity_tree ON activity_tree.id = ss.session_id
    WHERE activity_tree.root_id = s.id
    UNION ALL
    SELECT COALESCE(cr.completed_at, cr.started_at)
    FROM command_runs cr JOIN tree activity_tree ON activity_tree.id = cr.session_id
    WHERE activity_tree.root_id = s.id
  ) WHERE activity_at IS NOT NULL
)`;

function workspaceFilters({ archived, starred, status, scheduled }, { includeStatus = true } = {}) {
  const filters = ['s.project_id = ?', 's.parent_session_id IS NULL', 's.archived = ?'];
  const params = [archived ? 1 : 0];
  if (starred !== null) {
    filters.push('s.starred = ?');
    params.push(starred ? 1 : 0);
  }
  if (includeStatus && status === 'running') filters.push('a.running_count > 0');
  if (includeStatus && status === 'idle') filters.push('a.running_count = 0');
  if (scheduled === true) filters.push('a.scheduled_count > 0');
  if (scheduled === false) filters.push('a.scheduled_count = 0');
  return { filters, params };
}

/**
 * Return one stable offset page for an unchanged dataset.
 *
 * This is an intentional short-term consistency strategy. Aggregate filters
 * walk the project's workspace trees, so database work is not bounded by the
 * visible page. Concurrent activity can reorder rows between offset requests.
 * The long-term replacement is a maintained workspace projection with
 * single-card invalidation.
 */
// eslint-disable-next-line max-lines-per-function
export function getWorkspaceCards(db, projectId, options = {}) {
  const {
    archived = false,
    starred = null,
    status = null,
    scheduled = null,
    limit = 50,
    offset = 0,
  } = options;
  const { filters, params } = workspaceFilters({ archived, starred, status, scheduled });
  const sql = `${WORKSPACE_AGGREGATES_CTE}
    SELECT s.id, s.project_id AS projectId, s.name, s.status, s.starred, s.archived,
      s.pr_url AS prUrl, s.git_worktree AS gitWorktree,
      s.scheduled_at AS scheduledAt, s.created_at AS createdAt,
      s.updated_at AS updatedAt, ${WORKSPACE_LAST_ACTIVITY_SQL} AS last_activity_at,
      a.running_count AS runningCount, a.scheduled_count AS scheduledCount,
      a.running_session_ids AS runningSessionIds, a.member_ids AS memberIds,
      a.waiting_count AS waitingCount, a.member_count AS memberCount,
      a.nearest_scheduled_at AS nearestScheduledAt,
      ss.short_summary AS summaryPreview,
      ss.pr_state AS prState, ss.has_merge_conflicts AS hasMergeConflicts,
      ss.ci_status AS ciStatus,
      kc.id AS kanbanCardId, kl.id AS laneId, kl.name AS laneName
    FROM sessions s JOIN aggregates a ON a.root_id = s.id
    LEFT JOIN session_summaries ss ON ss.session_id = s.id
    LEFT JOIN kanban_card_sessions kcs ON kcs.session_id = s.id
    LEFT JOIN kanban_cards kc ON kc.id = kcs.card_id
    LEFT JOIN kanban_lanes kl ON kl.id = kc.lane_id
    WHERE ${filters.join(' AND ')}
    ORDER BY s.starred DESC,
      COALESCE(last_activity_at, s.updated_at, s.created_at) DESC,
      s.updated_at DESC, s.created_at DESC, s.id DESC
    LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(projectId, projectId, ...params, limit, offset);
  return rows.map(toWorkspaceCard);
}

/** Return authoritative status facets for the current non-status filters. */
export function getWorkspaceCardCounts(db, projectId, options = {}) {
  const { archived = false, starred = null, scheduled = null } = options;
  const { filters, params } = workspaceFilters(
    { archived, starred, status: null, scheduled },
    { includeStatus: false },
  );
  const row = db.prepare(`${WORKSPACE_AGGREGATES_CTE}
    SELECT
      COALESCE(SUM(CASE WHEN a.running_count > 0 THEN 1 ELSE 0 END), 0) AS running,
      COALESCE(SUM(CASE WHEN a.running_count = 0 THEN 1 ELSE 0 END), 0) AS idle
    FROM sessions s JOIN aggregates a ON a.root_id = s.id
    WHERE ${filters.join(' AND ')}`).get(projectId, projectId, ...params);
  return { running: row.running, idle: row.idle };
}

function toWorkspaceCard(row) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    status: row.status,
    starred: Boolean(row.starred),
    archived: Boolean(row.archived),
    prUrl: row.prUrl,
    gitWorktree: row.gitWorktree || null,
    scheduledAt: row.scheduledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastActivityAt: row.last_activity_at,
    runningCount: row.runningCount,
    runningSessionIds: row.runningSessionIds ? row.runningSessionIds.split(',') : [],
    memberIds: row.memberIds ? row.memberIds.split(',') : [row.id],
    scheduledCount: row.scheduledCount,
    waitingCount: row.waitingCount,
    memberCount: row.memberCount,
    nearestScheduledAt: row.nearestScheduledAt || null,
    summaryPreview: row.summaryPreview || null,
    prState: row.prState || null,
    hasMergeConflicts: row.hasMergeConflicts === null || row.hasMergeConflicts === undefined
      ? null
      : Boolean(row.hasMergeConflicts),
    ciStatus: row.ciStatus || null,
    kanban: row.kanbanCardId
      ? { cardId: row.kanbanCardId, laneId: row.laneId, laneName: row.laneName }
      : null,
  };
}
