import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

// Mock the API
vi.mock('../composables/useApi.js', () => ({
  api: {
    getSessionSummary: vi.fn().mockResolvedValue(null),
    getSessionSummariesBatch: vi.fn().mockResolvedValue({}),
  },
}));

// Note: Not mocking sessions store - will use actual Pinia instance

import WhatJustHappenedCard from './WhatJustHappenedCard.vue';
import { useSessionsStore } from '../stores/sessions.js';

describe('WhatJustHappenedCard', () => {
  let sessionsStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Get actual store instance
    sessionsStore = useSessionsStore();
  });

  async function flushAll(wrapper) {
    await flushPromises();
    await nextTick();
    await wrapper.vm.$nextTick?.();
    await wrapper.vm.$forceUpdate();
    await nextTick();
    await wrapper.vm.$forceUpdate();
    await nextTick();
  }

  function mountComponent(props = {}) {
    const defaultSession = {
      id: 'root-123',
      name: 'Root Session',
      status: 'waiting',
      projectId: 'project-1',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    return mount(WhatJustHappenedCard, {
      props: {
        session: defaultSession,
        ...props,
      },
      global: {
        stubs: {
          RouterLink: { template: '<a><slot /></a>' },
        },
      },
    });
  }

  describe('Chain trail rendering', () => {
    it('renders 3-deep completed chain', async () => {
      // Setup: root + 3 descendants
      sessionsStore.sessions = [
        { id: 'root-123', name: 'Root Session', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'child-1', name: 'Fix auth bug', status: 'completed', parentSessionId: 'root-123', updatedAt: '2024-01-01T01:00:00Z', lastActivityAt: '2024-01-01T01:00:00Z' },
        { id: 'child-2', name: 'Write auth tests', status: 'completed', parentSessionId: 'child-1', updatedAt: '2024-01-01T02:00:00Z', lastActivityAt: '2024-01-01T02:00:00Z' },
        { id: 'child-3', name: 'Fix CI failures', status: 'completed', parentSessionId: 'child-2', updatedAt: '2024-01-01T03:00:00Z', lastActivityAt: '2024-01-01T03:00:00Z' },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Verify chain steps are rendered (using .chain-step class for specificity)
      const chainSteps = wrapper.findAll('.chain-step');
      expect(chainSteps.length).toBe(3);

      // Verify session names appear in correct order
      const stepNames = wrapper.findAll('[data-testid^="chain-step-name-"]');
      expect(stepNames[0].text()).toBe('Fix auth bug');
      expect(stepNames[1].text()).toBe('Write auth tests');
      expect(stepNames[2].text()).toBe('Fix CI failures');
    });

    it('renders chain with error status', async () => {
      sessionsStore.sessions = [
        { id: 'root-123', name: 'Root Session', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'child-1', name: 'Fix auth bug', status: 'completed', parentSessionId: 'root-123', updatedAt: '2024-01-01T01:00:00Z', lastActivityAt: '2024-01-01T01:00:00Z' },
        { id: 'child-2', name: 'Write auth tests', status: 'error', parentSessionId: 'child-1', updatedAt: '2024-01-01T02:00:00Z', lastActivityAt: '2024-01-01T02:00:00Z', errorMessage: 'Could not connect to test database' },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Verify numbered badges are displayed
      const firstBadge = wrapper.find('[data-testid="chain-step-number-0"]');
      expect(firstBadge.exists()).toBe(true);
      expect(firstBadge.text()).toBe('1');

      const secondBadge = wrapper.find('[data-testid="chain-step-number-1"]');
      expect(secondBadge.exists()).toBe(true);
      expect(secondBadge.text()).toBe('2');

      // Verify error message is displayed
      const errorText = wrapper.find('.chain-step-error');
      expect(errorText.exists()).toBe(true);
      expect(errorText.text()).toContain('Could not connect to test database');
    });

    it('excludes root session from chain trail', async () => {
      sessionsStore.sessions = [
        { id: 'root-123', name: 'Root Session', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'child-1', name: 'Child Task', status: 'completed', parentSessionId: 'root-123', updatedAt: '2024-01-01T01:00:00Z', lastActivityAt: '2024-01-01T01:00:00Z' },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Verify root session name does not appear in chain
      const chainText = wrapper.find('[data-testid="chain-trail"]').text();
      expect(chainText).not.toContain('Root Session');
      expect(chainText).toContain('Child Task');
    });

    it('does not render card when no children', async () => {
      sessionsStore.sessions = [
        { id: 'root-123', name: 'Root Session', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('[data-testid="what-just-happened-card"]').exists()).toBe(false);
    });

    it('renders single child chain', async () => {
      sessionsStore.sessions = [
        { id: 'root-123', name: 'Root Session', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'child-1', name: 'Single Task', status: 'completed', parentSessionId: 'root-123', updatedAt: '2024-01-01T01:00:00Z', lastActivityAt: '2024-01-01T01:00:00Z' },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const chainSteps = wrapper.findAll('.chain-step');
      expect(chainSteps.length).toBe(1);
      expect(wrapper.find('[data-testid="chain-step-name-0"]').text()).toBe('Single Task');
    });
  });

  describe('Workflow tally', () => {
    it('shows correct counts for mixed statuses', async () => {
      sessionsStore.sessions = [
        { id: 'root-123', name: 'Root Session', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'child-1', name: 'Task 1', status: 'completed', parentSessionId: 'root-123', updatedAt: '2024-01-01T01:00:00Z' },
        { id: 'child-2', name: 'Task 2', status: 'completed', parentSessionId: 'root-123', updatedAt: '2024-01-01T02:00:00Z' },
        { id: 'child-3', name: 'Task 3', status: 'completed', parentSessionId: 'root-123', updatedAt: '2024-01-01T03:00:00Z' },
        { id: 'child-4', name: 'Task 4', status: 'running', parentSessionId: 'root-123', updatedAt: '2024-01-01T04:00:00Z' },
        { id: 'child-5', name: 'Task 5', status: 'scheduled', parentSessionId: 'root-123', updatedAt: '2024-01-01T05:00:00Z', scheduledFor: '2024-01-02T00:00:00Z' },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const tally = wrapper.find('[data-testid="workflow-tally"]');
      expect(tally.exists()).toBe(true);
      expect(tally.text()).toContain('3 completed');
      expect(tally.text()).toContain('1 running');
      expect(tally.text()).toContain('1 scheduled');
    });
  });

  describe('Branch selection', () => {
    it('shows most recently active branch', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3600000);
      const twoHoursAgo = new Date(now.getTime() - 7200000);

      sessionsStore.sessions = [
        { id: 'root-123', name: 'Root Session', status: 'waiting', updatedAt: twoHoursAgo.toISOString() },
        // Branch 1 (older)
        { id: 'branch1-child', name: 'Branch 1 Task', status: 'completed', parentSessionId: 'root-123', updatedAt: twoHoursAgo.toISOString(), lastActivityAt: twoHoursAgo.toISOString() },
        // Branch 2 (more recent)
        { id: 'branch2-child', name: 'Branch 2 Task', status: 'completed', parentSessionId: 'root-123', updatedAt: oneHourAgo.toISOString(), lastActivityAt: oneHourAgo.toISOString() },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Should show Branch 2 (more recent) not Branch 1
      const chainText = wrapper.find('[data-testid="chain-trail"]').text();
      expect(chainText).toContain('Branch 2 Task');
      expect(chainText).not.toContain('Branch 1 Task');
    });
  });

  describe('Summary text in chain', () => {
    it('displays shortSummary for steps with summaries', async () => {
      sessionsStore.sessions = [
        { id: 'root-123', name: 'Root Session', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'child-1', name: 'Task 1', status: 'completed', parentSessionId: 'root-123', updatedAt: '2024-01-01T01:00:00Z', lastActivityAt: '2024-01-01T01:00:00Z' },
        { id: 'child-2', name: 'Task 2', status: 'completed', parentSessionId: 'child-1', updatedAt: '2024-01-01T02:00:00Z', lastActivityAt: '2024-01-01T02:00:00Z' },
      ];

      const descendantSummaries = {
        'child-1': { shortSummary: 'Identified root cause in session middleware' },
        // child-2 has no summary
      };

      const wrapper = mountComponent({ descendantSummaries });
      await flushAll(wrapper);

      // Verify first step shows summary
      const summary1 = wrapper.find('[data-testid="chain-step-summary-0"]');
      expect(summary1.exists()).toBe(true);
      expect(summary1.text()).toBe('Identified root cause in session middleware');

      // Verify second step has no summary element (or empty)
      const summary2 = wrapper.find('[data-testid="chain-step-summary-1"]');
      expect(summary2.exists()).toBe(false);
    });
  });

  describe('Truncation', () => {
    it('shows first 2, ellipsis, and last 3 for long chains', async () => {
      const sessions = [
        { id: 'root-123', name: 'Root Session', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
      ];

      // Create 8 descendant sessions (chain of 8)
      for (let i = 1; i <= 8; i++) {
        sessions.push({
          id: `child-${i}`,
          name: `Task ${i}`,
          status: 'completed',
          parentSessionId: i === 1 ? 'root-123' : `child-${i - 1}`,
          updatedAt: `2024-01-01T${i.toString().padStart(2, '0')}:00:00Z`,
          lastActivityAt: `2024-01-01T${i.toString().padStart(2, '0')}:00:00Z`,
        });
      }

      sessionsStore.sessions = sessions;

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Should show first 2 + last 3 = 5 steps (not 8)
      const chainSteps = wrapper.findAll('.chain-step');
      expect(chainSteps.length).toBe(5);

      // Should show ellipsis
      const ellipsis = wrapper.find('[data-testid="chain-ellipsis"]');
      expect(ellipsis.exists()).toBe(true);
      expect(ellipsis.text()).toContain('...and 3 more steps');
    });
  });

  describe('Last activity time', () => {
    it('displays human-readable time', async () => {
      const twoMinutesAgo = new Date(Date.now() - 120000); // 2 minutes ago

      sessionsStore.sessions = [
        { id: 'root-123', name: 'Root Session', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'child-1', name: 'Task 1', status: 'completed', parentSessionId: 'root-123', updatedAt: twoMinutesAgo.toISOString(), lastActivityAt: twoMinutesAgo.toISOString() },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const lastActivity = wrapper.find('.last-activity');
      expect(lastActivity.exists()).toBe(true);
      expect(lastActivity.text()).toContain('2 minutes ago');
    });
  });

  describe('Step numbering', () => {
    it('displays sequential numbers for chain steps', async () => {
      sessionsStore.sessions = [
        { id: 'root-123', name: 'Root Session', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'child-1', name: 'Task 1', status: 'completed', parentSessionId: 'root-123', updatedAt: '2024-01-01T01:00:00Z', lastActivityAt: '2024-01-01T01:00:00Z' },
        { id: 'child-2', name: 'Task 2', status: 'completed', parentSessionId: 'child-1', updatedAt: '2024-01-01T02:00:00Z', lastActivityAt: '2024-01-01T02:00:00Z' },
        { id: 'child-3', name: 'Task 3', status: 'completed', parentSessionId: 'child-2', updatedAt: '2024-01-01T03:00:00Z', lastActivityAt: '2024-01-01T03:00:00Z' },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const stepNumbers = wrapper.findAll('[data-testid^="chain-step-number-"]');
      expect(stepNumbers.length).toBe(3);
      expect(stepNumbers[0].text()).toBe('1');
      expect(stepNumbers[1].text()).toBe('2');
      expect(stepNumbers[2].text()).toBe('3');
    });

    it('shows sequential numbering for truncated chains', async () => {
      const sessions = [
        { id: 'root-123', name: 'Root Session', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
      ];

      // Create 8 descendant sessions (chain of 8)
      for (let i = 1; i <= 8; i++) {
        sessions.push({
          id: `child-${i}`,
          name: `Task ${i}`,
          status: 'completed',
          parentSessionId: i === 1 ? 'root-123' : `child-${i - 1}`,
          updatedAt: `2024-01-01T${i.toString().padStart(2, '0')}:00:00Z`,
          lastActivityAt: `2024-01-01T${i.toString().padStart(2, '0')}:00:00Z`,
        });
      }

      sessionsStore.sessions = sessions;

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Should show first 2 + last 3 = 5 steps with numbers 1-5
      const stepNumbers = wrapper.findAll('[data-testid^="chain-step-number-"]');
      expect(stepNumbers.length).toBe(5);
      expect(stepNumbers[0].text()).toBe('1');
      expect(stepNumbers[1].text()).toBe('2');
      expect(stepNumbers[2].text()).toBe('3');
      expect(stepNumbers[3].text()).toBe('4');
      expect(stepNumbers[4].text()).toBe('5');
    });
  });

  describe('Step timestamps', () => {
    it('displays timestamps for each chain step', async () => {
      sessionsStore.sessions = [
        { id: 'root-123', name: 'Root Session', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'child-1', name: 'Task 1', status: 'completed', parentSessionId: 'root-123', updatedAt: '2024-01-15T10:30:00Z', lastActivityAt: '2024-01-15T10:30:00Z' },
        { id: 'child-2', name: 'Task 2', status: 'completed', parentSessionId: 'child-1', updatedAt: '2024-01-15T14:45:00Z', lastActivityAt: '2024-01-15T14:45:00Z' },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const timestamps = wrapper.findAll('[data-testid^="chain-step-timestamp-"]');
      expect(timestamps.length).toBe(2);
      // Verify the timestamps contain date, month, and time (format may vary by locale)
      expect(timestamps[0].text()).toMatch(/Jan.*15.*2024/);
      expect(timestamps[1].text()).toMatch(/Jan.*15.*2024/);
    });

    it('uses updatedAt as fallback when lastActivityAt is absent', async () => {
      sessionsStore.sessions = [
        { id: 'root-123', name: 'Root Session', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'child-1', name: 'Task 1', status: 'completed', parentSessionId: 'root-123', updatedAt: '2024-03-20T08:15:00Z' },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const timestamp = wrapper.find('[data-testid="chain-step-timestamp-0"]');
      expect(timestamp.exists()).toBe(true);
      expect(timestamp.text()).toMatch(/Mar.*20.*2024/);
    });

    it('does not display timestamp when both lastActivityAt and updatedAt are absent', async () => {
      sessionsStore.sessions = [
        { id: 'root-123', name: 'Root Session', status: 'waiting', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'child-1', name: 'Task 1', status: 'completed', parentSessionId: 'root-123' },
      ];

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const timestamp = wrapper.find('[data-testid="chain-step-timestamp-0"]');
      expect(timestamp.exists()).toBe(false);
    });
  });
});
