import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';
import { messages, conversations } from './index.js';

/**
 * Session repository class
 */
export class SessionRepository extends BaseRepository {
  constructor() {
    super('sessions', SessionRepository.#mapSession);
  }

  static #mapSession(row) {
    // DEBUG: Log scheduled_at value from database
    if (row.scheduled_at) {
      console.log('[DEBUG] scheduled_at from DB:', row.scheduled_at, 'type:', typeof row.scheduled_at);
    }
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
      // Token usage fields
      inputTokens: row.input_tokens || 0,
      outputTokens: row.output_tokens || 0,
      cacheReadInputTokens: row.cache_read_input_tokens || 0,
      cacheCreationInputTokens: row.cache_creation_input_tokens || 0,
      webSearchRequests: row.web_search_requests || 0,
      contextWindow: row.context_window || 200000,
      // Scheduling fields
      scheduledAt: row.scheduled_at || null,
      rescheduleDelayMinutes: row.reschedule_delay_minutes || 15,
      autoRescheduleEnabled: Boolean(row.auto_reschedule_enabled),
      rescheduleOnTokenLimit: Boolean(row.reschedule_on_token_limit),
      rescheduleOnServiceError: Boolean(row.reschedule_on_service_error),
      maxRescheduleCount: row.max_reschedule_count,
      maxTotalTokens: row.max_total_tokens,
      rescheduleCount: row.reschedule_count || 0,
      rescheduleAtTokenCount: row.reschedule_at_token_count,
      // Kanban fields
      targetLaneId: row.target_lane_id || null,
      laneTriggerDepth: row.lane_trigger_depth || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivityAt: row.last_activity_at || row.updated_at || row.created_at,
      activeTimeMs: row.active_time_ms || 0,
    };
  }

  /**
   * Override getById to include computed last_activity_at field
   * This is critical because getById is called after every create(), update(), and updateUsage() call
   * @param {string} id - Session ID
   * @returns {Object|null} Session with lastActivityAt
   */
  getById(id) {
    const row = this.db
      .prepare(
        `SELECT s.*,
          (SELECT MAX(cm.timestamp) FROM conversation_messages cm WHERE cm.session_id = s.id) AS last_activity_at,
          (CAST(
            CASE
              WHEN (SELECT MAX(cm.timestamp) FROM conversation_messages cm WHERE cm.session_id = s.id) IS NOT NULL
              THEN (SELECT MAX(cm.timestamp) FROM conversation_messages cm WHERE cm.session_id = s.id)
                 - (SELECT MIN(cm.timestamp) FROM conversation_messages cm WHERE cm.session_id = s.id)
              ELSE 0
            END AS INTEGER)
          ) AS active_time_ms
         FROM sessions s WHERE s.id = ?`
      )
      .get(id);
    return this.map(row);
  }

  /**
   * Create a new session
   * @param {string} projectId - Project ID
   * @param {string} name - Session name
   * @param {string} prompt - Initial prompt
   * @param {Object} options - Optional session configuration
   * @param {string} [options.mode='standard'] - Session mode
   * @param {boolean} [options.thinkingEnabled=false] - Enable thinking mode
   * @param {string|null} [options.gitBranch=null] - Git branch
   * @param {string|null} [options.parentSessionId=null] - Parent session ID
   * @param {string} [options.status='starting'] - Initial status
   * @param {string|null} [options.model=null] - Model to use
   * @param {string|null} [options.effortLevel=null] - Effort level
   * @returns {Object} Created session
   */
  create(projectId, name, prompt, options = {}) {
    // Support legacy positional arguments for backward compatibility
    // If options is a string, it's the old 'mode' parameter
    let config;
    if (typeof options === 'string') {
      // Legacy call: create(projectId, name, prompt, mode, thinkingEnabled, gitBranch, parentSessionId, status, model, { effortLevel })
      const [mode, thinkingEnabled, gitBranch, parentSessionId, status, model] = [
        options, arguments[4], arguments[5], arguments[6], arguments[7], arguments[8]
      ];
      const legacyOpts = arguments[9] || {};
      config = {
        mode: mode || 'standard',
        thinkingEnabled: thinkingEnabled || false,
        gitBranch: gitBranch || null,
        parentSessionId: parentSessionId || null,
        status: status || 'starting',
        model: model || null,
        effortLevel: legacyOpts.effortLevel || null,
      };
    } else {
      config = {
        mode: options.mode || 'standard',
        thinkingEnabled: options.thinkingEnabled || false,
        gitBranch: options.gitBranch || null,
        parentSessionId: options.parentSessionId || null,
        status: options.status || 'starting',
        model: options.model || null,
        effortLevel: options.effortLevel || null,
      };
    }

    const id = databaseManager.generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, name, status, mode, thinking_enabled, git_branch, parent_session_id, model, effort_level, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, projectId, name, config.status, config.mode, config.thinkingEnabled ? 1 : 0, config.gitBranch, config.parentSessionId, config.model, config.effortLevel, now, now);

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
    let sql = `SELECT s.*,
      (SELECT MAX(cm.timestamp) FROM conversation_messages cm WHERE cm.session_id = s.id) AS last_activity_at,
      (CAST(
        CASE
          WHEN (SELECT MAX(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id) IS NOT NULL
          THEN (SELECT MAX(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id)
             - (SELECT MIN(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id)
          ELSE 0
        END AS INTEGER)
      ) AS active_time_ms
      FROM sessions s WHERE project_id = ?`;
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

  /**
   * Get count of sessions for a project with optional filters
   * @param {string} projectId - Project ID
   * @param {Object} options - Filter options
   * @param {boolean|null} options.archived - Filter by archived status
   * @param {boolean|null} options.starred - Filter by starred status
   * @returns {number} Count of matching sessions
   */
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
        `SELECT s.*, p.name as project_name, p.working_directory as project_working_directory,
          (SELECT MAX(cm.timestamp) FROM conversation_messages cm WHERE cm.session_id = s.id) AS last_activity_at,
          (CAST(
            CASE
              WHEN (SELECT MAX(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id) IS NOT NULL
              THEN (SELECT MAX(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id)
                 - (SELECT MIN(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id)
              ELSE 0
            END AS INTEGER)
          ) AS active_time_ms
         FROM sessions s
         JOIN projects p ON s.project_id = p.id
         WHERE s.status IN ('starting', 'running', 'waiting')
           AND s.archived = 0
         ORDER BY s.starred DESC, s.updated_at DESC, s.created_at DESC, s.rowid DESC`
      )
      .all();
    return rows.map(row => ({
      ...SessionRepository.#mapSession(row),
      projectName: row.project_name,
      projectWorkingDirectory: row.project_working_directory,
    }));
  }

  /**
   * Get all child sessions of a parent session
   * @param {string} parentSessionId - The parent session ID
   * @returns {Array<Object>} Child sessions
   */
  getChildSessions(parentSessionId) {
    const rows = this.db
      .prepare(
        `SELECT s.*,
          (SELECT MAX(cm.timestamp) FROM conversation_messages cm WHERE cm.session_id = s.id) AS last_activity_at,
          (CAST(
            CASE
              WHEN (SELECT MAX(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id) IS NOT NULL
              THEN (SELECT MAX(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id)
                 - (SELECT MIN(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id)
              ELSE 0
            END AS INTEGER)
          ) AS active_time_ms
         FROM sessions s
         WHERE parent_session_id = ?
         ORDER BY updated_at DESC, created_at DESC, rowid DESC`
      )
      .all(parentSessionId);
    return this.mapAll(rows);
  }

  /**
   * Walk the parentSessionId chain upward to find the root session.
   * @param {string} sessionId - Starting session ID
   * @returns {string|null} - Root session ID, or null if session not found
   */
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

  /**
   * Collect all descendant session IDs (children, grandchildren, etc.) recursively.
   * Uses a lightweight ID-only query to avoid expensive joins.
   * @param {string} sessionId - The starting session ID
   * @returns {string[]} Array of all descendant session IDs (does NOT include the starting session)
   */
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

  /**
   * Mapping of camelCase field names to their snake_case column names.
   * Values are passed through to SQLite as-is.
   */
  static #DIRECT_FIELD_MAP = {
    name: 'name',
    status: 'status',
    mode: 'mode',
    gitBranch: 'git_branch',
    gitWorktree: 'git_worktree',
    prUrl: 'pr_url',
    error: 'error',
    costUsd: 'cost_usd',
    claudeSessionId: 'claude_session_id',
    model: 'model',
    nextTemplateId: 'next_template_id',
    parentSessionId: 'parent_session_id',
    scheduledAt: 'scheduled_at',
    rescheduleDelayMinutes: 'reschedule_delay_minutes',
    maxRescheduleCount: 'max_reschedule_count',
    maxTotalTokens: 'max_total_tokens',
    rescheduleCount: 'reschedule_count',
    rescheduleAtTokenCount: 'reschedule_at_token_count',
    pendingPrompt: 'pending_prompt',
    pendingModel: 'pending_model',
    effortLevel: 'effort_level',
    targetLaneId: 'target_lane_id',
    laneTriggerDepth: 'lane_trigger_depth',
  };

  /**
   * Mapping of camelCase boolean field names to their snake_case column names.
   * Values are converted to 1/0 for SQLite storage.
   */
  static #BOOLEAN_FIELD_MAP = {
    thinkingEnabled: 'thinking_enabled',
    archived: 'archived',
    starred: 'starred',
    manuallyNamed: 'manually_named',
    autoRescheduleEnabled: 'auto_reschedule_enabled',
    rescheduleOnTokenLimit: 'reschedule_on_token_limit',
    rescheduleOnServiceError: 'reschedule_on_service_error',
    autoSendPendingPrompt: 'auto_send_pending_prompt',
  };

  /**
   * Build the SET clause entries and parameter values from the provided data object.
   * @param {Object} data - The update data with camelCase keys
   * @returns {{ updates: string[], values: any[] }}
   */
  static #buildUpdateClauses(data) {
    const updates = [];
    const values = [];

    for (const [field, column] of Object.entries(SessionRepository.#DIRECT_FIELD_MAP)) {
      if (data[field] !== undefined) {
        updates.push(`${column} = ?`);
        values.push(data[field]);
      }
    }

    for (const [field, column] of Object.entries(SessionRepository.#BOOLEAN_FIELD_MAP)) {
      if (data[field] !== undefined) {
        updates.push(`${column} = ?`);
        values.push(data[field] ? 1 : 0);
      }
    }

    return { updates, values };
  }

  update(id, data) {
    const { updates, values } = SessionRepository.#buildUpdateClauses(data);

    if (updates.length === 0) return this.getById(id);

    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
  }

  /**
   * Duplicates a session with a new ID and reset state.
   * Does NOT handle git setup - that's done by the service layer.
   * Does NOT create initial conversation/message - those are handled by conversation duplication.
   *
   * @param {string} sourceSessionId - ID of session to duplicate
   * @param {object} options - Override options
   * @param {string} [options.name] - New name (defaults to "Original Name (Copy)")
   * @returns {object} The new session record
   */
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
        `INSERT INTO sessions (id, project_id, name, status, mode, thinking_enabled, git_branch, model, effort_level, context_window,
                               input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
                               web_search_requests, cost_usd, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        source.contextWindow,
        source.inputTokens,
        source.outputTokens,
        source.cacheReadInputTokens,
        source.cacheCreationInputTokens,
        source.webSearchRequests,
        source.costUsd,
        now,
        now
      );

    return this.getById(id);
  }

  /**
   * Get all sessions that have a PR URL set
   * Used by prStatusService for polling CI status
   * @returns {Array<Object>} Sessions with PR URLs
   */
  getSessionsWithPrUrls() {
    const rows = this.db
      .prepare(
        `SELECT s.*,
          (SELECT MAX(cm.timestamp) FROM conversation_messages cm WHERE cm.session_id = s.id) AS last_activity_at,
          (CAST(
            CASE
              WHEN (SELECT MAX(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id) IS NOT NULL
              THEN (SELECT MAX(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id)
                 - (SELECT MIN(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id)
              ELSE 0
            END AS INTEGER)
          ) AS active_time_ms
         FROM sessions s
         WHERE pr_url IS NOT NULL ORDER BY updated_at DESC, created_at DESC, rowid DESC`
      )
      .all();
    return this.mapAll(rows);
  }

  /**
   * Update token usage statistics for a session
   * @param {string} id - Session ID
   * @param {Object} usage - Usage data
   * @param {number} usage.inputTokens
   * @param {number} usage.outputTokens
   * @param {number} usage.cacheReadInputTokens
   * @param {number} usage.cacheCreationInputTokens
   * @param {number} usage.webSearchRequests
   * @param {number} usage.contextWindow
   * @returns {Object} Updated session
   */
  updateUsage(id, usage) {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE sessions SET
          input_tokens = ?,
          output_tokens = ?,
          cache_read_input_tokens = ?,
          cache_creation_input_tokens = ?,
          web_search_requests = ?,
          context_window = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheReadInputTokens,
        usage.cacheCreationInputTokens,
        usage.webSearchRequests,
        usage.contextWindow,
        now,
        id
      );
    return this.getById(id);
  }

  /**
   * Get all scheduled sessions that are due to start (scheduled_at <= now)
   * @param {number} now - Current timestamp in milliseconds
   * @returns {Array<Object>} Scheduled sessions that should start
   */
  getScheduledSessionsDue(now) {
    const rows = this.db
      .prepare(
        `SELECT s.*,
          (SELECT MAX(cm.timestamp) FROM conversation_messages cm WHERE cm.session_id = s.id) AS last_activity_at,
          (CAST(
            CASE
              WHEN (SELECT MAX(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id) IS NOT NULL
              THEN (SELECT MAX(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id)
                 - (SELECT MIN(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id)
              ELSE 0
            END AS INTEGER)
          ) AS active_time_ms
         FROM sessions s
         WHERE status = 'scheduled'
           AND scheduled_at IS NOT NULL
           AND scheduled_at <= ?
           AND archived = 0
         ORDER BY scheduled_at ASC`
      )
      .all(now);
    return this.mapAll(rows);
  }

  /**
   * Get all scheduled sessions (optionally filtered by project)
   * @param {string|null} projectId - Optional project ID to filter by
   * @returns {Array<Object>} Scheduled sessions with project info
   */
  getScheduledSessions(projectId = null) {
    let sql = `
      SELECT s.*, p.name as project_name,
        (SELECT MAX(cm.timestamp) FROM conversation_messages cm WHERE cm.session_id = s.id) AS last_activity_at,
        (CAST(
          CASE
            WHEN (SELECT MAX(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id) IS NOT NULL
            THEN (SELECT MAX(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id)
               - (SELECT MIN(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id)
            ELSE 0
          END AS INTEGER)
        ) AS active_time_ms
      FROM sessions s
      JOIN projects p ON s.project_id = p.id
      WHERE s.status = 'scheduled'
        AND s.archived = 0
    `;
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
