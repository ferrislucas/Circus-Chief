// last_activity_at is a denormalized column on `sessions`, maintained by
// triggers as messages/command-runs/summaries are written (see
// migrations/miscMigrations.js:workspace-list-activity-column and the
// trg_sessions_activity_on_* triggers in schema.sql). Aggregating MAX(s.last_activity_at)
// here costs nothing beyond the tree scan the query already has to do for
// running/scheduled/waiting counts. A prior version of this query computed
// workspace activity with a correlated subquery (4-way UNION join per root),
// which forced a full per-request scan of every session's messages/runs/
// summaries before LIMIT could apply — O(project size) on every list request.
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
      MAX(s.last_activity_at) AS last_activity_at,
      COUNT(*) - 1 AS descendant_count
    FROM tree JOIN sessions s ON s.id = tree.id GROUP BY tree.root_id
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
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Array.isArray(value) && value.length === 5
      && typeof value[0] === 'number' && value.slice(1, 4).every(Number.isFinite)
      && typeof value[4] === 'string' ? value : null;
  } catch { return null; }
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify([
    Number(row.starred), row.sort_activity, row.updatedAt, row.createdAt, row.id,
  ])).toString('base64url');
}

/**
 * Fetch a card page and its authoritative facets from a single aggregate walk.
 * Cursor pagination uses the complete descending sort tuple, so an activity
 * promotion between pages cannot create an offset gap.
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
  } = options;
  const { filters: baseFilters, params: baseParams } = workspaceFilters(
    { archived, starred, status: null, scheduled }, { includeStatus: false },
  );
  const { filters: pageFilters } = workspaceFilters({ archived, starred, status, scheduled });
  // pageFilters duplicate root/base conditions; use only its status predicates.
  const statusFilters = pageFilters
    .filter(filter => filter.includes('a.running_count'))
    .map(filter => filter.replaceAll('a.running_count', 'runningCount'));
  const cursorValues = decodeCursor(cursor);
  const cursorClause = cursorValues
    ? 'AND (starred, sort_activity, updatedAt, createdAt, id) < (?, ?, ?, ?, ?)'
    : '';
  const sql = `${WORKSPACE_AGGREGATES_CTE}
    , base AS (
      SELECT s.id, s.project_id AS projectId, s.name, s.status, s.starred, s.archived,
      s.pr_url AS prUrl, s.git_worktree AS gitWorktree,
      s.scheduled_at AS scheduledAt, s.created_at AS createdAt,
      s.updated_at AS updatedAt, a.last_activity_at AS last_activity_at,
      COALESCE(a.last_activity_at, s.updated_at, s.created_at) AS sort_activity,
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
    ), facet_counts AS (
      SELECT COALESCE(SUM(CASE WHEN runningCount > 0 THEN 1 ELSE 0 END), 0) AS running,
        COALESCE(SUM(CASE WHEN runningCount = 0 THEN 1 ELSE 0 END), 0) AS idle
      FROM base
    ), filtered AS (
      SELECT * FROM base WHERE 1=1 ${statusFilters.length ? `AND ${statusFilters.join(' AND ')}` : ''}
    )
    SELECT filtered.*, facet_counts.running AS facetRunning, facet_counts.idle AS facetIdle
    FROM facet_counts LEFT JOIN filtered ON 1=1 ${cursorClause}
    ORDER BY starred DESC, sort_activity DESC, updatedAt DESC, createdAt DESC, id DESC
    LIMIT ? ${cursorValues ? '' : 'OFFSET ?'}`;
  // base filters contain the project id placeholder from the aggregate CTE plus
  // their own root filter. Status conditions use no placeholders.
  const rows = db.prepare(sql).all(
    projectId, projectId, ...baseParams, ...(cursorValues || []), limit + 1,
    ...(cursorValues ? [] : [offset]),
  );
  const pageRows = rows.filter(row => row.id);
  const hasMore = pageRows.length > limit;
  const visibleRows = pageRows.slice(0, limit);
  const cards = visibleRows.map(toWorkspaceCard);
  const facets = { running: rows[0]?.facetRunning || 0, idle: rows[0]?.facetIdle || 0 };
  return {
    cards,
    facets,
    hasMore,
    nextCursor: hasMore ? encodeCursor(visibleRows.at(-1)) : null,
  };
}

export function getWorkspaceCards(db, projectId, options = {}) {
  return getWorkspaceCardPage(db, projectId, options).cards;
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
    descendantCount: row.descendantCount,
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
