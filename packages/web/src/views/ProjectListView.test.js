import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import ProjectListView from './ProjectListView.vue';
import { useProjectsStore } from '../stores/projects.js';

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

describe('ProjectListView', () => {
  let pinia;
  let router;
  let projectsStore;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: ProjectListView },
        { path: '/projects/new', component: { template: '<div></div>' } },
        { path: '/projects/:id/sessions', component: { template: '<div></div>' } },
        { path: '/projects/:id/edit', component: { template: '<div></div>' } },
      ]
    });

    projectsStore = useProjectsStore();
    vi.spyOn(projectsStore, 'fetchProjects').mockResolvedValue(undefined);
  });

  describe('Page Header', () => {
    it('displays "Repositories" as page title', async () => {
      projectsStore.projects = [];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] }
      });

      await flushAll(wrapper);

      expect(wrapper.find('h1').text()).toBe('Repositories');
    });

    it('shows "Add Repository" button', async () => {
      projectsStore.projects = [];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] }
      });

      await flushAll(wrapper);

      const link = wrapper.find('.page-header .btn-primary');
      expect(link.exists()).toBe(true);
      // Desktop label should be visible
      expect(link.find('.add-repo-label-full').text()).toBe('Add Repository');
    });
  });

  describe('Empty State', () => {
    it('renders welcome hero with heading', async () => {
      projectsStore.projects = [];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] }
      });

      await flushAll(wrapper);

      expect(wrapper.find('.welcome-heading').text()).toBe('Welcome to Circus Chief');
    });

    it('renders three step cards', async () => {
      projectsStore.projects = [];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] }
      });

      await flushAll(wrapper);

      const steps = wrapper.findAll('.step-card');
      expect(steps).toHaveLength(3);
      expect(steps[0].text()).toContain('Pick a repo folder');
      expect(steps[1].text()).toContain('Create coding sessions');
      expect(steps[2].text()).toContain('Track changes');
    });

    it('CTA button links to /projects/new', async () => {
      projectsStore.projects = [];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] }
      });

      await flushAll(wrapper);

      const cta = wrapper.find('.cta-button');
      expect(cta.exists()).toBe(true);
      expect(cta.text()).toBe('Add Your First Repository');
      // router-link renders as <a href="...">; the 'to' prop becomes the href attribute
      expect(cta.attributes('href')).toBe('/projects/new');
    });
  });

  describe('Populated State', () => {
    it('renders project cards with name and path', async () => {
      projectsStore.projects = [
        {
          id: 'proj-1',
          name: 'my-cool-app',
          workingDirectory: '/Users/me/code/my-cool-app',
          sessionCount: 0,
          lastActivityAt: null,
        }
      ];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] }
      });

      await flushAll(wrapper);

      expect(wrapper.find('.project-name').text()).toBe('my-cool-app');
      expect(wrapper.find('.project-path').text()).toBe('/Users/me/code/my-cool-app');
    });

    it('shows session count and relative time for active projects', async () => {
      projectsStore.projects = [
        {
          id: 'proj-1',
          name: 'my-cool-app',
          workingDirectory: '/Users/me/code/my-cool-app',
          sessionCount: 5,
          lastActivityAt: Date.now() - 7200000, // 2 hours ago
        }
      ];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] }
      });

      await flushAll(wrapper);

      const meta = wrapper.find('.project-meta');
      expect(meta.exists()).toBe(true);
      expect(meta.text()).toContain('5 sessions');
    });

    it('shows edit button with desktop label', async () => {
      projectsStore.projects = [
        {
          id: 'proj-1',
          name: 'my-cool-app',
          workingDirectory: '/Users/me/code/my-cool-app',
          sessionCount: 0,
          lastActivityAt: null,
        }
      ];
      projectsStore.loading = false;
      projectsStore.error = null;

      const wrapper = mount(ProjectListView, {
        global: { plugins: [pinia, router] }
      });

      await flushAll(wrapper);

      const editBtn = wrapper.find('.edit-btn');
      expect(editBtn.exists()).toBe(true);
      expect(editBtn.find('.edit-label-full').text()).toBe('Edit');
    });
  });
});
