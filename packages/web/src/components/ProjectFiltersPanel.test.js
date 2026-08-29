import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import ProjectFiltersPanel from './ProjectFiltersPanel.vue';
import { useProjectFiltersStore } from '../stores/projectFilters.js';

function mountPanel(statusFacets = { running: 0, waiting: 0, idle: 0 }) {
  return mount(ProjectFiltersPanel, {
    props: { statusFacets },
  });
}

describe('ProjectFiltersPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('renders three filter buttons in the session-list style', () => {
    const wrapper = mountPanel({ running: 2, waiting: 1, idle: 0 });

    const buttons = wrapper.findAll('.filter-btn');
    expect(buttons).toHaveLength(3);

    const labels = buttons.map((b) => b.find('.filter-label').text());
    expect(labels).toEqual(['running', 'waiting', 'idle']);

    for (const button of buttons) {
      expect(button.find('.filter-count').exists()).toBe(true);
    }
  });

  it('renders the supplied session and project badge values', () => {
    const wrapper = mountPanel({ running: 7, waiting: 2, idle: 5 });

    const counts = wrapper.findAll('.filter-count').map((el) => el.text());
    expect(counts).toEqual(['7', '2', '5']);
  });

  it('sets the filter on click and clears it when the active pill is clicked again', async () => {
    const wrapper = mountPanel({ running: 1, waiting: 0, idle: 0 });
    const store = useProjectFiltersStore();

    await wrapper.findAll('.filter-btn')[0].trigger('click');
    expect(store.statusFilter).toBe('running');

    await wrapper.findAll('.filter-btn')[0].trigger('click');
    expect(store.statusFilter).toBeNull();
  });

  it('marks the active pill with .active', () => {
    useProjectFiltersStore().setStatusFilter('waiting');
    const wrapper = mountPanel({ running: 0, waiting: 3, idle: 0 });

    const buttons = wrapper.findAll('.filter-btn');
    expect(buttons[1].classes()).toContain('active');
    expect(buttons[0].classes()).not.toContain('active');
    expect(buttons[2].classes()).not.toContain('active');
  });

  it('marks a zero-count pill with .filter-btn-empty', () => {
    const wrapper = mountPanel({ running: 0, waiting: 4, idle: 1 });

    const buttons = wrapper.findAll('.filter-btn');
    expect(buttons[0].classes()).toContain('filter-btn-empty');
    expect(buttons[1].classes()).not.toContain('filter-btn-empty');
    expect(buttons[2].classes()).not.toContain('filter-btn-empty');
  });

  it('sets aria-label in the `${status} (${count})` format', () => {
    const wrapper = mountPanel({ running: 3, waiting: 1, idle: 9 });

    const buttons = wrapper.findAll('.filter-btn');
    expect(buttons[0].attributes('aria-label')).toBe('running (3)');
    expect(buttons[1].attributes('aria-label')).toBe('waiting (1)');
    expect(buttons[2].attributes('aria-label')).toBe('idle (9)');
  });
});
