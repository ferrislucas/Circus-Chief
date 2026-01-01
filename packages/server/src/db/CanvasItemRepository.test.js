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

  describe('getAllVersionsByFilename', () => {
    it('returns empty array when no items with filename exist', () => {
      const items = repo.getAllVersionsByFilename(sessionId, 'nonexistent.txt');
      expect(items).toEqual([]);
    });

    it('returns all items with matching filename', () => {
      repo.create(sessionId, { type: 'text', content: 'Version 1', filename: 'test.txt' });
      repo.create(sessionId, { type: 'text', content: 'Version 2', filename: 'test.txt' });
      repo.create(sessionId, { type: 'text', content: 'Version 3', filename: 'test.txt' });

      const items = repo.getAllVersionsByFilename(sessionId, 'test.txt');

      expect(items).toHaveLength(3);
      expect(items.every(i => i.filename === 'test.txt')).toBe(true);
    });

    it('returns items ordered by createdAt descending (newest first)', () => {
      repo.create(sessionId, { type: 'text', content: 'Version 1', filename: 'test.txt' });
      repo.create(sessionId, { type: 'text', content: 'Version 2', filename: 'test.txt' });
      repo.create(sessionId, { type: 'text', content: 'Version 3', filename: 'test.txt' });

      const items = repo.getAllVersionsByFilename(sessionId, 'test.txt');

      // Newest should be first
      expect(items[0].createdAt).toBeGreaterThanOrEqual(items[1].createdAt);
      expect(items[1].createdAt).toBeGreaterThanOrEqual(items[2].createdAt);
    });

    it('does not return items with different filenames', () => {
      repo.create(sessionId, { type: 'text', content: 'File A', filename: 'a.txt' });
      repo.create(sessionId, { type: 'text', content: 'File B', filename: 'b.txt' });
      repo.create(sessionId, { type: 'text', content: 'File A v2', filename: 'a.txt' });

      const items = repo.getAllVersionsByFilename(sessionId, 'a.txt');

      expect(items).toHaveLength(2);
      expect(items.every(i => i.filename === 'a.txt')).toBe(true);
    });

    it('does not return items from other sessions', () => {
      // Create another session
      const project = projectRepo.create('Another Project', '/tmp/another');
      const now = Date.now();
      const otherId = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(otherId, project.id, 'Other Session', 'running', 'standard', now, now);

      repo.create(sessionId, { type: 'text', content: 'Session 1', filename: 'shared.txt' });
      repo.create(otherId, { type: 'text', content: 'Session 2', filename: 'shared.txt' });

      const items = repo.getAllVersionsByFilename(sessionId, 'shared.txt');

      expect(items).toHaveLength(1);
      expect(items[0].sessionId).toBe(sessionId);
    });

    it('works with PDF type', () => {
      repo.create(sessionId, { type: 'pdf', data: 'base64pdfdata', filename: 'doc.pdf', mimeType: 'application/pdf' });

      const items = repo.getAllVersionsByFilename(sessionId, 'doc.pdf');

      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('pdf');
      expect(items[0].mimeType).toBe('application/pdf');
    });
  });

  describe('soft delete functionality', () => {
    describe('getBySessionId excludes soft-deleted items', () => {
      it('excludes items with deleted_at set', () => {
        const item1 = repo.create(sessionId, { type: 'text', content: 'Active item' });
        const item2 = repo.create(sessionId, { type: 'text', content: 'Deleted item' });

        repo.softDelete(item2.id);

        const items = repo.getBySessionId(sessionId);

        expect(items).toHaveLength(1);
        expect(items[0].id).toBe(item1.id);
      });
    });

    describe('getAllVersionsByFilename excludes soft-deleted items', () => {
      it('excludes deleted versions from filename query', () => {
        repo.create(sessionId, { type: 'text', content: 'Version 1', filename: 'test.txt' });
        const v2 = repo.create(sessionId, { type: 'text', content: 'Version 2', filename: 'test.txt' });
        repo.create(sessionId, { type: 'text', content: 'Version 3', filename: 'test.txt' });

        repo.softDelete(v2.id);

        const items = repo.getAllVersionsByFilename(sessionId, 'test.txt');

        expect(items).toHaveLength(2);
        expect(items.every(i => i.id !== v2.id)).toBe(true);
      });
    });

    describe('getDeletedBySessionId', () => {
      it('returns only deleted items', () => {
        repo.create(sessionId, { type: 'text', content: 'Active item' });
        const item2 = repo.create(sessionId, { type: 'text', content: 'Deleted item' });

        repo.softDelete(item2.id);

        const deletedItems = repo.getDeletedBySessionId(sessionId);

        expect(deletedItems).toHaveLength(1);
        expect(deletedItems[0].id).toBe(item2.id);
        expect(deletedItems[0].deletedAt).toBeDefined();
        expect(deletedItems[0].deletedAt).not.toBeNull();
      });

      it('returns empty array for session with no trash', () => {
        repo.create(sessionId, { type: 'text', content: 'Active item' });

        const deletedItems = repo.getDeletedBySessionId(sessionId);

        expect(deletedItems).toEqual([]);
      });

      it('orders by deleted_at descending (most recently deleted first)', () => {
        const item1 = repo.create(sessionId, { type: 'text', content: 'First to delete' });
        const item2 = repo.create(sessionId, { type: 'text', content: 'Second to delete' });

        repo.softDelete(item1.id);
        // Small delay to ensure different timestamps
        repo.softDelete(item2.id);

        const deletedItems = repo.getDeletedBySessionId(sessionId);

        expect(deletedItems).toHaveLength(2);
        expect(deletedItems[0].deletedAt).toBeGreaterThanOrEqual(deletedItems[1].deletedAt);
      });
    });

    describe('softDelete', () => {
      it('sets deleted_at timestamp', () => {
        const item = repo.create(sessionId, { type: 'text', content: 'To delete' });
        const beforeDelete = Date.now();

        const deletedItem = repo.softDelete(item.id);

        expect(deletedItem.deletedAt).toBeDefined();
        expect(deletedItem.deletedAt).toBeGreaterThanOrEqual(beforeDelete);
        expect(deletedItem.deletedAt).toBeLessThanOrEqual(Date.now());
      });

      it('preserves other item fields', () => {
        const item = repo.create(sessionId, {
          type: 'markdown',
          content: '# Hello',
          filename: 'readme.md',
          label: 'Documentation',
        });

        const deletedItem = repo.softDelete(item.id);

        expect(deletedItem.id).toBe(item.id);
        expect(deletedItem.type).toBe('markdown');
        expect(deletedItem.content).toBe('# Hello');
        expect(deletedItem.filename).toBe('readme.md');
        expect(deletedItem.label).toBe('Documentation');
        expect(deletedItem.sessionId).toBe(sessionId);
        expect(deletedItem.createdAt).toBe(item.createdAt);
      });

      it('returns the updated item with deletedAt', () => {
        const item = repo.create(sessionId, { type: 'text', content: 'Test' });

        const deletedItem = repo.softDelete(item.id);

        expect(deletedItem).toHaveProperty('deletedAt');
        expect(typeof deletedItem.deletedAt).toBe('number');
      });
    });

    describe('recover', () => {
      it('clears deleted_at timestamp', () => {
        const item = repo.create(sessionId, { type: 'text', content: 'To recover' });
        repo.softDelete(item.id);

        const recoveredItem = repo.recover(item.id);

        expect(recoveredItem.deletedAt).toBeNull();
      });

      it('returns the recovered item', () => {
        const item = repo.create(sessionId, { type: 'text', content: 'Recover me', filename: 'test.txt' });
        repo.softDelete(item.id);

        const recoveredItem = repo.recover(item.id);

        expect(recoveredItem.id).toBe(item.id);
        expect(recoveredItem.content).toBe('Recover me');
        expect(recoveredItem.filename).toBe('test.txt');
        expect(recoveredItem.deletedAt).toBeNull();
      });

      it('makes item appear in getBySessionId again', () => {
        const item = repo.create(sessionId, { type: 'text', content: 'Test' });
        repo.softDelete(item.id);

        expect(repo.getBySessionId(sessionId)).toHaveLength(0);

        repo.recover(item.id);

        expect(repo.getBySessionId(sessionId)).toHaveLength(1);
      });
    });

    describe('recoverByFilename', () => {
      it('recovers all versions of a file', () => {
        repo.create(sessionId, { type: 'text', content: 'V1', filename: 'shared.txt' });
        repo.create(sessionId, { type: 'text', content: 'V2', filename: 'shared.txt' });
        repo.create(sessionId, { type: 'text', content: 'V3', filename: 'shared.txt' });

        // Soft delete all
        const allItems = repo.getBySessionId(sessionId);
        allItems.forEach(item => repo.softDelete(item.id));

        expect(repo.getDeletedBySessionId(sessionId)).toHaveLength(3);
        expect(repo.getBySessionId(sessionId)).toHaveLength(0);

        repo.recoverByFilename(sessionId, 'shared.txt');

        expect(repo.getBySessionId(sessionId)).toHaveLength(3);
        expect(repo.getDeletedBySessionId(sessionId)).toHaveLength(0);
      });

      it('does not affect other files', () => {
        repo.create(sessionId, { type: 'text', content: 'A1', filename: 'a.txt' });
        repo.create(sessionId, { type: 'text', content: 'B1', filename: 'b.txt' });

        const allItems = repo.getBySessionId(sessionId);
        allItems.forEach(item => repo.softDelete(item.id));

        repo.recoverByFilename(sessionId, 'a.txt');

        const activeItems = repo.getBySessionId(sessionId);
        const deletedItems = repo.getDeletedBySessionId(sessionId);

        expect(activeItems).toHaveLength(1);
        expect(activeItems[0].filename).toBe('a.txt');
        expect(deletedItems).toHaveLength(1);
        expect(deletedItems[0].filename).toBe('b.txt');
      });

      it('does not affect other sessions', () => {
        // Create another session
        const project = projectRepo.create('Another Project', '/tmp/another');
        const now = Date.now();
        const otherSessionId = databaseManager.generateId();
        databaseManager.get().prepare(
          'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(otherSessionId, project.id, 'Other Session', 'running', 'standard', now, now);

        repo.create(sessionId, { type: 'text', content: 'Session 1', filename: 'shared.txt' });
        repo.create(otherSessionId, { type: 'text', content: 'Session 2', filename: 'shared.txt' });

        // Delete both
        const session1Items = repo.getBySessionId(sessionId);
        session1Items.forEach(item => repo.softDelete(item.id));
        const session2Items = repo.getBySessionId(otherSessionId);
        session2Items.forEach(item => repo.softDelete(item.id));

        // Recover only from first session
        repo.recoverByFilename(sessionId, 'shared.txt');

        expect(repo.getBySessionId(sessionId)).toHaveLength(1);
        expect(repo.getDeletedBySessionId(otherSessionId)).toHaveLength(1);
      });
    });

    describe('permanentDelete', () => {
      it('removes item from database completely', () => {
        const item = repo.create(sessionId, { type: 'text', content: 'Gone forever' });
        repo.softDelete(item.id);

        repo.permanentDelete(item.id);

        expect(repo.getById(item.id)).toBeNull();
        expect(repo.getDeletedBySessionId(sessionId)).toHaveLength(0);
      });

      it('does not affect other items', () => {
        const item1 = repo.create(sessionId, { type: 'text', content: 'Keep me' });
        const item2 = repo.create(sessionId, { type: 'text', content: 'Delete me' });
        repo.softDelete(item2.id);

        repo.permanentDelete(item2.id);

        expect(repo.getById(item1.id)).not.toBeNull();
        expect(repo.getBySessionId(sessionId)).toHaveLength(1);
      });
    });

    describe('deletedAt field mapping', () => {
      it('maps deletedAt correctly from database row', () => {
        const item = repo.create(sessionId, { type: 'text', content: 'Test' });

        // Initially null
        expect(item.deletedAt).toBeNull();

        const deletedItem = repo.softDelete(item.id);
        expect(typeof deletedItem.deletedAt).toBe('number');

        const recovered = repo.recover(item.id);
        expect(recovered.deletedAt).toBeNull();
      });
    });
  });
});
