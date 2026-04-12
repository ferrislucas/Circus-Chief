import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions, canvasItems } from '../database.js';

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Import after mocks are set up
import { addItem, getItems, updateItemContent, removeItem } from './canvasStore.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

describe('canvasStore', () => {
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
    sessions.update(session.id, { status: 'waiting' });
  });

  describe('updateItemContent', () => {
    it('updates the content of an existing canvas item', () => {
      const item = canvasItems.create(session.id, {
        type: 'markdown',
        content: '# Original',
        filename: 'test.md',
      });

      const updated = updateItemContent(session.id, item.id, '# Updated');

      expect(updated.content).toBe('# Updated');
      expect(updated.id).toBe(item.id);
    });

    it('broadcasts CANVAS_UPDATE after updating content', () => {
      const item = canvasItems.create(session.id, {
        type: 'markdown',
        content: '# Original',
        filename: 'test.md',
      });

      const updated = updateItemContent(session.id, item.id, '# Updated');

      expect(broadcastToSession).toHaveBeenCalledWith(
        session.id,
        WS_MESSAGE_TYPES.CANVAS_UPDATE,
        { item: updated }
      );
    });

    it('throws when item does not exist', () => {
      expect(() => {
        updateItemContent(session.id, 'nonexistent-id', 'content');
      }).toThrow('Canvas item not found');
    });

    it('throws when item belongs to a different session', () => {
      const otherProject = projects.create('Other Project', '/tmp/other');
      const otherSession = sessions.create(otherProject.id, 'Other Session', 'prompt', 'standard');

      const item = canvasItems.create(otherSession.id, {
        type: 'markdown',
        content: '# Other',
        filename: 'test.md',
      });

      expect(() => {
        updateItemContent(session.id, item.id, 'new content');
      }).toThrow('Canvas item not found');
    });

    it('does not broadcast when item is not found', () => {
      expect(() => {
        updateItemContent(session.id, 'nonexistent-id', 'content');
      }).toThrow();

      expect(broadcastToSession).not.toHaveBeenCalled();
    });

    it('persists the updated content in the database', () => {
      const item = canvasItems.create(session.id, {
        type: 'text',
        content: 'old content',
        filename: 'test.txt',
      });

      updateItemContent(session.id, item.id, 'new content');

      const retrieved = canvasItems.getById(item.id);
      expect(retrieved.content).toBe('new content');
    });

    it('updates the updatedAt timestamp', () => {
      const item = canvasItems.create(session.id, {
        type: 'markdown',
        content: '# Original',
        filename: 'test.md',
      });

      const updated = updateItemContent(session.id, item.id, '# Updated');

      expect(updated.updatedAt).toBeGreaterThanOrEqual(item.updatedAt);
    });
  });

  describe('addItem', () => {
    it('creates a canvas item and broadcasts CANVAS_ADD', () => {
      const item = addItem(session.id, {
        type: 'markdown',
        content: '# Hello',
        filename: 'hello.md',
      });

      expect(item.content).toBe('# Hello');
      expect(item.type).toBe('markdown');
      expect(broadcastToSession).toHaveBeenCalledWith(
        session.id,
        WS_MESSAGE_TYPES.CANVAS_ADD,
        { item }
      );
    });
  });

  describe('getItems', () => {
    it('returns all items for a session', () => {
      canvasItems.create(session.id, { type: 'text', content: 'Item 1' });
      canvasItems.create(session.id, { type: 'text', content: 'Item 2' });

      const items = getItems(session.id);

      expect(items).toHaveLength(2);
    });

    it('returns empty array when no items exist', () => {
      const items = getItems(session.id);
      expect(items).toEqual([]);
    });
  });

  describe('removeItem', () => {
    it('removes a canvas item and broadcasts CANVAS_REMOVE', () => {
      const item = canvasItems.create(session.id, {
        type: 'text',
        content: 'Delete me',
      });

      removeItem(session.id, item.id);

      expect(canvasItems.getById(item.id)).toBeNull();
      expect(broadcastToSession).toHaveBeenCalledWith(
        session.id,
        WS_MESSAGE_TYPES.CANVAS_REMOVE,
        { sessionId: session.id, itemId: item.id }
      );
    });

    it('throws when item does not exist', () => {
      expect(() => {
        removeItem(session.id, 'nonexistent-id');
      }).toThrow('Canvas item not found');
    });

    it('throws when item belongs to a different session', () => {
      const otherProject = projects.create('Other Project', '/tmp/other');
      const otherSession = sessions.create(otherProject.id, 'Other Session', 'prompt', 'standard');

      const item = canvasItems.create(otherSession.id, {
        type: 'text',
        content: 'Other session item',
      });

      expect(() => {
        removeItem(session.id, item.id);
      }).toThrow('Canvas item not found');
    });
  });
});
