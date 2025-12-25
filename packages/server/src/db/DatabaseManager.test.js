import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from './DatabaseManager.js';

describe('DatabaseManager', () => {
  let manager;

  beforeEach(() => {
    manager = new DatabaseManager();
    manager.init(':memory:');
  });

  afterEach(() => {
    manager.close();
  });

  describe('constructor', () => {
    it('creates a new instance', () => {
      const instance = new DatabaseManager();
      expect(instance).toBeInstanceOf(DatabaseManager);
    });
  });

  describe('init', () => {
    it('initializes database', () => {
      const newManager = new DatabaseManager();
      const db = newManager.init(':memory:');

      expect(db).toBeDefined();
      // Note: WAL mode is set but in-memory databases report 'memory' as journal mode
      // The pragma is still applied successfully
      const journalMode = db.pragma('journal_mode', { simple: true });
      expect(['wal', 'memory']).toContain(journalMode);

      newManager.close();
    });

    it('enables foreign keys', () => {
      const newManager = new DatabaseManager();
      newManager.init(':memory:');

      const result = newManager.get().pragma('foreign_keys', { simple: true });
      expect(result).toBe(1);

      newManager.close();
    });

    it('runs schema and creates tables', () => {
      const tables = manager.get()
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map(t => t.name);

      expect(tables).toContain('projects');
      expect(tables).toContain('sessions');
      expect(tables).toContain('conversation_messages');
      expect(tables).toContain('canvas_items');
      expect(tables).toContain('session_notes');
    });
  });

  describe('get', () => {
    it('returns database instance', () => {
      const db = manager.get();
      expect(db).toBeDefined();
      expect(db.prepare).toBeTypeOf('function');
    });

    it('throws if database not initialized', () => {
      const newManager = new DatabaseManager();
      expect(() => newManager.get()).toThrow('Database not initialized');
    });
  });

  describe('close', () => {
    it('closes database connection', () => {
      const newManager = new DatabaseManager();
      newManager.init(':memory:');
      newManager.close();

      expect(() => newManager.get()).toThrow('Database not initialized');
    });

    it('can be called multiple times safely', () => {
      const newManager = new DatabaseManager();
      newManager.init(':memory:');
      newManager.close();
      newManager.close();
      // Should not throw
    });
  });

  describe('generateId', () => {
    it('generates valid UUID v4', () => {
      const id = manager.generateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('generates unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(manager.generateId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('transaction', () => {
    it('executes function in transaction', () => {
      const result = manager.transaction(() => {
        manager.get().prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('test-id', 'Test', '/tmp', Date.now(), Date.now());
        return 'success';
      });

      expect(result).toBe('success');

      const project = manager.get().prepare('SELECT * FROM projects WHERE id = ?').get('test-id');
      expect(project.name).toBe('Test');
    });

    it('rolls back on error', () => {
      try {
        manager.transaction(() => {
          manager.get().prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('rollback-id', 'Test', '/tmp', Date.now(), Date.now());
          throw new Error('Forced error');
        });
      } catch (e) {
        // Expected
      }

      const project = manager.get().prepare('SELECT * FROM projects WHERE id = ?').get('rollback-id');
      expect(project).toBeUndefined();
    });
  });

  describe('migrations', () => {
    it('allows stopped status in sessions table', () => {
      const db = manager.get();
      const now = Date.now();

      // Create a project first
      db.prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('proj-1', 'Test Project', '/tmp', now, now);

      // Create a session with running status
      db.prepare('INSERT INTO sessions (id, project_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('sess-1', 'proj-1', 'Test Session', 'running', now, now);

      // This should NOT throw - stopped status should be allowed
      expect(() => {
        db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('stopped', 'sess-1');
      }).not.toThrow();

      // Verify the update worked
      const session = db.prepare('SELECT status FROM sessions WHERE id = ?').get('sess-1');
      expect(session.status).toBe('stopped');
    });

    it('sessions table schema includes stopped in CHECK constraint', () => {
      const db = manager.get();
      const tableSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").get();

      expect(tableSchema.sql).toContain("'stopped'");
    });

    it('sessions table has archived column', () => {
      const db = manager.get();
      const columns = db.prepare('PRAGMA table_info(sessions)').all();
      const archivedColumn = columns.find((col) => col.name === 'archived');

      expect(archivedColumn).toBeDefined();
      expect(archivedColumn.type).toBe('INTEGER');
      expect(archivedColumn.notnull).toBe(1);
      expect(archivedColumn.dflt_value).toBe('0');
    });

    it('sessions archived column defaults to 0 (false)', () => {
      const db = manager.get();
      const now = Date.now();

      // Create a project first
      db.prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('proj-arch', 'Test Project', '/tmp', now, now);

      // Create a session without specifying archived
      db.prepare('INSERT INTO sessions (id, project_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('sess-arch', 'proj-arch', 'Test Session', 'running', now, now);

      // Verify archived is 0 by default
      const session = db.prepare('SELECT archived FROM sessions WHERE id = ?').get('sess-arch');
      expect(session.archived).toBe(0);
    });

    it('can update archived column to 1', () => {
      const db = manager.get();
      const now = Date.now();

      // Create a project and session
      db.prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('proj-arch2', 'Test Project', '/tmp', now, now);
      db.prepare('INSERT INTO sessions (id, project_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('sess-arch2', 'proj-arch2', 'Test Session', 'stopped', now, now);

      // Update archived to 1
      db.prepare('UPDATE sessions SET archived = 1 WHERE id = ?').run('sess-arch2');

      // Verify archived is now 1
      const session = db.prepare('SELECT archived FROM sessions WHERE id = ?').get('sess-arch2');
      expect(session.archived).toBe(1);
    });

    it('has index on archived column', () => {
      const db = manager.get();
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sessions'").all();
      const archivedIndex = indexes.find((idx) => idx.name === 'idx_sessions_archived');

      expect(archivedIndex).toBeDefined();
    });
  });
});
