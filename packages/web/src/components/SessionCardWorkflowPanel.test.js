/* eslint-env vitest */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import SessionCardWorkflowPanel from './SessionCardWorkflowPanel.vue';

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(() => ({
    getAllDescendants: vi.fn(() => []),
    getSessionPath: vi.fn(() => []),
  })),
}));

function mountPanel(sessionOverrides = {}) {
  return mount(SessionCardWorkflowPanel, {
    props: {
      session: {
        id: 'root',
        name: 'Root',
        lastActivityAt: null,
        ...sessionOverrides,
      },
      summaries: {},
      summary: null,
    },
    global: {
      components: {
        'router-link': {
          name: 'RouterLinkStub',
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
          compatConfig: { MODE: 3 },
        },
      },
      stubs: {
        WorkflowSessionItem: true,
      },
    },
  });
}

describe('SessionCardWorkflowPanel.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('root session date rendering', () => {
    it('renders lastActivityAt when present with "Last activity" tooltip', () => {
      const ts = new Date('2024-06-15T12:00:00Z').getTime();
      const wrapper = mountPanel({ lastActivityAt: ts });

      const dateEl = wrapper.find('.workflow-session-date');
      expect(dateEl.exists()).toBe(true);
      expect(dateEl.attributes('title')).toBe('Last activity');
      expect(dateEl.text()).not.toBe('—');
      expect(dateEl.text().length).toBeGreaterThan(0);
    });

    it('renders "—" placeholder with "No activity yet" tooltip when lastActivityAt is null', () => {
      const wrapper = mountPanel({ lastActivityAt: null });

      const dateEl = wrapper.find('.workflow-session-date');
      expect(dateEl.exists()).toBe(true);
      expect(dateEl.attributes('title')).toBe('No activity yet');
      expect(dateEl.text()).toBe('—');
    });

    it('flips tooltip between "Last activity" and "No activity yet" based on value', () => {
      const withActivity = mountPanel({ lastActivityAt: Date.now() });
      expect(
        withActivity.find('.workflow-session-date').attributes('title')
      ).toBe('Last activity');

      const withoutActivity = mountPanel({ lastActivityAt: null });
      expect(
        withoutActivity.find('.workflow-session-date').attributes('title')
      ).toBe('No activity yet');
    });
  });
});
