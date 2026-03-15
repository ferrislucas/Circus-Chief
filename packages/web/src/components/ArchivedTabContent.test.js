import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';

// Mock the sessions store
const mockSessionsStore = reactive({
  archivedSessions: [],
  archivedPagination: {
    loading: false,
    hasMore: false,
    total: 0,
    offset: 0,
  },
  error: null,
});

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(() => mockSessionsStore),
}));

// Mock SessionCard component
vi.mock('./SessionCard.vue', () => ({
  default: {
    name: 'SessionCard',
    template: '<div class="session-card-mock">SessionCard</div>',
    props: ['session', 'showSummary', 'summary', 'summaryLoading', 'summaryError', 'showUnarchive', 'prUrl', 'prSummary'],
  },
}));

import ArchivedTabContent from './ArchivedTabContent.vue';
import { useSessionsStore } from '../stores/sessions.js';

describe('ArchivedTabContent', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Reset store state
    mockSessionsStore.archivedSessions = [];
    mockSessionsStore.archivedPagination = {
      loading: false,
      hasMore: false,
      total: 0,
      offset: 0,
    };
    mockSessionsStore.error = null;
  });

  function mountComponent(props = {}) {
    return mount(ArchivedTabContent, {
      props: {
        summaries: {},
        loadingSummaries: {},
        summaryErrors: {},
        ...props,
      },
      global: {
        stubs: {
          SessionCard: true,
        },
      },
    });
  }

  describe('component structure', () => {
    it('exports a Vue component', () => {
      expect(ArchivedTabContent).toBeDefined();
      expect(ArchivedTabContent.__name).toBe('ArchivedTabContent');
    });

    it('has required props', () => {
      expect(ArchivedTabContent.props).toBeDefined();
      expect(ArchivedTabContent.props.summaries).toBeDefined();
      expect(ArchivedTabContent.props.loadingSummaries).toBeDefined();
      expect(ArchivedTabContent.props.summaryErrors).toBeDefined();
    });
  });

  describe('loading state', () => {
    it('shows skeleton when loading and no sessions', () => {
      mockSessionsStore.archivedPagination.loading = true;
      mockSessionsStore.archivedSessions = [];

      const wrapper = mountComponent();

      expect(wrapper.find('.skeleton-list').exists()).toBe(true);
      expect(wrapper.findAll('.skeleton')).toHaveLength(3);
    });

    it('does not show skeleton when loading but has sessions', () => {
      mockSessionsStore.archivedPagination.loading = true;
      mockSessionsStore.archivedSessions = [
        { id: 'session-1' },
      ];

      const wrapper = mountComponent();

      expect(wrapper.find('.skeleton-list').exists()).toBe(false);
    });
  });

  describe('error state', () => {
    it('shows error message when store has error', () => {
      mockSessionsStore.error = 'Failed to load sessions';
      mockSessionsStore.archivedSessions = [];

      const wrapper = mountComponent();

      expect(wrapper.find('.error-message').exists()).toBe(true);
      expect(wrapper.find('.error-message').text()).toBe('Failed to load sessions');
    });
  });

  describe('empty state', () => {
    it('shows empty state when no archived sessions', () => {
      mockSessionsStore.archivedPagination.loading = false;
      mockSessionsStore.archivedSessions = [];

      const wrapper = mountComponent();

      expect(wrapper.find('.empty-state').exists()).toBe(true);
      expect(wrapper.find('.empty-state').text()).toContain('No archived sessions');
    });

    it('does not show empty state when there are sessions', () => {
      mockSessionsStore.archivedSessions = [
        { id: 'session-1' },
      ];

      const wrapper = mountComponent();

      expect(wrapper.find('.empty-state').exists()).toBe(false);
    });
  });

  describe('session list', () => {
    it('renders session cards for each archived session', () => {
      mockSessionsStore.archivedSessions = [
        { id: 'session-1', name: 'Session 1' },
        { id: 'session-2', name: 'Session 2' },
      ];

      const wrapper = mountComponent({
        summaries: {
          'session-1': 'Summary 1',
          'session-2': 'Summary 2',
        },
      });

      const sessionCards = wrapper.findAllComponents({ name: 'SessionCard' });
      expect(sessionCards).toHaveLength(2);
    });

    it('passes correct props to SessionCard', () => {
      mockSessionsStore.archivedSessions = [
        { id: 'session-1', prUrl: 'https://github.com/pr/1' },
      ];

      const wrapper = mountComponent({
        summaries: { 'session-1': 'Test summary' },
        loadingSummaries: { 'session-1': false },
        summaryErrors: { 'session-1': null },
      });

      const sessionCard = wrapper.findComponent({ name: 'SessionCard' });
      expect(sessionCard.props('session')).toEqual({ id: 'session-1', prUrl: 'https://github.com/pr/1' });
      expect(sessionCard.props('showSummary')).toBe(true);
      expect(sessionCard.props('summary')).toBe('Test summary');
      expect(sessionCard.props('summaryLoading')).toBe(false);
      expect(sessionCard.props('summaryError')).toBe(null);
      expect(sessionCard.props('showUnarchive')).toBe(true);
      expect(sessionCard.props('prUrl')).toBe('https://github.com/pr/1');
      expect(sessionCard.props('prSummary')).toBe('Test summary');
    });
  });

  describe('load more', () => {
    it('shows load more button when hasMore is true', () => {
      mockSessionsStore.archivedSessions = [{ id: 'session-1' }];
      mockSessionsStore.archivedPagination.hasMore = true;
      mockSessionsStore.archivedPagination.total = 10;
      mockSessionsStore.archivedPagination.offset = 5;

      const wrapper = mountComponent();

      expect(wrapper.find('.load-more-container').exists()).toBe(true);
      expect(wrapper.find('button').text()).toContain('Load More');
      expect(wrapper.find('button').text()).toContain('5 remaining');
    });

    it('does not show load more button when hasMore is false', () => {
      mockSessionsStore.archivedSessions = [{ id: 'session-1' }];
      mockSessionsStore.archivedPagination.hasMore = false;

      const wrapper = mountComponent();

      expect(wrapper.find('.load-more-container').exists()).toBe(false);
    });

    it('disables button when loading', () => {
      mockSessionsStore.archivedSessions = [{ id: 'session-1' }];
      mockSessionsStore.archivedPagination.hasMore = true;
      mockSessionsStore.archivedPagination.loading = true;

      const wrapper = mountComponent();

      const button = wrapper.find('button');
      expect(button.attributes('disabled')).toBeDefined();
      expect(button.text()).toContain('Loading...');
    });

    it('calculates remaining count correctly', () => {
      mockSessionsStore.archivedSessions = [{ id: 'session-1' }];
      mockSessionsStore.archivedPagination.hasMore = true;
      mockSessionsStore.archivedPagination.total = 25;
      mockSessionsStore.archivedPagination.offset = 10;

      const wrapper = mountComponent();

      expect(wrapper.find('button').text()).toContain('15 remaining');
    });

    it('shows zero remaining when offset equals or exceeds total', () => {
      mockSessionsStore.archivedSessions = [{ id: 'session-1' }];
      mockSessionsStore.archivedPagination.hasMore = true;
      mockSessionsStore.archivedPagination.total = 10;
      mockSessionsStore.archivedPagination.offset = 15;

      const wrapper = mountComponent();

      expect(wrapper.find('button').text()).toContain('0 remaining');
    });
  });

  describe('events', () => {
    it('load more button is clickable', async () => {
      mockSessionsStore.archivedSessions = [{ id: 'session-1' }];
      mockSessionsStore.archivedPagination.hasMore = true;

      const wrapper = mountComponent();

      // Find the load more button
      const loadMoreContainer = wrapper.find('.load-more-container');
      expect(loadMoreContainer.exists()).toBe(true);

      const button = loadMoreContainer.find('button');
      expect(button.exists()).toBe(true);
      expect(button.attributes('disabled')).toBeUndefined();

      // Button can be clicked (verify it's not disabled and exists)
      expect(button.element.tagName).toBe('BUTTON');
    });

    it('component has event emitters defined', () => {
      // Verify emits are declared
      expect(ArchivedTabContent.emits).toBeDefined();
      expect(ArchivedTabContent).toBeDefined();
    });
  });
});
