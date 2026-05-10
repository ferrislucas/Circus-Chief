import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ScheduledChildCard from './ScheduledChildCard.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(() => ({
    updateSessionFields: vi.fn(),
    updateNextTemplate: vi.fn(),
  })),
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('ScheduledChildCard.vue', () => {
  let mockSessionsStore;
  let mockUiStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    mockSessionsStore = {
      updateSessionFields: vi.fn().mockResolvedValue(undefined),
      updateNextTemplate: vi.fn().mockResolvedValue(undefined),
    };
    mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };

    useSessionsStore.mockReturnValue(mockSessionsStore);
    useUiStore.mockReturnValue(mockUiStore);
  });

  const baseSession = {
    id: 'sess-1',
    name: 'Test Child',
    status: 'scheduled',
    scheduledAt: Date.now() + 7200000, // 2 hours from now
    nextTemplateId: null,
    autoRescheduleEnabled: false,
    rescheduleCount: 0,
    maxRescheduleCount: null,
    projectId: 'proj-1',
  };

  const globalStubs = {
    OrchestrationPanel: {
      name: 'OrchestrationPanel',
      props: ['sessionId', 'projectId', 'currentTemplateId', 'sessionStatus', 'isDraft', 'inputHasContent', 'autoRescheduleEnabled', 'hideScheduleRow'],
      template: '<div class="orchestration-panel-stub" data-testid="orchestration-panel" />',
      emits: ['openSchedule', 'update:templateId', 'openAutoReschedule'],
    },
    SchedulingEditModal: {
      name: 'SchedulingEditModal',
      props: ['isOpen', 'session'],
      template: '<div class="scheduling-edit-modal-stub" data-testid="scheduling-edit-modal" />',
      emits: ['close', 'saved'],
    },
    AutoRescheduleModal: {
      name: 'AutoRescheduleModal',
      props: ['isOpen', 'session'],
      template: '<div class="auto-reschedule-modal-stub" data-testid="auto-reschedule-modal" />',
      emits: ['close', 'saved'],
    },
  };

  function mountComponent(session = baseSession, projectId = 'proj-1') {
    return mount(ScheduledChildCard, {
      props: { session, projectId },
      global: {
        stubs: globalStubs,
      },
    });
  }

  it('renders session name and scheduled status badge', () => {
    const wrapper = mountComponent();
    expect(wrapper.find('.session-name').text()).toBe('Test Child');
    expect(wrapper.find('.status-scheduled').text()).toBe('scheduled');
  });

  it('renders session name as a button that emits open-session-overlay on click', async () => {
    // Note: Custom emit capture via wrapper.emitted() is unreliable with
    // Vue 3 script setup SFCs (known Vue Test Utils limitation).
    // Use attrs listener to capture the emitted event.
    const overlaySpy = vi.fn();
    const wrapper = mount(ScheduledChildCard, {
      props: { session: baseSession, projectId: 'proj-1' },
      attrs: { onOpenSessionOverlay: overlaySpy },
      global: { stubs: globalStubs },
    });
    const button = wrapper.find('.session-name-link');
    expect(button.exists()).toBe(true);
    expect(button.element.tagName).toBe('BUTTON');
    expect(button.find('.session-name').text()).toBe('Test Child');

    await button.trigger('click');
    expect(overlaySpy).toHaveBeenCalledWith('sess-1');
  });

  it('button is keyboard accessible with tabindex', async () => {
    const wrapper = mountComponent();
    const button = wrapper.find('.session-name-link');
    // Native <button> elements are inherently keyboard-accessible (Enter/Space trigger click)
    // Verify it's a button element (not a div/span that would need tabindex)
    expect(button.element.tagName).toBe('BUTTON');
    // Buttons are focusable by default — no tabindex needed
    expect(button.element.getAttribute('tabindex')).toBeNull();
  });

  it('renders timing info with countdown and absolute time', () => {
    const wrapper = mountComponent();
    const timingText = wrapper.find('.timing-text');
    const timingAbsolute = wrapper.find('.timing-absolute');
    expect(timingText.exists()).toBe(true);
    expect(timingAbsolute.exists()).toBe(true);
    // Should contain "in" for future times
    expect(timingText.text()).toContain('in');
    // Should contain AM or PM
    const hasTimeFormat = timingAbsolute.text().includes('AM') || timingAbsolute.text().includes('PM');
    expect(hasTimeFormat).toBe(true);
  });

  it('shows Edit button that opens SchedulingEditModal', async () => {
    const wrapper = mountComponent();
    const editBtn = wrapper.findAll('.timing-action-btn')[0];
    expect(editBtn.text()).toBe('Edit');

    await editBtn.trigger('click');
    await wrapper.vm.$nextTick();

    const modal = wrapper.findComponent({ name: 'SchedulingEditModal' });
    expect(modal.exists()).toBe(true);
    expect(modal.props('isOpen')).toBe(true);
    expect(modal.props('session')).toEqual(baseSession);
  });

  it('SchedulingEditModal closes on @close event', async () => {
    const wrapper = mountComponent();
    // Open the modal
    await wrapper.findAll('.timing-action-btn')[0].trigger('click');
    await wrapper.vm.$nextTick();

    const modal = wrapper.findComponent({ name: 'SchedulingEditModal' });
    expect(modal.props('isOpen')).toBe(true);

    // Emit close
    modal.vm.$emit('close');
    await wrapper.vm.$nextTick();

    expect(modal.props('isOpen')).toBe(false);
  });

  it('Cancel button calls confirm and cancels session', async () => {
    window.confirm = vi.fn().mockReturnValue(true);

    const wrapper = mountComponent();
    const cancelBtn = wrapper.findAll('.timing-action-btn')[1];
    expect(cancelBtn.text()).toBe('Cancel');

    await cancelBtn.trigger('click');
    await wrapper.vm.$nextTick();

    expect(window.confirm).toHaveBeenCalledWith('Cancel this scheduled session?');
    expect(mockSessionsStore.updateSessionFields).toHaveBeenCalledWith('sess-1', { status: 'stopped' });
    expect(mockUiStore.success).toHaveBeenCalledWith('Session cancelled');
  });

  it('Cancel button does nothing if confirm is dismissed', async () => {
    window.confirm = vi.fn().mockReturnValue(false);

    const wrapper = mountComponent();
    const cancelBtn = wrapper.findAll('.timing-action-btn')[1];
    await cancelBtn.trigger('click');
    await wrapper.vm.$nextTick();

    expect(window.confirm).toHaveBeenCalled();
    expect(mockSessionsStore.updateSessionFields).not.toHaveBeenCalled();
  });

  it('renders OrchestrationPanel', () => {
    const wrapper = mountComponent();
    expect(wrapper.findComponent({ name: 'OrchestrationPanel' }).exists()).toBe(true);
  });

  it('hides scheduling row in OrchestrationPanel', () => {
    const wrapper = mountComponent();
    const panel = wrapper.findComponent({ name: 'OrchestrationPanel' });
    expect(panel.props('hideScheduleRow')).toBe(true);
  });

  it('passes correct props to OrchestrationPanel', () => {
    const session = {
      ...baseSession,
      nextTemplateId: 'tpl-1',
      autoRescheduleEnabled: true,
    };
    const wrapper = mountComponent(session, 'proj-42');
    const panel = wrapper.findComponent({ name: 'OrchestrationPanel' });

    expect(panel.props('sessionId')).toBe('sess-1');
    expect(panel.props('projectId')).toBe('proj-42');
    expect(panel.props('currentTemplateId')).toBe('tpl-1');
    expect(panel.props('sessionStatus')).toBe('scheduled');
    expect(panel.props('isDraft')).toBe(false);
    expect(panel.props('inputHasContent')).toBe(true);
    expect(panel.props('autoRescheduleEnabled')).toBe(true);
    expect(panel.props('hideScheduleRow')).toBe(true);
  });

  it('handles template change event', async () => {
    const wrapper = mountComponent();
    const panel = wrapper.findComponent({ name: 'OrchestrationPanel' });

    panel.vm.$emit('update:templateId', 'tpl-new');
    await wrapper.vm.$nextTick();

    expect(mockSessionsStore.updateNextTemplate).toHaveBeenCalledWith('sess-1', 'tpl-new');
  });

  it('opens AutoRescheduleModal on openAutoReschedule event', async () => {
    const wrapper = mountComponent();
    const panel = wrapper.findComponent({ name: 'OrchestrationPanel' });

    panel.vm.$emit('openAutoReschedule');
    await wrapper.vm.$nextTick();

    const modal = wrapper.findComponent({ name: 'AutoRescheduleModal' });
    expect(modal.exists()).toBe(true);
    expect(modal.props('isOpen')).toBe(true);
    expect(modal.props('session')).toEqual(baseSession);
  });

  it('AutoRescheduleModal closes on @close event', async () => {
    const wrapper = mountComponent();
    const panel = wrapper.findComponent({ name: 'OrchestrationPanel' });

    // Open modal
    panel.vm.$emit('openAutoReschedule');
    await wrapper.vm.$nextTick();

    const modal = wrapper.findComponent({ name: 'AutoRescheduleModal' });
    expect(modal.props('isOpen')).toBe(true);

    // Close
    modal.vm.$emit('close');
    await wrapper.vm.$nextTick();

    expect(modal.props('isOpen')).toBe(false);
  });

  it('auto-reschedule status row shown when enabled', () => {
    const session = {
      ...baseSession,
      autoRescheduleEnabled: true,
      rescheduleCount: 2,
      maxRescheduleCount: 3,
    };
    const wrapper = mountComponent(session);
    expect(wrapper.text()).toContain('Auto-reschedule');
    expect(wrapper.text()).toContain('Attempt 2/3');
  });

  it('auto-reschedule status with unlimited max', () => {
    const session = {
      ...baseSession,
      autoRescheduleEnabled: true,
      rescheduleCount: 1,
      maxRescheduleCount: null,
    };
    const wrapper = mountComponent(session);
    expect(wrapper.text()).toContain('Attempt 1/∞');
  });
});
