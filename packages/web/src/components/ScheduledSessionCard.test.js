import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ScheduledSessionCard from './ScheduledSessionCard.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(() => ({
    updateSessionFields: vi.fn(),
  })),
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('ScheduledSessionCard.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mockSession = {
    id: 'session-1',
    name: 'Test Session',
    projectName: 'Test Project',
    scheduledAt: Date.now() + 3600000, // 1 hour from now
    autoRescheduleEnabled: false,
    rescheduleCount: 0,
    maxRescheduleCount: null,
  };

  it('renders scheduled session card', () => {
    const wrapper = mount(ScheduledSessionCard, {
      props: {
        session: mockSession,
      },
    });

    expect(wrapper.find('.scheduled-session-card').exists()).toBe(true);
    expect(wrapper.find('.session-name').text()).toBe('Test Session');
    expect(wrapper.find('.project-name').text()).toBe('Test Project');
    expect(wrapper.find('.status-scheduled').text()).toBe('scheduled');
  });

  it('displays timing information', () => {
    const wrapper = mount(ScheduledSessionCard, {
      props: {
        session: mockSession,
      },
    });

    const timingItems = wrapper.findAll('.timing-item');
    expect(timingItems.length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain('in ');
  });

  it('shows absolute time display', () => {
    const wrapper = mount(ScheduledSessionCard, {
      props: {
        session: mockSession,
      },
    });

    const text = wrapper.text();
    const hasTimeFormat = text.includes('AM') || text.includes('PM') || text.includes('a.m.') || text.includes('p.m.');
    expect(hasTimeFormat).toBe(true);
  });

  it('displays auto-reschedule info when enabled', () => {
    const sessionWithReschedule = {
      ...mockSession,
      autoRescheduleEnabled: true,
      rescheduleCount: 2,
      maxRescheduleCount: 5,
    };

    const wrapper = mount(ScheduledSessionCard, {
      props: {
        session: sessionWithReschedule,
      },
    });

    expect(wrapper.text()).toContain('Auto-reschedule');
    expect(wrapper.text()).toContain('Attempt 2/5');
  });

  it('displays unlimited reschedule count when maxRescheduleCount is null', () => {
    const sessionWithUnlimited = {
      ...mockSession,
      autoRescheduleEnabled: true,
      rescheduleCount: 3,
      maxRescheduleCount: null,
    };

    const wrapper = mount(ScheduledSessionCard, {
      props: {
        session: sessionWithUnlimited,
      },
    });

    expect(wrapper.text()).toContain('Attempt 3/∞');
  });

  it('does not display auto-reschedule info when disabled', () => {
    const sessionNoReschedule = {
      ...mockSession,
      autoRescheduleEnabled: false,
    };

    const wrapper = mount(ScheduledSessionCard, {
      props: {
        session: sessionNoReschedule,
      },
    });

    expect(wrapper.text()).not.toContain('Auto-reschedule');
  });

  it('has Start Now and Cancel buttons', () => {
    const wrapper = mount(ScheduledSessionCard, {
      props: {
        session: mockSession,
      },
    });

    const allButtons = wrapper.findAll('button');
    expect(allButtons.length).toBe(3); // Edit, Start Now, Cancel

    // Check action buttons specifically
    const actionButtons = wrapper.findAll('.card-actions button');
    expect(actionButtons.length).toBe(2);
    expect(actionButtons[0].text()).toBe('Start Now');
    expect(actionButtons[1].text()).toBe('Cancel');

    // Check edit button exists
    const editButton = wrapper.find('.edit-btn');
    expect(editButton.exists()).toBe(true);
  });

  it('handles Start Now action', async () => {
    const mockSessionsStore = {
      updateSessionFields: vi.fn().mockResolvedValue(undefined),
    };
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };

    useSessionsStore.mockReturnValue(mockSessionsStore);
    useUiStore.mockReturnValue(mockUiStore);

    const wrapper = mount(ScheduledSessionCard, {
      props: {
        session: mockSession,
      },
    });

    const startButton = wrapper.findAll('.card-actions button')[0];
    await startButton.trigger('click');
    await wrapper.vm.$nextTick();

    expect(mockSessionsStore.updateSessionFields).toHaveBeenCalledWith('session-1', {
      status: 'starting',
      scheduledAt: null,
    });
    expect(mockUiStore.success).toHaveBeenCalledWith('Session started');
  });

  it('handles Cancel action with confirmation', async () => {
    const mockSessionsStore = {
      updateSessionFields: vi.fn().mockResolvedValue(undefined),
    };
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };

    useSessionsStore.mockReturnValue(mockSessionsStore);
    useUiStore.mockReturnValue(mockUiStore);

    // Mock confirm dialog
    window.confirm = vi.fn().mockReturnValue(true);

    const wrapper = mount(ScheduledSessionCard, {
      props: {
        session: mockSession,
      },
    });

    const cancelButton = wrapper.findAll('.card-actions button')[1];
    await cancelButton.trigger('click');
    await wrapper.vm.$nextTick();

    expect(window.confirm).toHaveBeenCalled();
    expect(mockSessionsStore.updateSessionFields).toHaveBeenCalledWith('session-1', {
      status: 'stopped',
    });
    expect(mockUiStore.success).toHaveBeenCalledWith('Session cancelled');
  });

  it('does not cancel when user confirms no', async () => {
    const mockSessionsStore = {
      updateSessionFields: vi.fn().mockResolvedValue(undefined),
    };
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };

    useSessionsStore.mockReturnValue(mockSessionsStore);
    useUiStore.mockReturnValue(mockUiStore);

    // Mock confirm dialog to return false
    window.confirm = vi.fn().mockReturnValue(false);

    const wrapper = mount(ScheduledSessionCard, {
      props: {
        session: mockSession,
      },
    });

    const cancelButton = wrapper.findAll('.card-actions button')[1];
    await cancelButton.trigger('click');
    await wrapper.vm.$nextTick();

    expect(window.confirm).toHaveBeenCalled();
    expect(mockSessionsStore.updateSessionFields).not.toHaveBeenCalled();
  });

  it('shows loading state on buttons during action', async () => {
    const mockSessionsStore = {
      updateSessionFields: vi.fn(() => new Promise((resolve) => setTimeout(resolve, 100))),
    };
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };

    useSessionsStore.mockReturnValue(mockSessionsStore);
    useUiStore.mockReturnValue(mockUiStore);

    const wrapper = mount(ScheduledSessionCard, {
      props: {
        session: mockSession,
      },
    });

    const startButton = wrapper.findAll('.card-actions button')[0];
    startButton.trigger('click');
    await wrapper.vm.$nextTick();

    expect(startButton.text()).toBe('Loading...');
    expect(startButton.attributes('disabled')).toBe('');

    // Wait for promise to resolve
    await new Promise((resolve) => setTimeout(resolve, 150));
    await wrapper.vm.$nextTick();

    expect(startButton.text()).toBe('Start Now');
    expect(startButton.attributes('disabled')).toBeUndefined();
  });

  it('handles Start Now error gracefully', async () => {
    const mockError = new Error('Network error');
    const mockSessionsStore = {
      updateSessionFields: vi.fn().mockRejectedValue(mockError),
    };
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };

    useSessionsStore.mockReturnValue(mockSessionsStore);
    useUiStore.mockReturnValue(mockUiStore);

    const wrapper = mount(ScheduledSessionCard, {
      props: {
        session: mockSession,
      },
    });

    const startButton = wrapper.findAll('.card-actions button')[0];
    await startButton.trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await wrapper.vm.$nextTick();

    expect(mockUiStore.error).toHaveBeenCalledWith('Failed to start session: Network error');
    expect(startButton.text()).toBe('Start Now');
  });

  it('handles Cancel error gracefully', async () => {
    const mockError = new Error('Failed to cancel');
    const mockSessionsStore = {
      updateSessionFields: vi.fn().mockRejectedValue(mockError),
    };
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };

    useSessionsStore.mockReturnValue(mockSessionsStore);
    useUiStore.mockReturnValue(mockUiStore);

    window.confirm = vi.fn().mockReturnValue(true);

    const wrapper = mount(ScheduledSessionCard, {
      props: {
        session: mockSession,
      },
    });

    const cancelButton = wrapper.findAll('.card-actions button')[1];
    await cancelButton.trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await wrapper.vm.$nextTick();

    expect(mockUiStore.error).toHaveBeenCalledWith('Failed to cancel session: Failed to cancel');
    expect(cancelButton.text()).toBe('Cancel');
  });

  it('formats time correctly for different time distances', () => {
    const sessionInMin = {
      ...mockSession,
      scheduledAt: Date.now() + 300000, // 5 minutes
    };

    const wrapper = mount(ScheduledSessionCard, {
      props: {
        session: sessionInMin,
      },
    });

    expect(wrapper.text()).toContain('in ');
  });

  it('displays session without project name gracefully', () => {
    const sessionNoProject = {
      ...mockSession,
      projectName: undefined,
    };

    const wrapper = mount(ScheduledSessionCard, {
      props: {
        session: sessionNoProject,
      },
    });

    expect(wrapper.find('.session-name').text()).toBe('Test Session');
    expect(wrapper.find('.session-project').exists()).toBe(false);
  });
});
