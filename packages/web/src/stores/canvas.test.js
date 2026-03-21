import { describe, it, expect, vi } from 'vitest';
import { useCanvasStore } from './canvas.js';

// Mock the API module
vi.mock('../composables/useApi.js', () => ({
  api: {
    getCanvasItems: vi.fn(),
    getAllCanvasItems: vi.fn(),
    getCanvasFileContent: vi.fn(),
    uploadCanvasItem: vi.fn(),
    deleteCanvasItem: vi.fn(),
    getCanvasTrash: vi.fn(),
    recoverCanvasItem: vi.fn(),
    recoverCanvasFile: vi.fn(),
    permanentlyDeleteCanvasItem: vi.fn(),
    bulkDeleteCanvasItems: vi.fn(),
    bulkRecoverCanvasItems: vi.fn(),
    bulkPermanentlyDeleteCanvasItems: vi.fn(),
    updateCanvasItem: vi.fn(),
    createCanvasItem: vi.fn(),
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

    it('uses id as fallback when filename is missing', () => {
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

    it('moves all versions to trash when deleting multi-version file', async () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'report.md', createdAt: 1000 },
        { id: '2', filename: 'report.md', createdAt: 2000 },
        { id: '3', filename: 'report.md', createdAt: 3000 },
      ];

      const deletedItems = [
        { id: '1', filename: 'report.md', deletedAt: 4000 },
        { id: '2', filename: 'report.md', deletedAt: 4001 },
        { id: '3', filename: 'report.md', deletedAt: 4002 },
      ];

      api.deleteCanvasItem
        .mockResolvedValueOnce(deletedItems[0])
        .mockResolvedValueOnce(deletedItems[1])
        .mockResolvedValueOnce(deletedItems[2]);

      await store.deleteGroup('session-1', 'report.md');

      expect(store.items).toHaveLength(0);
      expect(store.trashedItems).toHaveLength(3);
      // Check that all versions are in trash (order doesn't matter)
      expect(store.trashedItems.map(item => item.id).sort()).toEqual(['1', '2', '3']);
      expect(store.trashedItems.every(item => item.filename === 'report.md')).toBe(true);
    });

    it('moves single item to trash when deleting one-version file', async () => {
      const store = useCanvasStore();
      const singleItem = { id: '1', filename: 'single.txt', createdAt: 1000 };
      store.items = [singleItem];

      const deletedItem = { id: '1', filename: 'single.txt', deletedAt: 2000 };
      api.deleteCanvasItem.mockResolvedValue(deletedItem);

      await store.deleteGroup('session-1', 'single.txt');

      expect(store.items).toHaveLength(0);
      expect(store.trashedItems).toHaveLength(1);
      expect(store.trashedItems[0]).toEqual(deletedItem);
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
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'recovered.txt' },
        { id: '2', filename: 'recovered.txt' },
      ]);
      api.getCanvasTrash.mockResolvedValue([]);

      await store.recoverFile('session-1', 'recovered.txt');

      expect(api.recoverCanvasFile).toHaveBeenCalledWith('session-1', 'recovered.txt');
      expect(api.getAllCanvasItems).toHaveBeenCalledWith('session-1');
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

  describe('fetchItemContent action', () => {
    it('fetches content from API and patches store items', async () => {
      const store = useCanvasStore();
      // Items without content/data (as returned by list endpoints after stripping)
      store.items = [
        { id: '1', filename: 'test.txt', type: 'text' },
        { id: '2', filename: 'other.txt', type: 'text' },
      ];

      api.getCanvasFileContent.mockResolvedValue({
        content: 'Hello World',
        data: null,
        type: 'text',
        mimeType: 'text/plain',
        filename: 'test.txt',
      });

      const result = await store.fetchItemContent('session-1', 'test.txt');

      expect(api.getCanvasFileContent).toHaveBeenCalledWith('session-1', 'test.txt');
      expect(result.content).toBe('Hello World');
      expect(result.data).toBeNull();
      // Store item should be patched
      expect(store.items[0].content).toBe('Hello World');
      expect(store.items[0].data).toBeNull();
      // Other item should be untouched
      expect(store.items[1].content).toBeUndefined();
    });

    it('returns cached content when already fetched (content is a string)', async () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'test.txt', type: 'text', content: 'Cached content' },
      ];

      const result = await store.fetchItemContent('session-1', 'test.txt');

      // Should NOT call API
      expect(api.getCanvasFileContent).not.toHaveBeenCalled();
      expect(result.content).toBe('Cached content');
    });

    it('returns cached content when already fetched (content is null)', async () => {
      const store = useCanvasStore();
      // null content is valid for image items - should be treated as "already fetched"
      store.items = [
        { id: '1', filename: 'pic.png', type: 'image', content: null, data: 'base64data' },
      ];

      const result = await store.fetchItemContent('session-1', 'pic.png');

      // Should NOT call API - content is null (fetched) not undefined (stripped)
      expect(api.getCanvasFileContent).not.toHaveBeenCalled();
      expect(result.content).toBeNull();
      expect(result.data).toBe('base64data');
    });

    it('fetches content when content is undefined (stripped by list endpoint)', async () => {
      const store = useCanvasStore();
      // content and data are both undefined (stripped from list response)
      store.items = [
        { id: '1', filename: 'test.txt', type: 'text' },
      ];

      api.getCanvasFileContent.mockResolvedValue({
        content: 'Fetched',
        data: null,
        type: 'text',
        mimeType: 'text/plain',
        filename: 'test.txt',
      });

      await store.fetchItemContent('session-1', 'test.txt');

      expect(api.getCanvasFileContent).toHaveBeenCalledWith('session-1', 'test.txt');
      expect(store.items[0].content).toBe('Fetched');
    });

    it('patches all versions of the same filename in the store', async () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'doc.md', type: 'markdown' },
        { id: '2', filename: 'doc.md', type: 'markdown' },
        { id: '3', filename: 'other.txt', type: 'text' },
      ];

      api.getCanvasFileContent.mockResolvedValue({
        content: '# Fetched content',
        data: null,
        type: 'markdown',
        mimeType: 'text/markdown',
        filename: 'doc.md',
      });

      await store.fetchItemContent('session-1', 'doc.md');

      // Both doc.md items should be patched
      expect(store.items[0].content).toBe('# Fetched content');
      expect(store.items[1].content).toBe('# Fetched content');
      // other.txt should be untouched
      expect(store.items[2].content).toBeUndefined();
    });

    it('treats empty string content as already fetched (cache hit)', async () => {
      const store = useCanvasStore();
      // Empty string is a valid value for text files - should be cached
      store.items = [
        { id: '1', filename: 'empty.txt', type: 'text', content: '' },
      ];

      const result = await store.fetchItemContent('session-1', 'empty.txt');

      // Should NOT call API - content is '' (fetched) not undefined (stripped)
      expect(api.getCanvasFileContent).not.toHaveBeenCalled();
      expect(result.content).toBe('');
    });

    it('handles API errors gracefully', async () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'error.txt', type: 'text' },
      ];

      api.getCanvasFileContent.mockRejectedValue(new Error('Network error'));

      await expect(store.fetchItemContent('session-1', 'error.txt')).rejects.toThrow('Network error');
      expect(api.getCanvasFileContent).toHaveBeenCalledWith('session-1', 'error.txt');
    });

    it('handles 404 errors from the content endpoint', async () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'missing.txt', type: 'text' },
      ];

      const error = new Error('Request failed with status code 404');
      error.response = { status: 404, data: { error: 'File not found' } };
      api.getCanvasFileContent.mockRejectedValue(error);

      await expect(store.fetchItemContent('session-1', 'missing.txt')).rejects.toThrow();
    });
  });

  describe('bulkDeleteItems action', () => {
    it('uses server-returned deletedIds to remove all versions from items', async () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'a.png', createdAt: 1000 },
        { id: '2', filename: 'a.png', createdAt: 2000 },
        { id: '3', filename: 'a.png', createdAt: 3000 },
        { id: '4', filename: 'b.png', createdAt: 4000 },
        { id: '5', filename: 'b.png', createdAt: 5000 },
      ];

      api.bulkDeleteCanvasItems.mockResolvedValue({
        deletedCount: 3,
        deletedIds: ['1', '2', '3'],
      });

      await store.bulkDeleteItems('session-1', ['3']);

      expect(store.items).toHaveLength(2);
      expect(store.items[0].id).toBe('4');
      expect(store.items[1].id).toBe('5');
    });

    it('moves all deleted items to trashedItems', async () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'a.png', createdAt: 1000 },
        { id: '2', filename: 'a.png', createdAt: 2000 },
        { id: '3', filename: 'a.png', createdAt: 3000 },
        { id: '4', filename: 'b.png', createdAt: 4000 },
      ];

      api.bulkDeleteCanvasItems.mockResolvedValue({
        deletedCount: 3,
        deletedIds: ['1', '2', '3'],
      });

      await store.bulkDeleteItems('session-1', ['3']);

      expect(store.trashedItems).toHaveLength(3);
      expect(store.trashedItems.every(i => i.deletedAt !== undefined && i.deletedAt !== null)).toBe(true);
      expect(store.trashedItems.map(i => i.id).sort()).toEqual(['1', '2', '3']);
    });

    it('clears selectedItemIds after operation', async () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'a.png', createdAt: 1000 },
      ];
      store.selectedItemIds.add('1');

      api.bulkDeleteCanvasItems.mockResolvedValue({
        deletedCount: 1,
        deletedIds: ['1'],
      });

      await store.bulkDeleteItems('session-1', ['1']);

      expect(store.selectedItemIds.size).toBe(0);
    });
  });

  describe('bulkRecoverItems action', () => {
    it('uses server-returned recoveredIds to move all versions from trash to items', async () => {
      const store = useCanvasStore();
      store.trashedItems = [
        { id: '1', filename: 'a.png', deletedAt: 1000 },
        { id: '2', filename: 'a.png', deletedAt: 1001 },
        { id: '3', filename: 'a.png', deletedAt: 1002 },
      ];

      api.bulkRecoverCanvasItems.mockResolvedValue({
        recoveredCount: 3,
        recoveredIds: ['1', '2', '3'],
      });

      await store.bulkRecoverItems('session-1', ['1']);

      expect(store.trashedItems).toHaveLength(0);
      expect(store.items).toHaveLength(3);
    });
  });

  describe('bulkPermanentlyDeleteItems action', () => {
    it('uses server-returned deletedIds to remove all versions from trashedItems', async () => {
      const store = useCanvasStore();
      store.trashedItems = [
        { id: '1', filename: 'a.png', deletedAt: 1000 },
        { id: '2', filename: 'a.png', deletedAt: 1001 },
        { id: '3', filename: 'a.png', deletedAt: 1002 },
      ];

      api.bulkPermanentlyDeleteCanvasItems.mockResolvedValue({
        deletedCount: 3,
        deletedIds: ['1', '2', '3'],
      });

      await store.bulkPermanentlyDeleteItems('session-1', ['1']);

      expect(store.trashedItems).toHaveLength(0);
    });
  });

  describe('selectAllItems action', () => {
    it('selects one ID per unique filename', () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'a.png', createdAt: 1000 },
        { id: '2', filename: 'a.png', createdAt: 2000 },
        { id: '3', filename: 'a.png', createdAt: 3000 },
        { id: '4', filename: 'b.png', createdAt: 4000 },
        { id: '5', filename: 'b.png', createdAt: 5000 },
      ];

      store.selectAllItems();

      expect(store.selectedItemIds.size).toBe(2);
    });
  });

  describe('isAllItemsSelected getter', () => {
    it('compares against unique file count', () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'a.png', createdAt: 1000 },
        { id: '2', filename: 'a.png', createdAt: 2000 },
        { id: '3', filename: 'b.png', createdAt: 3000 },
        { id: '4', filename: 'b.png', createdAt: 4000 },
      ];

      // Select one per filename (2 unique filenames)
      store.selectedItemIds.add('1');
      store.selectedItemIds.add('3');

      expect(store.isAllItemsSelected).toBe(true);
    });
  });

  describe('isPartialSelection getter', () => {
    it('is true when some but not all groups selected', () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'a.png', createdAt: 1000 },
        { id: '2', filename: 'b.png', createdAt: 2000 },
        { id: '3', filename: 'c.png', createdAt: 3000 },
      ];

      store.selectedItemIds.add('1');

      expect(store.isPartialSelection).toBe(true);
    });
  });

  describe('startEditing action', () => {
    it('sets the entry in editingSessionMap', () => {
      const store = useCanvasStore();
      store.startEditing('test.md', 'item-1');
      expect(store.editingSessionMap['test.md']).toBe('item-1');
    });
  });

  describe('endEditing action', () => {
    it('clears the entry from editingSessionMap', () => {
      const store = useCanvasStore();
      store.editingSessionMap['test.md'] = 'item-1';
      store.endEditing('test.md');
      expect(store.editingSessionMap['test.md']).toBeUndefined();
    });

    it('sets _hasEndedEditing flag for the filename', () => {
      const store = useCanvasStore();
      store.editingSessionMap['test.md'] = 'item-1';
      store.endEditing('test.md');
      expect(store._hasEndedEditing['test.md']).toBe(true);
    });
  });

  describe('patchItem action', () => {
    it('updates content and updatedAt for a matching item in items', () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'test.md', content: 'old', updatedAt: 1000 },
      ];

      store.patchItem({ id: '1', content: 'new', updatedAt: 2000 });

      expect(store.items[0].content).toBe('new');
      expect(store.items[0].updatedAt).toBe(2000);
    });

    it('does nothing when no matching item is found', () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'test.md', content: 'old', updatedAt: 1000 },
      ];

      store.patchItem({ id: 'nonexistent', content: 'new', updatedAt: 2000 });

      expect(store.items[0].content).toBe('old');
      expect(store.items[0].updatedAt).toBe(1000);
    });
  });

  describe('updateItemContent action', () => {
    it('calls api.updateCanvasItem and patches the local item', async () => {
      const store = useCanvasStore();
      store.items = [
        { id: 'item-1', filename: 'test.md', content: 'old', updatedAt: 1000 },
      ];

      api.updateCanvasItem.mockResolvedValue({ id: 'item-1', content: 'new', updatedAt: 2000 });

      await store.updateItemContent('session-1', 'item-1', 'new');

      expect(api.updateCanvasItem).toHaveBeenCalledWith('session-1', 'item-1', { content: 'new' });
      expect(store.items[0].content).toBe('new');
      expect(store.items[0].updatedAt).toBe(2000);
    });
  });

  describe('saveMarkdownContent action', () => {
    it('calls api.updateCanvasItem (PUT) when editingSessionMap has an entry', async () => {
      const store = useCanvasStore();
      store.editingSessionMap['test.md'] = 'item-1';
      store.items = [
        { id: 'item-1', filename: 'test.md', content: 'old', updatedAt: 1000 },
      ];

      api.updateCanvasItem.mockResolvedValue({ id: 'item-1', content: 'updated', updatedAt: 2000 });

      await store.saveMarkdownContent('session-1', 'test.md', 'updated', 'item-1');

      expect(api.updateCanvasItem).toHaveBeenCalledWith('session-1', 'item-1', { content: 'updated' });
    });

    it('does in-place update (PUT) on first-ever edit with currentItemId', async () => {
      const store = useCanvasStore();
      // No editingSessionMap entry and no _hasEndedEditing flag — first-ever edit
      store.items = [
        { id: 'item-1', filename: 'test.md', content: 'original', updatedAt: 1000 },
      ];

      api.updateCanvasItem.mockResolvedValue({ id: 'item-1', content: 'first edit', updatedAt: 2000 });

      await store.saveMarkdownContent('session-1', 'test.md', 'first edit', 'item-1');

      expect(api.updateCanvasItem).toHaveBeenCalledWith('session-1', 'item-1', { content: 'first edit' });
      expect(api.createCanvasItem).not.toHaveBeenCalled();
      // Should register the editing session after first save
      expect(store.editingSessionMap['test.md']).toBe('item-1');
    });

    it('creates new version (POST) when returning to edit after navigating away', async () => {
      const store = useCanvasStore();
      // Simulate: user edited, navigated away (endEditing was called), now returned
      store.editingSessionMap['test.md'] = 'item-1';
      store.endEditing('test.md'); // clears map, sets _hasEndedEditing

      api.createCanvasItem.mockResolvedValue({ id: 'new-item', content: 'v2 content', updatedAt: 3000, filename: 'test.md', type: 'markdown' });

      await store.saveMarkdownContent('session-1', 'test.md', 'v2 content', 'item-1');

      expect(api.createCanvasItem).toHaveBeenCalledWith('session-1', { type: 'markdown', content: 'v2 content', filename: 'test.md' });
      expect(api.updateCanvasItem).not.toHaveBeenCalled();
      // Should register the new version's ID
      expect(store.editingSessionMap['test.md']).toBe('new-item');
    });

    it('creates new version (POST) when no currentItemId and no editingSessionMap entry', async () => {
      const store = useCanvasStore();
      // No editingSessionMap entry, no currentItemId

      api.createCanvasItem.mockResolvedValue({ id: 'new-item', content: '# New', updatedAt: 2000, filename: 'new.md', type: 'markdown' });

      await store.saveMarkdownContent('session-1', 'new.md', '# New');

      expect(api.createCanvasItem).toHaveBeenCalledWith('session-1', { type: 'markdown', content: '# New', filename: 'new.md' });
      expect(store.editingSessionMap['new.md']).toBe('new-item');
    });

    it('clears _hasEndedEditing flag after creating a new version', async () => {
      const store = useCanvasStore();
      store.editingSessionMap['test.md'] = 'item-1';
      store.endEditing('test.md'); // sets _hasEndedEditing

      api.createCanvasItem.mockResolvedValue({ id: 'new-item', content: 'v2', updatedAt: 3000, filename: 'test.md', type: 'markdown' });

      await store.saveMarkdownContent('session-1', 'test.md', 'v2', 'item-1');

      // _hasEndedEditing should be cleared
      expect(store._hasEndedEditing?.['test.md']).toBeFalsy();
    });

    it('subsequent saves after new version use in-place update (PUT)', async () => {
      const store = useCanvasStore();
      // Simulate returning after navigate away — create new version
      store.editingSessionMap['test.md'] = 'item-1';
      store.endEditing('test.md');

      api.createCanvasItem.mockResolvedValue({ id: 'v2-item', content: 'v2', updatedAt: 3000, filename: 'test.md', type: 'markdown' });

      await store.saveMarkdownContent('session-1', 'test.md', 'v2', 'item-1');
      expect(api.createCanvasItem).toHaveBeenCalled();

      // Now subsequent saves should do in-place update
      vi.clearAllMocks();
      store.items = [{ id: 'v2-item', filename: 'test.md', content: 'v2', updatedAt: 3000 }];
      api.updateCanvasItem.mockResolvedValue({ id: 'v2-item', content: 'v2 updated', updatedAt: 4000 });

      await store.saveMarkdownContent('session-1', 'test.md', 'v2 updated', 'v2-item');

      expect(api.updateCanvasItem).toHaveBeenCalledWith('session-1', 'v2-item', { content: 'v2 updated' });
      expect(api.createCanvasItem).not.toHaveBeenCalled();
    });

    it('updates editingSessionMap after a successful save via PUT', async () => {
      const store = useCanvasStore();
      store.editingSessionMap['test.md'] = 'item-1';
      store.items = [
        { id: 'item-1', filename: 'test.md', content: 'old', updatedAt: 1000 },
      ];

      api.updateCanvasItem.mockResolvedValue({ id: 'item-1', content: 'updated', updatedAt: 2000 });

      await store.saveMarkdownContent('session-1', 'test.md', 'updated', 'item-1');

      // editingSessionMap should still have the entry
      expect(store.editingSessionMap['test.md']).toBe('item-1');
    });

    it('sets error on API failure but does not throw', async () => {
      const store = useCanvasStore();
      store.editingSessionMap['test.md'] = 'item-1';
      store.items = [
        { id: 'item-1', filename: 'test.md', content: 'old', updatedAt: 1000 },
      ];

      api.updateCanvasItem.mockRejectedValue(new Error('Network error'));

      // Should NOT throw
      await store.saveMarkdownContent('session-1', 'test.md', 'updated', 'item-1');

      expect(store.error).toContain('Failed to save markdown');
    });

    it('updates correct item when editingSessionMap points to different version', async () => {
      const store = useCanvasStore();
      // editingSessionMap points to v2 (simulating previous edit)
      store.editingSessionMap['test.md'] = 'v2-item';
      store.items = [
        { id: 'v1-item', filename: 'test.md', content: 'v1 old', updatedAt: 1000 },
        { id: 'v2-item', filename: 'test.md', content: 'v2 old', updatedAt: 2000 },
      ];

      api.updateCanvasItem.mockResolvedValue({ id: 'v1-item', content: 'v1 updated', updatedAt: 3000 });

      // User switched to v1 and edited — currentItemId is v1-item
      await store.saveMarkdownContent('session-1', 'test.md', 'v1 updated', 'v1-item');

      // Should update v1-item, NOT v2-item
      expect(api.updateCanvasItem).toHaveBeenCalledWith('session-1', 'v1-item', { content: 'v1 updated' });
      expect(api.createCanvasItem).not.toHaveBeenCalled();

      // editingSessionMap should now point to v1-item
      expect(store.editingSessionMap['test.md']).toBe('v1-item');
    });

    it('clears _hasEndedEditing flag when switching versions', async () => {
      const store = useCanvasStore();
      store.editingSessionMap['test.md'] = 'v2-item';
      store._hasEndedEditing = { 'test.md': true }; // Simulate ended editing
      store.items = [
        { id: 'v1-item', filename: 'test.md', content: 'v1', updatedAt: 1000 },
      ];

      api.updateCanvasItem.mockResolvedValue({ id: 'v1-item', content: 'v1 updated', updatedAt: 2000 });

      await store.saveMarkdownContent('session-1', 'test.md', 'v1 updated', 'v1-item');

      // Should clear _hasEndedEditing flag (version switch, not new version creation)
      expect(store._hasEndedEditing['test.md']).toBeFalsy();
    });

    it('does NOT create new version when switching between existing versions', async () => {
      const store = useCanvasStore();
      store.editingSessionMap['test.md'] = 'v2-item';
      store.items = [
        { id: 'v1-item', filename: 'test.md', content: 'v1', updatedAt: 1000 },
      ];

      api.updateCanvasItem.mockResolvedValue({ id: 'v1-item', content: 'v1 updated', updatedAt: 2000 });

      await store.saveMarkdownContent('session-1', 'test.md', 'v1 updated', 'v1-item');

      // Should NOT create a new version — this is just switching edit targets
      expect(api.createCanvasItem).not.toHaveBeenCalled();
    });
  });
});
