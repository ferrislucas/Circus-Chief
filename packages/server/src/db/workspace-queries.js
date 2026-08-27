// last_activity_at is a denormalized column on `sessions`, maintained by
// triggers as messages/command-runs/summaries are written (see
// migrations/miscMigrations.js:workspace-list-activity-column and the
// trg_sessions_activity_on_* triggers in schema.sql). Aggregating MAX(s.last_activity_at)
// here costs nothing beyond the tree scan the query already has to do for
// running/scheduled/waiting counts. A prior version of this query computed
// workspace activity with a correlated subquery (4-way UNION join per root),
// which forced a full per-request scan of every session's messages/runs/
// summaries before LIMIT could apply — O(project size) on every list request.
// Session metadata updates are activity too, so take the greatest timestamp
// per member before aggregating. COALESCE(last_activity_at, updated_at, ...)
// would permanently mask updated_at after the activity column is backfilled.
const WORKSPACE_AGGREGATES_CTE = `
  WITH RECURSIVE tree(root_id, id, project_id, path) AS (
    SELECT id, id, project_id, '/' || id || '/'
    FROM sessions WHERE project_id = @project_tree AND parent_session_id IS NULL
      AND (@target_root IS NULL OR id = @target_root)
    UNION ALL
    SELECT tree.root_id, s.id, tree.project_id, tree.path || s.id || '/'
    FROM sessions s
    JOIN tree ON s.parent_session_id = tree.id AND s.project_id = tree.project_id
    WHERE instr(tree.path, '/' || s.id || '/') = 0
  ), aggregates AS (
    SELECT tree.root_id,
      SUM(CASE WHEN s.status IN ('running', 'starting') THEN 1 ELSE 0 END) AS running_count,
      GROUP_CONCAT(CASE WHEN s.status IN ('running', 'starting') THEN s.id END ORDER BY s.id = tree.root_id DESC, s.id) AS running_session_ids,
      GROUP_CONCAT(s.id ORDER BY s.id = tree.root_id DESC, s.id) AS member_ids,
      SUM(CASE WHEN s.status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled_count,
      MIN(CASE WHEN s.status = 'scheduled' THEN s.scheduled_at END) AS nearest_scheduled_at,
      -- "Waiting" means blocked on AskUserQuestion/permission (pending_agent_input),
      -- NOT status='waiting' (which just means "turn ended, idle" and is set on
      -- nearly every completed session). See project-activity-queries.js for the
      -- fuller rationale; this CTE must use the same definition or the project-list
      -- "waiting" pill and its embedded workspace-card list disagree about which
      -- workspaces actually need a response.
      SUM(CASE WHEN s.pending_agent_input = 1 THEN 1 ELSE 0 END) AS waiting_count,
      MAX(MAX(COALESCE(s.last_activity_at, 0), COALESCE(s.updated_at, 0), COALESCE(s.created_at, 0))) AS last_activity_at,
      COUNT(*) - 1 AS descendant_count
    FROM tree JOIN sessions s ON s.id = tree.id GROUP BY tree.root_id
  )`;

function workspaceFilters({ archived, starred, scheduled, rootId = null }) {
  const filters = [
    's.project_id = @project_root',
    's.parent_session_id IS NULL',
    's.archived = @archived',
  ];
  const params = { archived: archived ? 1 : 0 };
  if (starred !== null) {
    filters.push('s.starred = @starred');
    params.starred = starred ? 1 : 0;
  }
  if (scheduled === true) filters.push('a.scheduled_count > 0');
  if (scheduled === false) filters.push('a.scheduled_count = 0');
  if (rootId) {
    filters.push('s.id = @root_id');
    params.root_id = rootId;
  }
  return { filters, params };
}

/**
 * Return status predicates for a workspace aggregate column.
 */
function statusPredicates(status) {
  if (status === 'running') return ['runningCount > 0'];
  if (status === 'waiting') return ['waitingCount > 0'];
  if (status === 'idle') return ['runningCount = 0'];
  return [];
}

/** Decode a validated workspace-card cursor, returning null for malformed values. */
export function decodeWorkspaceCardCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Array.isArray(value) &&
      value.length === 5 &&
      value.slice(0, 4).every(Number.isFinite) &&
      typeof value[4] === 'string'
      ? value
      : null;
  } catch {
    return null;
  }
}

export function isValidWorkspaceCardCursor(cursor) {
  return (
    cursor === undefined ||
    (typeof cursor === 'string' &&
      cursor.length <= 512 &&
      (!cursor || decodeWorkspaceCardCursor(cursor)))
  );
}

function encodeCursor(row) {
  return Buffer.from(
    JSON.stringify([Number(row.starred), row.sort_activity, row.updatedAt, row.createdAt, row.id])
  ).toString('base64url');
}

function cardPageParams(projectId, baseParams, options) {
  const { limit, offset, cursorValues, rootId = null } = options;
  const params = {
    project_tree: projectId,
    target_root: rootId,
    project_root: projectId,
    ...baseParams,
    limit: limit + 1,
    offset,
  };
  cursorValues?.forEach((value, index) => {
    params[`cur_${index}`] = value;
  });
  return params;
}

