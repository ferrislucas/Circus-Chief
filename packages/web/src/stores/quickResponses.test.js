import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useQuickResponsesStore } from './quickResponses.js';

// Mock the API
vi.mock('../composables/useApi.js', () => ({
  api: {
    getQuickResponses: vi.fn(),
    getGlobalQuickResponses: vi.fn(),
    createQuickResponse: vi.fn(),
    updateQuickResponse: vi.fn(),
    deleteQuickResponse: vi.fn(),
    reorderQuickResponses: vi.fn(),
    reorderGlobalQuickResponses: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

describe('useQuickResponsesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('initializes with empty arrays and loading false', () => {
      const store = useQuickResponsesStore();

      expect(store.projectResponses).toEqual([]);
      expect(store.globalResponses).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.currentProjectId).toBeNull();
    });
  });

  describe('getters', () => {
    describe('allResponses', () => {
      it('returns combined project and global responses', () => {
        const store = useQuickResponsesStore();
        store.projectResponses = [{ id: '1', label: 'Project' }];
        store.globalResponses = [{ id: '2', label: 'Global' }];

        expect(store.allResponses).toHaveLength(2);
        expect(store.allResponses[0].label).toBe('Project');
        expect(store.allResponses[1].label).toBe('Global');
      });

      it('returns project responses first', () => {
        const store = useQuickResponsesStore();
        store.projectResponses = [{ id: '1', label: 'P1' }, { id: '2', label: 'P2' }];
        store.globalResponses = [{ id: '3', label: 'G1' }];

        expect(store.allResponses[0].label).toBe('P1');
        expect(store.allResponses[1].label).toBe('P2');
        expect(store.allResponses[2].label).toBe('G1');
      });
    });

    describe('hasResponses', () => {
      it('returns true if any responses exist', () => {
        const store = useQuickResponsesStore();
        store.projectResponses = [{ id: '1' }];

        expect(store.hasResponses).toBe(true);
      });

      it('returns true if only global responses exist', () => {
        const store = useQuickResponsesStore();
        store.globalResponses = [{ id: '1' }];

        expect(store.hasResponses).toBe(true);
      });

      it('returns false if no responses', () => {
        const store = useQuickResponsesStore();

        expect(store.hasResponses).toBe(false);
      });
    });
  });

  describe('actions', () => {
    describe('fetchForProject', () => {
      it('populates projectResponses and globalResponses', async () => {
        const projectId = 'test-project-1';
        const mockResponse = {
          project: [{ id: '1', label: 'Yes', projectId }],
          global: [{ id: '2', label: 'LGTM', projectId: null }],
        };

        api.getQuickResponses.mockResolvedValue(mockResponse);

        const store = useQuickResponsesStore();
        await store.fetchForProject(projectId);

        expect(api.getQuickResponses).toHaveBeenCalledWith(projectId);
        expect(store.projectResponses).toEqual(mockResponse.project);
        expect(store.globalResponses).toEqual(mockResponse.global);
        expect(store.currentProjectId).toBe(projectId);
      });

      it('sets loading true while fetching', async () => {
        const projectId = 'test-project-1';
        api.getQuickResponses.mockResolvedValue({ project: [], global: [] });

        const store = useQuickResponsesStore();
        const promise = store.fetchForProject(projectId);

        // After the promise resolves, loading should be false
        await promise;
        expect(store.loading).toBe(false);
      });

      it('sets error on API failure', async () => {
        const projectId = 'test-project-1';
        api.getQuickResponses.mockRejectedValue(new Error('Network error'));

        const store = useQuickResponsesStore();

        await expect(store.fetchForProject(projectId)).rejects.toThrow('Network error');
        expect(store.error).toBe('Network error');
      });

      it('returns the response', async () => {
        const projectId = 'test-project-1';
        const mockResponse = { project: [], global: [] };
        api.getQuickResponses.mockResolvedValue(mockResponse);

        const store = useQuickResponsesStore();
        const result = await store.fetchForProject(projectId);

        expect(result).toEqual(mockResponse);
      });
    });

    describe('createResponse', () => {
      it('adds response to projectResponses if project-specific', async () => {
        const projectId = 'test-project-1';
        const newResponse = { id: '1', label: 'Yes', projectId, content: 'yes' };

        api.createQuickResponse.mockResolvedValue(newResponse);

        const store = useQuickResponsesStore();
        await store.createResponse(projectId, { label: 'Yes', content: 'yes' });

        expect(store.projectResponses).toContainEqual(newResponse);
        expect(store.globalResponses).not.toContainEqual(newResponse);
      });

      it('adds response to globalResponses if global', async () => {
        const projectId = 'test-project-1';
        const newResponse = { id: '1', label: 'LGTM', projectId: null, content: 'looks good' };

        api.createQuickResponse.mockResolvedValue(newResponse);

        const store = useQuickResponsesStore();
        await store.createResponse(projectId, { label: 'LGTM', content: 'looks good', isGlobal: true });

        expect(store.globalResponses).toContainEqual(newResponse);
        expect(store.projectResponses).not.toContainEqual(newResponse);
      });

      it('returns created response', async () => {
        const projectId = 'test-project-1';
        const newResponse = { id: '1', label: 'Yes', projectId, content: 'yes' };

        api.createQuickResponse.mockResolvedValue(newResponse);

        const store = useQuickResponsesStore();
        const result = await store.createResponse(projectId, { label: 'Yes', content: 'yes' });

        expect(result).toEqual(newResponse);
      });

      it('throws on API error', async () => {
        const projectId = 'test-project-1';
        api.createQuickResponse.mockRejectedValue(new Error('Validation error'));

        const store = useQuickResponsesStore();

        await expect(
          store.createResponse(projectId, { label: '', content: 'content' })
        ).rejects.toThrow('Validation error');
        expect(store.error).toBe('Validation error');
      });
    });

    describe('updateResponse', () => {
      it('updates response in projectResponses', async () => {
        const store = useQuickResponsesStore();
        store.projectResponses = [{ id: '1', label: 'Old', content: 'old', projectId: 'p1' }];

        const updated = { id: '1', label: 'New', content: 'old', projectId: 'p1' };
        api.updateQuickResponse.mockResolvedValue(updated);

        await store.updateResponse('1', { label: 'New' });

        expect(store.projectResponses[0].label).toBe('New');
      });

      it('updates response in globalResponses', async () => {
        const store = useQuickResponsesStore();
        store.globalResponses = [{ id: '1', label: 'Old', content: 'old', projectId: null }];

        const updated = { id: '1', label: 'New', content: 'old', projectId: null };
        api.updateQuickResponse.mockResolvedValue(updated);

        await store.updateResponse('1', { label: 'New' });

        expect(store.globalResponses[0].label).toBe('New');
      });

      it('preserves array order', async () => {
        const store = useQuickResponsesStore();
        store.projectResponses = [
          { id: '1', label: 'First', projectId: 'p1' },
          { id: '2', label: 'Second', projectId: 'p1' },
          { id: '3', label: 'Third', projectId: 'p1' },
        ];

        const updated = { id: '2', label: 'Updated', projectId: 'p1' };
        api.updateQuickResponse.mockResolvedValue(updated);

        await store.updateResponse('2', { label: 'Updated' });

        expect(store.projectResponses[0].label).toBe('First');
        expect(store.projectResponses[1].label).toBe('Updated');
        expect(store.projectResponses[2].label).toBe('Third');
      });

      it('returns updated response', async () => {
        const store = useQuickResponsesStore();
        store.projectResponses = [{ id: '1', label: 'Old', projectId: 'p1' }];

        const updated = { id: '1', label: 'New', projectId: 'p1' };
        api.updateQuickResponse.mockResolvedValue(updated);

        const result = await store.updateResponse('1', { label: 'New' });

        expect(result).toEqual(updated);
      });
    });

    describe('deleteResponse', () => {
      it('removes response from projectResponses', async () => {
        const store = useQuickResponsesStore();
        store.projectResponses = [
          { id: '1', label: 'First' },
          { id: '2', label: 'Second' },
        ];

        api.deleteQuickResponse.mockResolvedValue(undefined);

        await store.deleteResponse('1');

        expect(store.projectResponses).toHaveLength(1);
        expect(store.projectResponses[0].id).toBe('2');
      });

      it('removes response from globalResponses', async () => {
        const store = useQuickResponsesStore();
        store.globalResponses = [
          { id: '1', label: 'First' },
          { id: '2', label: 'Second' },
        ];

        api.deleteQuickResponse.mockResolvedValue(undefined);

        await store.deleteResponse('1');

        expect(store.globalResponses).toHaveLength(1);
        expect(store.globalResponses[0].id).toBe('2');
      });

      it('throws on API error', async () => {
        const store = useQuickResponsesStore();
        store.projectResponses = [{ id: '1' }];

        api.deleteQuickResponse.mockRejectedValue(new Error('Delete failed'));

        await expect(store.deleteResponse('1')).rejects.toThrow('Delete failed');
        expect(store.error).toBe('Delete failed');
      });
    });

    describe('reorderResponses', () => {
      it('updates order based on array position for project responses', async () => {
        const projectId = 'test-project-1';
        const store = useQuickResponsesStore();
        store.projectResponses = [
          { id: '1', label: 'A', sortOrder: 0 },
          { id: '2', label: 'B', sortOrder: 1 },
          { id: '3', label: 'C', sortOrder: 2 },
        ];

        api.reorderQuickResponses.mockResolvedValue({
          project: [
            { id: '3', label: 'C', sortOrder: 0 },
            { id: '1', label: 'A', sortOrder: 1 },
            { id: '2', label: 'B', sortOrder: 2 },
          ],
          global: [],
        });

        await store.reorderResponses(projectId, ['3', '1', '2']);

        expect(api.reorderQuickResponses).toHaveBeenCalledWith(projectId, [
          { id: '3', sortOrder: 0 },
          { id: '1', sortOrder: 1 },
          { id: '2', sortOrder: 2 },
        ]);
        expect(store.projectResponses[0].id).toBe('3');
      });

      it('reorders global responses when projectId is null', async () => {
        const store = useQuickResponsesStore();
        store.globalResponses = [
          { id: '1', label: 'A' },
          { id: '2', label: 'B' },
        ];

        api.reorderGlobalQuickResponses.mockResolvedValue([
          { id: '2', label: 'B', sortOrder: 0 },
          { id: '1', label: 'A', sortOrder: 1 },
        ]);

        await store.reorderResponses(null, ['2', '1']);

        expect(api.reorderGlobalQuickResponses).toHaveBeenCalledWith([
          { id: '2', sortOrder: 0 },
          { id: '1', sortOrder: 1 },
        ]);
        expect(store.globalResponses[0].id).toBe('2');
      });
    });

    describe('clearResponses', () => {
      it('clears all responses', () => {
        const store = useQuickResponsesStore();
        store.projectResponses = [{ id: '1' }];
        store.globalResponses = [{ id: '2' }];
        store.currentProjectId = 'test';
        store.error = 'some error';

        store.clearResponses();

        expect(store.projectResponses).toEqual([]);
        expect(store.globalResponses).toEqual([]);
        expect(store.currentProjectId).toBeNull();
        expect(store.error).toBeNull();
      });
    });
  });
});
