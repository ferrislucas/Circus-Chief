import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db = null;

/**
 * Initialize database with WAL mode and foreign keys
 * @param {string} dbPath - Path to database file (use ':memory:' for in-memory)
 * @returns {Database.Database}
 */
export function initDatabase(dbPath = 'claudetools.db') {
  db = new Database(dbPath);

  // Enable WAL mode and foreign keys
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  return db;
}

/**
 * Get the database instance
 * @returns {Database.Database}
 */
export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Generate a UUID
 * @returns {string}
 */
export function generateId() {
  return crypto.randomUUID();
}

/**
 * Run a function inside a transaction
 * @param {Function} fn - Function to run in transaction
 * @returns {any}
 */
export function transaction(fn) {
  return getDatabase().transaction(fn)();
}

// Projects CRUD
export const projects = {
  create(name, workingDirectory) {
    const id = generateId();
    const now = Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO projects (id, name, working_directory, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, name, workingDirectory, now, now);
    return this.getById(id);
  },

  getById(id) {
    const row = getDatabase().prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row ? mapProject(row) : null;
  },

  getAll() {
    const rows = getDatabase().prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
    return rows.map(mapProject);
  },

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

    getDatabase()
      .prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getById(id);
  },

  delete(id) {
    getDatabase().prepare('DELETE FROM projects WHERE id = ?').run(id);
  },
};

// Sessions CRUD
export const sessions = {
  create(projectId, name, prompt, mode = 'standard', gitBranch = null) {
    const id = generateId();
    const now = Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO sessions (id, project_id, name, status, mode, git_branch, created_at, updated_at)
         VALUES (?, ?, ?, 'starting', ?, ?, ?, ?)`
      )
      .run(id, projectId, name, mode, gitBranch, now, now);

    // Create initial user message
    messages.create(id, 'user', prompt);

    return this.getById(id);
  },

  getById(id) {
    const row = getDatabase().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    return row ? mapSession(row) : null;
  },

  getByProjectId(projectId) {
    const rows = getDatabase()
      .prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId);
    return rows.map(mapSession);
  },

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

    getDatabase()
      .prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getById(id);
  },

  delete(id) {
    getDatabase().prepare('DELETE FROM sessions WHERE id = ?').run(id);
  },
};

// Conversation messages CRUD
export const messages = {
  create(sessionId, role, content, toolUse = null) {
    const id = generateId();
    const now = Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO conversation_messages (id, session_id, role, content, tool_use, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, sessionId, role, content, toolUse ? JSON.stringify(toolUse) : null, now);
    return this.getById(id);
  },

  getById(id) {
    const row = getDatabase().prepare('SELECT * FROM conversation_messages WHERE id = ?').get(id);
    return row ? mapMessage(row) : null;
  },

  getBySessionId(sessionId) {
    const rows = getDatabase()
      .prepare('SELECT * FROM conversation_messages WHERE session_id = ? ORDER BY timestamp ASC')
      .all(sessionId);
    return rows.map(mapMessage);
  },
};

// Canvas items CRUD
export const canvasItems = {
  create(sessionId, data) {
    const id = generateId();
    const now = Date.now();
    getDatabase()
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
  },

  getById(id) {
    const row = getDatabase().prepare('SELECT * FROM canvas_items WHERE id = ?').get(id);
    return row ? mapCanvasItem(row) : null;
  },

  getBySessionId(sessionId) {
    const rows = getDatabase()
      .prepare('SELECT * FROM canvas_items WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId);
    return rows.map(mapCanvasItem);
  },

  delete(id) {
    getDatabase().prepare('DELETE FROM canvas_items WHERE id = ?').run(id);
  },
};

// Session notes CRUD
export const sessionNotes = {
  create(sessionId, content) {
    const id = generateId();
    const now = Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO session_notes (id, session_id, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, sessionId, content, now, now);
    return this.getById(id);
  },

  getById(id) {
    const row = getDatabase().prepare('SELECT * FROM session_notes WHERE id = ?').get(id);
    return row ? mapNote(row) : null;
  },

  getBySessionId(sessionId) {
    const rows = getDatabase()
      .prepare('SELECT * FROM session_notes WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId);
    return rows.map(mapNote);
  },

  update(id, content) {
    getDatabase()
      .prepare('UPDATE session_notes SET content = ?, updated_at = ? WHERE id = ?')
      .run(content, Date.now(), id);
    return this.getById(id);
  },

  delete(id) {
    getDatabase().prepare('DELETE FROM session_notes WHERE id = ?').run(id);
  },
};

// Map database rows to camelCase objects
function mapProject(row) {
  return {
    id: row.id,
    name: row.name,
    workingDirectory: row.working_directory,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSession(row) {
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

function mapMessage(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    toolUse: row.tool_use ? JSON.parse(row.tool_use) : null,
    timestamp: row.timestamp,
  };
}

function mapCanvasItem(row) {
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

function mapNote(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
