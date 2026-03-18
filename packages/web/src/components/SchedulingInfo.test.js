import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import SchedulingInfo from './SchedulingInfo.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(() => ({
    updateSessionFields: vi.fn(),
  })),
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(() => ({
    showToast: vi.fn(),
  })),
}));

describe('SchedulingInfo.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const now = Date.now();

  const scheduledSession = {
    id: 'session-1',
    name: 'Test Session',
    status: 'scheduled',
    scheduledAt: now + 3600000, // 1 hour from now
    autoRescheduleEnabled: false,
    rescheduleCount: 0,
    maxRescheduleCount: null,
  };

  describe('scheduled session display', () => {
    it('displays scheduled session info when status is "scheduled"', () => {
      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      expect(wrapper.find('.scheduling-info').exists()).toBe(true);
      expect(wrapper.find('.info-title').text()).toBe('Scheduled Session');
      expect(wrapper.text()).toContain('Starting');
    });

    it('does not display scheduled info for other statuses', () => {
      const runningSession = {
        ...scheduledSession,
        status: 'running',
        autoRescheduleEnabled: false,
      };

      const wrapper = mount(SchedulingInfo, {
        props: {
          session: runningSession,
        },
      });

      expect(wrapper.find('.scheduling-info').exists()).toBe(false);
    });

    it('displays countdown time', () => {
      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      const countdownText = wrapper.find('.countdown-text').text();
      expect(countdownText).toContain('Starting');
      expect(countdownText).toContain('in');
    });

    it('displays absolute time for scheduled session', () => {
      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      expect(wrapper.find('.absolute-time').exists()).toBe(true);
      // Should contain day of week, month, day, year, time
      expect(wrapper.find('.absolute-time').text()).toMatch(/\w+,/);
    });

    it('displays action buttons for scheduled session', () => {
      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      const buttons = wrapper.findAll('.actions button');
      expect(buttons.length).toBe(2); // Edit Schedule and Cancel
      expect(buttons[0].text()).toBe('Edit Schedule');
      expect(buttons[1].text()).toBe('Cancel');
    });

    it('shows auto-reschedule badge for scheduled session with reschedule enabled', () => {
      const sessionWithReschedule = {
        ...scheduledSession,
        autoRescheduleEnabled: true,
      };

      const wrapper = mount(SchedulingInfo, {
        props: {
          session: sessionWithReschedule,
        },
      });

      expect(wrapper.find('.reschedule-badge').exists()).toBe(true);
      expect(wrapper.text()).toContain('Auto-reschedule enabled');
    });

    it('does not show auto-reschedule badge when disabled', () => {
      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      expect(wrapper.find('.reschedule-badge').exists()).toBe(false);
    });
  });

  describe('countdown updates', () => {
    it('sets up countdown interval on mount', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

      mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
      setIntervalSpy.mockRestore();
    });

    it('clears countdown interval on unmount', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      wrapper.unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });

  describe('no content for non-scheduled/non-rescheduling sessions', () => {
    it('renders nothing for completed sessions without reschedule', () => {
      const completedSession = {
        ...scheduledSession,
        status: 'completed',
        autoRescheduleEnabled: false,
      };

      const wrapper = mount(SchedulingInfo, {
        props: {
          session: completedSession,
        },
      });

      expect(wrapper.find('.scheduling-info').exists()).toBe(false);
      expect(wrapper.find('.auto-reschedule-panel').exists()).toBe(false);
    });

    it('renders nothing for error sessions without reschedule', () => {
      const errorSession = {
        ...scheduledSession,
        status: 'error',
        autoRescheduleEnabled: false,
      };

      const wrapper = mount(SchedulingInfo, {
        props: {
          session: errorSession,
        },
      });

      expect(wrapper.find('.scheduling-info').exists()).toBe(false);
      expect(wrapper.find('.auto-reschedule-panel').exists()).toBe(false);
    });
  });
});
