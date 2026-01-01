import { describe, it, expect, vi } from 'vitest';
import { useCanvasStore } from './canvas.js';

// Mock the API module
vi.mock('../composables/useApi.js', () => ({
  api: {
    getCanvasItems: vi.fn(),
    uploadCanvasItem: vi.fn(),
    deleteCanvasItem: vi.fn(),
    getCanvasTrash: vi.fn(),
    recoverCanvasItem: vi.fn(),
    recoverCanvasFile: vi.fn(),
    permanentlyDeleteCanvasItem: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

describe('Canvas Store', () => {

  describe('state', () => {
    it('has correct initial state', () => {
      const store = useCanvasStore();
      expect(store.items).toEqual([]);
      expect(store.trashedItems).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('groupedItems getter', () => {
    it('groups items by filename', () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'test.png', createdAt: 1000 },
        { id: '2', filename: 'test.png', createdAt: 2000 },
        { id: '3', filename: 'other.png', createdAt: 3000 },
      ];

      const grouped = store.groupedItems;
      expect(grouped.length).toBe(2);

      // Find the test.png group (should have latest version first)
      const testGroup = grouped.find((g) => g.filename === 'test.png');
      expect(testGroup).toBeTruthy();
      expect(testGroup.id).toBe('2'); // Latest version
      expect(testGroup.versionCount).toBe(2);
      expect(testGroup.allVersions.length).toBe(2);
    });

    it('groups items by label when filename is missing', () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', label: 'My Label', createdAt: 1000 },
        { id: '2', label: 'My Label', createdAt: 2000 },
      ];

      const grouped = store.groupedItems;
      expect(grouped.length).toBe(1);
      expect(grouped[0].versionCount).toBe(2);
    });

    it('uses id as fallback when filename and label are missing', () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', createdAt: 1000 },
        { id: '2', createdAt: 2000 },
      ];

      const grouped = store.groupedItems;
      expect(grouped.length).toBe(2); // Each item is its own group
    });

    it('sorts groups by createdAt descending (newest first)', () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'old.png', createdAt: 1000 },
        { id: '2', filename: 'new.png', createdAt: 3000 },
        { id: '3', filename: 'middle.png', createdAt: 2000 },
      ];

      const grouped = store.groupedItems;
      expect(grouped[0].filename).toBe('new.png');
      expect(grouped[1].filename).toBe('middle.png');
      expect(grouped[2].filename).toBe('old.png');
    });

    it('sorts versions within groups by createdAt descending', () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'test.png', createdAt: 1000 },
        { id: '2', filename: 'test.png', createdAt: 3000 },
        { id: '3', filename: 'test.png', createdAt: 2000 },
      ];

      const grouped = store.groupedItems;
      expect(grouped[0].allVersions[0].id).toBe('2'); // newest
      expect(grouped[0].allVersions[1].id).toBe('3'); // middle
      expect(grouped[0].allVersions[2].id).toBe('1'); // oldest
    });
  });

  describe('groupedTrashedItems getter', () => {
    it('groups trashed items by filename', () => {
      const store = useCanvasStore();
      store.trashedItems = [
        { id: '1', filename: 'deleted.png', deletedAt: 1000 },
        { id: '2', filename: 'deleted.png', deletedAt: 2000 },
        { id: '3', filename: 'other.png', deletedAt: 3000 },
      ];

      const grouped = store.groupedTrashedItems;
      expect(grouped.length).toBe(2);

      const deletedGroup = grouped.find((g) => g.filename === 'deleted.png');
      expect(deletedGroup).toBeTruthy();
      expect(deletedGroup.versionCount).toBe(2);
      expect(deletedGroup.allVersions.length).toBe(2);
    });

    it('sorts trashed items by deletedAt descending', () => {
      const store = useCanvasStore();
      store.trashedItems = [
        { id: '1', filename: 'old.png', deletedAt: 1000 },
        { id: '2', filename: 'new.png', deletedAt: 3000 },
      ];

      const grouped = store.groupedTrashedItems;
      expect(grouped[0].filename).toBe('new.png');
      expect(grouped[1].filename).toBe('old.png');
    });
  });

  describe('deleteItem action', () => {
    it('removes item from items array and adds to trash', async () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'test.png' },
        { id: '2', filename: 'other.png' },
      ];

      const deletedItem = { id: '1', filename: 'test.png', deletedAt: 1000 };
      api.deleteCanvasItem.mockResolvedValue(deletedItem);

      await store.deleteItem('session-1', '1');

      expect(store.items.length).toBe(1);
      expect(store.items[0].id).toBe('2');
      expect(store.trashedItems.length).toBe(1);
      expect(store.trashedItems[0]).toEqual(deletedItem);
    });
  });

  describe('deleteGroup action', () => {
    it('deletes all items with the same filename', async () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'test.png' },
        { id: '2', filename: 'test.png' },
        { id: '3', filename: 'other.png' },
      ];

      api.deleteCanvasItem.mockResolvedValue();

      await store.deleteGroup('session-1', 'test.png');

      expect(api.deleteCanvasItem).toHaveBeenCalledTimes(2);
      expect(api.deleteCanvasItem).toHaveBeenCalledWith('session-1', '1');
      expect(api.deleteCanvasItem).toHaveBeenCalledWith('session-1', '2');
      expect(store.items.length).toBe(1);
      expect(store.items[0].id).toBe('3');
    });

    it('uses label for grouping when filename is missing', async () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', label: 'My File' },
        { id: '2', label: 'My File' },
        { id: '3', label: 'Other' },
      ];

      api.deleteCanvasItem.mockResolvedValue();

      await store.deleteGroup('session-1', 'My File');

      expect(api.deleteCanvasItem).toHaveBeenCalledTimes(2);
      expect(store.items.length).toBe(1);
    });
  });

  describe('removeItem action', () => {
    it('removes item from items array', () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'test.png' },
        { id: '2', filename: 'other.png' },
      ];

      store.removeItem('1');

      expect(store.items.length).toBe(1);
      expect(store.items[0].id).toBe('2');
    });
  });

  describe('uploadItem action', () => {
    it('adds new item to front of items array', async () => {
      const store = useCanvasStore();
      store.items = [{ id: '1', filename: 'existing.png' }];

      const newItem = { id: '2', filename: 'new.png' };
      api.uploadCanvasItem.mockResolvedValue(newItem);

      const result = await store.uploadItem('session-1', new File([], 'new.png'), 'new.png');

      expect(store.items.length).toBe(2);
      expect(store.items[0]).toEqual(newItem);
      expect(result).toEqual(newItem);
    });
  });

  describe('fetchTrashedItems action', () => {
    it('fetches and stores trashed items', async () => {
      const store = useCanvasStore();
      const trashedItems = [
        { id: '1', filename: 'deleted.png', deletedAt: 1000 },
        { id: '2', filename: 'removed.txt', deletedAt: 2000 },
      ];
      api.getCanvasTrash.mockResolvedValue(trashedItems);

      await store.fetchTrashedItems('session-1');

      expect(api.getCanvasTrash).toHaveBeenCalledWith('session-1');
      expect(store.trashedItems).toEqual(trashedItems);
    });

    it('sets error on failure', async () => {
      const store = useCanvasStore();
      api.getCanvasTrash.mockRejectedValue(new Error('Network error'));

      await store.fetchTrashedItems('session-1');

      expect(store.error).toBe('Network error');
    });
  });

  describe('recoverItem action', () => {
    it('removes item from trashedItems and adds to items', async () => {
      const store = useCanvasStore();
      store.trashedItems = [
        { id: '1', filename: 'recover.png', deletedAt: 1000 },
        { id: '2', filename: 'other.txt', deletedAt: 2000 },
      ];
      store.items = [{ id: '3', filename: 'existing.png' }];

      const recoveredItem = { id: '1', filename: 'recover.png', deletedAt: null };
      api.recoverCanvasItem.mockResolvedValue(recoveredItem);

      await store.recoverItem('session-1', '1');

      expect(store.trashedItems).toHaveLength(1);
      expect(store.trashedItems[0].id).toBe('2');
      expect(store.items).toHaveLength(2);
      expect(store.items[0]).toEqual(recoveredItem);
    });

    it('returns the recovered item', async () => {
      const store = useCanvasStore();
      store.trashedItems = [{ id: '1', filename: 'test.png', deletedAt: 1000 }];

      const recoveredItem = { id: '1', filename: 'test.png', deletedAt: null };
      api.recoverCanvasItem.mockResolvedValue(recoveredItem);

      const result = await store.recoverItem('session-1', '1');

      expect(result).toEqual(recoveredItem);
    });

    it('sets error on failure', async () => {
      const store = useCanvasStore();
      store.trashedItems = [{ id: '1', filename: 'test.png', deletedAt: 1000 }];
      api.recoverCanvasItem.mockRejectedValue(new Error('Recovery failed'));

      await expect(store.recoverItem('session-1', '1')).rejects.toThrow('Recovery failed');
      expect(store.error).toBe('Recovery failed');
    });
  });

  describe('recoverFile action', () => {
    it('refreshes both items and trashedItems', async () => {
      const store = useCanvasStore();
      api.recoverCanvasFile.mockResolvedValue({ recovered: 2 });
      api.getCanvasItems.mockResolvedValue([
        { id: '1', filename: 'recovered.txt' },
        { id: '2', filename: 'recovered.txt' },
      ]);
      api.getCanvasTrash.mockResolvedValue([]);

      await store.recoverFile('session-1', 'recovered.txt');

      expect(api.recoverCanvasFile).toHaveBeenCalledWith('session-1', 'recovered.txt');
      expect(api.getCanvasItems).toHaveBeenCalledWith('session-1');
      expect(api.getCanvasTrash).toHaveBeenCalledWith('session-1');
      expect(store.items).toHaveLength(2);
      expect(store.trashedItems).toHaveLength(0);
    });

    it('sets error on failure', async () => {
      const store = useCanvasStore();
      api.recoverCanvasFile.mockRejectedValue(new Error('File recovery failed'));

      await expect(store.recoverFile('session-1', 'test.txt')).rejects.toThrow('File recovery failed');
      expect(store.error).toBe('File recovery failed');
    });
  });

  describe('permanentlyDeleteItem action', () => {
    it('removes item from trashedItems', async () => {
      const store = useCanvasStore();
      store.trashedItems = [
        { id: '1', filename: 'delete.png', deletedAt: 1000 },
        { id: '2', filename: 'keep.txt', deletedAt: 2000 },
      ];
      api.permanentlyDeleteCanvasItem.mockResolvedValue();

      await store.permanentlyDeleteItem('session-1', '1');

      expect(api.permanentlyDeleteCanvasItem).toHaveBeenCalledWith('session-1', '1');
      expect(store.trashedItems).toHaveLength(1);
      expect(store.trashedItems[0].id).toBe('2');
    });

    it('sets error on failure', async () => {
      const store = useCanvasStore();
      store.trashedItems = [{ id: '1', filename: 'test.png', deletedAt: 1000 }];
      api.permanentlyDeleteCanvasItem.mockRejectedValue(new Error('Delete failed'));

      await expect(store.permanentlyDeleteItem('session-1', '1')).rejects.toThrow('Delete failed');
      expect(store.error).toBe('Delete failed');
    });
  });

  describe('groupedTrashedItems getter edge cases', () => {
    it('handles items with label fallback for grouping key', () => {
      const store = useCanvasStore();
      store.trashedItems = [
        { id: '1', label: 'My Screenshot', deletedAt: 1000 },
        { id: '2', label: 'My Screenshot', deletedAt: 2000 },
      ];

      const grouped = store.groupedTrashedItems;
      expect(grouped).toHaveLength(1);
      expect(grouped[0].versionCount).toBe(2);
      expect(grouped[0].label).toBe('My Screenshot');
    });

    it('handles items with id fallback for grouping key', () => {
      const store = useCanvasStore();
      store.trashedItems = [
        { id: '1', deletedAt: 1000 },
        { id: '2', deletedAt: 2000 },
      ];

      const grouped = store.groupedTrashedItems;
      // Each item should be its own group since IDs are unique
      expect(grouped).toHaveLength(2);
      expect(grouped[0].versionCount).toBe(1);
      expect(grouped[1].versionCount).toBe(1);
    });
  });
});
