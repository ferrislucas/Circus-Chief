import { describe, it, expect, vi } from 'vitest';
import { useTemplatesStore } from './templates.js';

// Mock the API module
vi.mock('../composables/useApi.js', () => ({
  api: {
    getProjectTemplates: vi.fn(),
    createProjectTemplate: vi.fn(),
    createGlobalTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

describe('Templates Store', () => {

  describe('initial state', () => {
    it('has empty arrays for templates', () => {
      const store = useTemplatesStore();
      expect(store.projectTemplates).toEqual([]);
      expect(store.globalTemplates).toEqual([]);
    });

    it('has loading set to false', () => {
      const store = useTemplatesStore();
      expect(store.loading).toBe(false);
    });

    it('has error set to null', () => {
      const store = useTemplatesStore();
      expect(store.error).toBeNull();
    });
  });

  describe('getters', () => {
    describe('allTemplates', () => {
      it('combines project and global templates', () => {
        const store = useTemplatesStore();
        store.projectTemplates = [{ id: '1', name: 'Project 1' }];
        store.globalTemplates = [{ id: '2', name: 'Global 1' }];

        expect(store.allTemplates).toHaveLength(2);
        expect(store.allTemplates[0].name).toBe('Project 1');
        expect(store.allTemplates[1].name).toBe('Global 1');
      });

      it('returns empty array when no templates', () => {
        const store = useTemplatesStore();
        expect(store.allTemplates).toEqual([]);
      });
    });

    describe('getTemplateById', () => {
      it('finds template in project templates', () => {
        const store = useTemplatesStore();
        store.projectTemplates = [{ id: '1', name: 'Project Template' }];

        const template = store.getTemplateById('1');

        expect(template).toBeDefined();
        expect(template.name).toBe('Project Template');
      });

      it('finds template in global templates', () => {
        const store = useTemplatesStore();
        store.globalTemplates = [{ id: '2', name: 'Global Template' }];

        const template = store.getTemplateById('2');

        expect(template).toBeDefined();
        expect(template.name).toBe('Global Template');
      });

      it('returns undefined for non-existent template', () => {
        const store = useTemplatesStore();
        store.projectTemplates = [{ id: '1', name: 'Template' }];

        const template = store.getTemplateById('non-existent');

        expect(template).toBeUndefined();
      });

      it('prefers project template when IDs conflict', () => {
        const store = useTemplatesStore();
        store.projectTemplates = [{ id: '1', name: 'Project Version' }];
        store.globalTemplates = [{ id: '1', name: 'Global Version' }];

        const template = store.getTemplateById('1');

        expect(template.name).toBe('Project Version');
      });
    });
  });

  describe('actions', () => {
    describe('fetchProjectTemplates', () => {
      it('fetches and sets templates', async () => {
        const store = useTemplatesStore();
        const mockResult = {
          project: [{ id: '1', name: 'Project Template' }],
          global: [{ id: '2', name: 'Global Template' }],
        };
        api.getProjectTemplates.mockResolvedValue(mockResult);

        await store.fetchProjectTemplates('proj-123');

        expect(api.getProjectTemplates).toHaveBeenCalledWith('proj-123');
        expect(store.projectTemplates).toEqual(mockResult.project);
        expect(store.globalTemplates).toEqual(mockResult.global);
        expect(store.loading).toBe(false);
        expect(store.error).toBeNull();
      });

      it('sets loading to true during fetch', async () => {
        const store = useTemplatesStore();
        let loadingDuringFetch = false;

        api.getProjectTemplates.mockImplementation(() => {
          loadingDuringFetch = store.loading;
          return Promise.resolve({ project: [], global: [] });
        });

        await store.fetchProjectTemplates('proj-123');

        expect(loadingDuringFetch).toBe(true);
      });

      it('handles missing project/global arrays', async () => {
        const store = useTemplatesStore();
        api.getProjectTemplates.mockResolvedValue({});

        await store.fetchProjectTemplates('proj-123');

        expect(store.projectTemplates).toEqual([]);
        expect(store.globalTemplates).toEqual([]);
      });

      it('sets error on failure', async () => {
        const store = useTemplatesStore();
        api.getProjectTemplates.mockRejectedValue(new Error('Network error'));

        await store.fetchProjectTemplates('proj-123');

        expect(store.error).toBe('Network error');
        expect(store.loading).toBe(false);
      });
    });

    describe('createProjectTemplate', () => {
      it('creates template and adds to project list', async () => {
        const store = useTemplatesStore();
        const newTemplate = { id: '1', name: 'New Template', projectId: 'proj-123' };
        api.createProjectTemplate.mockResolvedValue(newTemplate);

        const result = await store.createProjectTemplate('proj-123', {
          name: 'New Template',
          prompt: 'Do something',
        });

        expect(api.createProjectTemplate).toHaveBeenCalledWith('proj-123', {
          name: 'New Template',
          prompt: 'Do something',
        });
        expect(result).toEqual(newTemplate);
        expect(store.projectTemplates[0]).toEqual(newTemplate);
      });

      it('creates template with all optional fields', async () => {
        const store = useTemplatesStore();
        const newTemplate = {
          id: '1',
          name: 'New Template',
          projectId: 'proj-123',
          model: 'claude-sonnet-4-20250514',
          mode: 'plan',
          gitBranch: 'feature/test',
          gitMode: 'worktree',
        };
        api.createProjectTemplate.mockResolvedValue(newTemplate);

        const result = await store.createProjectTemplate('proj-123', {
          name: 'New Template',
          prompt: 'Do something',
          model: 'claude-sonnet-4-20250514',
          mode: 'plan',
          gitBranch: 'feature/test',
          gitMode: 'worktree',
        });

        expect(api.createProjectTemplate).toHaveBeenCalledWith('proj-123', {
          name: 'New Template',
          prompt: 'Do something',
          model: 'claude-sonnet-4-20250514',
          mode: 'plan',
          gitBranch: 'feature/test',
          gitMode: 'worktree',
        });
        expect(result).toEqual(newTemplate);
        expect(store.projectTemplates[0]).toEqual(newTemplate);
      });

      it('adds new template at the beginning of list', async () => {
        const store = useTemplatesStore();
        store.projectTemplates = [{ id: 'existing', name: 'Existing' }];

        const newTemplate = { id: 'new', name: 'New Template' };
        api.createProjectTemplate.mockResolvedValue(newTemplate);

        await store.createProjectTemplate('proj-123', { name: 'New', prompt: 'Prompt' });

        expect(store.projectTemplates[0].id).toBe('new');
        expect(store.projectTemplates[1].id).toBe('existing');
      });

      it('throws and sets error on failure', async () => {
        const store = useTemplatesStore();
        api.createProjectTemplate.mockRejectedValue(new Error('Creation failed'));

        await expect(
          store.createProjectTemplate('proj-123', { name: 'Test', prompt: 'Test' })
        ).rejects.toThrow('Creation failed');

        expect(store.error).toBe('Creation failed');
      });
    });

    describe('createGlobalTemplate', () => {
      it('creates template and adds to global list', async () => {
        const store = useTemplatesStore();
        const newTemplate = { id: '1', name: 'Global Template', projectId: null };
        api.createGlobalTemplate.mockResolvedValue(newTemplate);

        const result = await store.createGlobalTemplate({
          name: 'Global Template',
          prompt: 'Do something globally',
        });

        expect(api.createGlobalTemplate).toHaveBeenCalledWith({
          name: 'Global Template',
          prompt: 'Do something globally',
        });
        expect(result).toEqual(newTemplate);
        expect(store.globalTemplates[0]).toEqual(newTemplate);
      });

      it('adds new template at the beginning of global list', async () => {
        const store = useTemplatesStore();
        store.globalTemplates = [{ id: 'existing', name: 'Existing' }];

        const newTemplate = { id: 'new', name: 'New Global' };
        api.createGlobalTemplate.mockResolvedValue(newTemplate);

        await store.createGlobalTemplate({ name: 'New', prompt: 'Prompt' });

        expect(store.globalTemplates[0].id).toBe('new');
        expect(store.globalTemplates[1].id).toBe('existing');
      });

      it('throws and sets error on failure', async () => {
        const store = useTemplatesStore();
        api.createGlobalTemplate.mockRejectedValue(new Error('Creation failed'));

        await expect(
          store.createGlobalTemplate({ name: 'Test', prompt: 'Test' })
        ).rejects.toThrow('Creation failed');

        expect(store.error).toBe('Creation failed');
      });
    });

    describe('updateTemplate', () => {
      it('updates template in project list', async () => {
        const store = useTemplatesStore();
        store.projectTemplates = [{ id: '1', name: 'Original', prompt: 'Original prompt' }];

        const updated = { id: '1', name: 'Updated', prompt: 'Updated prompt' };
        api.updateTemplate.mockResolvedValue(updated);

        const result = await store.updateTemplate('1', { name: 'Updated' });

        expect(api.updateTemplate).toHaveBeenCalledWith('1', { name: 'Updated' });
        expect(result).toEqual(updated);
        expect(store.projectTemplates[0].name).toBe('Updated');
      });

      it('updates template with new fields', async () => {
        const store = useTemplatesStore();
        store.projectTemplates = [{ id: '1', name: 'Original', prompt: 'Original prompt' }];

        const updated = {
          id: '1',
          name: 'Updated',
          prompt: 'Updated prompt',
          model: 'claude-sonnet-4-20250514',
          mode: 'plan',
          gitBranch: 'develop',
          gitMode: 'branch',
        };
        api.updateTemplate.mockResolvedValue(updated);

        const result = await store.updateTemplate('1', {
          model: 'claude-sonnet-4-20250514',
          mode: 'plan',
          gitBranch: 'develop',
          gitMode: 'branch',
        });

        expect(api.updateTemplate).toHaveBeenCalledWith('1', {
          model: 'claude-sonnet-4-20250514',
          mode: 'plan',
          gitBranch: 'develop',
          gitMode: 'branch',
        });
        expect(result).toEqual(updated);
        expect(store.projectTemplates[0].model).toBe('claude-sonnet-4-20250514');
        expect(store.projectTemplates[0].mode).toBe('plan');
        expect(store.projectTemplates[0].gitBranch).toBe('develop');
        expect(store.projectTemplates[0].gitMode).toBe('branch');
      });

      it('updates template in global list', async () => {
        const store = useTemplatesStore();
        store.globalTemplates = [{ id: '2', name: 'Original' }];

        const updated = { id: '2', name: 'Updated' };
        api.updateTemplate.mockResolvedValue(updated);

        await store.updateTemplate('2', { name: 'Updated' });

        expect(store.globalTemplates[0].name).toBe('Updated');
      });

      it('does not modify list when template not found', async () => {
        const store = useTemplatesStore();
        store.projectTemplates = [{ id: '1', name: 'Existing' }];

        const updated = { id: 'other', name: 'Updated' };
        api.updateTemplate.mockResolvedValue(updated);

        await store.updateTemplate('other', { name: 'Updated' });

        expect(store.projectTemplates).toHaveLength(1);
        expect(store.projectTemplates[0].name).toBe('Existing');
      });

      it('throws and sets error on failure', async () => {
        const store = useTemplatesStore();
        api.updateTemplate.mockRejectedValue(new Error('Update failed'));

        await expect(store.updateTemplate('1', { name: 'Test' })).rejects.toThrow('Update failed');

        expect(store.error).toBe('Update failed');
      });
    });

    describe('deleteTemplate', () => {
      it('removes template from project list', async () => {
        const store = useTemplatesStore();
        store.projectTemplates = [
          { id: '1', name: 'Template 1' },
          { id: '2', name: 'Template 2' },
        ];
        api.deleteTemplate.mockResolvedValue(undefined);

        await store.deleteTemplate('1');

        expect(api.deleteTemplate).toHaveBeenCalledWith('1');
        expect(store.projectTemplates).toHaveLength(1);
        expect(store.projectTemplates[0].id).toBe('2');
      });

      it('removes template from global list', async () => {
        const store = useTemplatesStore();
        store.globalTemplates = [
          { id: '1', name: 'Global 1' },
          { id: '2', name: 'Global 2' },
        ];
        api.deleteTemplate.mockResolvedValue(undefined);

        await store.deleteTemplate('1');

        expect(store.globalTemplates).toHaveLength(1);
        expect(store.globalTemplates[0].id).toBe('2');
      });

      it('removes from both lists if present', async () => {
        const store = useTemplatesStore();
        store.projectTemplates = [{ id: '1', name: 'Project' }];
        store.globalTemplates = [{ id: '1', name: 'Global' }];
        api.deleteTemplate.mockResolvedValue(undefined);

        await store.deleteTemplate('1');

        expect(store.projectTemplates).toHaveLength(0);
        expect(store.globalTemplates).toHaveLength(0);
      });

      it('throws and sets error on failure', async () => {
        const store = useTemplatesStore();
        api.deleteTemplate.mockRejectedValue(new Error('Delete failed'));

        await expect(store.deleteTemplate('1')).rejects.toThrow('Delete failed');

        expect(store.error).toBe('Delete failed');
      });

      it('sets loading during delete', async () => {
        const store = useTemplatesStore();
        let loadingDuringDelete = false;

        api.deleteTemplate.mockImplementation(() => {
          loadingDuringDelete = store.loading;
          return Promise.resolve();
        });

        await store.deleteTemplate('1');

        expect(loadingDuringDelete).toBe(true);
        expect(store.loading).toBe(false);
      });
    });
  });
});
