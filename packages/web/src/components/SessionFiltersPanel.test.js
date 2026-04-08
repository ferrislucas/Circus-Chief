import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';

// Mock the sessions store
const mockSessionsStore = reactive({
  statusFilter: null,
  starredFilter: null,
  scheduledFilter: null,
});

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(() => mockSessionsStore),
}));

// Mock the useSessionFiltering composable
const mockToggleFilter = vi.fn();
const mockToggleStarFilterIcon = vi.fn();
const mockToggleScheduledFilterIcon = vi.fn();

vi.mock('../composables/useSessionFiltering.js', () => ({
  useSessionFiltering: vi.fn(() => ({
    toggleFilter: mockToggleFilter,
    toggleStarFilterIcon: mockToggleStarFilterIcon,
    starFilterTooltip: 'Test star tooltip',
    toggleScheduledFilterIcon: mockToggleScheduledFilterIcon,
    scheduledFilterTooltip: 'Test scheduled tooltip',
    statusFilterCounts: { running: 0, idle: 0 },
  })),
}));

import SessionFiltersPanel from './SessionFiltersPanel.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useSessionFiltering } from '../composables/useSessionFiltering.js';

describe('SessionFiltersPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Reset store state
    mockSessionsStore.statusFilter = null;
    mockSessionsStore.starredFilter = null;
    mockSessionsStore.scheduledFilter = null;

    // Reset mock functions
    mockToggleFilter.mockReset();
    mockToggleStarFilterIcon.mockReset();
    mockToggleScheduledFilterIcon.mockReset();
  });

  function mountComponent(props = {}) {
    return mount(SessionFiltersPanel, {
      props: {
        showStatusFilters: true,
        showScheduledFilter: true,
        ...props,
      },
      global: {
        stubs: {},
      },
    });
  }

  describe('component structure', () => {
    it('exports a Vue component', () => {
      expect(SessionFiltersPanel).toBeDefined();
      expect(SessionFiltersPanel.__name).toBe('SessionFiltersPanel');
    });

    it('has optional props', () => {
      expect(SessionFiltersPanel.props).toBeDefined();
      expect(SessionFiltersPanel.props.showStatusFilters).toBeDefined();
      expect(SessionFiltersPanel.props.showScheduledFilter).toBeDefined();
    });

    it('showStatusFilters defaults to true', () => {
      expect(SessionFiltersPanel.props.showStatusFilters.default).toBe(true);
    });

    it('showScheduledFilter defaults to true', () => {
      expect(SessionFiltersPanel.props.showScheduledFilter.default).toBe(true);
    });
  });

  describe('status filters', () => {
    it('shows status filter buttons when showStatusFilters is true', () => {
      const wrapper = mountComponent({
        showStatusFilters: true,
      });

      const buttons = wrapper.findAll('.filter-btn');
      const statusButtons = buttons.filter(btn => {
        const label = btn.find('.filter-label');
        return label.exists() && (label.text() === 'running' || label.text() === 'idle');
      });

      expect(statusButtons).toHaveLength(2);
    });

    it('does not show status filter buttons when showStatusFilters is false', () => {
      const wrapper = mountComponent({
        showStatusFilters: false,
      });

      const buttons = wrapper.findAll('.filter-btn');
      const statusButtons = buttons.filter(btn => {
        const label = btn.find('.filter-label');
        return label.exists() && (label.text() === 'running' || label.text() === 'idle');
      });

      expect(statusButtons).toHaveLength(0);
    });

    it('applies active class when status filter is active', async () => {
      mockSessionsStore.statusFilter = 'running';

      const wrapper = mountComponent();

      const runningButton = wrapper.findAll('.filter-btn').find(btn => {
        const label = btn.find('.filter-label');
        return label.exists() && label.text() === 'running';
      });
      expect(runningButton.classes()).toContain('active');
    });

    it('calls toggleFilter when status button clicked', async () => {
      const wrapper = mountComponent();

      const runningButton = wrapper.findAll('.filter-btn').find(btn => {
        const label = btn.find('.filter-label');
        return label.exists() && label.text() === 'running';
      });
      await runningButton.trigger('click');

      expect(mockToggleFilter).toHaveBeenCalledWith('running');
    });
  });

  describe('star filter', () => {
    it('always shows star filter button', () => {
      const wrapper = mountComponent({
        showStatusFilters: false,
        showScheduledFilter: false,
      });

      expect(wrapper.find('.star-btn').exists()).toBe(true);
    });

    it('shows star icon when starredFilter is null', () => {
      mockSessionsStore.starredFilter = null;

      const wrapper = mountComponent();

      const starButton = wrapper.find('.star-btn');
      expect(starButton.classes()).toContain('star-filter-all');
      expect(starButton.find('.star-icon').text()).toBe('☆');
    });

    it('shows filled star when starredFilter is starred', () => {
      mockSessionsStore.starredFilter = 'starred';

      const wrapper = mountComponent();

      const starButton = wrapper.find('.star-btn');
      expect(starButton.classes()).toContain('star-filter-active');
      expect(starButton.find('.star-icon').text()).toBe('⭐');
    });

    it('shows crossed star when starredFilter is unstarred', () => {
      mockSessionsStore.starredFilter = 'unstarred';

      const wrapper = mountComponent();

      const starButton = wrapper.find('.star-btn');
      expect(starButton.classes()).toContain('star-filter-unstarred');
      expect(starButton.find('.star-icon').text()).toBe('⭐');
      expect(starButton.find('.star-crossed').exists()).toBe(true);
    });

    it('has correct tooltip', () => {
      const wrapper = mountComponent();

      const starButton = wrapper.find('.star-btn');
      expect(starButton.attributes('title')).toBe('Test star tooltip');
    });

    it('calls toggleStarFilterIcon when clicked', async () => {
      const wrapper = mountComponent();

      const starButton = wrapper.find('.star-btn');
      await starButton.trigger('click');

      expect(mockToggleStarFilterIcon).toHaveBeenCalled();
    });
  });

  describe('scheduled filter', () => {
    it('shows scheduled filter button when showScheduledFilter is true', () => {
      const wrapper = mountComponent({
        showScheduledFilter: true,
      });

      expect(wrapper.find('.schedule-btn').exists()).toBe(true);
    });

    it('does not show scheduled filter button when showScheduledFilter is false', () => {
      const wrapper = mountComponent({
        showScheduledFilter: false,
      });

      expect(wrapper.find('.schedule-btn').exists()).toBe(false);
    });

    it('shows clock icon when scheduledFilter is null', () => {
      mockSessionsStore.scheduledFilter = null;

      const wrapper = mountComponent({
        showScheduledFilter: true,
      });

      const scheduleButton = wrapper.find('.schedule-btn');
      expect(scheduleButton.classes()).toContain('schedule-filter-all');
      expect(scheduleButton.find('.schedule-icon').text()).toBe('⏰');
    });

    it('shows filled clock when scheduledFilter is scheduled', () => {
      mockSessionsStore.scheduledFilter = 'scheduled';

      const wrapper = mountComponent({
        showScheduledFilter: true,
      });

      const scheduleButton = wrapper.find('.schedule-btn');
      expect(scheduleButton.classes()).toContain('schedule-filter-active');
      expect(scheduleButton.find('.schedule-icon').text()).toBe('⏰');
    });

    it('shows crossed clock when scheduledFilter is not-scheduled', () => {
      mockSessionsStore.scheduledFilter = 'not-scheduled';

      const wrapper = mountComponent({
        showScheduledFilter: true,
      });

      const scheduleButton = wrapper.find('.schedule-btn');
      expect(scheduleButton.classes()).toContain('schedule-filter-not-scheduled');
      expect(scheduleButton.find('.schedule-icon').text()).toBe('⏰');
      expect(scheduleButton.find('.schedule-crossed').exists()).toBe(true);
    });

    it('has correct tooltip', () => {
      const wrapper = mountComponent({
        showScheduledFilter: true,
      });

      const scheduleButton = wrapper.find('.schedule-btn');
      expect(scheduleButton.attributes('title')).toBe('Test scheduled tooltip');
    });

    it('calls toggleScheduledFilterIcon when clicked', async () => {
      const wrapper = mountComponent({
        showScheduledFilter: true,
      });

      const scheduleButton = wrapper.find('.schedule-btn');
      await scheduleButton.trigger('click');

      expect(mockToggleScheduledFilterIcon).toHaveBeenCalled();
    });
  });

  describe('layout and styling', () => {
    it('renders filters in correct container', () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.filters-container').exists()).toBe(true);
      expect(wrapper.find('.status-filters').exists()).toBe(true);
    });

    it('applies filter-btn class to all filter buttons', () => {
      const wrapper = mountComponent();

      const buttons = wrapper.findAll('.filter-btn');
      expect(buttons.length).toBeGreaterThan(0);

      buttons.forEach(button => {
        expect(button.classes()).toContain('filter-btn');
      });
    });
  });

  describe('composable integration', () => {
    it('uses useSessionFiltering composable', () => {
      mountComponent();

      expect(useSessionFiltering).toHaveBeenCalled();
    });

    it('uses sessions store', () => {
      mountComponent();

      expect(useSessionsStore).toHaveBeenCalled();
    });
  });

  describe('filter combinations', () => {
    it('can show all filters together', () => {
      const wrapper = mountComponent({
        showStatusFilters: true,
        showScheduledFilter: true,
      });

      // Should have: running, idle, star, scheduled buttons
      const buttons = wrapper.findAll('.filter-btn');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('can show only star filter', () => {
      const wrapper = mountComponent({
        showStatusFilters: false,
        showScheduledFilter: false,
      });

      expect(wrapper.find('.star-btn').exists()).toBe(true);
      expect(wrapper.findAll('.filter-btn').filter(btn => {
        const label = btn.find('.filter-label');
        return label.exists() && label.text() === 'running';
      })).toHaveLength(0);
      expect(wrapper.find('.schedule-btn').exists()).toBe(false);
    });
  });

  describe('status filter counts', () => {
    it('renders the running and idle counts inside .filter-count spans', () => {
      vi.mocked(useSessionFiltering).mockReturnValueOnce({
        toggleFilter: mockToggleFilter,
        toggleStarFilterIcon: mockToggleStarFilterIcon,
        starFilterTooltip: 'x',
        toggleScheduledFilterIcon: mockToggleScheduledFilterIcon,
        scheduledFilterTooltip: 'x',
        statusFilterCounts: { running: 3, idle: 7 },
      });
      const wrapper = mountComponent();
      const buttons = wrapper.findAll('.filter-btn');
      const running = buttons.find(b => b.find('.filter-label').exists() && b.find('.filter-label').text() === 'running');
      const idle = buttons.find(b => b.find('.filter-label').exists() && b.find('.filter-label').text() === 'idle');
      expect(running.find('.filter-count').text()).toBe('3');
      expect(idle.find('.filter-count').text()).toBe('7');
    });

    it('applies filter-btn-empty class when a count is 0', () => {
      vi.mocked(useSessionFiltering).mockReturnValueOnce({
        toggleFilter: mockToggleFilter,
        toggleStarFilterIcon: mockToggleStarFilterIcon,
        starFilterTooltip: 'x',
        toggleScheduledFilterIcon: mockToggleScheduledFilterIcon,
        scheduledFilterTooltip: 'x',
        statusFilterCounts: { running: 0, idle: 4 },
      });
      const wrapper = mountComponent();
      const buttons = wrapper.findAll('.filter-btn');
      const running = buttons.find(b => b.find('.filter-label').exists() && b.find('.filter-label').text() === 'running');
      const idle = buttons.find(b => b.find('.filter-label').exists() && b.find('.filter-label').text() === 'idle');
      expect(running.classes()).toContain('filter-btn-empty');
      expect(idle.classes()).not.toContain('filter-btn-empty');
    });

    it('still calls toggleFilter when a zero-count button is clicked (not disabled)', async () => {
      vi.mocked(useSessionFiltering).mockReturnValueOnce({
        toggleFilter: mockToggleFilter,
        toggleStarFilterIcon: mockToggleStarFilterIcon,
        starFilterTooltip: 'x',
        toggleScheduledFilterIcon: mockToggleScheduledFilterIcon,
        scheduledFilterTooltip: 'x',
        statusFilterCounts: { running: 0, idle: 0 },
      });
      const wrapper = mountComponent();
      const running = wrapper.findAll('.filter-btn').find(
        b => b.find('.filter-label').exists() && b.find('.filter-label').text() === 'running'
      );
      await running.trigger('click');
      expect(mockToggleFilter).toHaveBeenCalledWith('running');
    });

    it('sets an aria-label that includes the count in any-count grammatical format', () => {
      vi.mocked(useSessionFiltering).mockReturnValueOnce({
        toggleFilter: mockToggleFilter,
        toggleStarFilterIcon: mockToggleStarFilterIcon,
        starFilterTooltip: 'x',
        toggleScheduledFilterIcon: mockToggleScheduledFilterIcon,
        scheduledFilterTooltip: 'x',
        statusFilterCounts: { running: 1, idle: 5 },
      });
      const wrapper = mountComponent();
      const buttons = wrapper.findAll('.filter-btn');
      const running = buttons.find(
        b => b.find('.filter-label').exists() && b.find('.filter-label').text() === 'running'
      );
      const idle = buttons.find(
        b => b.find('.filter-label').exists() && b.find('.filter-label').text() === 'idle'
      );
      expect(running.attributes('aria-label')).toBe('running (1)');
      expect(idle.attributes('aria-label')).toBe('idle (5)');
    });
  });
});
