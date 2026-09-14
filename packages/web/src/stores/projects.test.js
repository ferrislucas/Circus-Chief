import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useProjectsStore } from './projects.js';
import { useProjectFiltersStore } from './projectFilters.js';

// Mock the API client
vi.mock('../composables/useApi.js', () => ({
  api: {
    getProjects: vi.fn(),
    getProject: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

function project(overrides = {}) {
  return {
    id: 'proj-1',
    name: 'my-repo',
    workingDirectory: '/tmp/my-repo',
    sessionCount: 3,
    lastActivityAt: null,
    runningWorkspaces: [],
    runningSessionCount: 0,
    waitingSessionCount: 0,
    ...overrides,
  };
}

describe('useProjectsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts empty and not loading', () => {
      const store = useProjectsStore();
      expect(store.projects).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('fetchProjects', () => {
    it('stores the array and toggles loading around the request', async () => {
      const store = useProjectsStore();
      let resolveGet;
      api.getProjects.mockReturnValue(new Promise((resolve) => { resolveGet = resolve; }));

      const pending = store.fetchProjects();
      expect(store.loading).toBe(true);
      resolveGet([project({ id: 'a' }), project({ id: 'b' })]);
      await pending;

      expect(store.loading).toBe(false);
      expect(store.projects).toHaveLength(2);
    });

    it('sets error on failure', async () => {
      const store = useProjectsStore();
      api.getProjects.mockRejectedValue(new Error('boom'));
      await store.fetchProjects();

      expect(store.error).toBe('boom');
      expect(store.loading).toBe(false);
    });

    it('normalizes projects missing the running-workspace fields', async () => {
      const store = useProjectsStore();
      api.getProjects.mockResolvedValue([
        { id: 'legacy', name: 'old', workingDirectory: '/tmp' },
      ]);
      await store.fetchProjects();

      expect(store.projects[0].runningWorkspaces).toEqual([]);
      expect(store.projects[0].runningSessionCount).toBe(0);
      expect(store.projects[0].waitingSessionCount).toBe(0);
    });
  });

  describe('fetchProjects (silent)', () => {
    it('does not toggle loading', async () => {
      const store = useProjectsStore();
      store.loading = false;
      api.getProjects.mockResolvedValue([project()]);

      await store.fetchProjects({ silent: true });

      expect(store.loading).toBe(false);
    });

    it('does not clear an already-rendered list on failure', async () => {
      const store = useProjectsStore();
      store.projects = [project({ id: 'existing' })];
      api.getProjects.mockRejectedValue(new Error('boom'));

      await store.fetchProjects({ silent: true });

      expect(store.projects).toHaveLength(1);
      expect(store.projects[0].id).toBe('existing');
      expect(store.error).toBeNull();
    });

    it('still replaces the list on success', async () => {
      const store = useProjectsStore();
      store.projects = [project({ id: 'old' })];
      api.getProjects.mockResolvedValue([project({ id: 'new' })]);

      await store.fetchProjects({ silent: true });

      expect(store.projects.map((p) => p.id)).toEqual(['new']);
    });
  });

  describe('statusFacets getter', () => {
    it('counts running sessions while retaining project counts for waiting and idle', () => {
      const store = useProjectsStore();
      store.projects = [
        project({ id: 'run', runningSessionCount: 2, waitingSessionCount: 0 }),
        project({ id: 'wait', runningSessionCount: 0, waitingSessionCount: 1 }),
        project({ id: 'both', runningSessionCount: 3, waitingSessionCount: 1 }),
        project({ id: 'idle', runningSessionCount: 0, waitingSessionCount: 0 }),
      ];

      // running: 2 + 3 sessions = 5; waiting: wait + both = 2 projects;
      // idle: idle = 1 project.
      expect(store.statusFacets).toEqual({ running: 5, waiting: 2, idle: 1 });
    });

    it('treats a project with zero sessions as idle', () => {
      const store = useProjectsStore();
      store.projects = [
        project({ id: 'empty', runningSessionCount: 0, waitingSessionCount: 0, sessionCount: 0 }),
      ];
      expect(store.statusFacets).toEqual({ running: 0, waiting: 0, idle: 1 });
    });
  });

  describe('filteredProjects getter', () => {
    let store;
    let filters;

    beforeEach(() => {
      store = useProjectsStore();
      filters = useProjectFiltersStore();
      store.projects = [
        project({ id: 'run', runningSessionCount: 2, waitingSessionCount: 0 }),
        project({ id: 'wait', runningSessionCount: 0, waitingSessionCount: 4 }),
        project({ id: 'both', runningSessionCount: 1, waitingSessionCount: 1 }),
        project({ id: 'idle', runningSessionCount: 0, waitingSessionCount: 0 }),
      ];
    });

    it('returns all projects when the filter is null', () => {
      filters.setStatusFilter(null);
      expect(store.filteredProjects.map((p) => p.id)).toEqual(['run', 'wait', 'both', 'idle']);
    });

    it('returns only running projects under the running filter', () => {
      filters.setStatusFilter('running');
      expect(store.filteredProjects.map((p) => p.id)).toEqual(['run', 'both']);
    });

    it('returns only waiting projects under the waiting filter', () => {
      filters.setStatusFilter('waiting');
      expect(store.filteredProjects.map((p) => p.id)).toEqual(['wait', 'both']);
    });

    it('returns only idle projects under the idle filter', () => {
      filters.setStatusFilter('idle');
      expect(store.filteredProjects.map((p) => p.id)).toEqual(['idle']);
    });

    it('keeps pinned projects visible under a status filter and lets pinned-only win', () => {
      store.projects[1].pinned = true; // waiting
      filters.setStatusFilter('running');
      expect(store.filteredProjects.map((p) => p.id)).toEqual(['run', 'wait', 'both']);

      filters.setPinnedOnly(true);
      expect(store.filteredProjects.map((p) => p.id)).toEqual(['wait']);
    });
  });

  describe('pinning', () => {
    it('keeps the aggregated list model and its position when a pin update succeeds', async () => {
      const store = useProjectsStore();
      const aggregatedProject = project({
        id: 'active',
        pinned: false,
        sessionCount: 7,
        workspaceCount: 3,
        runningSessionCount: 4,
        waitingSessionCount: 2,
        lastActivityAt: 1_700_000_000_000,
        runningWorkspaces: [{ id: 'workspace-1', name: 'Build', activeCount: 4 }],
        preview: { sessionId: 'session-1', title: 'Recent activity' },
        navigation: { workspaceId: 'workspace-1' },
      });
      store.projects = [aggregatedProject, project({ id: 'other', name: 'Other project' })];
      api.updateProject.mockResolvedValue({
        id: 'active',
        name: 'my-repo',
        workingDirectory: '/tmp/my-repo',
        pinned: true,
        createdAt: 1_600_000_000_000,
        updatedAt: 1_600_000_000_000,
      });

      const pending = store.toggleProjectPin('active');
      expect(store.projects[0]).toMatchObject({ ...aggregatedProject, pinned: true });
      expect(store.projects.map((entry) => entry.id)).toEqual(['active', 'other']);

      await pending;

      expect(store.projects).toEqual([
        { ...aggregatedProject, pinned: true },
        project({ id: 'other', name: 'Other project' }),
      ]);
    });

    it('keeps an active project visible after successful unpinning under a status filter', async () => {
      const store = useProjectsStore();
      const filters = useProjectFiltersStore();
      filters.setStatusFilter('running');
      store.projects = [project({
        id: 'active',
        pinned: true,
        sessionCount: 2,
        workspaceCount: 1,
        runningSessionCount: 2,
        waitingSessionCount: 0,
        lastActivityAt: 1_700_000_000_000,
        runningWorkspaces: [{ id: 'workspace-1', name: 'Build', activeCount: 2 }],
      })];
      api.updateProject.mockResolvedValue({
        id: 'active',
        name: 'my-repo',
        workingDirectory: '/tmp/my-repo',
        pinned: false,
      });

      await store.toggleProjectPin('active');

      expect(store.projects[0]).toMatchObject({
        pinned: false,
        sessionCount: 2,
        workspaceCount: 1,
        runningSessionCount: 2,
        waitingSessionCount: 0,
        lastActivityAt: 1_700_000_000_000,
        runningWorkspaces: [{ id: 'workspace-1', name: 'Build', activeCount: 2 }],
      });
      expect(store.filteredProjects.map((entry) => entry.id)).toEqual(['active']);
    });

    it('optimistically toggles, reconciles the server result, and tracks only the affected project', async () => {
      const store = useProjectsStore();
      store.projects = [project({ id: 'a' }), project({ id: 'b' })];
      let resolveUpdate;
      api.updateProject.mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve; }));

      const pending = store.toggleProjectPin('a');
      expect(store.projects[0].pinned).toBe(true);
      expect(store.isPinPending('a')).toBe(true);
      expect(store.isPinPending('b')).toBe(false);
      expect(api.updateProject).toHaveBeenCalledWith('a', { pinned: true });

      resolveUpdate(project({ id: 'a', pinned: true }));
      await pending;
      expect(store.isPinPending('a')).toBe(false);
    });

    it('rolls a failed pin update back without using the page error state', async () => {
      const store = useProjectsStore();
      store.projects = [project({ id: 'a', pinned: false })];
      api.updateProject.mockRejectedValue(new Error('boom'));

      await expect(store.toggleProjectPin('a')).rejects.toThrow('boom');
      expect(store.projects[0].pinned).toBe(false);
      expect(store.error).toBeNull();
    });
  });
});
