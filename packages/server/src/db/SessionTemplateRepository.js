import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Session template repository class
 */
export class SessionTemplateRepository extends BaseRepository {
  constructor() {
    super('session_templates', SessionTemplateRepository.#mapTemplate);
  }

  static #mapTemplate(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      prompt: row.prompt,
      nextTemplateId: row.next_template_id,
      thinkingEnabled: row.thinking_enabled === null ? null : Boolean(row.thinking_enabled),
      gitBranch: row.git_branch,
      gitMode: row.git_mode,
      model: row.model || null,
      mode: row.mode || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Create a new session template
   * @param {Object} data
   * @param {string|null} data.projectId - null for global templates
   * @param {string} data.name
   * @param {string} data.prompt
   * @param {string|null} data.nextTemplateId
   * @param {boolean|null} data.thinkingEnabled
   * @param {string|null} data.gitBranch
   * @param {string|null} data.gitMode
   * @param {string|null} data.model
   * @param {string|null} data.mode
   * @returns {Object}
   */
  create(data) {
    const id = databaseManager.generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO session_templates (id, project_id, name, prompt, next_template_id, thinking_enabled, git_branch, git_mode, model, mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        data.projectId || null,
        data.name,
        data.prompt,
        data.nextTemplateId || null,
        data.thinkingEnabled === null || data.thinkingEnabled === undefined ? null : (data.thinkingEnabled ? 1 : 0),
        data.gitBranch || null,
        data.gitMode || null,
        data.model || null,
        data.mode || null,
        now,
        now
      );
    return this.getById(id);
  }

  /**
   * Update a session template
   * @param {string} id
   * @param {Object} data
   * @returns {Object}
   */
  update(id, data) {
    const updates = [];
    const values = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.prompt !== undefined) {
      updates.push('prompt = ?');
      values.push(data.prompt);
    }
    if (data.nextTemplateId !== undefined) {
      updates.push('next_template_id = ?');
      values.push(data.nextTemplateId);
    }
    if (data.thinkingEnabled !== undefined) {
      updates.push('thinking_enabled = ?');
      values.push(data.thinkingEnabled === null ? null : (data.thinkingEnabled ? 1 : 0));
    }
    if (data.gitBranch !== undefined) {
      updates.push('git_branch = ?');
      values.push(data.gitBranch);
    }
    if (data.gitMode !== undefined) {
      updates.push('git_mode = ?');
      values.push(data.gitMode);
    }
    if (data.model !== undefined) {
      updates.push('model = ?');
      values.push(data.model);
    }
    if (data.mode !== undefined) {
      updates.push('mode = ?');
      values.push(data.mode);
    }

    if (updates.length === 0) return this.getById(id);

    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE session_templates SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
  }

  /**
   * Get all global templates (projectId is null)
   * @returns {Array}
   */
  getGlobal() {
    const rows = this.db
      .prepare('SELECT * FROM session_templates WHERE project_id IS NULL ORDER BY name')
      .all();
    return this.mapAll(rows);
  }

  /**
   * Get templates by project ID
   * @param {string} projectId
   * @returns {Array}
   */
  getByProjectId(projectId) {
    const rows = this.db
      .prepare('SELECT * FROM session_templates WHERE project_id = ? ORDER BY name')
      .all(projectId);
    return this.mapAll(rows);
  }

  /**
   * Get all templates available for a project (project-specific + global)
   * @param {string} projectId
   * @returns {Object} { project: Array, global: Array }
   */
  getAvailableForProject(projectId) {
    return {
      project: this.getByProjectId(projectId),
      global: this.getGlobal(),
    };
  }

  /**
   * Get all templates
   * @returns {Array}
   */
  getAll() {
    const rows = this.db
      .prepare('SELECT * FROM session_templates ORDER BY project_id NULLS FIRST, name')
      .all();
    return this.mapAll(rows);
  }
}
