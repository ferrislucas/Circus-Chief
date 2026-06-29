import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import SessionOverviewCard from './SessionOverviewCard.vue';

// Stub ScheduledChildCard
vi.mock('./ScheduledChildCard.vue', () => ({
  default: {
    name: 'ScheduledChildCard',
    props: ['session', 'projectId'],
    template: '<div class="scheduled-child-card-stub" data-testid="scheduled-child-card">{{ session.name }}</div>',
  },
}));

describe('SessionOverviewCard.vue', () => {
  function mountComponent(props = {}) {
    return mount(SessionOverviewCard, {
      props: {
        summary: null,
        loading: false,
        hasPrInfo: false,
        hasMetrics: false,
        sessionCount: 1,
        hasNonZeroTokens: false,
        formattedTokens: '',
        formattedDuration: '',
        filesCount: 0,
        prUrl: null,
        hasWarnings: false,
        ...props,
      },
    });
  }

  describe('Scheduled Sessions', () => {
    it('renders no scheduled sessions section when array is empty', () => {
      const wrapper = mountComponent({ scheduledSessions: [] });
      // The card should not render at all when there's no content
      expect(wrapper.find('.overview-scheduled-sessions').exists()).toBe(false);
    });

    it('renders no scheduled sessions section when prop is omitted', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.overview-scheduled-sessions').exists()).toBe(false);
    });

    it('renders scheduled sessions section when array has items', () => {
      const scheduledSessions = [
        { id: 'c1', name: 'Child 1', status: 'scheduled', scheduledAt: Date.now() + 3600000 },
      ];
      const wrapper = mountComponent({
        scheduledSessions,
        projectId: 'proj-1',
      });

      expect(wrapper.find('.overview-scheduled-sessions').exists()).toBe(true);
      expect(wrapper.find('.scheduled-sessions-heading').text()).toBe('Scheduled Sessions (1)');
    });

    it('renders multiple ScheduledChildCard stubs', () => {
      const scheduledSessions = [
        { id: 'c1', name: 'Child 1', status: 'scheduled', scheduledAt: Date.now() + 3600000 },
        { id: 'c2', name: 'Child 2', status: 'scheduled', scheduledAt: Date.now() + 7200000 },
        { id: 'c3', name: 'Child 3', status: 'scheduled', scheduledAt: Date.now() + 10800000 },
      ];
      const wrapper = mountComponent({
        scheduledSessions,
        projectId: 'proj-1',
      });

      expect(wrapper.find('.overview-scheduled-sessions').exists()).toBe(true);
      expect(wrapper.find('.scheduled-sessions-heading').text()).toBe('Scheduled Sessions (3)');
      const stubs = wrapper.findAll('.scheduled-child-card-stub');
      expect(stubs.length).toBe(3);
      expect(stubs[0].text()).toBe('Child 1');
      expect(stubs[1].text()).toBe('Child 2');
      expect(stubs[2].text()).toBe('Child 3');
    });

    it('passes projectId to each ScheduledChildCard', () => {
      const scheduledSessions = [
        { id: 'c1', name: 'Child 1', status: 'scheduled', scheduledAt: Date.now() + 3600000 },
        { id: 'c2', name: 'Child 2', status: 'scheduled', scheduledAt: Date.now() + 7200000 },
      ];
      const wrapper = mountComponent({
        scheduledSessions,
        projectId: 'proj-1',
      });

      const cards = wrapper.findAllComponents({ name: 'ScheduledChildCard' });
      expect(cards.length).toBe(2);
      expect(cards[0].props('projectId')).toBe('proj-1');
      expect(cards[1].props('projectId')).toBe('proj-1');
    });

    it('shows overview card when only scheduled sessions exist (no summary, PR, metrics)', () => {
      const scheduledSessions = [
        { id: 'c1', name: 'Child 1', status: 'scheduled', scheduledAt: Date.now() + 3600000 },
      ];
      const wrapper = mountComponent({
        scheduledSessions,
        projectId: 'proj-1',
      });

      expect(wrapper.find('.session-overview').exists()).toBe(true);
      expect(wrapper.find('.overview-scheduled-sessions').exists()).toBe(true);
    });

    it('does not show "Workspace Overview" header when only scheduled sessions exist', () => {
      const scheduledSessions = [
        { id: 'c1', name: 'Child 1', status: 'scheduled', scheduledAt: Date.now() + 3600000 },
      ];
      const wrapper = mountComponent({
        scheduledSessions,
        projectId: 'proj-1',
      });

      expect(wrapper.find('.session-overview').exists()).toBe(true);
      expect(wrapper.find('.overview-header').exists()).toBe(false);
    });

    it('does not render the not-started message inside the overview card', async () => {
      const wrapper = mountComponent({
        hasMetrics: true,
        formattedDuration: '1m',
      });

      expect(wrapper.find('.session-overview').exists()).toBe(true);
      expect(wrapper.find('.overview-summary-empty').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("This workspace hasn't started yet.");
    });
  });

});
