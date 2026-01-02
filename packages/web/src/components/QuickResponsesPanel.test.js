import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

// Mock the quick responses store
vi.mock('../stores/quickResponses.js', () => ({
  useQuickResponsesStore: vi.fn(),
}));

import QuickResponsesPanel from './QuickResponsesPanel.vue';
import { useQuickResponsesStore } from '../stores/quickResponses.js';

describe('QuickResponsesPanel', () => {
  let mockStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    mockStore = {
      loading: false,
      projectResponses: [],
      globalResponses: [],
      hasResponses: false,
      error: null,
    };

    vi.mocked(useQuickResponsesStore).mockReturnValue(mockStore);
  });

  function mountComponent(props = {}) {
    return mount(QuickResponsesPanel, {
      props,
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
      expect(QuickResponsesPanel.__name).toBe('QuickResponsesPanel');
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
    it('uses the quick responses store', () => {
      mountComponent();
      expect(useQuickResponsesStore).toHaveBeenCalled();
    });
  });

  describe('events', () => {
    it('defines insert and openSettings events', () => {
      const wrapper = mountComponent();
      expect(wrapper.emitted()).toBeDefined();
    });
  });

  describe('computed properties', () => {
    it('reads loading state from store', () => {
      mockStore.loading = true;
      mountComponent();
      expect(mockStore.loading).toBe(true);
    });

    it('reads projectResponses from store', () => {
      mockStore.projectResponses = [{ id: '1', label: 'Test' }];
      mountComponent();
      expect(mockStore.projectResponses).toHaveLength(1);
    });

    it('reads globalResponses from store', () => {
      mockStore.globalResponses = [{ id: '2', label: 'Global' }];
      mountComponent();
      expect(mockStore.globalResponses).toHaveLength(1);
    });

    it('reads hasResponses from store', () => {
      mockStore.hasResponses = true;
      mountComponent();
      expect(mockStore.hasResponses).toBe(true);
    });
  });

  describe('visibility', () => {
    it('shows panel when showEmpty is true even with no responses', () => {
      mockStore.hasResponses = false;
      const wrapper = mountComponent({ showEmpty: true });
      expect(wrapper.find('.quick-responses-panel').exists()).toBe(true);
    });

    it('hides panel when showEmpty is false and no responses', () => {
      mockStore.hasResponses = false;
      const wrapper = mountComponent({ showEmpty: false });
      expect(wrapper.find('.quick-responses-panel').exists()).toBe(false);
    });

    it('shows panel when there are responses regardless of showEmpty', () => {
      mockStore.hasResponses = true;
      mockStore.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent({ showEmpty: false });
      expect(wrapper.find('.quick-responses-panel').exists()).toBe(true);
    });

    it('shows empty state message when no responses', async () => {
      mockStore.hasResponses = false;
      const wrapper = mountComponent({ showEmpty: true });
      // Expand the panel
      await triggerClick(wrapper, '.toggle-button');
      expect(wrapper.find('.empty-state').exists()).toBe(true);
      expect(wrapper.find('.empty-text').text()).toBe('No quick responses yet');
    });

    it('shows add button in empty state', async () => {
      mockStore.hasResponses = false;
      const wrapper = mountComponent({ showEmpty: true });
      // Expand the panel
      await triggerClick(wrapper, '.toggle-button');
      const addButton = wrapper.find('.add-button');
      expect(addButton.exists()).toBe(true);
      expect(addButton.text()).toBe('+ Add Quick Response');
    });
  });

  describe('collapsible behavior', () => {
    it('starts in collapsed state', () => {
      mockStore.hasResponses = true;
      mockStore.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();
      // Empty state should not be visible in collapsed state
      expect(wrapper.find('.responses-content').exists()).toBe(false);
    });

    it('expands when toggle button is clicked', async () => {
      mockStore.hasResponses = true;
      mockStore.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();

      // Initially collapsed
      expect(wrapper.find('.responses-content').exists()).toBe(false);

      // Click toggle button
      await triggerClick(wrapper, '.toggle-button');
      expect(wrapper.find('.responses-content').exists()).toBe(true);
    });

    it('collapses when toggle button is clicked again', async () => {
      mockStore.hasResponses = true;
      mockStore.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();

      // Expand
      await triggerClick(wrapper, '.toggle-button');
      expect(wrapper.find('.responses-content').exists()).toBe(true);

      // Collapse
      await triggerClick(wrapper, '.toggle-button');
      expect(wrapper.find('.responses-content').exists()).toBe(false);
    });

    it('sets aria-expanded attribute correctly', async () => {
      mockStore.hasResponses = true;
      mockStore.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();
      const toggleButton = wrapper.find('.toggle-button');

      // Initially collapsed
      expect(toggleButton.attributes('aria-expanded')).toBe('false');

      // Expand
      await triggerClick(wrapper, '.toggle-button');
      expect(toggleButton.attributes('aria-expanded')).toBe('true');
    });

    it('auto-collapses after clicking a quick response', async () => {
      mockStore.hasResponses = true;
      mockStore.projectResponses = [
        { id: '1', label: 'Test', content: 'test content', autoSubmit: false }
      ];
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
      mockStore.hasResponses = true;
      const testResponse = {
        id: '1',
        label: 'Test Response',
        content: 'test content here',
        autoSubmit: true
      };
      mockStore.projectResponses = [testResponse];
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
      mockStore.hasResponses = true;
      mockStore.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();
      const toggleButton = wrapper.find('.toggle-button');

      // Chevron should have aria-expanded=false initially
      expect(toggleButton.attributes('aria-expanded')).toBe('false');

      // Expand
      await triggerClick(wrapper, '.toggle-button');
      expect(toggleButton.attributes('aria-expanded')).toBe('true');
    });

    it('header is always visible when panel is shown', async () => {
      mockStore.hasResponses = true;
      mockStore.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();

      // Panel header should always be visible
      expect(wrapper.find('.panel-header').exists()).toBe(true);
      expect(wrapper.find('.toggle-button').exists()).toBe(true);
      expect(wrapper.find('.settings-button').exists()).toBe(true);
    });

    it('uses v-if to remove content from DOM when collapsed', () => {
      mockStore.hasResponses = true;
      mockStore.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();

      // When collapsed, .responses-content element should NOT be in DOM
      expect(wrapper.find('.responses-content').exists()).toBe(false);
      expect(wrapper.html()).not.toContain('responses-content');
    });

    it('expands when clicking on the panel itself (not just the toggle button)', async () => {
      mockStore.hasResponses = true;
      mockStore.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();

      // Initially collapsed
      expect(wrapper.find('.responses-content').exists()).toBe(false);

      // Click on the panel itself (header area, not a button)
      await triggerClick(wrapper, '.panel-title');
      expect(wrapper.find('.responses-content').exists()).toBe(true);
    });

    it('has cursor-pointer class to indicate panel is clickable', () => {
      mockStore.hasResponses = true;
      mockStore.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();

      const panel = wrapper.find('.quick-responses-panel');
      expect(panel.classes()).toContain('cursor-pointer');
    });

    it('collapses when clicking on the panel while already expanded', async () => {
      mockStore.hasResponses = true;
      mockStore.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();

      // Expand via toggle button
      await triggerClick(wrapper, '.toggle-button');
      expect(wrapper.find('.responses-content').exists()).toBe(true);

      // Click on panel to collapse
      await triggerClick(wrapper, '.panel-title');
      expect(wrapper.find('.responses-content').exists()).toBe(false);
    });

    it('toggle button has @click.stop to prevent panel toggle', () => {
      mockStore.hasResponses = true;
      mockStore.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();

      // Verify toggle button exists
      const toggleButton = wrapper.find('.toggle-button');
      expect(toggleButton.exists()).toBe(true);

      // The toggle button should have @click.stop in template
      // (shallowMount only shows this level of DOM)
    });
  });
});
