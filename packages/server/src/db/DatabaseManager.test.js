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

  // Issue #175 - Conversation-level token usage columns
  describe('conversations token usage columns', () => {
    it('has input_tokens column with default 0', () => {
      const db = manager.get();
      const columns = db.prepare('PRAGMA table_info(conversations)').all();
      const column = columns.find((col) => col.name === 'input_tokens');

      expect(column).toBeDefined();
      expect(column.type).toBe('INTEGER');
      expect(column.dflt_value).toBe('0');
    });

    it('has output_tokens column with default 0', () => {
      const db = manager.get();
      const columns = db.prepare('PRAGMA table_info(conversations)').all();
      const column = columns.find((col) => col.name === 'output_tokens');

      expect(column).toBeDefined();
      expect(column.type).toBe('INTEGER');
      expect(column.dflt_value).toBe('0');
    });

    it('has cache_read_input_tokens column with default 0', () => {
      const db = manager.get();
      const columns = db.prepare('PRAGMA table_info(conversations)').all();
      const column = columns.find((col) => col.name === 'cache_read_input_tokens');

      expect(column).toBeDefined();
      expect(column.type).toBe('INTEGER');
      expect(column.dflt_value).toBe('0');
    });

    it('has cache_creation_input_tokens column with default 0', () => {
      const db = manager.get();
      const columns = db.prepare('PRAGMA table_info(conversations)').all();
      const column = columns.find((col) => col.name === 'cache_creation_input_tokens');

      expect(column).toBeDefined();
      expect(column.type).toBe('INTEGER');
      expect(column.dflt_value).toBe('0');
    });

    it('has web_search_requests column with default 0', () => {
      const db = manager.get();
      const columns = db.prepare('PRAGMA table_info(conversations)').all();
      const column = columns.find((col) => col.name === 'web_search_requests');

      expect(column).toBeDefined();
      expect(column.type).toBe('INTEGER');
      expect(column.dflt_value).toBe('0');
    });

    it('has context_window column with default 200000', () => {
      const db = manager.get();
      const columns = db.prepare('PRAGMA table_info(conversations)').all();
      const column = columns.find((col) => col.name === 'context_window');

      expect(column).toBeDefined();
      expect(column.type).toBe('INTEGER');
      expect(column.dflt_value).toBe('200000');
    });

    it('has model column (TEXT, nullable)', () => {
      const db = manager.get();
      const columns = db.prepare('PRAGMA table_info(conversations)').all();
      const column = columns.find((col) => col.name === 'model');

      expect(column).toBeDefined();
      expect(column.type).toBe('TEXT');
      expect(column.notnull).toBe(0); // nullable
    });

    it('creates conversation with default token values', () => {
      const db = manager.get();
      const now = Date.now();

      // Create project and session first
      db.prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('proj-conv-tokens', 'Test Project', '/tmp', now, now);
      db.prepare('INSERT INTO sessions (id, project_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('sess-conv-tokens', 'proj-conv-tokens', 'Test Session', 'running', now, now);

      // Create conversation without specifying token columns
      db.prepare('INSERT INTO conversations (id, session_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('conv-tokens', 'sess-conv-tokens', 'Test Conversation', 1, now, now);

      // Verify defaults
      const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get('conv-tokens');
      expect(conv.input_tokens).toBe(0);
      expect(conv.output_tokens).toBe(0);
      expect(conv.cache_read_input_tokens).toBe(0);
      expect(conv.cache_creation_input_tokens).toBe(0);
      expect(conv.web_search_requests).toBe(0);
      expect(conv.context_window).toBe(200000);
      expect(conv.model).toBeNull();
    });

    it('can update conversation with token usage values', () => {
      const db = manager.get();
      const now = Date.now();

      // Create project, session, and conversation
      db.prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('proj-conv-update', 'Test Project', '/tmp', now, now);
      db.prepare('INSERT INTO sessions (id, project_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('sess-conv-update', 'proj-conv-update', 'Test Session', 'running', now, now);
      db.prepare('INSERT INTO conversations (id, session_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('conv-update', 'sess-conv-update', 'Test Conversation', 1, now, now);

      // Update with token usage
      db.prepare(`
        UPDATE conversations SET
          input_tokens = ?,
          output_tokens = ?,
          cache_read_input_tokens = ?,
          cache_creation_input_tokens = ?,
          web_search_requests = ?,
          context_window = ?,
          model = ?
        WHERE id = ?
      `).run(1000, 500, 200, 100, 2, 200000, 'claude-sonnet-4-20250514', 'conv-update');

      // Verify the update
      const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get('conv-update');
      expect(conv.input_tokens).toBe(1000);
      expect(conv.output_tokens).toBe(500);
      expect(conv.cache_read_input_tokens).toBe(200);
      expect(conv.cache_creation_input_tokens).toBe(100);
      expect(conv.web_search_requests).toBe(2);
      expect(conv.context_window).toBe(200000);
      expect(conv.model).toBe('claude-sonnet-4-20250514');
    });

    it('accumulates token usage across multiple updates', () => {
      const db = manager.get();
      const now = Date.now();

      // Create project, session, and conversation
      db.prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('proj-conv-accum', 'Test Project', '/tmp', now, now);
      db.prepare('INSERT INTO sessions (id, project_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('sess-conv-accum', 'proj-conv-accum', 'Test Session', 'running', now, now);
      db.prepare('INSERT INTO conversations (id, session_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('conv-accum', 'sess-conv-accum', 'Test Conversation', 1, now, now);

      // First update
      db.prepare('UPDATE conversations SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE id = ?')
        .run(100, 50, 'conv-accum');

      // Second update (simulate second turn)
      db.prepare('UPDATE conversations SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE id = ?')
        .run(200, 100, 'conv-accum');

      // Verify accumulated values
      const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get('conv-accum');
      expect(conv.input_tokens).toBe(300);
      expect(conv.output_tokens).toBe(150);
    });
  });
});
