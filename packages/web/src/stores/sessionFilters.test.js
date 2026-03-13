import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionFiltersStore, createFilterPersistence } from './sessionFilters.js';

describe('SessionFilters Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('initial state', () => {
    it('has null filters by default', () => {
      const store = useSessionFiltersStore();
      expect(store.statusFilter).toBeNull();
      expect(store.starredFilter).toBeNull();
      expect(store.scheduledFilter).toBeNull();
    });
  });

  describe('statusFilter (localStorage)', () => {
    it('setStatusFilter sets the filter and persists to localStorage', () => {
      const store = useSessionFiltersStore();
      store.setStatusFilter('running');
      expect(store.statusFilter).toBe('running');
      expect(localStorage.getItem('sessionStatusFilter')).toBe('running');
    });

    it('setStatusFilter clears localStorage when null', () => {
      const store = useSessionFiltersStore();
      store.setStatusFilter('running');
      store.setStatusFilter(null);
      expect(store.statusFilter).toBeNull();
      expect(localStorage.getItem('sessionStatusFilter')).toBeNull();
    });

    it('saveStatusFilter persists current value', () => {
      const store = useSessionFiltersStore();
      store.statusFilter = 'idle';
      store.saveStatusFilter();
      expect(localStorage.getItem('sessionStatusFilter')).toBe('idle');
    });

    it('restoreStatusFilter restores valid value', () => {
      localStorage.setItem('sessionStatusFilter', 'running');
      const store = useSessionFiltersStore();
      store.restoreStatusFilter();
      expect(store.statusFilter).toBe('running');
    });

    it('restoreStatusFilter resets on invalid value', () => {
      localStorage.setItem('sessionStatusFilter', 'invalid');
      const store = useSessionFiltersStore();
      store.restoreStatusFilter();
      expect(store.statusFilter).toBeNull();
    });

    it('restoreStatusFilter handles missing localStorage gracefully', () => {
      const store = useSessionFiltersStore();
      store.restoreStatusFilter();
      expect(store.statusFilter).toBeNull();
    });
  });

  describe('starredFilter (sessionStorage)', () => {
    it('setStarredFilter sets the filter and persists to sessionStorage', () => {
      const store = useSessionFiltersStore();
      store.setStarredFilter('starred');
      expect(store.starredFilter).toBe('starred');
      expect(sessionStorage.getItem('sessionStarredFilter')).toBe('starred');
    });

    it('setStarredFilter clears sessionStorage when null', () => {
      const store = useSessionFiltersStore();
      store.setStarredFilter('starred');
      store.setStarredFilter(null);
      expect(store.starredFilter).toBeNull();
      expect(sessionStorage.getItem('sessionStarredFilter')).toBeNull();
    });

    it('restoreStarredFilter restores valid value', () => {
      sessionStorage.setItem('sessionStarredFilter', 'unstarred');
      const store = useSessionFiltersStore();
      store.restoreStarredFilter();
      expect(store.starredFilter).toBe('unstarred');
    });

    it('restoreStarredFilter resets on invalid value', () => {
      sessionStorage.setItem('sessionStarredFilter', 'invalid');
      const store = useSessionFiltersStore();
      store.restoreStarredFilter();
      expect(store.starredFilter).toBeNull();
    });
  });

  describe('scheduledFilter (sessionStorage)', () => {
    it('setScheduledFilter sets the filter and persists to sessionStorage', () => {
      const store = useSessionFiltersStore();
      store.setScheduledFilter('scheduled');
      expect(store.scheduledFilter).toBe('scheduled');
      expect(sessionStorage.getItem('sessionScheduledFilter')).toBe('scheduled');
    });

    it('setScheduledFilter clears sessionStorage when null', () => {
      const store = useSessionFiltersStore();
      store.setScheduledFilter('scheduled');
      store.setScheduledFilter(null);
      expect(store.scheduledFilter).toBeNull();
      expect(sessionStorage.getItem('sessionScheduledFilter')).toBeNull();
    });

    it('restoreScheduledFilter restores valid value', () => {
      sessionStorage.setItem('sessionScheduledFilter', 'not-scheduled');
      const store = useSessionFiltersStore();
      store.restoreScheduledFilter();
      expect(store.scheduledFilter).toBe('not-scheduled');
    });

    it('restoreScheduledFilter resets on invalid value', () => {
      sessionStorage.setItem('sessionScheduledFilter', 'bogus');
      const store = useSessionFiltersStore();
      store.restoreScheduledFilter();
      expect(store.scheduledFilter).toBeNull();
    });
  });

  describe('createFilterPersistence factory', () => {
    it('creates set, save, and restore functions', () => {
      const result = createFilterPersistence('testFilter', 'testKey', ['a', 'b'], 'localStorage');
      expect(typeof result.set).toBe('function');
      expect(typeof result.save).toBe('function');
      expect(typeof result.restore).toBe('function');
    });
  });
});
