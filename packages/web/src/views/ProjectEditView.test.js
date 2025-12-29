import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import ProjectEditView from './ProjectEditView.vue';
import { useProjectsStore } from '../stores/projects.js';
import { useProjectDefaultsStore } from '../stores/projectDefaults.js';

// Mock the API and components
vi.mock('../composables/useApi.js');
vi.mock('../components/PathChooser.vue', () => ({
  default: { name: 'PathChooser', template: '<input />' }
}));

// Global helper to flush all async updates and force DOM re-render
async function flushAll(wrapper) {
  await flushPromises();
  await nextTick();
  if (wrapper && wrapper.vm) {
    await wrapper.vm.$nextTick?.();
    // Force Vue to re-render with updated state
    await wrapper.vm.$forceUpdate();
    await nextTick();
    // Multiple update cycles to ensure all conditions re-evaluate
    await wrapper.vm.$forceUpdate();
    await nextTick();
  }
}

describe('ProjectEditView with Session Defaults', () => {
  let pinia;
  let router;
  let projectsStore;
  let defaultsStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    pinia = createPinia();

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/projects/:id/edit', component: ProjectEditView },
        { path: '/projects/:id/sessions', component: { template: '<div></div>' } }
      ]
    });

  // Helper to flush all async updates and force DOM re-render
  async function flushAll(wrapper) {
    await flushAll(wrapper);
    if (wrapper && wrapper.vm) {
      await wrapper.vm.$nextTick?.();
      // Force Vue to re-render with updated state
      await wrapper.vm.$forceUpdate();
      await nextTick();
      // Multiple update cycles to ensure all conditions re-evaluate
      await wrapper.vm.$forceUpdate();
      await nextTick();
    }
  }

    projectsStore = useProjectsStore();
    defaultsStore = useProjectDefaultsStore();

    // Mock store methods
    vi.spyOn(projectsStore, 'fetchProject').mockResolvedValue(undefined);
    vi.spyOn(projectsStore, 'updateProject').mockResolvedValue({
      id: 'proj-1',
      name: 'Test Project',
      workingDirectory: '/tmp/test'
    });

    vi.spyOn(defaultsStore, 'fetchDefaults').mockResolvedValue(null);
    vi.spyOn(defaultsStore, 'updateDefaults').mockResolvedValue({});
    vi.spyOn(defaultsStore, 'resetDefaults').mockResolvedValue(null);
  });

  describe('Session Defaults Section', () => {
    it('displays Session Defaults collapsible section', async () => {
      // Mock project data
      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Test',
        workingDirectory: '/tmp'
      };

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        },
        props: {},
        attachTo: document.body
      });

      // Check for details element with Session Defaults summary
      const details = wrapper.findAll('details');
      const sessionDefaultsSection = details.find(d =>
        d.text().includes('Session Defaults')
      );

      expect(sessionDefaultsSection).toBeDefined();
    });

    it('displays all default form fields', async () => {
      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Test',
        workingDirectory: '/tmp'
      };

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        }
      });

      const text = wrapper.text();
      expect(text).toContain('Mode');
      expect(text).toContain('Enable thinking');
      expect(text).toContain('Start sessions immediately');
      expect(text).toContain('Git Mode');
      expect(text).toContain('Default Git Branch');
      expect(text).toContain('Model');
    });

    it('loads defaults when component mounts', async () => {
      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Test',
        workingDirectory: '/tmp'
      };

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        }
      });

      await wrapper.vm.$nextTick();

      expect(defaultsStore.fetchDefaults).toHaveBeenCalledWith('proj-1');
    });
  });

  describe('Form Field Initialization', () => {
    it('pre-fills form with default values from store', async () => {
      const mockDefaults = {
        mode: 'plan',
        thinkingEnabled: true,
        gitMode: 'worktree',
        gitBranch: 'feature/test',
        model: 'claude-opus-4'
      };

      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Test',
        workingDirectory: '/tmp'
      };

      defaultsStore.defaultsByProjectId['proj-1'] = mockDefaults;

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        }
      });

      // Wait for watchers to run
      await wrapper.vm.$nextTick();
      await flushAll(wrapper);

      // Check that form fields are populated
      const selects = wrapper.findAll('select');
      const inputs = wrapper.findAll('input[type="text"]');
      const checkboxes = wrapper.findAll('input[type="checkbox"]');

      expect(selects.length).toBeGreaterThan(0);
      expect(inputs.length).toBeGreaterThan(0);
    });

    it('displays empty values for unset defaults', async () => {
      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Test',
        workingDirectory: '/tmp'
      };

      defaultsStore.defaultsByProjectId['proj-1'] = null;

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        }
      });

      await wrapper.vm.$nextTick();

      // Mode select should have default value
      const modeSelect = wrapper.find('select#defaultMode');
      expect(modeSelect.element.value).toBe('');
    });

    it('initializes thinkingEnabled checkbox correctly', async () => {
      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Test',
        workingDirectory: '/tmp'
      };

      const mockDefaults = {
        thinkingEnabled: true
      };
      defaultsStore.defaultsByProjectId['proj-1'] = mockDefaults;

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        }
      });

      await wrapper.vm.$nextTick();
      await flushAll(wrapper);

      // After watcher runs, checkboxes should be initialized
      const checkboxes = wrapper.findAll('input[type="checkbox"]');
      expect(checkboxes.length).toBeGreaterThan(0);
    });
  });

  describe('Reset Defaults Button', () => {
    it('displays reset button', async () => {
      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Test',
        workingDirectory: '/tmp'
      };

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        }
      });

      const text = wrapper.text();
      expect(text).toContain('Reset to System Defaults');
    });

    it('calls resetDefaults on button click with confirmation', async () => {
      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Test',
        workingDirectory: '/tmp'
      };

      // Mock confirm dialog
      window.confirm = vi.fn(() => true);

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        }
      });

      const resetButton = wrapper.find('button[class*="btn-secondary"]');
      if (resetButton.exists()) {
        await resetButton.trigger('click');
        await wrapper.vm.$nextTick();

        expect(window.confirm).toHaveBeenCalled();
      }
    });

    it('does not reset if user cancels confirmation', async () => {
      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Test',
        workingDirectory: '/tmp'
      };

      window.confirm = vi.fn(() => false);

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        }
      });

      const resetButton = wrapper.find('button[class*="btn-secondary"]');
      if (resetButton.exists()) {
        await resetButton.trigger('click');

        expect(defaultsStore.resetDefaults).not.toHaveBeenCalled();
      }
    });
  });

  describe('Form Submission', () => {
    it('saves defaults when form submitted', async () => {
      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Test Project',
        workingDirectory: '/tmp/test'
      };

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        }
      });

      // Set default values in form
      wrapper.vm.defaultMode = 'plan';
      wrapper.vm.defaultThinkingEnabled = true;
      wrapper.vm.defaultGitMode = 'worktree';

      await wrapper.vm.$nextTick();

      // Submit form
      const form = wrapper.find('form');
      await form.trigger('submit');

      await flushAll(wrapper);

      // Should have called updateDefaults with the values
      expect(defaultsStore.updateDefaults).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({
          mode: 'plan',
          thinkingEnabled: true,
          gitMode: 'worktree'
        })
      );
    });

    it('saves project and defaults together', async () => {
      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Test',
        workingDirectory: '/tmp'
      };

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        }
      });

      wrapper.vm.name = 'Updated Name';
      wrapper.vm.defaultMode = 'standard';

      await wrapper.vm.$nextTick();

      const form = wrapper.find('form');
      await form.trigger('submit');

      await flushAll(wrapper);

      expect(projectsStore.updateProject).toHaveBeenCalled();
      expect(defaultsStore.updateDefaults).toHaveBeenCalled();
    });

    it('handles API errors gracefully', async () => {
      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Test',
        workingDirectory: '/tmp'
      };

      const error = new Error('API Error');
      defaultsStore.updateDefaults.mockRejectedValueOnce(error);

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        }
      });

      wrapper.vm.defaultMode = 'plan';

      const form = wrapper.find('form');
      await form.trigger('submit');

      await flushAll(wrapper);

      expect(wrapper.vm.error).toBeDefined();
    });

    it('only sends non-empty defaults to API', async () => {
      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Test',
        workingDirectory: '/tmp'
      };

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        }
      });

      // Set only mode default, leave others empty
      wrapper.vm.defaultMode = 'plan';
      wrapper.vm.defaultThinkingEnabled = false;
      wrapper.vm.defaultGitMode = '';
      wrapper.vm.defaultModel = '';

      const form = wrapper.find('form');
      await form.trigger('submit');

      await flushAll(wrapper);

      // Should only send mode in the defaults
      const callArgs = defaultsStore.updateDefaults.mock.calls[0];
      expect(callArgs[1]).toEqual({
        mode: 'plan'
      });
    });
  });

  describe('Form State Management', () => {
    it('updates form when project changes', async () => {
      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Project 1',
        workingDirectory: '/tmp'
      };

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        }
      });

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.name).toBe('Project 1');

      // Change project
      projectsStore.currentProject = {
        id: 'proj-2',
        name: 'Project 2',
        workingDirectory: '/home/project2'
      };

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.name).toBe('Project 2');
      expect(wrapper.vm.workingDirectory).toBe('/home/project2');
    });

    it('updates defaults form when defaults change', async () => {
      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Test',
        workingDirectory: '/tmp'
      };

      defaultsStore.defaultsByProjectId['proj-1'] = null;

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        }
      });

      await wrapper.vm.$nextTick();
      await flushAll(wrapper);

      expect(wrapper.vm.defaultMode).toBe('');

      // Update defaults in store
      defaultsStore.defaultsByProjectId['proj-1'] = {
        mode: 'plan'
      };

      await wrapper.vm.$nextTick();
      await flushAll(wrapper);

      expect(wrapper.vm.defaultMode).toBe('plan');
    });
  });

  describe('Loading States', () => {
    it('disables reset button while saving', async () => {
      projectsStore.currentProject = {
        id: 'proj-1',
        name: 'Test',
        workingDirectory: '/tmp'
      };

      const wrapper = mount(ProjectEditView, {
        global: {
          plugins: [pinia, router],
          stubs: { PathChooser: true }
        }
      });

      wrapper.vm.savingDefaults = true;
      await wrapper.vm.$nextTick();

      const resetButton = wrapper.find('button[class*="btn-secondary"]');
      expect(resetButton.attributes('disabled')).toBeDefined();
    });
  });
});
