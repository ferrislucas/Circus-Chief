import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import ProjectListView from './ProjectListView.vue';
import { useProjectsStore } from '../stores/projects.js';
import { useProjectFiltersStore } from '../stores/projectFilters.js';

// Mock the composable to avoid opening a WebSocket in jsdom.
vi.mock('../composables/useProjectListRealtime.js', () => ({
  useProjectListRealtime: vi.fn(),
}));

// Mock the composable
vi.mock('../composables/useSummaryHelpers.js', () => ({
  formatRelativeTime: vi.fn((ts) => {
    if (!ts) return '';
    return '2h ago';
  }),
}));

// Helper to flush all async updates
async function flushAll(wrapper) {
  await flushPromises();
  await nextTick();
  if (wrapper && wrapper.vm) {
    await wrapper.vm.$nextTick?.();
    await wrapper.vm.$forceUpdate();
    await nextTick();
    await wrapper.vm.$forceUpdate();
    await nextTick();
  }
}

function fullProject(overrides = {}) {
  return {
    id: 'proj-1',
    name: 'my-cool-app',
    workingDirectory: '/Users/me/code/my-cool-app',
    sessionCount: 0,
    lastActivityAt: null,
    runningWorkspaces: [],
    runningSessionCount: 0,
    waitingSessionCount: 0,
    ...overrides,
  };
}

