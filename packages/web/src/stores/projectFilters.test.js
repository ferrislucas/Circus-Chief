import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useProjectFiltersStore } from './projectFilters.js';

describe('ProjectFilters Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('has a null status filter by default', () => {
      const store = useProjectFiltersStore();
      expect(store.statusFilter).toBeNull();
    });
  });

  describe('statusFilter (localStorage)', () => {
    it('setStatusFilter sets the filter and persists to projectStatusFilter', () => {
      const store = useProjectFiltersStore();
      store.setStatusFilter('running');
      expect(store.statusFilter).toBe('running');
      expect(localStorage.getItem('projectStatusFilter')).toBe('running');
    });

    it('does not collide with the session list filter key', () => {
      const store = useProjectFiltersStore();
      // Simulate the session list storing its own filter.
      localStorage.setItem('sessionStatusFilter', 'idle');

      store.setStatusFilter('waiting');

      expect(localStorage.getItem('projectStatusFilter')).toBe('waiting');
      expect(localStorage.getItem('sessionStatusFilter')).toBe('idle');
    });

    it('setStatusFilter(null) clears the filter and removes the key', () => {
      const store = useProjectFiltersStore();
      store.setStatusFilter('running');
      store.setStatusFilter(null);

      expect(store.statusFilter).toBeNull();
      expect(localStorage.getItem('projectStatusFilter')).toBeNull();
    });

    it('restoreStatusFilter restores a running value', () => {
      localStorage.setItem('projectStatusFilter', 'running');
      const store = useProjectFiltersStore();
      store.restoreStatusFilter();
      expect(store.statusFilter).toBe('running');
    });

    it('restoreStatusFilter restores a waiting value', () => {
      localStorage.setItem('projectStatusFilter', 'waiting');
      const store = useProjectFiltersStore();
      store.restoreStatusFilter();
      expect(store.statusFilter).toBe('waiting');
    });

    it('restoreStatusFilter restores an idle value', () => {
      localStorage.setItem('projectStatusFilter', 'idle');
      const store = useProjectFiltersStore();
      store.restoreStatusFilter();
      expect(store.statusFilter).toBe('idle');
    });

    it('restoreStatusFilter resets on an unknown stored value', () => {
      localStorage.setItem('projectStatusFilter', 'bogus');
      const store = useProjectFiltersStore();
      store.restoreStatusFilter();
      expect(store.statusFilter).toBeNull();
    });

    it('restoreStatusFilter survives a throwing localStorage', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied');
      });
      const store = useProjectFiltersStore();
      expect(() => store.restoreStatusFilter()).not.toThrow();
      expect(store.statusFilter).toBeNull();
    });
  });
});