function parseCardPageRows(resultRows, limit) {
  const facetRow = resultRows.find((row) => row.row_kind === 'facets');
  const rows = resultRows.filter((row) => row.row_kind === 'page');
  return {
    visibleRows: rows.slice(0, limit),
    hasMore: rows.length > limit,
    facets: {
      running: facetRow?.facet_running || 0,
      idle: facetRow?.facet_idle || 0,
      waiting: facetRow?.facet_waiting || 0,
    },
  };
}

function buildWorkspaceCardPageSql(baseFilters, statusFilters, cursorClause, hasCursor) {
  return `${WORKSPACE_AGGREGATES_CTE}
    , base AS (
      SELECT s.id, s.project_id AS projectId, s.name, s.status, s.starred, s.archived,
      s.pr_url AS prUrl, s.git_worktree AS gitWorktree,
      s.scheduled_at AS scheduledAt, s.created_at AS createdAt,
      s.updated_at AS updatedAt, a.last_activity_at AS last_activity_at,
      a.last_activity_at AS sort_activity,
      a.running_count AS runningCount, a.scheduled_count AS scheduledCount,
      a.running_session_ids AS runningSessionIds, a.member_ids AS memberIds,
      a.waiting_count AS waitingCount, a.descendant_count AS descendantCount,
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
    WHERE ${baseFilters.join(' AND ')}
    ), filtered AS (
      SELECT * FROM base WHERE 1=1 ${statusFilters.length ? `AND ${statusFilters.join(' AND ')}` : ''}
    ), facets AS (
      SELECT
        COALESCE(SUM(CASE WHEN runningCount > 0 THEN 1 ELSE 0 END), 0) AS running,
        COALESCE(SUM(CASE WHEN runningCount = 0 THEN 1 ELSE 0 END), 0) AS idle,
        COALESCE(SUM(CASE WHEN waitingCount > 0 THEN 1 ELSE 0 END), 0) AS waiting
      FROM base
    ), paged AS (
      SELECT * FROM filtered WHERE 1=1 ${cursorClause}
      ORDER BY starred DESC, sort_activity DESC, updatedAt DESC, createdAt DESC, id DESC
      LIMIT @limit ${hasCursor ? '' : 'OFFSET @offset'}
    )
    SELECT 'page' AS row_kind, paged.*, NULL AS facet_running, NULL AS facet_idle, NULL AS facet_waiting
    FROM paged
    UNION ALL
    SELECT 'facets' AS row_kind,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, facets.running, facets.idle, facets.waiting
    FROM facets`;
}

/**
 * Fetch a card page and its authoritative facets.
 *
 * Offset pagination is stable only for an unchanged dataset. Aggregate filters
 * walk every workspace tree, so database work is not bounded by the visible
 * page. Cursor pagination uses the complete descending sort tuple so an
 * activity promotion between pages cannot create an offset gap. A maintained
 * workspace projection with single-card invalidation is the long-term path.
 */
export function getWorkspaceCardPage(db, projectId, options = {}) {
  const {
    archived = false,
    starred = null,
    status = null,
    scheduled = null,
    limit = 50,
    offset = 0,
    cursor = null,
    rootId = null,
  } = options;
  const { filters: baseFilters, params: baseParams } = workspaceFilters({
    archived,
    starred,
    scheduled,
    rootId,
  });
  const statusFilters = statusPredicates(status);
  const cursorValues = decodeWorkspaceCardCursor(cursor);
  const cursorClause = cursorValues
    ? 'AND (starred, sort_activity, updatedAt, createdAt, id) < (@cur_0, @cur_1, @cur_2, @cur_3, @cur_4)'
    : '';
  const sql = buildWorkspaceCardPageSql(baseFilters, statusFilters, cursorClause, Boolean(cursorValues));
  const resultRows = db.prepare(sql).all(
    cardPageParams(projectId, baseParams, {
      limit,
      offset,
      cursorValues,
      rootId,
    })
  );
  const { visibleRows, hasMore, facets } = parseCardPageRows(resultRows, limit);
  const cards = visibleRows.map(toWorkspaceCard);
  return {
    cards,
    facets,
    hasMore,
    nextCursor: hasMore ? encodeCursor(visibleRows.at(-1)) : null,
  };
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
    descendantCount: row.descendantCount,
    nearestScheduledAt: row.nearestScheduledAt || null,
    summaryPreview: row.summaryPreview || null,
    prState: row.prState || null,
    hasMergeConflicts:
      row.hasMergeConflicts === null || row.hasMergeConflicts === undefined
        ? null
        : Boolean(row.hasMergeConflicts),
    ciStatus: row.ciStatus || null,
    kanban: row.kanbanCardId
      ? { cardId: row.kanbanCardId, laneId: row.laneId, laneName: row.laneName }
      : null,
  };
}
