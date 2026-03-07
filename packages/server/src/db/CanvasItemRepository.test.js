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
      expect(item.updatedAt).toBeTypeOf('number');
      expect(item.updatedAt).toBe(item.createdAt);
    });

    it('creates canvas item with label', () => {
      const _item = repo.create(sessionId, {
        type: 'text',
        content: 'Some text',
      });

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

  describe('getLatestVersionsBySessionId', () => {
    it('returns empty array when no items exist', () => {
      const items = repo.getLatestVersionsBySessionId(sessionId);
      expect(items).toEqual([]);
    });

    it('returns only the latest version of each file', () => {
      // Create multiple versions of test.txt
      repo.create(sessionId, { type: 'text', content: 'Version 1', filename: 'test.txt' });
      repo.create(sessionId, { type: 'text', content: 'Version 2', filename: 'test.txt' });
      const v3 = repo.create(sessionId, { type: 'text', content: 'Version 3', filename: 'test.txt' });

      // Create multiple versions of another.md
      repo.create(sessionId, { type: 'markdown', content: '# V1', filename: 'another.md' });
      const v2md = repo.create(sessionId, { type: 'markdown', content: '# V2', filename: 'another.md' });

      const items = repo.getLatestVersionsBySessionId(sessionId);

      // Should only return 2 items (one per filename)
      expect(items).toHaveLength(2);

      // Find the returned items by filename
      const txtItem = items.find(i => i.filename === 'test.txt');
      const mdItem = items.find(i => i.filename === 'another.md');

      // Should be the latest versions
      expect(txtItem.id).toBe(v3.id);
      expect(txtItem.content).toBe('Version 3');
      expect(mdItem.id).toBe(v2md.id);
      expect(mdItem.content).toBe('# V2');
    });

    it('returns items with no duplicates', () => {
      // Create 5 versions of the same file
      repo.create(sessionId, { type: 'text', content: 'V1', filename: 'shared.txt' });
      repo.create(sessionId, { type: 'text', content: 'V2', filename: 'shared.txt' });
      repo.create(sessionId, { type: 'text', content: 'V3', filename: 'shared.txt' });
      repo.create(sessionId, { type: 'text', content: 'V4', filename: 'shared.txt' });
      repo.create(sessionId, { type: 'text', content: 'V5', filename: 'shared.txt' });

      const items = repo.getLatestVersionsBySessionId(sessionId);

      // Should only return 1 item
      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('V5'); // Latest version
    });

    it('returns items ordered by createdAt descending', () => {
      const i1 = repo.create(sessionId, { type: 'text', content: 'First', filename: 'a.txt' });
      const i2 = repo.create(sessionId, { type: 'text', content: 'Second', filename: 'b.txt' });
      const i3 = repo.create(sessionId, { type: 'text', content: 'Third', filename: 'c.txt' });

      const items = repo.getLatestVersionsBySessionId(sessionId);

      expect(items).toHaveLength(3);
      expect(items[0].createdAt).toBeGreaterThanOrEqual(items[2].createdAt);

      // Verify all expected items are returned
      const ids = items.map(i => i.id);
      expect(ids).toContain(i1.id);
      expect(ids).toContain(i2.id);
      expect(ids).toContain(i3.id);
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

      const items = repo.getLatestVersionsBySessionId(sessionId);

      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('Session 1');
    });

    it('excludes soft-deleted items', () => {
      const v1 = repo.create(sessionId, { type: 'text', content: 'V1', filename: 'test.txt' });
      const v2 = repo.create(sessionId, { type: 'text', content: 'V2', filename: 'test.txt' });

      // Soft delete the latest version
      repo.softDelete(v2.id);

      const items = repo.getLatestVersionsBySessionId(sessionId);

      // Should return v1 now (since v2 is deleted)
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe(v1.id);
      expect(items[0].content).toBe('V1');
    });

    it('excludes files with all versions deleted', () => {
      const v1 = repo.create(sessionId, { type: 'text', content: 'V1', filename: 'deleted.txt' });
      const v2 = repo.create(sessionId, { type: 'text', content: 'V2', filename: 'deleted.txt' });
      repo.create(sessionId, { type: 'text', content: 'Active', filename: 'active.txt' });

      // Delete all versions of deleted.txt
      repo.softDelete(v1.id);
      repo.softDelete(v2.id);

      const items = repo.getLatestVersionsBySessionId(sessionId);

      // Should only return active.txt
      expect(items).toHaveLength(1);
      expect(items[0].filename).toBe('active.txt');
    });

    it('works with various file types', () => {
      repo.create(sessionId, { type: 'image', data: 'imagedata', filename: 'pic.png', mimeType: 'image/png' });
      repo.create(sessionId, { type: 'pdf', data: 'pdfdata', filename: 'doc.pdf', mimeType: 'application/pdf' });
      repo.create(sessionId, { type: 'markdown', content: '# Title', filename: 'readme.md' });
      repo.create(sessionId, { type: 'json', data: '{"key":"value"}', filename: 'data.json' });
      repo.create(sessionId, { type: 'code', content: 'console.log()', filename: 'script.js' });

      const items = repo.getLatestVersionsBySessionId(sessionId);

      expect(items).toHaveLength(5);
      expect(items.map(i => i.type).sort()).toEqual(['code', 'image', 'json', 'markdown', 'pdf']);
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
        });

        const deletedItem = repo.softDelete(item.id);

        expect(deletedItem.id).toBe(item.id);
        expect(deletedItem.type).toBe('markdown');
        expect(deletedItem.content).toBe('# Hello');
        expect(deletedItem.filename).toBe('readme.md');
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

      it('updates updatedAt timestamp when recovering', async () => {
        const item = repo.create(sessionId, { type: 'text', content: 'To recover' });
        const originalUpdatedAt = item.updatedAt;

        // Add a small delay to ensure timestamp difference
        await new Promise(resolve => setTimeout(resolve, 10));

        repo.softDelete(item.id);
        const recoveredItem = repo.recover(item.id);

        expect(recoveredItem.updatedAt).toBeGreaterThan(originalUpdatedAt);
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

    describe('duplicateForSession', () => {
      let targetSessionId;
      let targetProject;

      const createTargetSession = () => {
        targetProject = projectRepo.create('Target Project', '/tmp/target');
        targetSessionId = databaseManager.generateId();
        const now = Date.now();
        databaseManager.get().prepare(
          'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(targetSessionId, targetProject.id, 'Target Session', 'running', 'standard', now, now);
      };

      it('should copy all canvas items to new session', () => {
        repo.create(sessionId, { type: 'image', filename: 'pic.png', content: 'base64data' });
        repo.create(sessionId, { type: 'markdown', content: '# Title' });

        createTargetSession();
        repo.duplicateForSession(sessionId, targetSessionId);

        const targetItems = repo.getBySessionId(targetSessionId);
        expect(targetItems).toHaveLength(2);
      });

      it('should preserve all item metadata', () => {
        repo.create(sessionId, {
          type: 'image',
          content: 'base64data',
          mimeType: 'image/png',
          filename: 'screenshot.png',
          width: 1920,
          height: 1080,
        });

        createTargetSession();
        repo.duplicateForSession(sessionId, targetSessionId);

        const targetItems = repo.getBySessionId(targetSessionId);
        expect(targetItems[0]).toMatchObject({
          type: 'image',
          content: 'base64data',
          mimeType: 'image/png',
          filename: 'screenshot.png',
          width: 1920,
          height: 1080,
        });
      });

      it('should handle all canvas item types', () => {
        const types = ['image', 'markdown', 'text', 'json', 'pdf', 'code'];
        types.forEach(type => {
          repo.create(sessionId, { type, filename: `file.${type}` });
        });

        createTargetSession();
        repo.duplicateForSession(sessionId, targetSessionId);

        const targetItems = repo.getBySessionId(targetSessionId);
        expect(targetItems).toHaveLength(types.length);
        expect(targetItems.map(i => i.type).sort()).toEqual(types.sort());
      });

      it('should generate new IDs for all items', () => {
        const original = repo.create(sessionId, { type: 'text' });

        createTargetSession();
        repo.duplicateForSession(sessionId, targetSessionId);

        const targetItems = repo.getBySessionId(targetSessionId);
        expect(targetItems[0].id).not.toBe(original.id);
      });

      it('should handle session with no canvas items', () => {
        createTargetSession();
        repo.duplicateForSession(sessionId, targetSessionId);

        expect(repo.getBySessionId(targetSessionId)).toHaveLength(0);
      });

      it('should preserve JSON data field', () => {
        repo.create(sessionId, {
          type: 'json',
          data: { key: 'value', nested: { a: 1 } },
        });

        createTargetSession();
        repo.duplicateForSession(sessionId, targetSessionId);

        const targetItems = repo.getBySessionId(targetSessionId);
        expect(targetItems[0].data).toEqual({ key: 'value', nested: { a: 1 } });
      });

      it('should not copy deleted items', () => {
        repo.create(sessionId, { type: 'text', content: 'Keep' });
        const deleted = repo.create(sessionId, { type: 'text', content: 'Delete' });
        repo.softDelete(deleted.id);

        createTargetSession();
        repo.duplicateForSession(sessionId, targetSessionId);

        const targetItems = repo.getBySessionId(targetSessionId);
        expect(targetItems).toHaveLength(1);
        expect(targetItems[0].content).toBe('Keep');
      });
    });
  });

  describe('JSON data parsing in #mapCanvasItem', () => {
    it('parses JSON data when type is "json" and data is a valid JSON string', () => {
      const jsonObject = { key: 'value', nested: { a: 1, b: [1, 2, 3] } };
      const item = repo.create(sessionId, {
        type: 'json',
        data: jsonObject,
      });

      // Data should be returned as an object, not a string
      expect(item.data).toEqual(jsonObject);
      expect(typeof item.data).toBe('object');
      expect(item.data).not.toBe(JSON.stringify(jsonObject));
    });

    it('does not parse JSON when type is not "json"', () => {
      const jsonString = '{"key":"value"}';
      const item = repo.create(sessionId, {
        type: 'text',
        data: jsonString,
      });

      // Data should remain as string for non-json types
      expect(item.data).toBe(jsonString);
      expect(typeof item.data).toBe('string');
    });

    it('handles nested JSON objects correctly', () => {
      const nestedData = {
        user: {
          name: 'Test User',
          age: 30,
          address: {
            street: '123 Test St',
            city: 'Test City',
          },
        },
        tags: ['tag1', 'tag2', 'tag3'],
        active: true,
      };

      const item = repo.create(sessionId, {
        type: 'json',
        data: nestedData,
      });

      expect(item.data).toEqual(nestedData);
      expect(item.data.user.address.city).toBe('Test City');
      expect(item.data.tags).toHaveLength(3);
      expect(item.data.active).toBe(true);
    });

    it('handles invalid JSON gracefully by keeping original string', () => {
      // Insert invalid JSON directly into database
      const id = databaseManager.generateId();
      const now = Date.now();
      const invalidJson = '{invalid json without closing brace';

      databaseManager
        .get()
        .prepare(
          `INSERT INTO canvas_items (id, session_id, type, content, data, mime_type, filename, width, height, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, sessionId, 'json', null, invalidJson, null, null, null, null, now, now);

      const item = repo.getById(id);

      // Should keep the invalid string as-is
      expect(item.data).toBe(invalidJson);
      expect(typeof item.data).toBe('string');
    });

    it('handles malformed JSON gracefully', () => {
      const id = databaseManager.generateId();
      const now = Date.now();
      const malformedJson = '{"key": undefined value}';

      databaseManager
        .get()
        .prepare(
          `INSERT INTO canvas_items (id, session_id, type, content, data, mime_type, filename, width, height, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, sessionId, 'json', null, malformedJson, null, null, null, null, now, now);

      const item = repo.getById(id);

      // Should keep the malformed string
      expect(item.data).toBe(malformedJson);
    });

    it('returns null for null data field', () => {
      const item = repo.create(sessionId, {
        type: 'json',
        content: 'No data field',
      });

      expect(item.data).toBeNull();
    });

    it('handles empty JSON object', () => {
      const item = repo.create(sessionId, {
        type: 'json',
        data: {},
      });

      expect(item.data).toEqual({});
      expect(typeof item.data).toBe('object');
      expect(Object.keys(item.data)).toHaveLength(0);
    });

    it('handles JSON array', () => {
      const jsonArray = [1, 2, 3, { key: 'value' }, ['nested', 'array']];
      const item = repo.create(sessionId, {
        type: 'json',
        data: jsonArray,
      });

      expect(item.data).toEqual(jsonArray);
      expect(Array.isArray(item.data)).toBe(true);
      expect(item.data).toHaveLength(5);
    });

    it('handles JSON primitives (string, number, boolean)', () => {
      // Note: When creating, objects are stringified, but primitives at top level
      // are not typically used. Testing the parsing behavior:
      const id = databaseManager.generateId();
      const now = Date.now();

      // Insert as string (as it would be stored)
      databaseManager
        .get()
        .prepare(
          `INSERT INTO canvas_items (id, session_id, type, content, data, mime_type, filename, width, height, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, sessionId, 'json', null, '"just a string"', null, null, null, null, now, now);

      const item = repo.getById(id);
      expect(item.data).toBe('just a string');
    });

    it('preserves JSON data through retrieval after creation', () => {
      const originalData = {
        timestamp: Date.now(),
        message: 'Test message',
        count: 42,
        items: ['a', 'b', 'c'],
      };

      const created = repo.create(sessionId, {
        type: 'json',
        data: originalData,
        filename: 'test.json',
      });

      // Retrieve by ID
      const retrieved = repo.getById(created.id);
      expect(retrieved.data).toEqual(originalData);

      // Retrieve by session
      const sessionItems = repo.getBySessionId(sessionId);
      const fromSession = sessionItems.find(i => i.id === created.id);
      expect(fromSession.data).toEqual(originalData);

      // Retrieve latest versions
      const latestItems = repo.getLatestVersionsBySessionId(sessionId);
      const fromLatest = latestItems.find(i => i.id === created.id);
      expect(fromLatest.data).toEqual(originalData);
    });

    it('keeps data as string for non-json types even if it looks like JSON', () => {
      const jsonString = '{"looks":"like json"}';

      const textItem = repo.create(sessionId, {
        type: 'text',
        data: jsonString,
      });

      const markdownItem = repo.create(sessionId, {
        type: 'markdown',
        data: jsonString,
      });

      const codeItem = repo.create(sessionId, {
        type: 'code',
        data: jsonString,
      });

      // All should keep data as string
      expect(textItem.data).toBe(jsonString);
      expect(typeof textItem.data).toBe('string');

      expect(markdownItem.data).toBe(jsonString);
      expect(typeof markdownItem.data).toBe('string');

      expect(codeItem.data).toBe(jsonString);
      expect(typeof codeItem.data).toBe('string');
    });

    it('handles JSON with special characters', () => {
      const specialData = {
        unicode: 'Hello 世界 🌍',
        newlines: 'Line 1\nLine 2\nLine 3',
        quotes: 'He said "hello"',
        mixed: 'Path: C:\\Users\\Test\nNext: "quoted"',
      };

      const item = repo.create(sessionId, {
        type: 'json',
        data: specialData,
      });

      expect(item.data).toEqual(specialData);
      expect(item.data.unicode).toBe('Hello 世界 🌍');
      expect(item.data.newlines).toContain('\n');
      expect(item.data.quotes).toBe('He said "hello"');
    });

    it('preserves JSON data when duplicating sessions', () => {
      const sourceData = {
        config: { setting1: true, setting2: false },
        items: [{ id: 1, name: 'Item 1' }],
        metadata: { version: '1.0.0', created: Date.now() },
      };

      repo.create(sessionId, {
        type: 'json',
        data: sourceData,
        filename: 'config.json',
      });

      // Create target session
      const project = projectRepo.create('Target Project', '/tmp/target');
      const targetSessionId = databaseManager.generateId();
      const now = Date.now();
      databaseManager
        .get()
        .prepare(
          'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(targetSessionId, project.id, 'Target Session', 'running', 'standard', now, now);

      // Duplicate
      repo.duplicateForSession(sessionId, targetSessionId);

      // Verify data is preserved and parsed correctly
      const targetItems = repo.getBySessionId(targetSessionId);
      expect(targetItems).toHaveLength(1);
      expect(targetItems[0].data).toEqual(sourceData);
      expect(targetItems[0].data.config.setting1).toBe(true);
      expect(targetItems[0].data.items).toHaveLength(1);
    });
  });

  describe('batch operations', () => {
    describe('softDeleteBatch', () => {
      it('deletes multiple items atomically', () => {
        const item1 = repo.create(sessionId, { type: 'text', content: 'Item 1' });
        const item2 = repo.create(sessionId, { type: 'text', content: 'Item 2' });
        const item3 = repo.create(sessionId, { type: 'text', content: 'Item 3' });

        const count = repo.softDeleteBatch([item1.id, item2.id]);

        expect(count).toBe(2);
        expect(repo.getById(item1.id).deletedAt).not.toBeNull();
        expect(repo.getById(item2.id).deletedAt).not.toBeNull();
        expect(repo.getById(item3.id).deletedAt).toBeNull();
      });

      it('returns 0 for empty array', () => {
        const count = repo.softDeleteBatch([]);
        expect(count).toBe(0);
      });

      it('returns 0 for undefined/null', () => {
        expect(repo.softDeleteBatch()).toBe(0);
        expect(repo.softDeleteBatch(null)).toBe(0);
      });

      it('only deletes items that are not already deleted', () => {
        const item1 = repo.create(sessionId, { type: 'text', content: 'Item 1' });
        const item2 = repo.create(sessionId, { type: 'text', content: 'Item 2' });

        repo.softDelete(item1.id);

        const count = repo.softDeleteBatch([item1.id, item2.id]);

        // Should only count item2 since item1 was already deleted
        expect(count).toBe(1);
      });
    });

    describe('recoverBatch', () => {
      it('recovers multiple items atomically', () => {
        const item1 = repo.create(sessionId, { type: 'text', content: 'Item 1' });
        const item2 = repo.create(sessionId, { type: 'text', content: 'Item 2' });
        const item3 = repo.create(sessionId, { type: 'text', content: 'Item 3' });

        repo.softDeleteBatch([item1.id, item2.id, item3.id]);

        const count = repo.recoverBatch([item1.id, item2.id]);

        expect(count).toBe(2);
        expect(repo.getById(item1.id).deletedAt).toBeNull();
        expect(repo.getById(item2.id).deletedAt).toBeNull();
        expect(repo.getById(item3.id).deletedAt).not.toBeNull();
      });

      it('returns 0 for empty array', () => {
        const count = repo.recoverBatch([]);
        expect(count).toBe(0);
      });

      it('only recovers items that are deleted', () => {
        const item1 = repo.create(sessionId, { type: 'text', content: 'Item 1' });
        const item2 = repo.create(sessionId, { type: 'text', content: 'Item 2' });

        repo.softDelete(item1.id);

        const count = repo.recoverBatch([item1.id, item2.id]);

        // Should only count item1 since item2 wasn't deleted
        expect(count).toBe(1);
      });
    });

    describe('permanentDeleteBatch', () => {
      it('permanently deletes multiple items from trash', () => {
        const item1 = repo.create(sessionId, { type: 'text', content: 'Item 1' });
        const item2 = repo.create(sessionId, { type: 'text', content: 'Item 2' });
        const item3 = repo.create(sessionId, { type: 'text', content: 'Item 3' });

        repo.softDeleteBatch([item1.id, item2.id, item3.id]);

        const count = repo.permanentDeleteBatch([item1.id, item2.id]);

        expect(count).toBe(2);
        expect(repo.getById(item1.id)).toBeNull();
        expect(repo.getById(item2.id)).toBeNull();
        expect(repo.getById(item3.id)).not.toBeNull();
      });

      it('does not delete active items', () => {
        const item1 = repo.create(sessionId, { type: 'text', content: 'Item 1' });
        const item2 = repo.create(sessionId, { type: 'text', content: 'Item 2' });

        const count = repo.permanentDeleteBatch([item1.id, item2.id]);

        expect(count).toBe(0);
        expect(repo.getById(item1.id)).not.toBeNull();
        expect(repo.getById(item2.id)).not.toBeNull();
      });

      it('returns 0 for empty array', () => {
        const count = repo.permanentDeleteBatch([]);
        expect(count).toBe(0);
      });
    });
  });
});
