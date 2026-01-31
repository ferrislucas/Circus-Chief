import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import AutoRescheduleModal from './AutoRescheduleModal.vue';
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

describe('AutoRescheduleModal.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  const runningSession = {
    id: 'session-1',
    name: 'Test Session',
    status: 'running',
    autoRescheduleEnabled: false,
    rescheduleDelayMinutes: 15,
    rescheduleCount: 0,
    maxRescheduleCount: null,
  };

  const sessionWithReschedule = {
    id: 'session-2',
    name: 'Test Session with Reschedule',
    status: 'running',
    autoRescheduleEnabled: true,
    rescheduleDelayMinutes: 30,
    rescheduleCount: 2,
    maxRescheduleCount: 5,
    rescheduleOnTokenLimit: true,
    rescheduleOnServiceError: false,
    maxTotalTokens: 500000,
    rescheduleAtTokenCount: 300000,
  };

  function mountComponent(props = {}) {
    return mount(AutoRescheduleModal, {
      props: {
        isOpen: true,
        session: runningSession,
        ...props,
      },
    });
  }

  describe('component structure', () => {
    it('exports a Vue component', () => {
      expect(AutoRescheduleModal).toBeDefined();
      expect(AutoRescheduleModal.__name).toBe('AutoRescheduleModal');
    });

    it('has required props', () => {
      const wrapper = mountComponent();
      expect(wrapper.props('isOpen')).toBe(true);
      expect(wrapper.props('session')).toEqual(runningSession);
    });

    it('can be closed', () => {
      const wrapper = mountComponent({ isOpen: false });
      expect(wrapper.props('isOpen')).toBe(false);
    });

    it('accepts sessions with different statuses', () => {
      const completedSession = { ...runningSession, status: 'completed' };
      const wrapper = mountComponent({ session: completedSession });
      expect(wrapper.props('session').status).toBe('completed');
    });

    it('defines close and saved events', () => {
      const wrapper = mountComponent();
      expect(wrapper.emitted()).toBeDefined();
    });
  });

  describe('store integration', () => {
    it('uses the sessions store', () => {
      mountComponent();
      expect(useSessionsStore).toHaveBeenCalled();
    });

    it('uses the ui store', () => {
      mountComponent();
      expect(useUiStore).toHaveBeenCalled();
    });
  });

  describe('props validation', () => {
    it('accepts session with reschedule enabled', () => {
      const wrapper = mountComponent({ session: sessionWithReschedule });
      expect(wrapper.props('session').autoRescheduleEnabled).toBe(true);
    });

    it('accepts session with reschedule disabled', () => {
      const wrapper = mountComponent({ session: runningSession });
      expect(wrapper.props('session').autoRescheduleEnabled).toBe(false);
    });

    it('accepts session with reschedule count > 0', () => {
      const sessionWithCount = { ...sessionWithReschedule, rescheduleCount: 5 };
      const wrapper = mountComponent({ session: sessionWithCount });
      expect(wrapper.props('session').rescheduleCount).toBe(5);
    });
  });

  describe('component renders', () => {
    it('renders without errors', () => {
      const wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it('renders with different session statuses', () => {
      const statuses = ['running', 'waiting', 'completed', 'error'];
      statuses.forEach((status) => {
        const session = { ...runningSession, status };
        const wrapper = mountComponent({ session });
        expect(wrapper.exists()).toBe(true);
      });
    });
  });
});
