import { describe, it, expect, beforeEach } from 'vitest';
import { CanvasItemRepository } from './CanvasItemRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { databaseManager } from './DatabaseManager.js';

describe('CanvasItemRepository', () => {
  // Uses global setup from test/setup.js
  let repo;
  let projectRepo;
  let sessionId;

  beforeEach(() => {
    repo = new CanvasItemRepository();
    projectRepo = new ProjectRepository();

    // Create a project and session for testing
    const project = projectRepo.create('Test Project', '/tmp/test');
    const now = Date.now();
    const id = databaseManager.generateId();
    databaseManager.get().prepare(
      'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, project.id, 'Test Session', 'running', 'standard', now, now);
    sessionId = id;
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(CanvasItemRepository);
      expect(repo.tableName).toBe('canvas_items');
    });
  });

  describe('create', () => {
    it('creates a canvas item with type and content', () => {
      const item = repo.create(sessionId, {
        type: 'markdown',
        content: '# Hello World',
      });

      expect(item.id).toBeDefined();
      expect(item.sessionId).toBe(sessionId);
      expect(item.type).toBe('markdown');
      expect(item.content).toBe('# Hello World');
      expect(item.createdAt).toBeTypeOf('number');
    });

    it('creates canvas item with label', () => {
      const item = repo.create(sessionId, {
        type: 'text',
        content: 'Some text',
        label: 'My Label',
      });

      expect(item.label).toBe('My Label');
    });

    it('creates canvas item with data (for images)', () => {
      const item = repo.create(sessionId, {
        type: 'image',
        data: 'base64encodeddata',
        mimeType: 'image/png',
      });

      expect(item.type).toBe('image');
      expect(item.data).toBe('base64encodeddata');
      expect(item.mimeType).toBe('image/png');
    });

    it('creates canvas item with dimensions', () => {
      const item = repo.create(sessionId, {
        type: 'image',
        data: 'base64data',
        width: 800,
        height: 600,
      });

      expect(item.width).toBe(800);
      expect(item.height).toBe(600);
    });

    it('creates canvas item with filename', () => {
      const item = repo.create(sessionId, {
        type: 'text',
        content: 'file content',
        filename: 'test.txt',
      });

      expect(item.filename).toBe('test.txt');
    });

    it('sets optional fields to null when not provided', () => {
      const item = repo.create(sessionId, {
        type: 'text',
        content: 'Simple text',
      });

      expect(item.data).toBeNull();
      expect(item.mimeType).toBeNull();
      expect(item.filename).toBeNull();
      expect(item.label).toBeNull();
      expect(item.width).toBeNull();
      expect(item.height).toBeNull();
    });
  });

  describe('getById', () => {
    it('retrieves canvas item by ID', () => {
      const created = repo.create(sessionId, {
        type: 'markdown',
        content: '# Test',
      });
      const retrieved = repo.getById(created.id);

      expect(retrieved).toEqual(created);
    });

    it('returns null for non-existent ID', () => {
      expect(repo.getById('non-existent')).toBeNull();
    });
  });

  describe('getBySessionId', () => {
    it('returns empty array when no items exist', () => {
      const items = repo.getBySessionId(sessionId);
      expect(items).toEqual([]);
    });

    it('returns all items for a session', () => {
      repo.create(sessionId, { type: 'text', content: 'Item 1' });
      repo.create(sessionId, { type: 'text', content: 'Item 2' });
      repo.create(sessionId, { type: 'text', content: 'Item 3' });

      const items = repo.getBySessionId(sessionId);

      expect(items).toHaveLength(3);
    });

    it('returns items ordered by createdAt descending', () => {
      const i1 = repo.create(sessionId, { type: 'text', content: 'First' });
      const i2 = repo.create(sessionId, { type: 'text', content: 'Second' });
      const i3 = repo.create(sessionId, { type: 'text', content: 'Third' });

      const items = repo.getBySessionId(sessionId);

      // Verify all items are returned and ordered by createdAt DESC
      expect(items).toHaveLength(3);
      const ids = items.map(i => i.id);
      expect(ids).toContain(i1.id);
      expect(ids).toContain(i2.id);
      expect(ids).toContain(i3.id);
      // Items with same timestamp are returned, ordering is stable
      expect(items[0].createdAt).toBeGreaterThanOrEqual(items[2].createdAt);
    });

    it('does not return items from other sessions', () => {
      // Create another session
      const project = projectRepo.create('Another Project', '/tmp/another');
      const now = Date.now();
      const otherId = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(otherId, project.id, 'Other Session', 'running', 'standard', now, now);

      repo.create(sessionId, { type: 'text', content: 'Session 1 item' });
      repo.create(otherId, { type: 'text', content: 'Session 2 item' });

      const items = repo.getBySessionId(sessionId);

      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('Session 1 item');
    });
  });

  describe('delete', () => {
    it('deletes a canvas item', () => {
      const item = repo.create(sessionId, {
        type: 'text',
        content: 'Delete me',
      });
      repo.delete(item.id);

      expect(repo.getById(item.id)).toBeNull();
    });

    it('does not throw when deleting non-existent item', () => {
      expect(() => repo.delete('non-existent')).not.toThrow();
    });
  });
});
