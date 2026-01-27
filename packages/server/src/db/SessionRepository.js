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
      thinkingEnabled: Boolean(row.thinking_enabled),
      archived: Boolean(row.archived),
      starred: Boolean(row.starred),
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  create(projectId, name, prompt, mode = 'standard', thinkingEnabled = false, gitBranch = null, parentSessionId = null, status = 'starting') {
    const id = databaseManager.generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, name, status, mode, thinking_enabled, git_branch, parent_session_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, projectId, name, status, mode, thinkingEnabled ? 1 : 0, gitBranch, parentSessionId, now, now);

    // Create initial conversation
    const conversation = conversations.create(id, 'Initial', true);

    // Only create initial user message for sessions that start immediately
    // For waiting/scheduled sessions, the message will be created when they start
    if (status !== 'waiting' && status !== 'scheduled') {
      messages.create(id, 'user', prompt, null, conversation.id);
    }

    return this.getById(id);
  }

  getByProjectId(projectId, { archived = null, starred = null, limit = null, offset = 0 } = {}) {
    let sql = `SELECT * FROM sessions WHERE project_id = ?`;
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
        `SELECT s.*, p.name as project_name, p.working_directory as project_working_directory
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
        `SELECT * FROM sessions
         WHERE parent_session_id = ?
         ORDER BY updated_at DESC, created_at DESC, rowid DESC`
      )
      .all(parentSessionId);
    return this.mapAll(rows);
  }

  update(id, data) {
    const updates = [];
    const values = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      values.push(data.status);
    }
    if (data.mode !== undefined) {
      updates.push('mode = ?');
      values.push(data.mode);
    }
    if (data.gitBranch !== undefined) {
      updates.push('git_branch = ?');
      values.push(data.gitBranch);
    }
    if (data.gitWorktree !== undefined) {
      updates.push('git_worktree = ?');
      values.push(data.gitWorktree);
    }
    if (data.prUrl !== undefined) {
      updates.push('pr_url = ?');
      values.push(data.prUrl);
    }
    if (data.error !== undefined) {
      updates.push('error = ?');
      values.push(data.error);
    }
    if (data.costUsd !== undefined) {
      updates.push('cost_usd = ?');
      values.push(data.costUsd);
    }
    if (data.claudeSessionId !== undefined) {
      updates.push('claude_session_id = ?');
      values.push(data.claudeSessionId);
    }
    if (data.thinkingEnabled !== undefined) {
      updates.push('thinking_enabled = ?');
      values.push(data.thinkingEnabled ? 1 : 0);
    }
    if (data.nextTemplateId !== undefined) {
      updates.push('next_template_id = ?');
      values.push(data.nextTemplateId);
    }
    if (data.parentSessionId !== undefined) {
      updates.push('parent_session_id = ?');
      values.push(data.parentSessionId);
    }
    if (data.archived !== undefined) {
      updates.push('archived = ?');
      values.push(data.archived ? 1 : 0);
    }
    if (data.starred !== undefined) {
      updates.push('starred = ?');
      values.push(data.starred ? 1 : 0);
    }
    // Scheduling fields
    if (data.scheduledAt !== undefined) {
      updates.push('scheduled_at = ?');
      values.push(data.scheduledAt);
    }
    if (data.rescheduleDelayMinutes !== undefined) {
      updates.push('reschedule_delay_minutes = ?');
      values.push(data.rescheduleDelayMinutes);
    }
    if (data.autoRescheduleEnabled !== undefined) {
      updates.push('auto_reschedule_enabled = ?');
      values.push(data.autoRescheduleEnabled ? 1 : 0);
    }
    if (data.rescheduleOnTokenLimit !== undefined) {
      updates.push('reschedule_on_token_limit = ?');
      values.push(data.rescheduleOnTokenLimit ? 1 : 0);
    }
    if (data.rescheduleOnServiceError !== undefined) {
      updates.push('reschedule_on_service_error = ?');
      values.push(data.rescheduleOnServiceError ? 1 : 0);
    }
    if (data.maxRescheduleCount !== undefined) {
      updates.push('max_reschedule_count = ?');
      values.push(data.maxRescheduleCount);
    }
    if (data.maxTotalTokens !== undefined) {
      updates.push('max_total_tokens = ?');
      values.push(data.maxTotalTokens);
    }
    if (data.rescheduleCount !== undefined) {
      updates.push('reschedule_count = ?');
      values.push(data.rescheduleCount);
    }
    if (data.rescheduleAtTokenCount !== undefined) {
      updates.push('reschedule_at_token_count = ?');
      values.push(data.rescheduleAtTokenCount);
    }
    if (data.pendingPrompt !== undefined) {
      updates.push('pending_prompt = ?');
      values.push(data.pendingPrompt);
    }
    if (data.pendingModel !== undefined) {
      updates.push('pending_model = ?');
      values.push(data.pendingModel);
    }

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
        `INSERT INTO sessions (id, project_id, name, status, mode, thinking_enabled, git_branch, context_window,
                               input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
                               web_search_requests, cost_usd, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        source.projectId,
        newName,
        'waiting',  // Always reset status to draft
        source.mode,
        source.thinkingEnabled ? 1 : 0,
        source.gitBranch,  // Copy branch name (NOT worktree path)
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
      .prepare('SELECT * FROM sessions WHERE pr_url IS NOT NULL ORDER BY updated_at DESC, created_at DESC, rowid DESC')
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
        `SELECT * FROM sessions
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
      SELECT s.*, p.name as project_name
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
