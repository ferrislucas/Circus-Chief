import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import ProjectListView from './ProjectListView.vue';
import { useProjectsStore } from '../stores/projects.js';
import { useProjectFiltersStore } from '../stores/projectFilters.js';

const { getWorkspaceCards } = vi.hoisted(() => ({ getWorkspaceCards: vi.fn() }));

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

vi.mock('../api/index.js', () => ({
  api: { getWorkspaceCards },
}));

vi.mock('../components/SessionCard.vue', () => ({
  default: {
    name: 'SessionCard',
    props: ['session'],
    template: '<div class="session-card">{{ session.name }}</div>',
  },
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
    getWorkspaceCards.mockResolvedValue({ workspaces: [] });
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

  describe('Embedded session cards', () => {
    it('shows the three most recent cards for each project without a filter', async () => {
      getWorkspaceCards.mockResolvedValueOnce({
        workspaces: [
          { id: 'ws-1', name: 'latest' },
          { id: 'ws-2', name: 'previous' },
        ],
      });
      projectsStore.projects = [fullProject({ sessionCount: 2 })];
      projectsStore.loading = false;
      const wrapper = mount(ProjectListView, { global: { plugins: [pinia, router] } });
      await flushAll(wrapper);

      expect(getWorkspaceCards).toHaveBeenCalledWith('proj-1', { status: null, limit: 3 });
      expect(wrapper.findAll('.embedded-session-list .session-card')).toHaveLength(2);
      expect(wrapper.text()).toContain('latest');
    });

    it('loads every matching card when a status filter is selected', async () => {
      useProjectFiltersStore().setStatusFilter('waiting');
      getWorkspaceCards.mockResolvedValueOnce({
        workspaces: [
          { id: 'ws-1', name: 'needs input' },
          { id: 'ws-2', name: 'also waiting' },
        ],
      });
      projectsStore.projects = [fullProject({ waitingSessionCount: 2 })];
      projectsStore.loading = false;
      const wrapper = mount(ProjectListView, { global: { plugins: [pinia, router] } });
      await flushAll(wrapper);

      expect(getWorkspaceCards).toHaveBeenCalledWith('proj-1', { status: 'waiting', limit: 500 });
      expect(wrapper.findAll('.embedded-session-list .session-card')).toHaveLength(2);
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
