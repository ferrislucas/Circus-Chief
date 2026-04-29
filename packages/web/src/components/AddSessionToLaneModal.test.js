/* eslint-env vitest */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import AddSessionToLaneModal from './AddSessionToLaneModal.vue';

// Sessions returned by api.getProjectSessions — configurable per test via the
// `mockProjectSessions` closure variable.
let mockProjectSessions = [];

vi.mock('../composables/useApi.js', () => ({
  api: {
    getProjectSessions: vi.fn(() => Promise.resolve(mockProjectSessions)),
  },
}));

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(() => ({})),
}));

vi.mock('../stores/kanban.js', () => ({
  useKanbanStore: vi.fn(() => ({
    isSessionOnBoard: vi.fn(() => false),
    addSessionToBoard: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('AddSessionToLaneModal.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockProjectSessions = [];
  });

  const defaultProps = {
    isOpen: true,
    projectId: 'proj-1',
    laneId: 'lane-1',
    laneName: 'Plan',
  };

  async function mountWithSessions(sessions) {
    mockProjectSessions = sessions;
    const wrapper = mount(AddSessionToLaneModal, { props: defaultProps });
    await flushPromises();
    return wrapper;
  }

  describe('session date rendering', () => {
    it('renders lastActivityAt when present with "Last activity" tooltip', async () => {
      const activity = new Date('2024-06-15T12:00:00Z').getTime();
      const wrapper = await mountWithSessions([
        {
          id: 's1',
          name: 'Has Activity',
          status: 'running',
          mode: 'standard',
          lastActivityAt: activity,
          updatedAt: activity - 10_000,
          createdAt: activity - 20_000,
          parentSessionId: null,
        },
      ]);

      const dateEl = wrapper.find('.session-date');
      expect(dateEl.exists()).toBe(true);
      expect(dateEl.attributes('title')).toBe('Last activity');
      expect(dateEl.text().length).toBeGreaterThan(0);
    });

    it('falls back to updatedAt / createdAt when lastActivityAt is null', async () => {
      const updated = new Date('2024-06-15T12:00:00Z').getTime();
      const wrapper = await mountWithSessions([
        {
          id: 's1',
          name: 'No Activity',
          status: 'waiting',
          mode: 'standard',
          lastActivityAt: null,
          updatedAt: updated,
          createdAt: updated - 10_000,
          parentSessionId: null,
        },
      ]);

      const dateEl = wrapper.find('.session-date');
      expect(dateEl.exists()).toBe(true);
      // Tooltip reflects "No activity yet" because lastActivityAt is null.
      expect(dateEl.attributes('title')).toBe('No activity yet');
      // But date text is populated from the updatedAt fallback.
      expect(dateEl.text().length).toBeGreaterThan(0);
    });

    it('flips tooltip between "Last activity" and "No activity yet" based on value', async () => {
      const ts = new Date('2024-06-15T12:00:00Z').getTime();
      const wrapper = await mountWithSessions([
        {
          id: 'has',
          name: 'Has',
          status: 'running',
          mode: 'standard',
          lastActivityAt: ts,
          updatedAt: ts,
          createdAt: ts,
          parentSessionId: null,
        },
        {
          id: 'none',
          name: 'None',
          status: 'waiting',
          mode: 'standard',
          lastActivityAt: null,
          updatedAt: ts,
          createdAt: ts,
          parentSessionId: null,
        },
      ]);

      const dates = wrapper.findAll('.session-date');
      expect(dates).toHaveLength(2);
      expect(dates[0].attributes('title')).toBe('Last activity');
      expect(dates[1].attributes('title')).toBe('No activity yet');
    });
  });
});
