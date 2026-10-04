import { defineStore } from 'pinia';
import { createFilterPersistence } from './sessionFilters.js';

// Reuses the same persistence factory as the session list's status filter, with
// a distinct localStorage key so the two filters never collide.
const persistence = createFilterPersistence(
  'statusFilter',
  'projectStatusFilter',
  ['running', 'waiting', 'idle'],
  'localStorage',
);

export const useProjectFiltersStore = defineStore('projectFilters', {
  state: () => ({
    statusFilter: null, // 'running' | 'waiting' | 'idle' | null
    pinnedOnly: false,
  }),

  actions: {
    ...persistence,
    // Named aliases matching the sessionFilters store's API, so call sites
    // (ProjectListView, ProjectFiltersPanel) read identically to the
    // session-list equivalents.
    setStatusFilter(filter) {
      this.set(filter);
    },
    saveStatusFilter() {
      this.save();
    },
    restoreStatusFilter() {
      this.restore();
    },
    setPinnedOnly(pinnedOnly) {
      this.pinnedOnly = Boolean(pinnedOnly);
      this.savePinnedOnly();
    },
    togglePinnedOnly() {
      this.setPinnedOnly(!this.pinnedOnly);
    },
    savePinnedOnly() {
      try {
        if (this.pinnedOnly) localStorage.setItem('projectPinnedOnly', 'true');
        else localStorage.removeItem('projectPinnedOnly');
      } catch {
        // Filtering remains available when browser storage is unavailable.
      }
    },
    restorePinnedOnly() {
      try {
        this.pinnedOnly = localStorage.getItem('projectPinnedOnly') === 'true';
      } catch {
        this.pinnedOnly = false;
      }
    },
  },
});