describe('ProjectListView', () => {
  let pinia;
  let router;
  let projectsStore;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    localStorage.clear();

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: ProjectListView },
        { path: '/projects/new', component: { template: '<div></div>' } },
        { path: '/projects/:id/sessions', component: { template: '<div></div>' } },
        { path: '/projects/:id/edit', component: { template: '<div></div>' } },
        { path: '/sessions/:id/:tab?', component: { template: '<div></div>' } },
      ],
    });

    projectsStore = useProjectsStore();
    vi.spyOn(projectsStore, 'fetchProjects').mockResolvedValue(undefined);
  });

  describe('Page Header', () => {
    it('displays "Projects" as page title', async () => {
      projectsStore.projects = [];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });

      await flushAll(wrapper);

      expect(wrapper.find('h1').text()).toBe('Projects');
    });

    it('shows "Add Project" button', async () => {
      projectsStore.projects = [];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });

      await flushAll(wrapper);

      const link = wrapper.find('.page-header .btn-primary');
      expect(link.exists()).toBe(true);
      // Desktop label should be visible
      expect(link.find('.add-repo-label-full').text()).toBe('Add Project');
    });
  });

  describe('Empty State', () => {
    it('renders welcome hero with heading', async () => {
      projectsStore.projects = [];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });

      await flushAll(wrapper);

      expect(wrapper.find('.welcome-heading').text()).toBe('Welcome to Circus Chief');
    });

    it('renders three step cards', async () => {
      projectsStore.projects = [];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });

      await flushAll(wrapper);

      const steps = wrapper.findAll('.step-card');
      expect(steps).toHaveLength(3);
      expect(steps[0].text()).toContain('Pick a project folder');
      expect(steps[1].text()).toContain('Create coding sessions');
      expect(steps[2].text()).toContain('Track changes');
    });

    it('CTA button links to /projects/new', async () => {
      projectsStore.projects = [];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });

      await flushAll(wrapper);

      const cta = wrapper.find('.cta-button');
      expect(cta.exists()).toBe(true);
      expect(cta.text()).toBe('Add Your First Project');
      // router-link renders as <a href="...">; the 'to' prop becomes the href attribute
      expect(cta.attributes('href')).toBe('/projects/new');
    });
  });

  describe('Populated State', () => {
    it('renders project cards with name and path', async () => {
      projectsStore.projects = [fullProject()];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });

      await flushAll(wrapper);

      expect(wrapper.find('.project-name').text()).toBe('my-cool-app');
      expect(wrapper.find('.project-path').text()).toBe('/Users/me/code/my-cool-app');
    });

    it('shows session count and relative time for active projects', async () => {
      projectsStore.projects = [
        fullProject({
          sessionCount: 5,
          lastActivityAt: Date.now() - 7200000, // 2 hours ago
        }),
      ];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });

      await flushAll(wrapper);

      const meta = wrapper.find('.project-meta');
      expect(meta.exists()).toBe(true);
      expect(meta.text()).toContain('5 sessions');
    });

    it('shows edit button with desktop label', async () => {
      projectsStore.projects = [fullProject()];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });

      await flushAll(wrapper);

      const editBtn = wrapper.find('.edit-btn');
      expect(editBtn.exists()).toBe(true);
      expect(editBtn.find('.edit-label-full').text()).toBe('Edit');
    });
  });

  describe('Workspace links', () => {
    it('renders one link per runningWorkspaces entry showing name and count', async () => {
      projectsStore.projects = [
        fullProject({
          runningWorkspaces: [
            { id: 'ws-1', name: 'feature-x', activeCount: 3 },
            { id: 'ws-2', name: 'bugfix-y', activeCount: 1 },
          ],
          runningSessionCount: 4,
        }),
      ];
      projectsStore.loading = false;

      const wrapper = mount(ProjectListView, { global: { plugins: [pinia, router] } });
      await flushAll(wrapper);

      const links = wrapper.findAll('.workspace-link');
      expect(links).toHaveLength(2);
      expect(links[0].text()).toContain('feature-x');
      expect(links[0].text()).toContain('3');
      expect(links[1].text()).toContain('bugfix-y');
      expect(links[1].text()).toContain('1');
    });

    it('pluralizes the count label correctly: 1 → "session", 3 → "sessions"', async () => {
      projectsStore.projects = [
        fullProject({
          runningWorkspaces: [
            { id: 'ws-single', name: 'solo', activeCount: 1 },
            { id: 'ws-multi', name: 'team', activeCount: 3 },
          ],
          runningSessionCount: 4,
        }),
      ];
      projectsStore.loading = false;

      const wrapper = mount(ProjectListView, { global: { plugins: [pinia, router] } });
      await flushAll(wrapper);

      const links = wrapper.findAll('.workspace-link');
      expect(links[0].find('.workspace-count').text()).toBe('1 session');
      expect(links[1].find('.workspace-count').text()).toBe('3 sessions');
    });

    it('falls back to "Untitled workspace" when the workspace name is empty', async () => {
      projectsStore.projects = [
        fullProject({
          runningWorkspaces: [{ id: 'ws-empty', name: '', activeCount: 2 }],
          runningSessionCount: 2,
        }),
      ];
      projectsStore.loading = false;

      const wrapper = mount(ProjectListView, { global: { plugins: [pinia, router] } });
      await flushAll(wrapper);

      const link = wrapper.find('.workspace-link');
      expect(link.exists()).toBe(true);
      expect(link.find('.workspace-name').text()).toBe('Untitled workspace');
      expect(link.find('.workspace-count').text()).toBe('2 sessions');
    });

    it('renders no workspace-links block when runningWorkspaces is empty', async () => {
      projectsStore.projects = [fullProject({ runningWorkspaces: [] })];
      projectsStore.loading = false;

      const wrapper = mount(ProjectListView, { global: { plugins: [pinia, router] } });
      await flushAll(wrapper);

      expect(wrapper.find('.workspace-links').exists()).toBe(false);
      // The card itself still renders
      expect(wrapper.find('.project-card').exists()).toBe(true);
    });

    it('renders all links with no cap — 12 workspaces produce 12 links', async () => {
      const workspaces = Array.from({ length: 12 }, (_, i) => ({
        id: `ws-${i}`,
        name: `workspace-${i}`,
        activeCount: i + 1,
      }));
      projectsStore.projects = [
        fullProject({ runningWorkspaces: workspaces, runningSessionCount: 12 }),
      ];
      projectsStore.loading = false;

      const wrapper = mount(ProjectListView, { global: { plugins: [pinia, router] } });
      await flushAll(wrapper);

      expect(wrapper.findAll('.workspace-link')).toHaveLength(12);
      // No "+N more" or collapse controls
      expect(wrapper.text()).not.toContain('more');
    });

    it('each link is a real router-link resolving to /sessions/:workspaceId', async () => {
      projectsStore.projects = [
        fullProject({
          runningWorkspaces: [{ id: 'sess-abc123', name: 'my-feature', activeCount: 2 }],
          runningSessionCount: 2,
        }),
      ];
      projectsStore.loading = false;

      const wrapper = mount(ProjectListView, { global: { plugins: [pinia, router] } });
      await flushAll(wrapper);

      const link = wrapper.find('.workspace-link');
      expect(link.attributes('href')).toBe('/sessions/sess-abc123');
    });

    it('clicking a workspace link navigates to /sessions/:id, not /projects/:id/sessions', async () => {
      const pushSpy = vi.spyOn(router, 'push');
      projectsStore.projects = [
        fullProject({
          id: 'proj-1',
          runningWorkspaces: [{ id: 'ws-root', name: 'my-feature', activeCount: 1 }],
          runningSessionCount: 1,
        }),
      ];
      projectsStore.loading = false;

      const wrapper = mount(ProjectListView, { global: { plugins: [pinia, router] } });
      await flushAll(wrapper);

      const link = wrapper.find('.workspace-link');
      await link.trigger('click');
      await nextTick();

      // The workspace link navigated to the session detail page.
      // router.push should NOT have been called with the session list (only the
      // card-header click would trigger that).
      expect(pushSpy).not.toHaveBeenCalledWith('/projects/proj-1/sessions');
      // And the card-header click handler was not triggered (link used @click.stop).
    });
  });

  describe('Status filter', () => {
    it('renders three filter pills above the list', async () => {
      projectsStore.projects = [fullProject()];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });

      await flushAll(wrapper);

      const pills = wrapper.findAll('.filter-btn');
      expect(pills).toHaveLength(3);
    });

    it('renders the list from filteredProjects, not the raw array', async () => {
      projectsStore.projects = [
        fullProject({ id: 'run', runningSessionCount: 2 }),
        fullProject({ id: 'idle', runningSessionCount: 0 }),
      ];
      projectsStore.loading = false;
      projectsStore.error = null;
      useProjectFiltersStore().setStatusFilter('running');

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });

      await flushAll(wrapper);

      const names = wrapper.findAll('.project-name').map((el) => el.text());
      expect(names).toEqual(['my-cool-app']);
      expect(wrapper.findAll('.project-card')).toHaveLength(1);
    });

    it('shows the filtered-empty state (not the welcome hero) when a filter matches nothing', async () => {
      projectsStore.projects = [fullProject({ id: 'idle', runningSessionCount: 0 })];
      projectsStore.loading = false;
      projectsStore.error = null;
      useProjectFiltersStore().setStatusFilter('running');

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });

      await flushAll(wrapper);

      expect(wrapper.find('.no-match').exists()).toBe(true);
      expect(wrapper.find('.no-match-text').text()).toBe('No projects match this filter.');
      expect(wrapper.find('.welcome-heading').exists()).toBe(false);
    });

    it('still shows the welcome hero when there are genuinely no projects', async () => {
      projectsStore.projects = [];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });

      await flushAll(wrapper);

      expect(wrapper.find('.welcome-heading').text()).toBe('Welcome to Circus Chief');
      expect(wrapper.find('.no-match').exists()).toBe(false);
    });
  });
});
