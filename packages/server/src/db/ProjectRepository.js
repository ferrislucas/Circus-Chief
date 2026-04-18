import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Project repository class
 */
export class ProjectRepository extends BaseRepository {
  constructor() {
    super('projects', ProjectRepository.#mapProject);
  }

  static #mapProject(row) {
    return {
      id: row.id,
      name: row.name,
      workingDirectory: row.working_directory,
      systemPrompt: row.system_prompt,
      onSessionCreated: row.on_session_created,
      onSessionDeleted: row.on_session_deleted,
      prPollInterval: row.pr_poll_interval,
      repoUrl: row.repo_url,
      worktreePath: row.worktree_path,
      kanbanEnabled: row.kanban_enabled === undefined ? true : Boolean(row.kanban_enabled),
      sessionCount: row.session_count ?? 0,
      lastActivityAt: row.last_activity_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  create(name, workingDirectory, systemPrompt = null, options = {}) {
    const id = databaseManager.generateId();
    const now = Date.now();
    const {
      onSessionCreated = null,
      onSessionDeleted = null,
      prPollInterval = 60000,
      repoUrl = null,
      kanbanEnabled = true,
      worktreePath = null,
    } = options;
    this.db
      .prepare(
        `INSERT INTO projects (id, name, working_directory, system_prompt, on_session_created, on_session_deleted, pr_poll_interval, repo_url, kanban_enabled, worktree_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        name,
        workingDirectory,
        systemPrompt,
        onSessionCreated,
        onSessionDeleted,
        prPollInterval,
        repoUrl,
        kanbanEnabled ? 1 : 0,
        worktreePath,
        now,
        now
      );
    return this.getById(id);
  }

  getAll() {
    const rows = this.db.prepare(`
      SELECT p.*,
        COUNT(CASE WHEN s.archived = 0 THEN s.id END) as session_count,
        MAX(s.updated_at) as last_activity_at
      FROM projects p
      LEFT JOIN sessions s ON s.project_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `).all();
    return this.mapAll(rows);
  }

  /**
   * Field mapping from camelCase data keys to snake_case column names.
   * Entries with a transform function apply that transform to the value.
   */
  static #FIELD_MAP = {
    name: { column: 'name' },
    workingDirectory: { column: 'working_directory' },
    systemPrompt: { column: 'system_prompt' },
    onSessionCreated: { column: 'on_session_created' },
    onSessionDeleted: { column: 'on_session_deleted' },
    prPollInterval: { column: 'pr_poll_interval' },
    repoUrl: { column: 'repo_url' },
    worktreePath: { column: 'worktree_path' },
    kanbanEnabled: { column: 'kanban_enabled', transform: (v) => v ? 1 : 0 },
  };

  update(id, data) {
    const updates = [];
    const values = [];

    for (const [key, { column, transform }] of Object.entries(ProjectRepository.#FIELD_MAP)) {
      if (data[key] !== undefined) {
        updates.push(`${column} = ?`);
        values.push(transform ? transform(data[key]) : data[key]);
      }
    }

    if (updates.length === 0) return this.getById(id);

    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
  }
}
