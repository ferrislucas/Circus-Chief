import { defineStore } from 'pinia';
import { canvasActions } from './canvasActions.js';
import { canvasMarkdownActions } from './canvasMarkdownActions.js';

export const useCanvasStore = defineStore('canvas', {
  state: () => ({
    items: [],
    trashedItems: [],
    loading: false,
    error: null,
    selectedItemIds: new Set(),
    bulkOperationInProgress: false,
    editingSessionMap: {},  // { [filename]: latestItemId } — tracks "active editing session"
  }),

  getters: {
    selectedItemCount: (state) => state.selectedItemIds.size,

    isAllItemsSelected: (state) => {
      const uniqueFiles = new Set(state.items.map(i => i.filename || i.id));
      return uniqueFiles.size > 0 && state.selectedItemIds.size === uniqueFiles.size;
    },

    isPartialSelection: (state) => {
      const uniqueFiles = new Set(state.items.map(i => i.filename || i.id));
      return state.selectedItemIds.size > 0 && state.selectedItemIds.size < uniqueFiles.size;
    },

    selectedItems: (state) => state.items.filter(item => state.selectedItemIds.has(item.id)),

    // Group items by filename, return latest of each with version info
    groupedItems: (state) => {
      const groups = {};
      for (const item of state.items) {
        const key = item.filename || item.id;
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      }
      return Object.values(groups)
        .map((versions) => {
          versions.sort((a, b) => b.createdAt - a.createdAt);
          return {
            ...versions[0],
            versionCount: versions.length,
            allVersions: versions,
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    // Group trashed items by filename, return latest of each with version info
    groupedTrashedItems: (state) => {
      const groups = {};
      for (const item of state.trashedItems) {
        const key = item.filename || item.id;
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      }
      return Object.values(groups)
        .map((versions) => {
          versions.sort((a, b) => b.deletedAt - a.deletedAt);
          return {
            ...versions[0],
            versionCount: versions.length,
            allVersions: versions,
          };
        })
        .sort((a, b) => b.deletedAt - a.deletedAt);
    },
  },

  actions: {
    ...canvasActions,
    ...canvasMarkdownActions,
  },
});
