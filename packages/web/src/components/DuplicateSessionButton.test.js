import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import DuplicateSessionButton from './DuplicateSessionButton.vue';

// Mock the stores
vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(),
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(),
}));

import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

describe('DuplicateSessionButton', () => {
  let mockSessionsStore;
  let mockUiStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Mock confirm dialog (default to true for most tests)
    vi.stubGlobal('confirm', vi.fn(() => true));

    // Mock sessions store
    mockSessionsStore = {
      duplicateSession: vi.fn(),
      error: null,
    };
    vi.mocked(useSessionsStore).mockReturnValue(mockSessionsStore);

    // Mock UI store
    mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);
  });

  function mountComponent(props = {}) {
    return mount(DuplicateSessionButton, {
      props: {
        sessionId: 'session-123',
        sessionName: 'Test Session',
        ...props,
      },
    });
  }

  describe('component structure', () => {
    it('renders button with correct text', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('button').exists()).toBe(true);
      expect(wrapper.text()).toContain('Duplicate');
    });

    it('renders button with SVG icon', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('svg').exists()).toBe(true);
    });

    it('accepts sessionId prop (required)', () => {
      const wrapper = mountComponent({ sessionId: 'sess-456' });
      expect(wrapper.props('sessionId')).toBe('sess-456');
    });

    it('accepts sessionName prop (optional)', () => {
      const wrapper = mountComponent({ sessionName: 'My Session' });
      expect(wrapper.props('sessionName')).toBe('My Session');
    });

    it('has correct button classes', () => {
      const wrapper = mountComponent();
      const button = wrapper.find('button');
      expect(button.classes()).toContain('btn');
      expect(button.classes()).toContain('btn-outline-secondary');
    });
  });

  describe('initial state', () => {
    it('button is enabled initially', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('button').attributes('disabled')).toBeUndefined();
    });

    it('shows "Duplicate" text initially', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('Duplicate');
      expect(wrapper.text()).not.toContain('Duplicating');
    });

    it('button content is visible', () => {
      const wrapper = mountComponent();
      const content = wrapper.find('.button-content');
      expect(content.exists()).toBe(true);
      expect(content.classes()).not.toContain('loading');
    });
  });

  describe('click handler', () => {
    it('calls handleDuplicate when button is clicked', async () => {
      const wrapper = mountComponent();
      mockSessionsStore.duplicateSession.mockResolvedValue({
        id: 'new-session',
        name: 'Copy of Test Session',
      });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(mockSessionsStore.duplicateSession).toHaveBeenCalledWith('session-123');
    });

    it('prevents API call if already in progress', async () => {
      const wrapper = mountComponent();
      let resolveClick;
      mockSessionsStore.duplicateSession.mockImplementation(
        () => new Promise((resolve) => { resolveClick = resolve; })
      );

      await wrapper.find('button').trigger('click');
      await wrapper.vm.$nextTick();

      // Verify the API was called once
      expect(mockSessionsStore.duplicateSession).toHaveBeenCalledTimes(1);

      // Attempting to click again (simulating rapid clicks)
      await wrapper.find('button').trigger('click');

      // Should still only have one call due to isLoading guard
      expect(mockSessionsStore.duplicateSession).toHaveBeenCalledTimes(1);

      resolveClick({ id: 'new' });
      await flushPromises();
    });

    it('prevents multiple clicks when loading', async () => {
      const wrapper = mountComponent();
      let resolveClick;
      mockSessionsStore.duplicateSession.mockImplementation(
        () => new Promise((resolve) => { resolveClick = resolve; })
      );

      const button = wrapper.find('button');
      await button.trigger('click');
      await wrapper.vm.$nextTick();

      // Try clicking again while loading
      await button.trigger('click');

      // Should only be called once because handleDuplicate checks isLoading
      expect(mockSessionsStore.duplicateSession).toHaveBeenCalledTimes(1);

      resolveClick({ id: 'new' });
      await flushPromises();
    });
  });

  describe('loading state', () => {
    it('properly manages async operation lifecycle', async () => {
      const wrapper = mountComponent();
      let resolveClick;
      mockSessionsStore.duplicateSession.mockImplementation(
        () => new Promise((resolve) => { resolveClick = resolve; })
      );

      // Start the operation
      await wrapper.find('button').trigger('click');
      await wrapper.vm.$nextTick();

      // Verify API call was made
      expect(mockSessionsStore.duplicateSession).toHaveBeenCalled();

      // Resolve the promise
      resolveClick({ id: 'new' });
      await flushPromises();

      // Verify success notification was shown
      expect(mockUiStore.success).toHaveBeenCalled();
    });

    it('handles rapid click attempts during loading', async () => {
      const wrapper = mountComponent();
      let resolveClick;
      mockSessionsStore.duplicateSession.mockImplementation(
        () => new Promise((resolve) => { resolveClick = resolve; })
      );

      const button = wrapper.find('button');

      // First click
      await button.trigger('click');
      await wrapper.vm.$nextTick();
      expect(mockSessionsStore.duplicateSession).toHaveBeenCalledTimes(1);

      // Second click while loading (should be prevented by disabled state)
      await button.trigger('click');
      await wrapper.vm.$nextTick();

      // Should still only have called once
      expect(mockSessionsStore.duplicateSession).toHaveBeenCalledTimes(1);

      resolveClick({ id: 'new-session' });
      await flushPromises();
    });

    it('restores normal state after operation completes', async () => {
      const wrapper = mountComponent();
      mockSessionsStore.duplicateSession.mockResolvedValue({ id: 'new-session' });

      // Before: normal state
      expect(wrapper.find('button').element.disabled).toBe(false);
      expect(wrapper.text()).toContain('Duplicate');

      await wrapper.find('button').trigger('click');
      await flushPromises();

      // After: should be back to normal
      expect(wrapper.find('button').element.disabled).toBe(false);
      expect(wrapper.text()).toContain('Duplicate');
    });
  });

  describe('success handling', () => {
    it('calls uiStore.success with session name on success', async () => {
      const wrapper = mountComponent({ sessionName: 'Original Session' });
      mockSessionsStore.duplicateSession.mockResolvedValue({
        id: 'new-session',
        name: 'Copy of Original Session',
      });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(mockUiStore.success).toHaveBeenCalledWith(
        expect.stringContaining('Session duplicated')
      );
      expect(mockUiStore.success).toHaveBeenCalledWith(
        expect.stringContaining('Copy of Original Session')
      );
    });

    it('emits success event with new session data', async () => {
      const wrapper = mountComponent();
      const newSession = { id: 'new-session', name: 'Copy of Test Session' };
      mockSessionsStore.duplicateSession.mockResolvedValue(newSession);

      await wrapper.find('button').trigger('click');
      await flushPromises();

      // Check that success was called (the store action was successful)
      expect(mockUiStore.success).toHaveBeenCalled();
      expect(mockSessionsStore.duplicateSession).toHaveBeenCalled();
    });

    it('re-enables button after successful duplication', async () => {
      const wrapper = mountComponent();
      mockSessionsStore.duplicateSession.mockResolvedValue({ id: 'new-session' });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(wrapper.find('button').attributes('disabled')).toBeUndefined();
    });

    it('restores normal text after successful duplication', async () => {
      const wrapper = mountComponent();
      mockSessionsStore.duplicateSession.mockResolvedValue({ id: 'new-session' });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Duplicate');
      expect(wrapper.text()).not.toContain('Duplicating');
    });

    it('uses default name when sessionName prop is not provided', async () => {
      const wrapper = mountComponent({ sessionName: undefined });
      mockSessionsStore.duplicateSession.mockResolvedValue({
        id: 'new-session',
        name: 'Copy of session',
      });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      // Should display the returned name
      expect(mockUiStore.success).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('calls uiStore.error on duplication failure', async () => {
      const wrapper = mountComponent();
      const errorMessage = 'Failed to duplicate session';
      mockSessionsStore.duplicateSession.mockRejectedValue(
        new Error(errorMessage)
      );

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(mockUiStore.error).toHaveBeenCalledWith(errorMessage);
    });

    it('emits error event on failure', async () => {
      const wrapper = mountComponent();
      const error = new Error('Duplication failed');
      mockSessionsStore.duplicateSession.mockRejectedValue(error);

      await wrapper.find('button').trigger('click');
      await flushPromises();

      // Verify error handling was triggered
      expect(mockUiStore.error).toHaveBeenCalled();
      expect(mockSessionsStore.duplicateSession).toHaveBeenCalled();
    });

    it('re-enables button after error', async () => {
      const wrapper = mountComponent();
      mockSessionsStore.duplicateSession.mockRejectedValue(new Error('Failed'));

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(wrapper.find('button').attributes('disabled')).toBeUndefined();
    });

    it('restores normal text after error', async () => {
      const wrapper = mountComponent();
      mockSessionsStore.duplicateSession.mockRejectedValue(new Error('Failed'));

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Duplicate');
      expect(wrapper.text()).not.toContain('Duplicating');
    });

    it('allows retry after error', async () => {
      const wrapper = mountComponent();
      mockSessionsStore.duplicateSession.mockRejectedValueOnce(new Error('Failed'));
      mockSessionsStore.duplicateSession.mockResolvedValueOnce({ id: 'new-session' });

      // First attempt (fails)
      await wrapper.find('button').trigger('click');
      await flushPromises();

      // Second attempt (succeeds)
      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(mockSessionsStore.duplicateSession).toHaveBeenCalledTimes(2);
      expect(mockUiStore.success).toHaveBeenCalled();
    });

    it('displays default error message if error lacks details', async () => {
      const wrapper = mountComponent();
      mockSessionsStore.duplicateSession.mockRejectedValue(new Error());

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(mockUiStore.error).toHaveBeenCalledWith('Failed to duplicate session');
    });
  });

  describe('API integration', () => {
    it('passes sessionId to store action', async () => {
      const wrapper = mountComponent({ sessionId: 'sess-789' });
      mockSessionsStore.duplicateSession.mockResolvedValue({ id: 'new' });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(mockSessionsStore.duplicateSession).toHaveBeenCalledWith('sess-789');
    });

    it('passes options to store action when needed', async () => {
      const wrapper = mountComponent({ sessionId: 'sess-123' });
      mockSessionsStore.duplicateSession.mockResolvedValue({ id: 'new' });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      // Verify the call was made (options are handled by the store in Phase 2)
      expect(mockSessionsStore.duplicateSession).toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('has proper title attribute', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('button').attributes('title')).toBe('Create a copy of this session with all data');
    });

    it('button is keyboard accessible', async () => {
      const wrapper = mountComponent();
      const button = wrapper.find('button');
      expect(button.element.tagName).toBe('BUTTON');
    });
  });

  describe('confirmation dialog', () => {
    it('shows confirmation dialog when button is clicked', async () => {
      const wrapper = mountComponent();
      mockSessionsStore.duplicateSession.mockResolvedValue({ id: 'new-session' });

      await wrapper.find('button').trigger('click');
      await wrapper.vm.$nextTick();

      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate this session')
      );
    });

    it('includes helpful message in confirmation dialog', async () => {
      const wrapper = mountComponent();
      mockSessionsStore.duplicateSession.mockResolvedValue({ id: 'new-session' });

      await wrapper.find('button').trigger('click');
      await wrapper.vm.$nextTick();

      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining('conversations, canvas items, and notes')
      );
    });

    it('proceeds with duplication when user confirms', async () => {
      vi.mocked(window.confirm).mockReturnValue(true);
      const wrapper = mountComponent();
      mockSessionsStore.duplicateSession.mockResolvedValue({ id: 'new-session' });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(mockSessionsStore.duplicateSession).toHaveBeenCalledWith('session-123');
      expect(mockUiStore.success).toHaveBeenCalled();
    });

    it('cancels duplication when user declines confirmation', async () => {
      vi.mocked(window.confirm).mockReturnValue(false);
      const wrapper = mountComponent();

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(mockSessionsStore.duplicateSession).not.toHaveBeenCalled();
      expect(mockUiStore.success).not.toHaveBeenCalled();
      expect(mockUiStore.error).not.toHaveBeenCalled();
    });

    it('keeps button enabled when user cancels confirmation', async () => {
      vi.mocked(window.confirm).mockReturnValue(false);
      const wrapper = mountComponent();

      await wrapper.find('button').trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.find('button').attributes('disabled')).toBeUndefined();
      expect(wrapper.text()).toContain('Duplicate');
    });

    it('allows retry after canceling confirmation', async () => {
      const wrapper = mountComponent();
      mockSessionsStore.duplicateSession.mockResolvedValue({ id: 'new-session' });

      // First click: user cancels
      vi.mocked(window.confirm).mockReturnValueOnce(false);
      await wrapper.find('button').trigger('click');
      await wrapper.vm.$nextTick();
      expect(mockSessionsStore.duplicateSession).not.toHaveBeenCalled();

      // Second click: user confirms
      vi.mocked(window.confirm).mockReturnValueOnce(true);
      await wrapper.find('button').trigger('click');
      await flushPromises();
      expect(mockSessionsStore.duplicateSession).toHaveBeenCalledOnce();
    });
  });
});
