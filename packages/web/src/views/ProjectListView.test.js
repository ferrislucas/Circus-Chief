import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import ProjectListView from './ProjectListView.vue';
import { useProjectsStore } from '../stores/projects.js';
import { useProjectFiltersStore } from '../stores/projectFilters.js';

const { getWorkspaceCards } = vi.hoisted(() => ({ getWorkspaceCards: vi.fn() }));
const { fetchButtons } = vi.hoisted(() => ({ fetchButtons: vi.fn().mockResolvedValue(true) }));

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

vi.mock('../stores/commandButtons.js', () => ({
  useCommandButtonsStore: () => ({ fetchButtons }),
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
    workspaceCount: 0,
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
    fetchButtons.mockReset();
    fetchButtons.mockResolvedValue(true);
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

    it('does not offer project editing from the list', async () => {
      projectsStore.projects = [fullProject()];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });

      await flushAll(wrapper);

      expect(wrapper.find('.edit-btn').exists()).toBe(false);
      expect(wrapper.find(`a[href="/projects/proj-1/edit"]`).exists()).toBe(false);
    });

    it('always shows running and waiting session counts plus workspace count', async () => {
      projectsStore.projects = [fullProject({
        sessionCount: 7,
        workspaceCount: 3,
        runningSessionCount: 2,
        waitingSessionCount: 1,
      })];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });
      await flushAll(wrapper);

      const summary = wrapper.find('.project-session-summary');
      expect(summary.exists()).toBe(true);
      expect(summary.text()).toContain('2 running');
      expect(summary.text()).toContain('1 waiting');
      expect(summary.text()).toContain('3 workspaces');
    });

    it('highlights the running indicator only for projects with running sessions', async () => {
      projectsStore.projects = [
        fullProject({ id: 'running', runningSessionCount: 2 }),
        fullProject({ id: 'idle', runningSessionCount: 0 }),
      ];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });
      await flushAll(wrapper);

      const counts = wrapper.findAll('.project-running-count');
      expect(counts).toHaveLength(2);
      expect(counts[0].classes()).toContain('has-running-sessions');
      expect(counts[1].classes()).not.toContain('has-running-sessions');
    });

    it('loads Circus command definitions for the embedded session cards', async () => {
      projectsStore.projects = [fullProject({ id: 'commands-project' })];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });
      await flushAll(wrapper);

      expect(fetchButtons).toHaveBeenCalledWith('commands-project');
    });

    it('does not reload command definitions when project data refreshes with the same IDs', async () => {
      projectsStore.projects = [fullProject({ id: 'commands-project' })];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });
      await flushAll(wrapper);

      projectsStore.projects = [fullProject({
        id: 'commands-project',
        runningSessionCount: 1,
      })];
      await flushAll(wrapper);

      expect(fetchButtons).toHaveBeenCalledTimes(1);
      expect(fetchButtons).toHaveBeenCalledWith('commands-project');
    });

    it('retries command-definition hydration after a transient failure', async () => {
      fetchButtons
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      projectsStore.projects = [fullProject({ id: 'commands-project' })];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] },
      });
      await flushAll(wrapper);

      expect(fetchButtons).toHaveBeenCalledTimes(1);

      projectsStore.projects = [fullProject({
        id: 'commands-project',
        runningSessionCount: 1,
      })];
      await flushAll(wrapper);

      expect(fetchButtons).toHaveBeenCalledTimes(2);
      expect(fetchButtons).toHaveBeenLastCalledWith('commands-project');

      projectsStore.projects = [fullProject({
        id: 'commands-project',
        runningSessionCount: 2,
      })];
      await flushAll(wrapper);

      expect(fetchButtons).toHaveBeenCalledTimes(2);
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
      await wrapper.find('.sessions-toggle').trigger('click');
      expect(wrapper.findAll('.embedded-session-list .session-card')).toHaveLength(2);
      expect(wrapper.text()).toContain('latest');
    });

    it('keeps session cards inside the project card and toggles them', async () => {
      getWorkspaceCards.mockResolvedValueOnce({
        workspaces: [{ id: 'ws-1', name: 'latest' }],
      });
      projectsStore.projects = [fullProject({ sessionCount: 1 })];
      projectsStore.loading = false;
      const wrapper = mount(ProjectListView, { global: { plugins: [pinia, router] } });
      await flushAll(wrapper);

      const projectCard = wrapper.find('.project-card');
      const toggle = projectCard.find('.sessions-toggle');
      expect(toggle.exists()).toBe(true);
      expect(projectCard.find('.embedded-session-list').exists()).toBe(false);
      expect(toggle.attributes('aria-expanded')).toBe('false');

      await toggle.trigger('click');

      expect(projectCard.find('.embedded-session-list').exists()).toBe(true);
      expect(toggle.text()).toContain('Hide sessions');
      expect(toggle.attributes('aria-expanded')).toBe('true');
    });

    it('restores each project session toggle state from local storage', async () => {
      localStorage.setItem(
        'circus-chief.project-list.session-visibility',
        JSON.stringify({ 'proj-1': true })
      );
      getWorkspaceCards.mockResolvedValueOnce({
        workspaces: [{ id: 'ws-1', name: 'latest' }],
      });
      projectsStore.projects = [fullProject({ sessionCount: 1 })];
      projectsStore.loading = false;
      const wrapper = mount(ProjectListView, { global: { plugins: [pinia, router] } });
      await flushAll(wrapper);

      expect(wrapper.find('.embedded-session-list').exists()).toBe(true);
      expect(wrapper.find('.sessions-toggle').attributes('aria-expanded')).toBe('true');
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
      await wrapper.find('.sessions-toggle').trigger('click');
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
