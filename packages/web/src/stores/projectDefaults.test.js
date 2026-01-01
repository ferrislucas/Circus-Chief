import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useProjectDefaultsStore } from './projectDefaults.js';

// Mock the API
vi.mock('../composables/useApi.js', () => ({
  api: {
    getProjectSessionDefaults: vi.fn(),
    updateProjectSessionDefaults: vi.fn(),
    resetProjectSessionDefaults: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

describe('useProjectDefaultsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('initializes with empty defaults', () => {
      const store = useProjectDefaultsStore();

      expect(store.defaultsByProjectId).toEqual({});
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('fetchDefaults', () => {
    it('fetches defaults from API', async () => {
      const projectId = 'test-project-1';
      const mockDefaults = {
        id: 'default-1',
        projectId,
        mode: 'plan',
        thinkingEnabled: true,
      };

      api.getProjectSessionDefaults.mockResolvedValue(mockDefaults);

      const store = useProjectDefaultsStore();
      const result = await store.fetchDefaults(projectId);

      expect(api.getProjectSessionDefaults).toHaveBeenCalledWith(projectId);
      expect(result).toEqual(mockDefaults);
      expect(store.defaultsByProjectId[projectId]).toEqual(mockDefaults);
    });

    it('handles API errors', async () => {
      const projectId = 'test-project-1';
      const error = new Error('API Error');

      api.getProjectSessionDefaults.mockRejectedValue(error);

      const store = useProjectDefaultsStore();

      await expect(store.fetchDefaults(projectId)).rejects.toThrow('API Error');
      expect(store.error).toBe('API Error');
    });

    it('sets loading state correctly', async () => {
      const projectId = 'test-project-1';
      const mockDefaults = { mode: 'plan' };

      api.getProjectSessionDefaults.mockResolvedValue(mockDefaults);

      const store = useProjectDefaultsStore();

      // Check initial state
      expect(store.loading).toBe(false);

      const promise = store.fetchDefaults(projectId);
      // Note: In real tests, you might need to use vi.advanceTimersByTimeAsync or similar

      const result = await promise;
      expect(store.loading).toBe(false);
      expect(result).toBeDefined();
    });

    it('handles null response (no defaults)', async () => {
      const projectId = 'test-project-1';

      api.getProjectSessionDefaults.mockResolvedValue(null);

      const store = useProjectDefaultsStore();
      const result = await store.fetchDefaults(projectId);

      expect(result).toBeNull();
      expect(store.defaultsByProjectId[projectId]).toBeNull();
    });
  });

  describe('updateDefaults', () => {
    it('updates defaults via API', async () => {
      const projectId = 'test-project-1';
      const newDefaults = { mode: 'plan', thinkingEnabled: true };
      const updatedDefaults = { id: 'default-1', projectId, ...newDefaults };

      api.updateProjectSessionDefaults.mockResolvedValue(updatedDefaults);

      const store = useProjectDefaultsStore();
      const result = await store.updateDefaults(projectId, newDefaults);

      expect(api.updateProjectSessionDefaults).toHaveBeenCalledWith(projectId, newDefaults);
      expect(result).toEqual(updatedDefaults);
      expect(store.defaultsByProjectId[projectId]).toEqual(updatedDefaults);
    });

    it('handles validation errors from API', async () => {
      const projectId = 'test-project-1';
      const invalidDefaults = { mode: 'invalid' };
      const error = new Error('Validation error');

      api.updateProjectSessionDefaults.mockRejectedValue(error);

      const store = useProjectDefaultsStore();

      await expect(store.updateDefaults(projectId, invalidDefaults)).rejects.toThrow(
        'Validation error'
      );
      expect(store.error).toBe('Validation error');
    });

    it('allows partial updates', async () => {
      const projectId = 'test-project-1';
      const partialDefaults = { mode: 'standard' };
      const updatedDefaults = {
        id: 'default-1',
        projectId,
        mode: 'standard',
        thinkingEnabled: true,
      };

      api.updateProjectSessionDefaults.mockResolvedValue(updatedDefaults);

      const store = useProjectDefaultsStore();
      const result = await store.updateDefaults(projectId, partialDefaults);

      expect(result.mode).toBe('standard');
      expect(result.thinkingEnabled).toBe(true);
    });

    it('overwrites previous defaults in state', async () => {
      const projectId = 'test-project-1';
      const oldDefaults = { id: 'default-1', projectId, mode: 'plan' };
      const newDefaults = { id: 'default-1', projectId, mode: 'standard' };

      api.updateProjectSessionDefaults.mockResolvedValue(newDefaults);

      const store = useProjectDefaultsStore();

      // Set initial defaults
      store.defaultsByProjectId[projectId] = oldDefaults;

      await store.updateDefaults(projectId, { mode: 'standard' });

      expect(store.defaultsByProjectId[projectId]).toEqual(newDefaults);
    });
  });

  describe('resetDefaults', () => {
    it('calls API to reset defaults', async () => {
      const projectId = 'test-project-1';

      api.resetProjectSessionDefaults.mockResolvedValue({
        message: 'Reset successful',
      });

      const store = useProjectDefaultsStore();
      const result = await store.resetDefaults(projectId);

      expect(api.resetProjectSessionDefaults).toHaveBeenCalledWith(projectId);
      expect(result).toBeDefined();
    });

    it('clears defaults in state after reset', async () => {
      const projectId = 'test-project-1';

      api.resetProjectSessionDefaults.mockResolvedValue({ message: 'Reset' });

      const store = useProjectDefaultsStore();

      // Set initial defaults
      store.defaultsByProjectId[projectId] = {
        mode: 'plan',
        thinkingEnabled: true,
      };

      await store.resetDefaults(projectId);

      // After reset, defaults should have all null fields
      expect(store.defaultsByProjectId[projectId]).toEqual({
        mode: null,
        thinkingEnabled: null,
        startImmediately: null,
        gitMode: null,
        gitBranch: null,
        model: null,
      });
    });

    it('handles API errors', async () => {
      const projectId = 'test-project-1';
      const error = new Error('Reset failed');

      api.resetProjectSessionDefaults.mockRejectedValue(error);

      const store = useProjectDefaultsStore();

      await expect(store.resetDefaults(projectId)).rejects.toThrow('Reset failed');
      expect(store.error).toBe('Reset failed');
    });
  });

  describe('clearProjectDefaults', () => {
    it('removes defaults for specific project', () => {
      const store = useProjectDefaultsStore();

      store.defaultsByProjectId = {
        'project-1': { mode: 'plan' },
        'project-2': { mode: 'standard' },
      };

      store.clearProjectDefaults('project-1');

      expect(store.defaultsByProjectId['project-1']).toBeUndefined();
      expect(store.defaultsByProjectId['project-2']).toBeDefined();
    });
  });

  describe('clearAllDefaults', () => {
    it('clears all cached defaults', () => {
      const store = useProjectDefaultsStore();

      store.defaultsByProjectId = {
        'project-1': { mode: 'plan' },
        'project-2': { mode: 'standard' },
      };

      store.clearAllDefaults();

      expect(store.defaultsByProjectId).toEqual({});
    });
  });

  describe('getDefaultsForProject getter', () => {
    it('returns defaults for project', () => {
      const store = useProjectDefaultsStore();
      const mockDefaults = { mode: 'plan', thinkingEnabled: true };

      store.defaultsByProjectId = {
        'project-1': mockDefaults,
      };

      expect(store.getDefaultsForProject('project-1')).toEqual(mockDefaults);
    });

    it('returns null for non-existent project', () => {
      const store = useProjectDefaultsStore();

      expect(store.getDefaultsForProject('non-existent')).toBeNull();
    });
  });

  describe('multiple projects', () => {
    it('caches defaults for multiple projects independently', async () => {
      const project1Defaults = { id: '1', projectId: 'p1', mode: 'plan' };
      const project2Defaults = { id: '2', projectId: 'p2', mode: 'standard' };

      api.getProjectSessionDefaults.mockImplementation((projectId) => {
        if (projectId === 'p1') return Promise.resolve(project1Defaults);
        if (projectId === 'p2') return Promise.resolve(project2Defaults);
      });

      const store = useProjectDefaultsStore();

      await store.fetchDefaults('p1');
      await store.fetchDefaults('p2');

      expect(store.defaultsByProjectId['p1']).toEqual(project1Defaults);
      expect(store.defaultsByProjectId['p2']).toEqual(project2Defaults);
    });

    it('updates only specific project defaults', async () => {
      const store = useProjectDefaultsStore();

      // Initialize with defaults
      store.defaultsByProjectId = {
        'p1': { mode: 'plan', thinkingEnabled: true },
        'p2': { mode: 'standard', thinkingEnabled: false },
      };

      const updatedDefaults = { mode: 'yolo', thinkingEnabled: true };

      api.updateProjectSessionDefaults.mockResolvedValue({
        id: '1',
        projectId: 'p1',
        ...updatedDefaults,
      });

      await store.updateDefaults('p1', updatedDefaults);

      expect(store.defaultsByProjectId['p1'].mode).toBe('yolo');
      expect(store.defaultsByProjectId['p2'].mode).toBe('standard'); // Unchanged
    });
  });
});
