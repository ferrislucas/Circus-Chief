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
  });

  describe('canvas_items type migration', () => {
    it('allows code type in canvas_items table', () => {
      const db = manager.get();
      const now = Date.now();

      // Create a project and session first
      db.prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('proj-canvas-1', 'Test Project', '/tmp', now, now);
      db.prepare('INSERT INTO sessions (id, project_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('sess-canvas-1', 'proj-canvas-1', 'Test Session', 'running', now, now);

      // This should NOT throw - code type should be allowed
      expect(() => {
        db.prepare('INSERT INTO canvas_items (id, session_id, type, content, filename, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run('canvas-1', 'sess-canvas-1', 'code', 'const x = 1;', 'test.js', now);
      }).not.toThrow();

      // Verify the insert worked
      const item = db.prepare('SELECT * FROM canvas_items WHERE id = ?').get('canvas-1');
      expect(item.type).toBe('code');
      expect(item.content).toBe('const x = 1;');
    });

    it('canvas_items table schema includes code in CHECK constraint', () => {
      const db = manager.get();
      const tableSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='canvas_items'").get();

      expect(tableSchema.sql).toContain("'code'");
    });

    it('still allows existing types after migration', () => {
      const db = manager.get();
      const now = Date.now();

      db.prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('proj-canvas-2', 'Test Project 2', '/tmp', now, now);
      db.prepare('INSERT INTO sessions (id, project_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('sess-canvas-2', 'proj-canvas-2', 'Test Session 2', 'running', now, now);

      // All original types should still work
      expect(() => {
        db.prepare('INSERT INTO canvas_items (id, session_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .run('c-1', 'sess-canvas-2', 'text', 'plain text', now);
      }).not.toThrow();

      expect(() => {
        db.prepare('INSERT INTO canvas_items (id, session_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .run('c-2', 'sess-canvas-2', 'markdown', '# Heading', now);
      }).not.toThrow();

      expect(() => {
        db.prepare('INSERT INTO canvas_items (id, session_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)')
          .run('c-3', 'sess-canvas-2', 'json', '{"key":"value"}', now);
      }).not.toThrow();

      expect(() => {
        db.prepare('INSERT INTO canvas_items (id, session_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)')
          .run('c-4', 'sess-canvas-2', 'image', 'base64data', now);
      }).not.toThrow();

      expect(() => {
        db.prepare('INSERT INTO canvas_items (id, session_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)')
          .run('c-5', 'sess-canvas-2', 'pdf', 'base64pdfdata', now);
      }).not.toThrow();
    });

    it('rejects invalid canvas item type', () => {
      const db = manager.get();
      const now = Date.now();

      db.prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('proj-canvas-3', 'Test Project 3', '/tmp', now, now);
      db.prepare('INSERT INTO sessions (id, project_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('sess-canvas-3', 'proj-canvas-3', 'Test Session 3', 'running', now, now);

      // Invalid type should throw
      expect(() => {
        db.prepare('INSERT INTO canvas_items (id, session_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .run('c-invalid', 'sess-canvas-3', 'invalid_type', 'content', now);
      }).toThrow();
    });
  });
});
