import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Project session defaults repository class
 */
// Maps camelCase data keys to DB column names, with optional boolean conversion
const UPSERT_FIELD_MAP = [
  { key: 'mode', column: 'mode' },
  { key: 'thinkingEnabled', column: 'thinking_enabled', boolean: true },
  { key: 'startImmediately', column: 'start_immediately', boolean: true },
  { key: 'gitMode', column: 'git_mode' },
  { key: 'gitBranch', column: 'git_branch' },
  { key: 'model', column: 'model' },
  { key: 'effortLevel', column: 'effort_level' },
];

/**
 * Build the update clauses and values for defined fields in data.
 * @param {Object} data - Input data with optional fields
 * @returns {{ updates: string[], values: any[] }}
 */
function buildUpdateFields(data) {
  const updates = [];
  const values = [];
  for (const { key, column, boolean: isBool } of UPSERT_FIELD_MAP) {
    if (data[key] !== undefined) {
      updates.push(`${column} = ?`);
      values.push(isBool ? (data[key] ? 1 : 0) : data[key]);
    }
  }
  return { updates, values };
}

export class ProjectDefaultsRepository extends BaseRepository {
  constructor() {
    super('project_session_defaults', ProjectDefaultsRepository.#mapDefaults);
  }

  static #mapDefaults(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      mode: row.mode || null,
      thinkingEnabled: row.thinking_enabled === null ? null : row.thinking_enabled === 1,
      startImmediately: row.start_immediately === null ? null : row.start_immediately === 1,
      gitMode: row.git_mode || null,
      gitBranch: row.git_branch || null,
      model: row.model || null,
      effortLevel: row.effort_level || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get defaults for a specific project
   * @param {string} projectId - Project ID
   * @returns {Object|null} Defaults object or null if not found
   */
  getByProjectId(projectId) {
    const row = this.db
      .prepare('SELECT * FROM project_session_defaults WHERE project_id = ?')
      .get(projectId);
    return row ? ProjectDefaultsRepository.#mapDefaults(row) : null;
  }

  /**
   * Create or update defaults for a project (upsert)
   * Allows partial updates - unspecified fields preserve existing values
   * @param {string} projectId - Project ID
   * @param {Object} data - Defaults data (all fields optional)
   * @returns {Object} Updated defaults object
   */
  upsert(projectId, data) {
    // Get existing defaults if any
    const existing = this.getByProjectId(projectId);

    if (!existing) {
      // Create new defaults record
      const id = databaseManager.generateId();
      const now = Date.now();

      this.db
        .prepare(
          `INSERT INTO project_session_defaults
           (id, project_id, mode, thinking_enabled, start_immediately, git_mode, git_branch, model, effort_level, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          projectId,
          data.mode || null,
          data.thinkingEnabled !== undefined ? (data.thinkingEnabled ? 1 : 0) : null,
          data.startImmediately !== undefined ? (data.startImmediately ? 1 : 0) : null,
          data.gitMode || null,
          data.gitBranch || null,
          data.model || null,
          data.effortLevel || null,
          now,
          now
        );
    } else {
      // Update existing defaults
      const { updates, values } = buildUpdateFields(data);

      if (updates.length > 0) {
        updates.push('updated_at = ?');
        values.push(Date.now());
        values.push(projectId);

        this.db
          .prepare(`UPDATE project_session_defaults SET ${updates.join(', ')} WHERE project_id = ?`)
          .run(...values);
      }
    }

    return this.getByProjectId(projectId);
  }

  /**
   * Reset defaults to system defaults (all fields become null)
   * Returns null if no defaults exist for the project
   * @param {string} projectId - Project ID
   * @returns {Object|null} Updated defaults object with all fields set to null, or null if project has no defaults
   */
  resetToDefaults(projectId) {
    const existing = this.getByProjectId(projectId);

    if (!existing) {
      // Return null for non-existent projects/defaults
      return null;
    }

    // Update existing defaults to all nulls
    this.db
      .prepare(
        `UPDATE project_session_defaults
         SET mode = NULL, thinking_enabled = NULL, start_immediately = NULL,
             git_mode = NULL, git_branch = NULL, model = NULL, effort_level = NULL, updated_at = ?
         WHERE project_id = ?`
      )
      .run(Date.now(), projectId);

    return this.getByProjectId(projectId);
  }

  /**
   * Delete defaults for a project
   * @param {string} projectId - Project ID
   */
  deleteByProjectId(projectId) {
    this.db
      .prepare('DELETE FROM project_session_defaults WHERE project_id = ?')
      .run(projectId);
  }

  /**
   * Get system default values
   * @returns {Object} System defaults object
   */
  static getSystemDefaults() {
    return {
      mode: 'standard',
      thinkingEnabled: false,
      startImmediately: true,
      gitMode: null,
      gitBranch: null,
      model: null,
      effortLevel: null,
    };
  }
}
