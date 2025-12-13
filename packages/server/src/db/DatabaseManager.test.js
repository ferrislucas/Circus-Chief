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
});
