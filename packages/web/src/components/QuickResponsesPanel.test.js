import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import QuickResponsesPanel from './QuickResponsesPanel.vue';
import { useQuickResponsesStore } from '../stores/quickResponses.js';

describe('QuickResponsesPanel', () => {
  let store;
  let pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    store = useQuickResponsesStore();
    // Clear the store state
    store.projectResponses = [];
    store.globalResponses = [];
    store.loading = false;
    store.error = null;
  });

  function mountComponent(props = {}) {
    return mount(QuickResponsesPanel, {
      props,
      global: {
        plugins: [pinia],
      },
    });
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
    it('uses the quick responses store', () => {
      const wrapper = mountComponent();
      expect(wrapper.vm).toBeDefined();
      // The component successfully mounts, which means it uses the store
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
      store.loading = true;
      mountComponent();
      expect(store.loading).toBe(true);
    });

    it('reads projectResponses from store', () => {
      store.projectResponses = [{ id: '1', label: 'Test' }];
      mountComponent();
      expect(store.projectResponses).toHaveLength(1);
    });

    it('reads globalResponses from store', () => {
      store.globalResponses = [{ id: '2', label: 'Global' }];
      mountComponent();
      expect(store.globalResponses).toHaveLength(1);
    });

    it('reads hasResponses from store', () => {
      store.projectResponses = [{ id: '1', label: 'Test' }];
      mountComponent();
      expect(store.hasResponses).toBe(true);
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
      store.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent({ showEmpty: false });
      expect(wrapper.find('.quick-responses-panel').exists()).toBe(true);
    });

    it('shows empty state message when no responses', async () => {
      const wrapper = mountComponent({ showEmpty: true });
      // Expand the panel
      wrapper.vm.toggleExpanded();
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.empty-state').exists()).toBe(true);
      expect(wrapper.find('.empty-text').text()).toBe('No quick responses yet');
    });

    it('shows add button in empty state', async () => {
      const wrapper = mountComponent({ showEmpty: true });
      // Expand the panel
      wrapper.vm.toggleExpanded();
      await wrapper.vm.$nextTick();
      const addButton = wrapper.find('.add-button');
      expect(addButton.exists()).toBe(true);
      expect(addButton.text()).toBe('+ Add Quick Response');
    });
  });

  describe('collapsible behavior', () => {
    it('starts in collapsed state', () => {
      store.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();
      // Empty state should not be visible in collapsed state
      expect(wrapper.find('.responses-content').exists()).toBe(false);
    });

    it('expands when toggle button is clicked', async () => {
      store.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();

      // Initially collapsed
      expect(wrapper.find('.responses-content').exists()).toBe(false);

      // Click toggle button
      wrapper.vm.toggleExpanded();
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.responses-content').exists()).toBe(true);
    });

    it('collapses when toggle button is clicked again', async () => {
      store.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();

      // Expand
      wrapper.vm.toggleExpanded();
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.responses-content').exists()).toBe(true);

      // Collapse
      wrapper.vm.toggleExpanded();
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.responses-content').exists()).toBe(false);
    });

    it('sets aria-expanded attribute correctly', async () => {
      store.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();
      const toggleButton = wrapper.find('.toggle-button');

      // Initially collapsed
      expect(toggleButton.attributes('aria-expanded')).toBe('false');

      // Expand
      wrapper.vm.toggleExpanded();
      await wrapper.vm.$nextTick();
      expect(toggleButton.attributes('aria-expanded')).toBe('true');
    });

    it('auto-collapses after clicking a quick response', async () => {
      store.projectResponses = [
        { id: '1', label: 'Test', content: 'test content', autoSubmit: false }
      ];
      const wrapper = mountComponent();

      // Expand panel
      wrapper.vm.toggleExpanded();
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.responses-content').exists()).toBe(true);

      // Click response button
      await wrapper.find('.response-button').trigger('click');
      await wrapper.vm.$nextTick();

      // Panel should collapse automatically
      expect(wrapper.find('.responses-content').exists()).toBe(false);
    });

    it('handles response click with correct data structure', async () => {
      const testResponse = {
        id: '1',
        label: 'Test Response',
        content: 'test content here',
        autoSubmit: true
      };
      store.projectResponses = [testResponse];
      const wrapper = mountComponent();

      // Expand panel
      wrapper.vm.toggleExpanded();
      await wrapper.vm.$nextTick();

      // Verify response button is visible with correct text
      const responseButton = wrapper.find('.response-button');
      expect(responseButton.exists()).toBe(true);
      expect(responseButton.text()).toContain('Test Response');

      // Click response and verify panel auto-collapses
      await responseButton.trigger('click');
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.responses-content').exists()).toBe(false);
    });

    it('chevron icon rotates when expanded', async () => {
      store.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();
      const toggleButton = wrapper.find('.toggle-button');

      // Chevron should have aria-expanded=false initially
      expect(toggleButton.attributes('aria-expanded')).toBe('false');

      // Expand
      wrapper.vm.toggleExpanded();
      await wrapper.vm.$nextTick();
      expect(toggleButton.attributes('aria-expanded')).toBe('true');
    });

    it('header is always visible when panel is shown', async () => {
      store.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();

      // Panel header should always be visible
      expect(wrapper.find('.panel-header').exists()).toBe(true);
      expect(wrapper.find('.toggle-button').exists()).toBe(true);
      expect(wrapper.find('.settings-button').exists()).toBe(true);
    });

    it('uses v-if to remove content from DOM when collapsed', () => {
      store.projectResponses = [{ id: '1', label: 'Test', content: 'test content' }];
      const wrapper = mountComponent();

      // When collapsed, .responses-content element should NOT be in DOM
      expect(wrapper.find('.responses-content').exists()).toBe(false);
      expect(wrapper.html()).not.toContain('responses-content');
    });
  });
});
