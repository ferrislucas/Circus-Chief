import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ScheduleSessionModal from './ScheduleSessionModal.vue';
import { SESSIONS_STORE_KEY } from '../composables/useOverlayStore.js';

const { mockApi, mockModalClose, mockModalOpenUpdate, mockUiStore } = vi.hoisted(() => ({
  mockApi: { scheduleSession: vi.fn() },
  mockModalClose: vi.fn(),
  mockModalOpenUpdate: vi.fn(),
  mockUiStore: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../composables/useApi.js', () => ({ api: mockApi }));
vi.mock('../stores/ui.js', () => ({ useUiStore: () => mockUiStore }));

describe('ScheduleSessionModal.vue', () => {
  const sessionsStore = {
    getSessionById: vi.fn(),
    updateSession: vi.fn(),
  };

  function mountModal() {
    return mount(ScheduleSessionModal, {
      props: {
        isOpen: true,
        sessionId: 'session-1',
        prompt: 'Keep this follow-up prompt',
        onClose: mockModalClose,
        'onUpdate:isOpen': mockModalOpenUpdate,
      },
      global: {
        provide: {
          [SESSIONS_STORE_KEY]: sessionsStore,
        },
      },
    });
  }

  async function submitSchedule(wrapper) {
    await wrapper.find('#scheduled-at').setValue('2099-01-01T12:00');
    await wrapper.find('.btn-primary').trigger('click');
    await flushPromises();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.scheduleSession.mockReset();
  });

  it('keeps the form open and visible when scheduling fails', async () => {
    mockApi.scheduleSession.mockRejectedValue(new Error('Scheduling service is unavailable'));
    const wrapper = mountModal();

    await submitSchedule(wrapper);

    expect(wrapper.find('.modal-backdrop').exists()).toBe(true);
    expect(wrapper.find('#scheduled-at').element.value).toBe('2099-01-01T12:00');
    expect(wrapper.props('prompt')).toBe('Keep this follow-up prompt');
    expect(wrapper.find('[data-testid="schedule-error"]').text()).toBe(
      'Failed to schedule workspace: Scheduling service is unavailable'
    );
    expect(mockUiStore.error).toHaveBeenCalledWith(
      'Failed to schedule workspace: Scheduling service is unavailable'
    );
    expect(wrapper.find('.btn-primary').text()).toBe('Schedule');
  });

  it('updates the store, notifies success, and closes after scheduling succeeds', async () => {
    const scheduledSession = { id: 'session-1', status: 'scheduled', scheduledAt: 4070952000000 };
    mockApi.scheduleSession.mockResolvedValue(scheduledSession);
    const wrapper = mountModal();

    await submitSchedule(wrapper);

    expect(sessionsStore.updateSession).toHaveBeenCalledWith(scheduledSession);
    expect(mockUiStore.success).toHaveBeenCalledWith('Workspace scheduled successfully');
    expect(mockModalOpenUpdate).toHaveBeenCalledWith(false);
    expect(mockModalClose).toHaveBeenCalledOnce();
  });
});
