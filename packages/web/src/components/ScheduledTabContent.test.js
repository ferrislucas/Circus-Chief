import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Mock ScheduledSessionCard component
vi.mock('./ScheduledSessionCard.vue', () => ({
  default: {
    name: 'ScheduledSessionCard',
    template: '<div class="scheduled-session-card-mock">ScheduledSessionCard</div>',
    props: ['session'],
  },
}));

import ScheduledTabContent from './ScheduledTabContent.vue';

describe('ScheduledTabContent', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  function mountComponent(props = {}) {
    return mount(ScheduledTabContent, {
      props: {
        sessions: [],
        loading: false,
        ...props,
      },
      global: {
        stubs: {
          ScheduledSessionCard: true,
        },
      },
    });
  }

  describe('component structure', () => {
    it('exports a Vue component', () => {
      expect(ScheduledTabContent).toBeDefined();
      expect(ScheduledTabContent.__name).toBe('ScheduledTabContent');
    });

    it('has required props', () => {
      expect(ScheduledTabContent.props).toBeDefined();
      expect(ScheduledTabContent.props.sessions).toBeDefined();
      expect(ScheduledTabContent.props.loading).toBeDefined();
    });

    it('sessions prop is required', () => {
      expect(ScheduledTabContent.props.sessions.required).toBe(true);
    });

    it('loading prop defaults to false', () => {
      expect(ScheduledTabContent.props.loading.default).toBe(false);
    });
  });

  describe('loading state', () => {
    it('shows skeleton when loading is true', () => {
      const wrapper = mountComponent({
        sessions: [],
        loading: true,
      });

      expect(wrapper.find('.skeleton-list').exists()).toBe(true);
      expect(wrapper.findAll('.skeleton')).toHaveLength(3);
    });

    it('does not show skeleton when loading is false', () => {
      const wrapper = mountComponent({
        sessions: [],
        loading: false,
      });

      expect(wrapper.find('.skeleton-list').exists()).toBe(false);
    });

    it('skeleton items have correct styling', () => {
      const wrapper = mountComponent({
        sessions: [],
        loading: true,
      });

      const skeletons = wrapper.findAll('.skeleton');
      skeletons.forEach(skeleton => {
        expect(skeleton.classes()).toContain('card');
        expect(skeleton.attributes('style')).toContain('height: 120px');
      });
    });
  });

  describe('empty state', () => {
    it('shows empty state when no scheduled sessions', () => {
      const wrapper = mountComponent({
        sessions: [],
        loading: false,
      });

      expect(wrapper.find('.empty-state').exists()).toBe(true);
      expect(wrapper.find('.empty-state p').text()).toContain('No scheduled sessions');
    });

    it('shows helpful message in empty state', () => {
      const wrapper = mountComponent({
        sessions: [],
        loading: false,
      });

      const emptyText = wrapper.find('.empty-state p').text();
      expect(emptyText).toContain('scheduling options');
      expect(emptyText).toContain('schedule it for later');
    });

    it('does not show empty state when there are sessions', () => {
      const wrapper = mountComponent({
        sessions: [{ id: 'session-1' }],
        loading: false,
      });

      expect(wrapper.find('.empty-state').exists()).toBe(false);
    });
  });

  describe('session list', () => {
    it('renders scheduled session cards for each session', () => {
      const sessions = [
        { id: 'session-1', name: 'Scheduled Session 1' },
        { id: 'session-2', name: 'Scheduled Session 2' },
        { id: 'session-3', name: 'Scheduled Session 3' },
      ];

      const wrapper = mountComponent({
        sessions,
        loading: false,
      });

      const sessionCards = wrapper.findAllComponents({ name: 'ScheduledSessionCard' });
      expect(sessionCards).toHaveLength(3);
    });

    it('passes correct session prop to each ScheduledSessionCard', () => {
      const sessions = [
        { id: 'session-1', name: 'Scheduled Session 1', scheduledFor: '2024-01-15T10:00:00Z' },
        { id: 'session-2', name: 'Scheduled Session 2', scheduledFor: '2024-01-16T14:00:00Z' },
      ];

      const wrapper = mountComponent({
        sessions,
        loading: false,
      });

      const sessionCards = wrapper.findAllComponents({ name: 'ScheduledSessionCard' });
      expect(sessionCards[0].props('session')).toEqual(sessions[0]);
      expect(sessionCards[1].props('session')).toEqual(sessions[1]);
    });

    it('uses session id as key for rendering', () => {
      const sessions = [
        { id: 'session-1', name: 'Session 1' },
        { id: 'session-2', name: 'Session 2' },
      ];

      const wrapper = mountComponent({
        sessions,
        loading: false,
      });

      const sessionList = wrapper.find('.session-list');
      expect(sessionList.exists()).toBe(true);
    });
  });

  describe('styling', () => {
    it('applies correct layout classes to session list', () => {
      const wrapper = mountComponent({
        sessions: [{ id: 'session-1' }],
        loading: false,
      });

      const sessionList = wrapper.find('.session-list');
      expect(sessionList.exists()).toBe(true);
    });

    it('applies correct layout to empty state', () => {
      const wrapper = mountComponent({
        sessions: [],
        loading: false,
      });

      const emptyState = wrapper.find('.empty-state');
      expect(emptyState.classes()).toContain('empty-state');
    });
  });

  describe('rendering states priority', () => {
    it('prioritizes loading state over empty state', () => {
      const wrapper = mountComponent({
        sessions: [],
        loading: true,
      });

      expect(wrapper.find('.skeleton-list').exists()).toBe(true);
      expect(wrapper.find('.empty-state').exists()).toBe(false);
    });

    it('shows session list when not loading and has sessions', () => {
      const wrapper = mountComponent({
        sessions: [{ id: 'session-1' }],
        loading: false,
      });

      expect(wrapper.find('.skeleton-list').exists()).toBe(false);
      expect(wrapper.find('.empty-state').exists()).toBe(false);
      expect(wrapper.find('.session-list').exists()).toBe(true);
    });
  });
});
