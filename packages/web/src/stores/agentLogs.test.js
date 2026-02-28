import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAgentLogsStore } from './agentLogs.js';

// Mock the API
vi.mock('../composables/useApi.js', () => ({
  api: {
    getAgentCallLogs: vi.fn(),
    getAgentCallFilterOptions: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

const makePaginatedResponse = (logs = [], total = 0, limit = 25, offset = 0) => ({
  logs,
  pagination: { total, limit, offset, hasMore: offset + limit < total },
});

describe('useAgentLogsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('has correct initial state', () => {
      const store = useAgentLogsStore();

      expect(store.logs).toEqual([]);
      expect(store.pagination).toEqual({ total: 0, limit: 25, offset: 0, hasMore: false });
      expect(store.filters).toEqual({
        agentType: null,
        callType: null,
        status: null,
        model: null,
        startDate: null,
        endDate: null,
        sessionId: null,
      });
      expect(store.filterOptions).toEqual({ agentTypes: [], callTypes: [], statuses: [], models: [] });
      expect(store.perPage).toBe(25);
      expect(store.currentPage).toBe(1);
      expect(store.sortBy).toBe('started_at');
      expect(store.sortOrder).toBe('DESC');
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('getters', () => {
    describe('totalPages', () => {
      it('computes totalPages correctly', () => {
        const store = useAgentLogsStore();
        store.pagination.total = 100;
        store.perPage = 25;

        expect(store.totalPages).toBe(4);
      });

      it('returns 0 when total is 0', () => {
        const store = useAgentLogsStore();
        expect(store.totalPages).toBe(0);
      });
    });

    describe('activeFilters', () => {
      it('returns only non-null filters', () => {
        const store = useAgentLogsStore();
        store.filters.agentType = 'claude-code';
        store.filters.callType = 'runSession';

        const active = store.activeFilters;
        expect(Object.keys(active)).toHaveLength(2);
        expect(active.agentType).toBe('claude-code');
        expect(active.callType).toBe('runSession');
      });

      it('returns empty object when no filters set', () => {
        const store = useAgentLogsStore();
        expect(store.activeFilters).toEqual({});
      });
    });
  });

  describe('fetchLogs', () => {
    it('calls API with correct params including offset and active filters', async () => {
      const store = useAgentLogsStore();
      store.currentPage = 2;
      store.perPage = 10;
      store.filters.agentType = 'claude-code';
      store.sortBy = 'total_tokens';
      store.sortOrder = 'ASC';

      api.getAgentCallLogs.mockResolvedValue(makePaginatedResponse([], 0, 10, 10));

      await store.fetchLogs();

      expect(api.getAgentCallLogs).toHaveBeenCalledWith({
        limit: 10,
        offset: 10, // (page 2 - 1) * 10
        agentType: 'claude-code',
        sortBy: 'total_tokens',
        sortOrder: 'ASC',
      });
    });

    it('updates logs and pagination state on success', async () => {
      const store = useAgentLogsStore();
      const mockLogs = [{ id: '1', agentType: 'claude-code' }];
      api.getAgentCallLogs.mockResolvedValue(makePaginatedResponse(mockLogs, 1, 25, 0));

      await store.fetchLogs();

      expect(store.logs).toEqual(mockLogs);
      expect(store.pagination.total).toBe(1);
    });

    it('sets loading=true during fetch and false after', async () => {
      const store = useAgentLogsStore();
      let loadingDuringFetch = false;

      api.getAgentCallLogs.mockImplementation(() => {
        loadingDuringFetch = store.loading;
        return Promise.resolve(makePaginatedResponse());
      });

      await store.fetchLogs();

      expect(loadingDuringFetch).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('handles errors gracefully (sets error, clears loading)', async () => {
      const store = useAgentLogsStore();
      api.getAgentCallLogs.mockRejectedValue(new Error('Network error'));

      await store.fetchLogs();

      expect(store.error).toBe('Network error');
      expect(store.loading).toBe(false);
    });

    it('clears error on subsequent success', async () => {
      const store = useAgentLogsStore();
      api.getAgentCallLogs.mockRejectedValueOnce(new Error('fail'));
      await store.fetchLogs();
      expect(store.error).toBe('fail');

      api.getAgentCallLogs.mockResolvedValue(makePaginatedResponse());
      await store.fetchLogs();
      expect(store.error).toBeNull();
    });
  });

  describe('fetchFilterOptions', () => {
    it('populates filterOptions on success', async () => {
      const store = useAgentLogsStore();
      api.getAgentCallFilterOptions.mockResolvedValue({
        agentTypes: ['claude-code'],
        callTypes: ['runSession'],
        statuses: ['completed'],
        models: ['claude-sonnet'],
      });

      await store.fetchFilterOptions();

      expect(store.filterOptions.agentTypes).toContain('claude-code');
      expect(store.filterOptions.callTypes).toContain('runSession');
    });

    it('handles errors silently (filterOptions unchanged)', async () => {
      const store = useAgentLogsStore();
      api.getAgentCallFilterOptions.mockRejectedValue(new Error('Server error'));

      await store.fetchFilterOptions();

      // filterOptions should remain empty defaults
      expect(store.filterOptions).toEqual({ agentTypes: [], callTypes: [], statuses: [], models: [] });
    });
  });

  describe('setFilter', () => {
    it('updates the specified filter', async () => {
      const store = useAgentLogsStore();
      api.getAgentCallLogs.mockResolvedValue(makePaginatedResponse());

      await store.setFilter('agentType', 'claude-code');

      expect(store.filters.agentType).toBe('claude-code');
    });

    it('resets currentPage to 1', async () => {
      const store = useAgentLogsStore();
      store.currentPage = 3;
      api.getAgentCallLogs.mockResolvedValue(makePaginatedResponse());

      await store.setFilter('agentType', 'claude-code');

      expect(store.currentPage).toBe(1);
    });

    it('triggers fetchLogs', async () => {
      const store = useAgentLogsStore();
      api.getAgentCallLogs.mockResolvedValue(makePaginatedResponse());

      await store.setFilter('agentType', 'claude-code');

      expect(api.getAgentCallLogs).toHaveBeenCalledTimes(1);
    });

    it('sets filter to null when falsy value provided', async () => {
      const store = useAgentLogsStore();
      store.filters.agentType = 'claude-code';
      api.getAgentCallLogs.mockResolvedValue(makePaginatedResponse());

      await store.setFilter('agentType', '');

      expect(store.filters.agentType).toBeNull();
    });
  });

  describe('clearFilters', () => {
    it('resets all filters to null', async () => {
      const store = useAgentLogsStore();
      store.filters.agentType = 'claude-code';
      store.filters.status = 'completed';
      api.getAgentCallLogs.mockResolvedValue(makePaginatedResponse());

      await store.clearFilters();

      Object.values(store.filters).forEach((v) => expect(v).toBeNull());
    });

    it('resets currentPage to 1 and triggers fetch', async () => {
      const store = useAgentLogsStore();
      store.currentPage = 5;
      api.getAgentCallLogs.mockResolvedValue(makePaginatedResponse());

      await store.clearFilters();

      expect(store.currentPage).toBe(1);
      expect(api.getAgentCallLogs).toHaveBeenCalled();
    });
  });

  describe('setPage', () => {
    it('updates currentPage and triggers fetch', async () => {
      const store = useAgentLogsStore();
      api.getAgentCallLogs.mockResolvedValue(makePaginatedResponse());

      await store.setPage(3);

      expect(store.currentPage).toBe(3);
      expect(api.getAgentCallLogs).toHaveBeenCalled();
    });
  });

  describe('setPerPage', () => {
    it('updates perPage, resets to page 1, and triggers fetch', async () => {
      const store = useAgentLogsStore();
      store.currentPage = 3;
      api.getAgentCallLogs.mockResolvedValue(makePaginatedResponse());

      await store.setPerPage(50);

      expect(store.perPage).toBe(50);
      expect(store.currentPage).toBe(1);
      expect(api.getAgentCallLogs).toHaveBeenCalled();
    });
  });

  describe('setSort', () => {
    it('updates sortBy and sortOrder, resets to page 1', async () => {
      const store = useAgentLogsStore();
      store.currentPage = 2;
      api.getAgentCallLogs.mockResolvedValue(makePaginatedResponse());

      await store.setSort('total_tokens', 'ASC');

      expect(store.sortBy).toBe('total_tokens');
      expect(store.sortOrder).toBe('ASC');
      expect(store.currentPage).toBe(1);
      expect(api.getAgentCallLogs).toHaveBeenCalled();
    });
  });
});
