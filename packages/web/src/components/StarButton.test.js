import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import StarButton from './StarButton.vue';

// Mock the sessions store
vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(),
}));

// Mock the UI store
vi.mock('../stores/ui.js', () => ({
  useUIStore: vi.fn(),
}));

import { useSessionsStore } from '../stores/sessions.js';
import { useUIStore } from '../stores/ui.js';

describe('StarButton', () => {
  let mockSessionsStore;
  let mockUIStore;

  beforeEach(() => {
    setActivePinia(createPinia());

    mockSessionsStore = {
      toggleSessionStar: vi.fn().mockResolvedValue({}),
    };
    useSessionsStore.mockReturnValue(mockSessionsStore);

    mockUIStore = {
      error: vi.fn(),
    };
    useUIStore.mockReturnValue(mockUIStore);
  });

  describe('rendering', () => {
    it('renders as a button element', () => {
      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: false,
        },
      });

      expect(wrapper.find('button').exists()).toBe(true);
    });

    it('displays filled star when starred is true', () => {
      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: true,
        },
      });

      const star = wrapper.find('.star-icon');
      expect(star.text()).toBe('⭐');
    });

    it('displays empty star when starred is false', () => {
      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: false,
        },
      });

      const star = wrapper.find('.star-icon');
      expect(star.text()).toBe('☆');
    });

    it('applies is-starred class when starred is true', () => {
      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: true,
        },
      });

      expect(wrapper.find('.star-button').classes()).toContain('is-starred');
    });

    it('does not apply is-starred class when starred is false', () => {
      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: false,
        },
      });

      expect(wrapper.find('.star-button').classes()).not.toContain('is-starred');
    });
  });

  describe('size variations', () => {
    it('applies small size class', () => {
      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: false,
          size: 'small',
        },
      });

      expect(wrapper.find('.star-button').classes()).toContain('text-xs');
    });

    it('applies medium size class by default', () => {
      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: false,
        },
      });

      expect(wrapper.find('.star-button').classes()).toContain('text-sm');
    });

    it('applies large size class', () => {
      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: false,
          size: 'large',
        },
      });

      expect(wrapper.find('.star-button').classes()).toContain('text-lg');
    });
  });

  describe('toggle behavior', () => {
    it('calls toggleSessionStar when clicked', async () => {
      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session-123',
          starred: false,
        },
      });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(mockSessionsStore.toggleSessionStar).toHaveBeenCalledWith('test-session-123');
    });

    it('sets loading state during toggle', async () => {
      mockSessionsStore.toggleSessionStar.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: false,
        },
      });

      const button = wrapper.find('button');
      await button.trigger('click');

      // Check loading state immediately after click
      expect(wrapper.find('.star-button').classes()).toContain('is-loading');

      await flushPromises();
    });
  });

  describe('disabled state', () => {
    it('disables button when disabled prop is true', () => {
      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: false,
          disabled: true,
        },
      });

      expect(wrapper.find('button').attributes('disabled')).toBeDefined();
    });

    it('disables button when loading', async () => {
      mockSessionsStore.toggleSessionStar.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: false,
        },
      });

      await wrapper.find('button').trigger('click');

      // Button should be disabled while loading
      expect(wrapper.find('button').attributes('disabled')).toBeDefined();
    });

    it('does not call toggle when disabled', async () => {
      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: false,
          disabled: true,
        },
      });

      await wrapper.find('button').trigger('click');

      expect(mockSessionsStore.toggleSessionStar).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('shows error message on API failure', async () => {
      mockSessionsStore.toggleSessionStar.mockRejectedValueOnce(new Error('API Error'));

      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: false,
        },
      });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(mockUIStore.error).toHaveBeenCalledWith('Failed to toggle star');
    });

    it('clears loading state after error', async () => {
      mockSessionsStore.toggleSessionStar.mockRejectedValueOnce(new Error('API Error'));

      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: false,
        },
      });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(wrapper.find('.star-button').classes()).not.toContain('is-loading');
    });
  });

  describe('accessibility', () => {
    it('has title attribute when starred', () => {
      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: true,
        },
      });

      expect(wrapper.find('button').attributes('title')).toBe('Unstar session');
    });

    it('has title attribute when not starred', () => {
      const wrapper = mount(StarButton, {
        props: {
          sessionId: 'test-session',
          starred: false,
        },
      });

      expect(wrapper.find('button').attributes('title')).toBe('Star session');
    });
  });
});
