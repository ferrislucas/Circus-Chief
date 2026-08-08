import { ACTIVITY_FIELDS_SQL } from './session-helpers.js';

/** Return the lightweight workspace-card projection used by the list view. */
export function getWorkspaceCards(db, projectId, { archived = false, starred = null, status = null, scheduled = null, limit = 50, offset = 0 } = {}) {
  const filters = ['s.project_id = ?', 's.parent_session_id IS NULL', 's.archived = ?'];
  const params = [projectId, archived ? 1 : 0];
  if (starred !== null) { filters.push('s.starred = ?'); params.push(starred ? 1 : 0); }

  const eligibility = [];
  if (status === 'running') eligibility.push('a.running_count > 0');
  if (status === 'idle') eligibility.push('a.running_count = 0');
  if (scheduled === true) eligibility.push('a.scheduled_count > 0');
  if (scheduled === false) eligibility.push('a.scheduled_count = 0');
  const having = eligibility.length ? ` AND ${eligibility.join(' AND ')}` : '';
  const sql = `
    WITH RECURSIVE tree(root_id, id) AS (
      SELECT id, id FROM sessions WHERE project_id = ? AND parent_session_id IS NULL
      UNION ALL
      SELECT tree.root_id, s.id FROM sessions s JOIN tree ON s.parent_session_id = tree.id
    ), aggregates AS (
      SELECT tree.root_id,
        SUM(CASE WHEN s.status IN ('running', 'starting') THEN 1 ELSE 0 END) AS running_count,
        SUM(CASE WHEN s.status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled_count,
        MIN(CASE WHEN s.status = 'scheduled' THEN s.scheduled_at END) AS nearest_scheduled_at,
        SUM(CASE WHEN s.status = 'waiting' THEN 1 ELSE 0 END) AS waiting_count,
        COUNT(*) - 1 AS member_count
      FROM tree JOIN sessions s ON s.id = tree.id GROUP BY tree.root_id
    )
    SELECT s.id, s.project_id AS projectId, s.name, s.status, s.starred, s.archived,
      s.pr_url AS prUrl, s.scheduled_at AS scheduledAt, s.created_at AS createdAt,
      s.updated_at AS updatedAt, ${ACTIVITY_FIELDS_SQL},
      a.running_count AS runningCount, a.scheduled_count AS scheduledCount,
      a.waiting_count AS waitingCount, a.member_count AS memberCount,
      a.nearest_scheduled_at AS nearestScheduledAt,
      ss.short_summary AS summaryPreview,
      kc.id AS kanbanCardId, kl.id AS laneId, kl.name AS laneName
    FROM sessions s JOIN aggregates a ON a.root_id = s.id
    LEFT JOIN session_summaries ss ON ss.session_id = s.id
    LEFT JOIN kanban_card_sessions kcs ON kcs.session_id = s.id
    LEFT JOIN kanban_cards kc ON kc.id = kcs.card_id
    LEFT JOIN kanban_lanes kl ON kl.id = kc.lane_id
    WHERE ${filters.join(' AND ')}${having}
    ORDER BY s.starred DESC, COALESCE(last_activity_at, s.updated_at, s.created_at) DESC,
      s.updated_at DESC, s.created_at DESC, s.rowid DESC
    LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(projectId, ...params, limit, offset);
  return rows.map(toWorkspaceCard);
}

function toWorkspaceCard(row) {
  return {
    id: row.id, projectId: row.projectId, name: row.name, status: row.status,
    starred: Boolean(row.starred), archived: Boolean(row.archived), prUrl: row.prUrl,
    scheduledAt: row.scheduledAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
    lastActivityAt: row.last_activity_at, runningCount: row.runningCount,
    scheduledCount: row.scheduledCount, waitingCount: row.waitingCount,
    memberCount: row.memberCount, nearestScheduledAt: row.nearestScheduledAt || null,
    summaryPreview: row.summaryPreview || null,
    kanban: row.kanbanCardId ? { cardId: row.kanbanCardId, laneId: row.laneId, laneName: row.laneName } : null,
  };
}

/** Return the compact ancestor/descendant tree used by a workspace shell. */
export function getWorkspaceMembers(db, rootId) {
  const rows = db.prepare(`
    WITH RECURSIVE tree(id, parent_session_id, depth, path) AS (
      SELECT id, parent_session_id, 0, id FROM sessions WHERE id = ?
      UNION ALL
      SELECT s.id, s.parent_session_id, tree.depth + 1, tree.path || '/' || s.id
      FROM sessions s JOIN tree ON s.parent_session_id = tree.id
      WHERE instr(tree.path, s.id) = 0
    )
    SELECT s.id, s.project_id AS projectId, s.parent_session_id AS parentSessionId,
      s.name, s.status, s.starred, s.archived, s.scheduled_at AS scheduledAt,
      s.created_at AS createdAt, s.updated_at AS updatedAt, tree.depth,
      ss.short_summary AS summaryPreview
    FROM tree JOIN sessions s ON s.id = tree.id
    LEFT JOIN session_summaries ss ON ss.session_id = s.id ORDER BY tree.path
  `).all(rootId);
  return rows.map(row => ({
    id: row.id, projectId: row.projectId, parentSessionId: row.parentSessionId,
    name: row.name, status: row.status, starred: Boolean(row.starred),
    archived: Boolean(row.archived), scheduledAt: row.scheduledAt,
    createdAt: row.createdAt, updatedAt: row.updatedAt, depth: row.depth,
    summaryPreview: row.summaryPreview || null,
  }));
}
