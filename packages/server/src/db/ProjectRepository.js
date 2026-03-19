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
      kanbanEnabled: row.kanban_enabled === undefined ? true : Boolean(row.kanban_enabled),
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
    } = options;
    this.db
      .prepare(
        `INSERT INTO projects (id, name, working_directory, system_prompt, on_session_created, on_session_deleted, pr_poll_interval, repo_url, kanban_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        now,
        now
      );
    return this.getById(id);
  }

  getAll() {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
    return this.mapAll(rows);
  }

  update(id, data) {
    const updates = [];
    const values = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.workingDirectory !== undefined) {
      updates.push('working_directory = ?');
      values.push(data.workingDirectory);
    }
    if (data.systemPrompt !== undefined) {
      updates.push('system_prompt = ?');
      values.push(data.systemPrompt);
    }
    if (data.onSessionCreated !== undefined) {
      updates.push('on_session_created = ?');
      values.push(data.onSessionCreated);
    }
    if (data.onSessionDeleted !== undefined) {
      updates.push('on_session_deleted = ?');
      values.push(data.onSessionDeleted);
    }
    if (data.prPollInterval !== undefined) {
      updates.push('pr_poll_interval = ?');
      values.push(data.prPollInterval);
    }
    if (data.repoUrl !== undefined) {
      updates.push('repo_url = ?');
      values.push(data.repoUrl);
    }
    if (data.kanbanEnabled !== undefined) {
      updates.push('kanban_enabled = ?');
      values.push(data.kanbanEnabled ? 1 : 0);
    }
    if (updates.length === 0) return this.getById(id);

    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
  }
}
