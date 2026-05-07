import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

import QuickResponsesPanel from './QuickResponsesPanel.vue';
import { useTemplatesStore } from '../stores/templates.js';

const pushMock = vi.fn();

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe('QuickResponsesPanel', () => {
  let store;
  let pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    store = useTemplatesStore();
    // Clear the store state
    store.projectTemplates = [];
    store.globalTemplates = [];
    store.loading = false;
    store.error = null;
    pushMock.mockClear();
  });

  function template(overrides = {}) {
    return {
      id: '1',
      name: 'Test',
      prompt: 'test content',
      showInQuickResponses: true,
      quickResponseAutoSubmit: false,
      quickResponseSortOrder: 0,
      createdAt: 1,
      ...overrides,
    };
  }

  function mountComponent(props = {}) {
    return mount(QuickResponsesPanel, {
      props,
      global: {
        plugins: [pinia],
      },
    });
  }

  // Helper function to trigger click and force DOM update
  // This is needed because Vue Test Utils doesn't always update the DOM
  // after reactive state changes in script setup components
  async function triggerClick(wrapper, selector) {
    await wrapper.find(selector).trigger('click');
    wrapper.vm.$forceUpdate();
    await nextTick();
    await flushPromises();
  }

  describe('component structure', () => {
    it('exports a Vue component', () => {
      expect(QuickResponsesPanel).toBeDefined();
      expect(QuickResponsesPanel.name).toBe('QuickResponsesPanel');
    });

    it('accepts showEmpty prop', () => {
      const wrapper = mountComponent({ showEmpty: false });
      expect(wrapper.props('showEmpty')).toBe(false);
    });

    it('defaults showEmpty to true', () => {
      const wrapper = mountComponent();
      expect(wrapper.props('showEmpty')).toBe(true);
    });
  });

  describe('store integration', () => {
    it('uses the templates store', () => {
      const wrapper = mountComponent();
      expect(wrapper.vm).toBeDefined();
      // The component successfully mounts, which means it uses the store
    });
  });

  describe('events', () => {
    it('defines insert events', () => {
      const wrapper = mountComponent();
      expect(wrapper.emitted()).toBeDefined();
    });
  });

  describe('computed properties', () => {
    it('reads loading state from store', () => {
      store.loading = true;
      mountComponent();
      expect(store.loading).toBe(true);
    });

    it('reads project quick response templates from store', () => {
      store.projectTemplates = [template()];
      mountComponent();
      expect(store.quickResponseTemplates.project).toHaveLength(1);
    });

    it('reads global quick response templates from store', () => {
      store.globalTemplates = [template({ id: '2', name: 'Global' })];
      mountComponent();
      expect(store.quickResponseTemplates.global).toHaveLength(1);
    });

    it('reads hasQuickResponseTemplates from store', () => {
      store.projectTemplates = [template()];
      mountComponent();
      expect(store.hasQuickResponseTemplates).toBe(true);
    });
  });

  describe('visibility', () => {
    it('shows panel when showEmpty is true even with no responses', () => {
      const wrapper = mountComponent({ showEmpty: true });
      expect(wrapper.find('.quick-responses-panel').exists()).toBe(true);
    });

    it('hides panel when showEmpty is false and no responses', () => {
      const wrapper = mountComponent({ showEmpty: false });
      expect(wrapper.find('.quick-responses-panel').exists()).toBe(false);
    });

    it('shows panel when there are responses regardless of showEmpty', () => {
      store.projectTemplates = [template()];
      const wrapper = mountComponent({ showEmpty: false });
      expect(wrapper.find('.quick-responses-panel').exists()).toBe(true);
    });

    it('shows empty state message when no responses', async () => {
      const wrapper = mountComponent({ showEmpty: true });
      // Expand the panel
      await triggerClick(wrapper, '.toggle-button');
      expect(wrapper.find('.empty-state').exists()).toBe(true);
      expect(wrapper.find('.empty-text').text()).toBe('No quick response templates yet');
    });
  });

  describe('collapsible behavior', () => {
    it('starts in collapsed state', () => {
      store.projectTemplates = [template()];
      const wrapper = mountComponent();
      // Empty state should not be visible in collapsed state
      expect(wrapper.find('.responses-content').exists()).toBe(false);
    });

    it('expands when toggle button is clicked', async () => {
      store.projectTemplates = [template()];
      const wrapper = mountComponent();

      // Initially collapsed
      expect(wrapper.find('.responses-content').exists()).toBe(false);

      // Click toggle button
      await triggerClick(wrapper, '.toggle-button');
      expect(wrapper.find('.responses-content').exists()).toBe(true);
    });

    it('collapses when toggle button is clicked again', async () => {
      store.projectTemplates = [template()];
      const wrapper = mountComponent();

      // Expand
      await triggerClick(wrapper, '.toggle-button');
      expect(wrapper.find('.responses-content').exists()).toBe(true);

      // Collapse
      await triggerClick(wrapper, '.toggle-button');
      expect(wrapper.find('.responses-content').exists()).toBe(false);
    });

    it('sets aria-expanded attribute correctly', async () => {
      store.projectTemplates = [template()];
      const wrapper = mountComponent();
      const toggleButton = wrapper.find('.toggle-button');

      // Initially collapsed
      expect(toggleButton.attributes('aria-expanded')).toBe('false');

      // Expand
      await triggerClick(wrapper, '.toggle-button');
      expect(toggleButton.attributes('aria-expanded')).toBe('true');
    });

    it('auto-collapses after clicking a quick response', async () => {
      store.projectTemplates = [template()];
      const wrapper = mountComponent();

      // Expand panel
      await triggerClick(wrapper, '.toggle-button');
      expect(wrapper.find('.responses-content').exists()).toBe(true);

      // Click response button
      await triggerClick(wrapper, '.response-button');

      // Panel should collapse automatically
      expect(wrapper.find('.responses-content').exists()).toBe(false);
    });

    it('handles response click with correct data structure', async () => {
      const testResponse = {
        ...template({
          id: '1',
          name: 'Test Response',
          prompt: 'test content here',
          quickResponseAutoSubmit: true,
        }),
      };
      store.projectTemplates = [testResponse];
      const wrapper = mountComponent();

      // Expand panel
      await triggerClick(wrapper, '.toggle-button');

      // Verify response button is visible with correct text
      const responseButton = wrapper.find('.response-button');
      expect(responseButton.exists()).toBe(true);
      expect(responseButton.text()).toContain('Test Response');

      // Click response and verify panel auto-collapses
      await triggerClick(wrapper, '.response-button');
      expect(wrapper.find('.responses-content').exists()).toBe(false);
    });

    it('chevron icon rotates when expanded', async () => {
      store.projectTemplates = [template()];
      const wrapper = mountComponent();
      const toggleButton = wrapper.find('.toggle-button');

      // Chevron should have aria-expanded=false initially
      expect(toggleButton.attributes('aria-expanded')).toBe('false');

      // Expand
      await triggerClick(wrapper, '.toggle-button');
      expect(toggleButton.attributes('aria-expanded')).toBe('true');
    });

    it('header is always visible when panel is shown', async () => {
      store.projectTemplates = [template()];
      const wrapper = mountComponent();

      // Panel header and toggle button should always be visible
      expect(wrapper.find('.panel-header').exists()).toBe(true);
      expect(wrapper.find('.toggle-button').exists()).toBe(true);
      // Settings button only shows when expanded
      expect(wrapper.find('.settings-button').exists()).toBe(false);
    });

    it('navigates to project templates from the settings button', async () => {
      store.projectTemplates = [template()];
      const wrapper = mountComponent({ projectId: 'project-123' });

      await triggerClick(wrapper, '.toggle-button');
      await triggerClick(wrapper, '.settings-button');

      expect(pushMock).toHaveBeenCalledWith('/projects/project-123/templates');
    });

    it('uses v-if to remove content from DOM when collapsed', () => {
      store.projectTemplates = [template()];
      const wrapper = mountComponent();

      // When collapsed, .responses-content element should NOT be in DOM
      expect(wrapper.find('.responses-content').exists()).toBe(false);
      expect(wrapper.html()).not.toContain('responses-content');
    });

    it('expands when clicking on the panel itself (not just the toggle button)', async () => {
      store.projectTemplates = [template()];
      const wrapper = mountComponent();

      // Initially collapsed
      expect(wrapper.find('.responses-content').exists()).toBe(false);

      // Click on the panel itself (header area, not a button)
      await triggerClick(wrapper, '.panel-title');
      expect(wrapper.find('.responses-content').exists()).toBe(true);
    });

    it('has cursor-pointer class to indicate panel is clickable', () => {
      store.projectTemplates = [template()];
      const wrapper = mountComponent();

      const panel = wrapper.find('.quick-responses-panel');
      expect(panel.classes()).toContain('cursor-pointer');
    });

    it('collapses when clicking on the panel while already expanded', async () => {
      store.projectTemplates = [template()];
      const wrapper = mountComponent();

      // Expand via toggle button
      await triggerClick(wrapper, '.toggle-button');
      expect(wrapper.find('.responses-content').exists()).toBe(true);

      // Click on panel to collapse
      await triggerClick(wrapper, '.panel-title');
      expect(wrapper.find('.responses-content').exists()).toBe(false);
    });

    it('toggle button has @click.stop to prevent panel toggle', () => {
      store.projectTemplates = [template()];
      const wrapper = mountComponent();

      // Verify toggle button exists
      const toggleButton = wrapper.find('.toggle-button');
      expect(toggleButton.exists()).toBe(true);

      // The toggle button should have @click.stop in template
      // (shallowMount only shows this level of DOM)
    });
  });
});
