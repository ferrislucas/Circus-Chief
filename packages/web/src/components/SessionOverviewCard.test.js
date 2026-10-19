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

  describe('Lineage graph subsection', () => {
    function lineageRow(id, overrides = {}) {
      return {
        session: {
          id,
          name: `Session ${id}`,
          status: 'stopped',
          createdAt: '2026-01-10T12:00:00Z',
          updatedAt: '2026-01-10T12:10:00Z',
        },
        lane: 0,
        barStartPct: 0,
        barEndPct: 50,
        isScheduled: false,
        ...overrides,
      };
    }

    it('renders the lineage graph when lineageRows has 2+ rows', () => {
      const wrapper = mountComponent({
        hasMetrics: true,
        lineageRows: [lineageRow('a'), lineageRow('b')],
        currentSessionId: 'b',
      });

      expect(wrapper.find('[data-testid="session-lineage-graph"]').exists()).toBe(true);
      expect(wrapper.findAll('[data-session-id]').map((el) => el.attributes('data-session-id')))
        .toEqual(['a', 'b']);
    });

    it('hides the lineage graph for 0 or 1 rows', () => {
      const withOne = mountComponent({
        hasMetrics: true,
        lineageRows: [lineageRow('a')],
      });
      expect(withOne.find('[data-testid="session-lineage-graph"]').exists()).toBe(false);

      const withNone = mountComponent({ hasMetrics: true, lineageRows: [] });
      expect(withNone.find('[data-testid="session-lineage-graph"]').exists()).toBe(false);
    });

    it("re-emits the graph's open-session as open-session-overlay", async () => {
      // attrs listener per ScheduledChildCard.test.js (wrapper.emitted()
      // is unreliable with script setup SFCs).
      const spy = vi.fn();
      const wrapper = mount(SessionOverviewCard, {
        props: {
          summary: null,
          loading: false,
          hasPrInfo: false,
          hasMetrics: true,
          lineageRows: [lineageRow('a'), lineageRow('b')],
          currentSessionId: 'a',
        },
        attrs: { onOpenSessionOverlay: spy },
      });

      await wrapper.find('[data-session-id="b"]').trigger('click');
      expect(spy).toHaveBeenCalledWith('b');
    });
  });

  describe('Session count metric', () => {
    it('renders the session count metric with a "Sessions" label', () => {
      const wrapper = mountComponent({
        hasMetrics: true,
        sessionCount: 3,
      });

      const metrics = wrapper.findAll('.metric');
      const sessionMetric = metrics.find(
        (metric) => metric.find('.metric-label').text() === 'Sessions',
      );

      expect(sessionMetric).toBeTruthy();
      expect(sessionMetric.find('.metric-value').text()).toBe('3');

      const labels = metrics.map((metric) => metric.find('.metric-label').text());
      expect(labels).not.toContain('Workspaces');
    });
  });

});
