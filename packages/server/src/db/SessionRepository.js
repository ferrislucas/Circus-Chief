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
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      status: row.status,
      mode: row.mode,
      thinkingEnabled: Boolean(row.thinking_enabled),
      gitBranch: row.git_branch,
      gitWorktree: row.git_worktree,
      prUrl: row.pr_url,
      error: row.error,
      costUsd: row.cost_usd,
      claudeSessionId: row.claude_session_id,
      model: row.model,
      nextTemplateId: row.next_template_id,
      parentSessionId: row.parent_session_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  create(projectId, name, prompt, mode = 'standard', thinkingEnabled = false, gitBranch = null, model = null, parentSessionId = null) {
    const id = databaseManager.generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, name, status, mode, thinking_enabled, git_branch, model, parent_session_id, created_at, updated_at)
         VALUES (?, ?, ?, 'starting', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, projectId, name, mode, thinkingEnabled ? 1 : 0, gitBranch, model, parentSessionId, now, now);

    // Create initial conversation and user message
    const conversation = conversations.create(id, 'Initial', true);
    messages.create(id, 'user', prompt, null, conversation.id);

    return this.getById(id);
  }

  getByProjectId(projectId) {
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions
         WHERE project_id = ?
         ORDER BY
           updated_at DESC,
           created_at DESC,
           rowid DESC`
      )
      .all(projectId);
    return this.mapAll(rows);
  }

  getActiveAndWaiting() {
    const rows = this.db
      .prepare(
        `SELECT s.*, p.name as project_name, p.working_directory as project_working_directory
         FROM sessions s
         JOIN projects p ON s.project_id = p.id
         WHERE s.status IN ('starting', 'running', 'waiting')
         ORDER BY s.updated_at DESC, s.created_at DESC, s.rowid DESC`
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
    if (data.model !== undefined) {
      updates.push('model = ?');
      values.push(data.model);
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

    if (updates.length === 0) return this.getById(id);

    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values);

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
}
