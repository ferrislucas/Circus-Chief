import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import ProjectNewView from './ProjectNewView.vue';
import { useProjectsStore } from '../stores/projects.js';

// Mock components
vi.mock('../components/PathChooser.vue', () => ({
  default: {
    name: 'PathChooser',
    template: '<input class="path-chooser-mock" />',
    props: ['modelValue'],
    emits: ['update:modelValue'],
  }
}));

vi.mock('@circuschief/shared/constants', () => ({
  DEFAULT_SYSTEM_PROMPT: 'You are Claude Code, an AI coding assistant.',
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

describe('ProjectNewView', () => {
  let pinia;
  let router;
  let projectsStore;
  let uiStore;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/projects/new', component: ProjectNewView },
        { path: '/', component: { template: '<div></div>' } },
        { path: '/projects/:id/sessions', component: { template: '<div></div>' } },
      ]
    });

    projectsStore = useProjectsStore();
    vi.spyOn(projectsStore, 'createProject').mockResolvedValue({
      id: 'proj-1',
      name: 'test-app',
      workingDirectory: '/tmp/test-app',
    });

    // Mock UI store
    // eslint-disable-next-line no-undef
    const { useUiStore } = require('../stores/ui.js');
    uiStore = useUiStore();
    vi.spyOn(uiStore, 'success').mockImplementation(() => {});
  });

  describe('Page Title and Labels', () => {
    it('displays "Add a Repository" as page title', async () => {
      await router.push('/projects/new');
      await router.isReady();

      const wrapper = mount(ProjectNewView, {
        global: { plugins: [pinia, router] }
      });

      await flushAll(wrapper);

      expect(wrapper.find('h1').text()).toBe('Add a Repository');
    });

    it('shows "Repository Folder" label', async () => {
      await router.push('/projects/new');
      await router.isReady();

      const wrapper = mount(ProjectNewView, {
        global: { plugins: [pinia, router] }
      });

      await flushAll(wrapper);

      const text = wrapper.text();
      expect(text).toContain('Repository Folder');
    });

    it('shows "Display Name" label', async () => {
      await router.push('/projects/new');
      await router.isReady();

      const wrapper = mount(ProjectNewView, {
        global: { plugins: [pinia, router] }
      });

      await flushAll(wrapper);

      const text = wrapper.text();
      expect(text).toContain('Display Name');
    });

    it('submit button says "Add Repository"', async () => {
      await router.push('/projects/new');
      await router.isReady();

      const wrapper = mount(ProjectNewView, {
        global: { plugins: [pinia, router] }
      });

      await flushAll(wrapper);

      const submitBtn = wrapper.find('button[type="submit"]');
      expect(submitBtn.text()).toContain('Add Repository');
    });
  });

  describe('Auto-fill Name from Path', () => {
    it('auto-fills name from path', async () => {
      await router.push('/projects/new');
      await router.isReady();

      const wrapper = mount(ProjectNewView, {
        global: { plugins: [pinia, router] }
      });

      await flushAll(wrapper);

      // Simulate setting the working directory
      wrapper.vm.workingDirectory = '/Users/me/code/my-app';
      await flushAll(wrapper);

      expect(wrapper.vm.name).toBe('my-app');
    });

    it('stops auto-filling after manual name edit', async () => {
      await router.push('/projects/new');
      await router.isReady();

      const wrapper = mount(ProjectNewView, {
        global: { plugins: [pinia, router] }
      });

      await flushAll(wrapper);

      // Simulate manual name edit
      wrapper.vm.name = 'custom-name';
      wrapper.vm.onNameInput();
      await flushAll(wrapper);

      // Now change the path - name should NOT update
      wrapper.vm.workingDirectory = '/Users/me/code/different-app';
      await flushAll(wrapper);

      expect(wrapper.vm.name).toBe('custom-name');
    });
  });

  describe('Form Submission', () => {
    it('shows success toast "Repository added" on submit', async () => {
      await router.push('/projects/new');
      await router.isReady();

      const wrapper = mount(ProjectNewView, {
        global: { plugins: [pinia, router] }
      });

      await flushAll(wrapper);

      // Set form values
      wrapper.vm.name = 'test-app';
      wrapper.vm.workingDirectory = '/tmp/test-app';
      await flushAll(wrapper);

      // Submit form
      const form = wrapper.find('form');
      await form.trigger('submit');
      await flushAll(wrapper);

      expect(uiStore.success).toHaveBeenCalledWith('Repository added');
    });
  });
});
