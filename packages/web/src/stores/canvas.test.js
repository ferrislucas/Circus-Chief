import { describe, it, expect, vi } from 'vitest';
import { useCanvasStore } from './canvas.js';

// Mock the API module
vi.mock('../composables/useApi.js', () => ({
  api: {
    getCanvasItems: vi.fn(),
    uploadCanvasItem: vi.fn(),
    deleteCanvasItem: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

describe('Canvas Store', () => {

  describe('state', () => {
    it('has correct initial state', () => {
      const store = useCanvasStore();
      expect(store.items).toEqual([]);
      expect(store.selectedItemId).toBeNull();
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

  describe('selectedItem getter', () => {
    it('returns the selected item', () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'test.png' },
        { id: '2', filename: 'other.png' },
      ];
      store.selectedItemId = '2';

      expect(store.selectedItem).toEqual({ id: '2', filename: 'other.png' });
    });

    it('returns undefined when no item is selected', () => {
      const store = useCanvasStore();
      store.items = [{ id: '1', filename: 'test.png' }];
      store.selectedItemId = null;

      expect(store.selectedItem).toBeUndefined();
    });

    it('returns undefined when selected item does not exist', () => {
      const store = useCanvasStore();
      store.items = [{ id: '1', filename: 'test.png' }];
      store.selectedItemId = 'nonexistent';

      expect(store.selectedItem).toBeUndefined();
    });
  });

  describe('selectedItemVersions getter', () => {
    it('returns all versions for the selected item filename', () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'test.png', createdAt: 1000 },
        { id: '2', filename: 'test.png', createdAt: 2000 },
        { id: '3', filename: 'other.png', createdAt: 3000 },
      ];
      store.selectedItemId = '1';

      const versions = store.selectedItemVersions;
      expect(versions.length).toBe(2);
      expect(versions[0].id).toBe('2'); // newest first
      expect(versions[1].id).toBe('1');
    });

    it('returns empty array when no item is selected', () => {
      const store = useCanvasStore();
      store.items = [{ id: '1', filename: 'test.png' }];
      store.selectedItemId = null;

      expect(store.selectedItemVersions).toEqual([]);
    });
  });

  describe('selectItem action', () => {
    it('sets selectedItemId', () => {
      const store = useCanvasStore();
      store.selectItem('item-123');
      expect(store.selectedItemId).toBe('item-123');
    });
  });

  describe('clearSelection action', () => {
    it('clears selectedItemId', () => {
      const store = useCanvasStore();
      store.selectedItemId = 'item-123';
      store.clearSelection();
      expect(store.selectedItemId).toBeNull();
    });
  });

  describe('deleteItem action', () => {
    it('removes item from items array', async () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'test.png' },
        { id: '2', filename: 'other.png' },
      ];

      api.deleteCanvasItem.mockResolvedValue();

      await store.deleteItem('session-1', '1');

      expect(store.items.length).toBe(1);
      expect(store.items[0].id).toBe('2');
    });

    it('clears selection if deleted item was selected', async () => {
      const store = useCanvasStore();
      store.items = [{ id: '1', filename: 'test.png' }];
      store.selectedItemId = '1';

      api.deleteCanvasItem.mockResolvedValue();

      await store.deleteItem('session-1', '1');

      expect(store.selectedItemId).toBeNull();
    });

    it('does not clear selection if different item was deleted', async () => {
      const store = useCanvasStore();
      store.items = [
        { id: '1', filename: 'test.png' },
        { id: '2', filename: 'other.png' },
      ];
      store.selectedItemId = '1';

      api.deleteCanvasItem.mockResolvedValue();

      await store.deleteItem('session-1', '2');

      expect(store.selectedItemId).toBe('1');
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
    it('removes item and clears selection if selected', () => {
      const store = useCanvasStore();
      store.items = [{ id: '1', filename: 'test.png' }];
      store.selectedItemId = '1';

      store.removeItem('1');

      expect(store.items.length).toBe(0);
      expect(store.selectedItemId).toBeNull();
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
});
