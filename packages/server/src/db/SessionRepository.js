/* eslint-disable max-lines -- Session persistence APIs share a mapper and transaction boundary. */
import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';
import { messages, conversations } from './index.js';
import { SESSION_EXECUTION_STATES } from '@circuschief/shared';
import {
  ACTIVITY_FIELDS_SQL,
  SESSION_ORDER_BY,
  applySessionFilters,
  mapTokenUsage,
  mapScheduling,
  mapWorkflow,
  parseCreateConfig,
  buildUpdateClauses,
  claimScheduledRow,
  DEFAULT_AGENT_TYPE,
  resolveAgentTypeFromModel,
} from './session-helpers.js';
import { getWorkspaceCardPage } from './workspace-queries.js';

/**
 * Session repository class
 */
export class SessionRepository extends BaseRepository {
  constructor() {
    super('sessions', SessionRepository.#mapSession);
  }

  static #mapSession(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      status: row.status,
      mode: row.mode,
      model: row.model,
      providerId: row.provider_id || null,
      thinkingEnabled: Boolean(row.thinking_enabled),
      archived: Boolean(row.archived),
      starred: Boolean(row.starred),
      manuallyNamed: Boolean(row.manually_named),
      gitBranch: row.git_branch,
      gitWorktree: row.git_worktree,
      prUrl: row.pr_url,
      prUrlAutoLinkDisabled: Boolean(row.pr_url_auto_link_disabled),
      error: row.error,
      costUsd: row.cost_usd,
      claudeSessionId: row.claude_session_id,
      nextTemplateId: row.next_template_id,
      parentSessionId: row.parent_session_id,
      pendingPrompt: row.pending_prompt || null,
      pendingModel: row.pending_model || null,
      effortLevel: row.effort_level || null,
      autoSendPendingPrompt: Boolean(row.auto_send_pending_prompt),
      slashCommands: row.slash_commands || null,
      // Agent runtime driving this session (fallback to 'claude-code' for legacy rows).
      agentType: row.agent_type || DEFAULT_AGENT_TYPE,
      ...mapTokenUsage(row),
      ...mapScheduling(row),
      // Kanban fields
      laneTriggerDepth: row.lane_trigger_depth || 0,
      ...mapWorkflow(row),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivityAt: row.last_activity_at ?? null,
      lastMessageAt: row.last_message_at ?? null,
      activeTimeMs: row.active_time_ms || 0,
    };
  }

  /** Override getById to include computed last_activity_at and active_time_ms fields */
  getById(id) {
    const row = this.db
      .prepare(`SELECT s.*, ${ACTIVITY_FIELDS_SQL} FROM sessions s WHERE s.id = ?`)
      .get(id);
    return this.map(row);
  }

  /** Batch-fetch multiple sessions by their IDs in a single query. Unknown IDs are silently omitted. */
  getByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT s.*, ${ACTIVITY_FIELDS_SQL} FROM sessions s WHERE s.id IN (${placeholders})`)
      .all(...ids);
    return this.mapAll(rows);
  }

  /** Create a new session with optional config (mode, thinkingEnabled, gitBranch, parentSessionId, status, model, providerId, effortLevel, agentType) */
  create(projectId, name, prompt, options = {}) {
    const config = parseCreateConfig(options, Array.prototype.slice.call(arguments, 4));

    // Resolve agentType: explicit override → model-based derivation → fallback.
    // resolveAgentTypeFromModel(null) returns DEFAULT_AGENT_TYPE, so the absent-model
    // case is covered without a separate branch.
    const agentType = config.agentType ?? resolveAgentTypeFromModel(config.model);

    const id = databaseManager.generateId();
    const now = Date.now();
    // Resolve workflow lineage before insertion. A child always preserves the
    // requested parent; it only joins a lane run while that workflow is open.
    const parentWorkflow = config.parentSessionId
      ? this.db.prepare('SELECT lane_run_id, own_work_state FROM sessions WHERE id = ?').get(config.parentSessionId)
      : null;
    const laneRunId = parentWorkflow?.own_work_state === 'open' && parentWorkflow.lane_run_id
      && this.db.prepare(`SELECT 1 FROM kanban_lane_runs r JOIN kanban_cards c ON c.id=r.card_id
        WHERE r.id=? AND r.status='open' AND c.active_lane_run_id=r.id AND c.lane_id=r.source_lane_id`)
        .get(parentWorkflow.lane_run_id)
      ? parentWorkflow.lane_run_id : null;
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, name, status, mode, thinking_enabled, git_branch, parent_session_id, model, provider_id, effort_level, agent_type, lane_run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, projectId, name, config.status, config.mode, config.thinkingEnabled ? 1 : 0,
        config.gitBranch, config.parentSessionId, config.model, config.providerId, config.effortLevel,
        agentType, laneRunId, now, now);

    // Create initial conversation
    const conversation = conversations.create(id, 'Initial', true);

    // Only create initial user message for sessions that start immediately
    // For waiting/scheduled sessions, the message will be created when they start
    if (config.status !== 'waiting' && config.status !== 'scheduled') {
      messages.create(id, 'user', prompt, { toolUse: null, conversationId: conversation.id });
    }

    return this.getById(id);
  }

  getByProjectId(projectId, { archived = null, starred = null, limit = null, offset = 0 } = {}) {
    let sql = `SELECT s.*, ${ACTIVITY_FIELDS_SQL} FROM sessions s WHERE project_id = ?`;
    const params = [projectId];
    sql = applySessionFilters(sql, params, { archived, starred });
    sql += SESSION_ORDER_BY;
    if (limit !== null) {
      sql += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);
    }
    return this.mapAll(this.db.prepare(sql).all(...params));
  }

  /**
   * Get only root sessions (workspaces) for a project — rows where parent_session_id IS NULL.
   * Uses the same ordering and optional filters as getByProjectId.
   */
  getRootsByProjectId(projectId, { archived = null, starred = null, limit = null, offset = 0 } = {}) {
    let sql = `SELECT s.*, ${ACTIVITY_FIELDS_SQL} FROM sessions s WHERE project_id = ? AND parent_session_id IS NULL`;
    const params = [projectId];
    sql = applySessionFilters(sql, params, { archived, starred });
    sql += SESSION_ORDER_BY;
    if (limit !== null) {
      sql += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);
    }
    return this.mapAll(this.db.prepare(sql).all(...params));
  }

  /** Count root sessions (workspaces) for a project */
  getRootsCountByProjectId(projectId, { archived = null, starred = null } = {}) {
    let sql = `SELECT COUNT(*) as count FROM sessions WHERE project_id = ? AND parent_session_id IS NULL`;
    const params = [projectId];
    sql = applySessionFilters(sql, params, { archived, starred });
    return this.db.prepare(sql).get(...params).count;
  }

  /**
   * Purpose-built list projection for workspace cards.  Unlike getRootsByProjectId,
   * this deliberately selects a small allowlist and computes workflow state in one
   * set-based query.  Keeping this here also prevents a future session column from
   * accidentally becoming part of the list payload.
   */
  getWorkspaceCardPage(projectId, options = {}) {
    return getWorkspaceCardPage(this.db, projectId, options);
  }

  getWorkspaceCard(projectId, rootId) {
    return getWorkspaceCardPage(this.db, projectId, { rootId, limit: 1 }).cards[0] || null;
  }

  /** Get count of sessions for a project with optional archived/starred filters */
  getCountByProjectId(projectId, { archived = null, starred = null } = {}) {
    let sql = `SELECT COUNT(*) as count FROM sessions WHERE project_id = ?`;
    const params = [projectId];
    sql = applySessionFilters(sql, params, { archived, starred });
    return this.db.prepare(sql).get(...params).count;
  }

  getActiveAndWaiting() {
    const rows = this.db
      .prepare(
        `SELECT s.*, p.name as project_name, p.working_directory as project_working_directory, ${ACTIVITY_FIELDS_SQL}
         FROM sessions s JOIN projects p ON s.project_id = p.id
         WHERE s.status IN ('starting', 'running', 'waiting') AND s.archived = 0
         ORDER BY s.starred DESC, COALESCE(last_activity_at, s.updated_at, s.created_at) DESC, s.updated_at DESC, s.created_at DESC, s.rowid DESC`
      )
      .all();
    return rows.map(row => ({
      ...SessionRepository.#mapSession(row),
      projectName: row.project_name,
      projectWorkingDirectory: row.project_working_directory,
    }));
  }

  /** Get all child sessions of a parent session */
  getChildSessions(parentSessionId) {
    const rows = this.db
      .prepare(
        `SELECT s.*, ${ACTIVITY_FIELDS_SQL} FROM sessions s
         WHERE parent_session_id = ?
         ORDER BY COALESCE(last_activity_at, updated_at, created_at) DESC, updated_at DESC, created_at DESC, rowid DESC`
      )
      .all(parentSessionId);
    return this.mapAll(rows);
  }

  /** Walk the parentSessionId chain upward to find the root session */
  getRootSessionId(sessionId) {
    let current = this.getById(sessionId);
    const visited = new Set();

    while (current?.parentSessionId) {
      if (visited.has(current.id)) break; // cycle guard
      visited.add(current.id);
      current = this.getById(current.parentSessionId);
    }

    return current?.id ?? null;
  }

  /** Collect all descendant session IDs recursively (does NOT include the starting session) */
  getAllDescendantIds(sessionId) {
    const stmt = this.db.prepare('SELECT id FROM sessions WHERE parent_session_id = ?');
    const descendantIds = [];
    const stack = [sessionId];
    const visited = new Set();

    while (stack.length > 0) {
      const currentId = stack.pop();
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const childRows = stmt.all(currentId);
      for (const row of childRows) {
        descendantIds.push(row.id);
        stack.push(row.id);
      }
    }

    return descendantIds;
  }

  update(id, data) {
    // execution_state is intentionally not an API-writable field, but it is
    // updated by the workflow service through this repository. Keep the
    // persistence boundary strict so a typo cannot strand a lane worker in a
    // state no client or recovery path understands.
    if (data.executionState !== undefined && !SESSION_EXECUTION_STATES.includes(data.executionState)) {
      throw new Error(`Invalid session execution state: ${data.executionState}`);
    }
    const { updates, values } = buildUpdateClauses(data);

    if (updates.length === 0) return this.getById(id);

    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
  }

  /**
   * Atomically claim a due scheduled session for execution. See
   * `claimScheduledRow` in session-helpers.js for the full contract.
   * @param {string} id - Session id to claim.
   * @param {{ promptOverride?: string }} [options]
   * @returns {object|null}
   */
  claimScheduled(id, { promptOverride } = {}) {
    return claimScheduledRow(this, id, promptOverride);
  }

  /**
   * Touch a session to update its updated_at timestamp without changing other fields.
   * This is used to mark a session as recently active (e.g., when a message is added).
   * @param {string} id - Session ID
   * @returns {Object|null} The updated session or null if not found
   */
  touch(id) {
    const now = Date.now();
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, id);
    return this.getById(id);
  }

  /** Duplicate a session with a new ID and reset state (does NOT handle git or conversation setup) */
  duplicate(sourceSessionId, { name } = {}) {
    const source = this.getById(sourceSessionId);
    if (!source) {
      throw new Error(`Session not found: ${sourceSessionId}`);
    }

    const id = databaseManager.generateId();
    const now = Date.now();
    const newName = name || `${source.name} (Copy)`;

    // Insert new session with same settings but new ID and status
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, name, status, mode, thinking_enabled, git_branch, model, provider_id, effort_level, agent_type, context_window,
                               input_tokens, output_tokens, thinking_tokens, cache_read_input_tokens, cache_creation_input_tokens,
                               web_search_requests, cost_usd, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        source.projectId,
        newName,
        'waiting',  // Always reset status to draft
        source.mode,
        source.thinkingEnabled ? 1 : 0,
        source.gitBranch,  // Copy branch name (NOT worktree path)
        source.model,
        source.providerId,
        source.effortLevel,
        source.agentType || DEFAULT_AGENT_TYPE,
        source.contextWindow,
        source.inputTokens,
        source.outputTokens,
        source.thinkingTokens,
        source.cacheReadInputTokens,
        source.cacheCreationInputTokens,
        source.webSearchRequests,
        source.costUsd,
        now,
        now
      );

    return this.getById(id);
  }

  /** Get all sessions that have a PR URL set (used by prStatusService) */
  getSessionsWithPrUrls() {
    const rows = this.db
      .prepare(
        `SELECT s.*, ${ACTIVITY_FIELDS_SQL} FROM sessions s
         WHERE pr_url IS NOT NULL ORDER BY COALESCE(last_activity_at, updated_at, created_at) DESC, updated_at DESC, created_at DESC, rowid DESC`
      )
      .all();
    return this.mapAll(rows);
  }

  updateUsage(id, usage) {
    this.db
      .prepare(
        `UPDATE sessions SET input_tokens = ?, output_tokens = ?, thinking_tokens = ?, cache_read_input_tokens = ?,
          cache_creation_input_tokens = ?, web_search_requests = ?, context_window = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(usage.inputTokens, usage.outputTokens, usage.thinkingTokens || 0, usage.cacheReadInputTokens,
        usage.cacheCreationInputTokens, usage.webSearchRequests, usage.contextWindow, Date.now(), id);
    return this.getById(id);
  }

  /** Get scheduled sessions that are due to start (scheduled_at <= now) */
  getScheduledSessionsDue(now) {
    const rows = this.db
      .prepare(
        `SELECT s.*, ${ACTIVITY_FIELDS_SQL} FROM sessions s
         WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ? AND archived = 0
         ORDER BY scheduled_at ASC`
      )
      .all(now);
    return this.mapAll(rows);
  }

  /**
   * Sessions left in 'starting' by a previous process. Startup work happens in
   * the server process, so none can still be live when boot recovery runs.
   * @returns {Array<object>}
   */
  getOrphanedStartingSessions() {
    return this.getRecoverableSessions('starting');
  }

  /**
   * Sessions left in 'running' by a previous process. Agent processes are
   * children of the server, so no session can still be genuinely running at
   * boot — every such row is orphaned regardless of how recently it was
   * touched, so no staleness cutoff applies.
   * @returns {Array<object>}
   */
  getOrphanedRunningSessions() {
    return this.getRecoverableSessions('running');
  }

  /** Sessions whose abort was requested but whose worker did not unwind. */
  getStaleAbortingSessions(cutoff) {
    return this.mapAll(this.db.prepare(`SELECT s.*, ${ACTIVITY_FIELDS_SQL} FROM sessions s
      WHERE execution_state='aborting' AND updated_at < ? AND archived=0`).all(cutoff));
  }

  /**
   * Non-archived sessions in `status`. With a `cutoff`, only those untouched
   * since it; without one, every match regardless of recency.
   * @param {string} status
   * @param {number} [cutoff] - Absolute timestamp; rows with updated_at < cutoff match.
   * @returns {Array<object>}
   */
  getRecoverableSessions(status, cutoff) {
    const hasCutoff = cutoff != null;
    const sql = `SELECT s.*, ${ACTIVITY_FIELDS_SQL} FROM sessions s WHERE status = ? AND archived = 0${hasCutoff ? ' AND updated_at < ?' : ''}`;
    return this.mapAll(this.db.prepare(sql).all(...(hasCutoff ? [status, cutoff] : [status])));
  }

  /** Get all scheduled sessions, optionally filtered by project */
  getScheduledSessions(projectId = null) {
    let sql = `SELECT s.*, p.name as project_name, ${ACTIVITY_FIELDS_SQL}
      FROM sessions s JOIN projects p ON s.project_id = p.id
      WHERE s.status = 'scheduled' AND s.archived = 0`;
    const params = [];

    if (projectId) {
      sql += ` AND s.project_id = ?`;
      params.push(projectId);
    }

    sql += ` ORDER BY s.scheduled_at ASC`;

    return this.db.prepare(sql).all(...params).map(row => ({
      ...SessionRepository.#mapSession(row),
      projectName: row.project_name,
    }));
  }
}
