import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';
import { messages, conversations, modelProviders } from './index.js';
import {
  ACTIVITY_FIELDS_SQL,
  mapTokenUsage,
  mapScheduling,
  parseCreateConfig,
  buildUpdateClauses,
} from './session-helpers.js';

const DEFAULT_AGENT_TYPE = 'claude-code';

/**
 * Resolve the agent type ('claude-code' or 'codex') from a model ID by looking
 * up which provider owns the model. This is the same logic as
 * sessionProvider.resolveAgentTypeFromModel but inlined here to avoid a
 * circular dependency:
 *   database.js (index) → SessionRepository → sessionProvider → database.js
 * @param {string|null} modelId
 * @returns {'claude-code'|'codex'}
 */
function resolveAgentTypeFromModel(modelId) {
  if (!modelId) return DEFAULT_AGENT_TYPE;
  const provider = modelProviders.getProviderByModelId(modelId);
  if (!provider) return DEFAULT_AGENT_TYPE;
  // ProviderRepository.getAgentTypeForProvider maps kind → agent adapter
  const agentType = modelProviders.getAgentTypeForProvider(provider.id);
  return agentType || DEFAULT_AGENT_TYPE;
}

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
      thinkingEnabled: Boolean(row.thinking_enabled),
      archived: Boolean(row.archived),
      starred: Boolean(row.starred),
      manuallyNamed: Boolean(row.manually_named),
      gitBranch: row.git_branch,
      gitWorktree: row.git_worktree,
      prUrl: row.pr_url,
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
      targetLaneId: row.target_lane_id || null,
      laneTriggerDepth: row.lane_trigger_depth || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivityAt: row.last_activity_at || row.updated_at || row.created_at,
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

  /** Create a new session with optional config (mode, thinkingEnabled, gitBranch, parentSessionId, status, model, effortLevel, agentType) */
  create(projectId, name, prompt, options = {}) {
    const config = parseCreateConfig(options, Array.prototype.slice.call(arguments, 4));

    // Resolve agentType: explicit override → model-based derivation → fallback
    const agentType =
      config.agentType
      ?? (config.model ? resolveAgentTypeFromModel(config.model) : null)
      ?? DEFAULT_AGENT_TYPE;

    const id = databaseManager.generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, name, status, mode, thinking_enabled, git_branch, parent_session_id, model, effort_level, agent_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        projectId,
        name,
        config.status,
        config.mode,
        config.thinkingEnabled ? 1 : 0,
        config.gitBranch,
        config.parentSessionId,
        config.model,
        config.effortLevel,
        agentType,
        now,
        now
      );

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

    if (archived !== null) {
      sql += ` AND archived = ?`;
      params.push(archived ? 1 : 0);
    }

    if (starred !== null) {
      sql += ` AND starred = ?`;
      params.push(starred ? 1 : 0);
    }

    sql += ` ORDER BY
      starred DESC,
      updated_at DESC,
      created_at DESC,
      rowid DESC`;

    // Add LIMIT/OFFSET for pagination
    if (limit !== null) {
      sql += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);
    }

    const rows = this.db.prepare(sql).all(...params);
    return this.mapAll(rows);
  }

  /** Get count of sessions for a project with optional archived/starred filters */
  getCountByProjectId(projectId, { archived = null, starred = null } = {}) {
    let sql = `SELECT COUNT(*) as count FROM sessions WHERE project_id = ?`;
    const params = [projectId];

    if (archived !== null) {
      sql += ` AND archived = ?`;
      params.push(archived ? 1 : 0);
    }

    if (starred !== null) {
      sql += ` AND starred = ?`;
      params.push(starred ? 1 : 0);
    }

    return this.db.prepare(sql).get(...params).count;
  }

  getActiveAndWaiting() {
    const rows = this.db
      .prepare(
        `SELECT s.*, p.name as project_name, p.working_directory as project_working_directory, ${ACTIVITY_FIELDS_SQL}
         FROM sessions s JOIN projects p ON s.project_id = p.id
         WHERE s.status IN ('starting', 'running', 'waiting') AND s.archived = 0
         ORDER BY s.starred DESC, s.updated_at DESC, s.created_at DESC, s.rowid DESC`
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
         ORDER BY updated_at DESC, created_at DESC, rowid DESC`
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
    const { updates, values } = buildUpdateClauses(data);

    if (updates.length === 0) return this.getById(id);

    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
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
        `INSERT INTO sessions (id, project_id, name, status, mode, thinking_enabled, git_branch, model, effort_level, agent_type, context_window,
                               input_tokens, output_tokens, thinking_tokens, cache_read_input_tokens, cache_creation_input_tokens,
                               web_search_requests, cost_usd, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
         WHERE pr_url IS NOT NULL ORDER BY updated_at DESC, created_at DESC, rowid DESC`
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

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(row => ({
      ...SessionRepository.#mapSession(row),
      projectName: row.project_name,
    }));
  }
}
