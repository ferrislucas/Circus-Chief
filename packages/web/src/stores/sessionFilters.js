import { defineStore } from 'pinia';

/**
 * Creates a set of filter persistence methods (set, save, restore) for a named filter.
 *
 * @param {string} filterKey - The state key in the store (e.g., 'statusFilter')
 * @param {string} storageKey - The key used in localStorage/sessionStorage (e.g., 'sessionStatusFilter')
 * @param {Array<string>} validValues - Valid filter values (e.g., ['running', 'idle'])
 * @param {'localStorage'|'sessionStorage'} storageType - Which storage API to use
 * @returns {Object} An object with set, save, and restore action functions
 */
export function createFilterPersistence(filterKey, storageKey, validValues, storageType) {
  const storage = storageType === 'localStorage' ? localStorage : sessionStorage;

  return {
    set(filter) {
      this[filterKey] = filter;
      this._saveFilter(filterKey, storageKey, storage);
    },

    _saveFilter(fKey, sKey, store) {
      try {
        if (this[fKey]) {
          store.setItem(sKey, this[fKey]);
        } else {
          store.removeItem(sKey);
        }
      } catch (error) {
        console.warn(`Failed to save ${fKey}:`, error);
      }
    },

    save() {
      this._saveFilter(filterKey, storageKey, storage);
    },

    restore() {
      try {
        const filter = storage.getItem(storageKey);
        if (validValues.includes(filter)) {
          this[filterKey] = filter;
        } else {
          this[filterKey] = null;
        }
      } catch (error) {
        console.warn(`Failed to restore ${filterKey}:`, error);
      }
    },
  };
}

export const useSessionFiltersStore = defineStore('sessionFilters', {
  state: () => ({
    statusFilter: null,   // 'running' | 'idle' | null
    starredFilter: null,  // 'starred' | 'unstarred' | null
    scheduledFilter: null, // 'scheduled' | 'not-scheduled' | null
  }),

  actions: {
    // Status filter (localStorage)
    setStatusFilter(filter) {
      this.statusFilter = filter;
      this.saveStatusFilter();
    },

    saveStatusFilter() {
      try {
        if (this.statusFilter) {
          localStorage.setItem('sessionStatusFilter', this.statusFilter);
        } else {
          localStorage.removeItem('sessionStatusFilter');
        }
      } catch (error) {
        console.warn('Failed to save status filter:', error);
      }
    },

    restoreStatusFilter() {
      try {
        const filter = localStorage.getItem('sessionStatusFilter');
        if (filter === 'running' || filter === 'idle') {
          this.statusFilter = filter;
        }
      } catch (error) {
        console.warn('Failed to restore status filter:', error);
      }
    },

    // Starred filter (sessionStorage)
    setStarredFilter(filter) {
      this.starredFilter = filter;
      this.saveStarredFilter();
    },

    saveStarredFilter() {
      try {
        if (this.starredFilter) {
          sessionStorage.setItem('sessionStarredFilter', this.starredFilter);
        } else {
          sessionStorage.removeItem('sessionStarredFilter');
        }
      } catch (error) {
        console.warn('Failed to save starred filter:', error);
      }
    },

    restoreStarredFilter() {
      try {
        const filter = sessionStorage.getItem('sessionStarredFilter');
        if (filter === 'starred' || filter === 'unstarred') {
          this.starredFilter = filter;
        } else {
          this.starredFilter = null;
        }
      } catch (error) {
        console.warn('Failed to restore starred filter:', error);
      }
    },

    // Scheduled filter (sessionStorage)
    setScheduledFilter(filter) {
      this.scheduledFilter = filter;
      this.saveScheduledFilter();
    },

    saveScheduledFilter() {
      try {
        if (this.scheduledFilter) {
          sessionStorage.setItem('sessionScheduledFilter', this.scheduledFilter);
        } else {
          sessionStorage.removeItem('sessionScheduledFilter');
        }
      } catch (error) {
        console.warn('Failed to save scheduled filter:', error);
      }
    },

    restoreScheduledFilter() {
      try {
        const filter = sessionStorage.getItem('sessionScheduledFilter');
        if (filter === 'scheduled' || filter === 'not-scheduled') {
          this.scheduledFilter = filter;
        } else {
          this.scheduledFilter = null;
        }
      } catch (error) {
        console.warn('Failed to restore scheduled filter:', error);
      }
    },
  },
});
