import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { reactive } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import SchedulingInfo from './SchedulingInfo.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

// Shared mock instances so the composable and tests reference the same spies.
// `mutations` is reactive (not a plain object) so the `scheduleMutationInFlight`
// getter is a genuine Vue reactive dependency, matching the real Pinia store.
const mutations = reactive({});
const sharedSessionsStore = {
  updateSessionFields: vi.fn(),
  runScheduledNow: vi.fn(),
  scheduleMutationInFlight: (id) => mutations[id] || null,
  beginScheduleMutation: (id, kind) => {
    if (mutations[id]) return false;
    mutations[id] = kind;
    return true;
  },
  endScheduleMutation: (id) => { delete mutations[id]; },
};

const sharedUiStore = {
  success: vi.fn(),
  error: vi.fn(),
  showToast: vi.fn(),
};

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(() => sharedSessionsStore),
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(() => sharedUiStore),
}));

describe('SchedulingInfo.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.clearAllMocks();
    sharedSessionsStore.updateSessionFields.mockResolvedValue(undefined);
    sharedSessionsStore.runScheduledNow.mockResolvedValue(undefined);
    for (const key of Object.keys(mutations)) delete mutations[key];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const now = Date.now();

  const scheduledSession = {
    id: 'session-1',
    name: 'Test Workspace',
    status: 'scheduled',
    scheduledAt: now + 3600000, // 1 hour from now
    autoRescheduleEnabled: false,
    rescheduleCount: 0,
    maxRescheduleCount: null,
  };

  describe('scheduled workspace display', () => {
    it('displays scheduled workspace info when status is "scheduled"', () => {
      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      expect(wrapper.find('.scheduling-info').exists()).toBe(true);
      expect(wrapper.find('.info-title').text()).toBe('Scheduled Workspace');
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

    it('does not display scheduled info when scheduledAt is missing', () => {
      const scheduledWithoutTime = {
        ...scheduledSession,
        scheduledAt: null,
      };

      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledWithoutTime,
        },
      });

      expect(wrapper.find('.scheduling-info').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('56 years ago');
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

    it('displays absolute time for scheduled workspace', () => {
      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      expect(wrapper.find('.absolute-time').exists()).toBe(true);
      // Should contain day of week, month, day, year, time
      expect(wrapper.find('.absolute-time').text()).toMatch(/\w+,/);
    });

    it('displays action buttons for scheduled workspace', () => {
      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      const buttons = wrapper.findAll('.actions button');
      expect(buttons.length).toBe(3);
      expect(buttons[0].text()).toBe('Start Now');
      expect(buttons[0].classes()).toContain('btn-primary');
      expect(buttons[1].text()).toBe('Edit Schedule');
      expect(buttons[2].text()).toBe('Cancel');
    });

    it('shows auto-reschedule badge for scheduled workspace with reschedule enabled', () => {
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

  describe('no content for non-scheduled/non-rescheduling workspaces', () => {
    it('renders nothing for completed workspaces without reschedule', () => {
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

    it('renders nothing for error workspaces without reschedule', () => {
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

  describe('Cancel action', () => {
    // Cancel tests need real timers so that async rejections can settle
    beforeEach(() => {
      vi.useRealTimers();
    });
    afterEach(() => {
      vi.useFakeTimers();
    });

    it('shows confirm dialog when Cancel button is clicked', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);

      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      const cancelButton = wrapper.find('[data-testid="scheduled-cancel-btn"]');
      await cancelButton.trigger('click');
      await wrapper.vm.$nextTick();

      expect(window.confirm).toHaveBeenCalledWith('Cancel this scheduled workspace?');
    });

    it('calls updateSessionFields with status stopped and scheduledAt null when confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      const cancelButton = wrapper.find('[data-testid="scheduled-cancel-btn"]');
      await cancelButton.trigger('click');
      await wrapper.vm.$nextTick();

      expect(sharedSessionsStore.updateSessionFields).toHaveBeenCalledWith('session-1', {
        status: 'stopped',
        scheduledAt: null,
      });
    });

    it('shows success toast after successful cancellation', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      const cancelButton = wrapper.find('[data-testid="scheduled-cancel-btn"]');
      await cancelButton.trigger('click');
      await wrapper.vm.$nextTick();

      expect(sharedUiStore.success).toHaveBeenCalledWith('Workspace cancelled');
    });

    it('does not call updateSessionFields when user dismisses confirm', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);

      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      const cancelButton = wrapper.find('[data-testid="scheduled-cancel-btn"]');
      await cancelButton.trigger('click');
      await wrapper.vm.$nextTick();

      expect(sharedSessionsStore.updateSessionFields).not.toHaveBeenCalled();
    });

    it('disables Cancel button during cancellation', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      let resolvePromise;
      sharedSessionsStore.updateSessionFields.mockImplementation(
        () => new Promise((resolve) => { resolvePromise = resolve; }),
      );

      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      const cancelButton = wrapper.find('[data-testid="scheduled-cancel-btn"]');
      await cancelButton.trigger('click');
      await wrapper.vm.$nextTick();

      // Button should be disabled while the API call is in progress
      expect(cancelButton.attributes('disabled')).toBeDefined();

      resolvePromise();
      await wrapper.vm.$nextTick();
    });

    it('shows error toast when updateSessionFields rejects', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      sharedSessionsStore.updateSessionFields.mockRejectedValue(new Error('Network error'));

      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      const cancelButton = wrapper.find('[data-testid="scheduled-cancel-btn"]');
      await cancelButton.trigger('click');
      await new Promise((resolve) => setTimeout(resolve, 50));
      await wrapper.vm.$nextTick();

      expect(sharedUiStore.error).toHaveBeenCalledWith('Failed to cancel workspace: Network error');
    });

    it('re-enables Cancel button after error', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      sharedSessionsStore.updateSessionFields.mockRejectedValue(new Error('fail'));

      const wrapper = mount(SchedulingInfo, {
        props: {
          session: scheduledSession,
        },
      });

      const cancelButton = wrapper.find('[data-testid="scheduled-cancel-btn"]');
      await cancelButton.trigger('click');
      await new Promise((resolve) => setTimeout(resolve, 50));
      await wrapper.vm.$nextTick();

      expect(cancelButton.attributes('disabled')).toBeUndefined();
    });

    it('disables Start Now and Edit Schedule together while Cancel is in flight', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      let resolveCancel;
      sharedSessionsStore.updateSessionFields.mockImplementation(
        () => new Promise((resolve) => { resolveCancel = resolve; })
      );

      const wrapper = mount(SchedulingInfo, { props: { session: scheduledSession } });
      const startBtn = wrapper.find('[data-testid="scheduled-start-now-btn"]');
      const editBtn = wrapper.find('[data-testid="scheduled-edit-btn"]');
      const cancelBtn = wrapper.find('[data-testid="scheduled-cancel-btn"]');

      await cancelBtn.trigger('click');
      await wrapper.vm.$nextTick();

      expect(startBtn.attributes('disabled')).toBeDefined();
      expect(editBtn.attributes('disabled')).toBeDefined();

      resolveCancel();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(startBtn.attributes('disabled')).toBeUndefined();
      expect(editBtn.attributes('disabled')).toBeUndefined();
    });

    it('rapid double-click on Cancel only confirms/cancels once (handler-level guard)', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      let resolveCancel;
      sharedSessionsStore.updateSessionFields.mockImplementation(
        () => new Promise((resolve) => { resolveCancel = resolve; })
      );

      const wrapper = mount(SchedulingInfo, { props: { session: scheduledSession } });
      const cancelBtn = wrapper.find('[data-testid="scheduled-cancel-btn"]');

      const firstClick = cancelBtn.trigger('click');
      const secondClick = cancelBtn.trigger('click');
      await Promise.all([firstClick, secondClick]);

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(sharedSessionsStore.updateSessionFields).toHaveBeenCalledTimes(1);
      resolveCancel();
    });

    it('cross-control: clicking Start Now disables the Cancel and Edit Schedule buttons too', async () => {
      let resolveStart;
      sharedSessionsStore.runScheduledNow.mockImplementation(
        () => new Promise((resolve) => { resolveStart = resolve; })
      );

      const wrapper = mount(SchedulingInfo, { props: { session: scheduledSession } });
      const startBtn = wrapper.find('[data-testid="scheduled-start-now-btn"]');
      const editBtn = wrapper.find('[data-testid="scheduled-edit-btn"]');
      const cancelBtn = wrapper.find('[data-testid="scheduled-cancel-btn"]');

      await startBtn.trigger('click');
      await wrapper.vm.$nextTick();

      expect(startBtn.text()).toBe('Starting...');
      expect(editBtn.attributes('disabled')).toBeDefined();
      expect(cancelBtn.attributes('disabled')).toBeDefined();

      resolveStart();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(editBtn.attributes('disabled')).toBeUndefined();
      expect(cancelBtn.attributes('disabled')).toBeUndefined();
    });
  });
});
