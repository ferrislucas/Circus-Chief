import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Database manager class - singleton pattern for managing SQLite connection
 */
export class DatabaseManager {
  #db = null;

  /**
   * Initialize database with WAL mode and foreign keys
   * @param {string} dbPath - Path to database file (use ':memory:' for in-memory)
   * @returns {Database.Database}
   */
  init(dbPath = 'claudetools.db') {
    this.#db = new Database(dbPath);

    // Enable WAL mode and foreign keys
    this.#db.pragma('journal_mode = WAL');
    this.#db.pragma('foreign_keys = ON');

    // Run schema
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    this.#db.exec(schema);

    return this.#db;
  }

  /**
   * Get the database instance
   * @returns {Database.Database}
   */
  get() {
    if (!this.#db) {
      throw new Error('Database not initialized. Call init first.');
    }
    return this.#db;
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.#db) {
      this.#db.close();
      this.#db = null;
    }
  }

  /**
   * Generate a UUID
   * @returns {string}
   */
  generateId() {
    return crypto.randomUUID();
  }

  /**
   * Run a function inside a transaction
   * @param {Function} fn - Function to run in transaction
   * @returns {any}
   */
  transaction(fn) {
    return this.get().transaction(fn)();
  }
}

// Singleton instance
const databaseManager = new DatabaseManager();

// Legacy function exports for backward compatibility
export function initDatabase(dbPath) {
  return databaseManager.init(dbPath);
}

export function getDatabase() {
  return databaseManager.get();
}

export function closeDatabase() {
  return databaseManager.close();
}

export function generateId() {
  return databaseManager.generateId();
}

export function transaction(fn) {
  return databaseManager.transaction(fn);
}

/**
 * Base repository class with common CRUD patterns
 */
class BaseRepository {
  #tableName;
  #mapFn;

  constructor(tableName, mapFn) {
    this.#tableName = tableName;
    this.#mapFn = mapFn;
  }

  get tableName() {
    return this.#tableName;
  }

  get db() {
    return getDatabase();
  }

  map(row) {
    return row ? this.#mapFn(row) : null;
  }

  mapAll(rows) {
    return rows.map(this.#mapFn);
  }

  getById(id) {
    const row = this.db.prepare(`SELECT * FROM ${this.#tableName} WHERE id = ?`).get(id);
    return this.map(row);
  }

  delete(id) {
    this.db.prepare(`DELETE FROM ${this.#tableName} WHERE id = ?`).run(id);
  }
}

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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  create(name, workingDirectory) {
    const id = generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO projects (id, name, working_directory, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, name, workingDirectory, now, now);
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

    if (updates.length === 0) return this.getById(id);

    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
  }
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
      gitBranch: row.git_branch,
      gitWorktree: row.git_worktree,
      prUrl: row.pr_url,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  create(projectId, name, prompt, mode = 'standard', gitBranch = null) {
    const id = generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, name, status, mode, git_branch, created_at, updated_at)
         VALUES (?, ?, ?, 'starting', ?, ?, ?, ?)`
      )
      .run(id, projectId, name, mode, gitBranch, now, now);

    // Create initial user message
    messages.create(id, 'user', prompt);

    return this.getById(id);
  }

  getByProjectId(projectId) {
    const rows = this.db
      .prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId);
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

    if (updates.length === 0) return this.getById(id);

    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
  }
}

/**
 * Message repository class
 */
export class MessageRepository extends BaseRepository {
  constructor() {
    super('conversation_messages', MessageRepository.#mapMessage);
  }

  static #mapMessage(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      toolUse: row.tool_use ? JSON.parse(row.tool_use) : null,
      timestamp: row.timestamp,
    };
  }

  create(sessionId, role, content, toolUse = null) {
    const id = generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO conversation_messages (id, session_id, role, content, tool_use, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, sessionId, role, content, toolUse ? JSON.stringify(toolUse) : null, now);
    return this.getById(id);
  }

  getBySessionId(sessionId) {
    const rows = this.db
      .prepare('SELECT * FROM conversation_messages WHERE session_id = ? ORDER BY timestamp ASC')
      .all(sessionId);
    return this.mapAll(rows);
  }
}

/**
 * Canvas item repository class
 */
export class CanvasItemRepository extends BaseRepository {
  constructor() {
    super('canvas_items', CanvasItemRepository.#mapCanvasItem);
  }

  static #mapCanvasItem(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      type: row.type,
      content: row.content,
      data: row.data,
      mimeType: row.mime_type,
      filename: row.filename,
      label: row.label,
      width: row.width,
      height: row.height,
      createdAt: row.created_at,
    };
  }

  create(sessionId, data) {
    const id = generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO canvas_items (id, session_id, type, content, data, mime_type, filename, label, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        sessionId,
        data.type,
        data.content || null,
        data.data || null,
        data.mimeType || null,
        data.filename || null,
        data.label || null,
        data.width || null,
        data.height || null,
        now
      );
    return this.getById(id);
  }

  getBySessionId(sessionId) {
    const rows = this.db
      .prepare('SELECT * FROM canvas_items WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId);
    return this.mapAll(rows);
  }
}

/**
 * Session note repository class
 */
export class SessionNoteRepository extends BaseRepository {
  constructor() {
    super('session_notes', SessionNoteRepository.#mapNote);
  }

  static #mapNote(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  create(sessionId, content) {
    const id = generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO session_notes (id, session_id, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, sessionId, content, now, now);
    return this.getById(id);
  }

  getBySessionId(sessionId) {
    const rows = this.db
      .prepare('SELECT * FROM session_notes WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId);
    return this.mapAll(rows);
  }

  update(id, content) {
    this.db
      .prepare('UPDATE session_notes SET content = ?, updated_at = ? WHERE id = ?')
      .run(content, Date.now(), id);
    return this.getById(id);
  }
}

// Singleton instances for backward compatibility
export const projects = new ProjectRepository();
export const sessions = new SessionRepository();
export const messages = new MessageRepository();
export const canvasItems = new CanvasItemRepository();
export const sessionNotes = new SessionNoteRepository();

// Export the database manager instance
export { databaseManager };
