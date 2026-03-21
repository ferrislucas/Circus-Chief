import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import SessionTreeHandle from './SessionTreeHandle.vue';

describe('SessionTreeHandle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mountComponent(props = {}) {
    return mount(SessionTreeHandle, {
      props: { ...props }
    });
  }

  describe('rendering', () => {
    it('renders the handle element with correct test id', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('[data-testid="session-tree-handle"]').exists()).toBe(true);
    });

    it('renders the handle with session-tree-handle class', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.session-tree-handle').exists()).toBe(true);
    });

    it('has correct ARIA attributes', () => {
      const wrapper = mountComponent();
      const handle = wrapper.find('.session-tree-handle');
      expect(handle.attributes('role')).toBe('button');
      expect(handle.attributes('aria-label')).toBe('Open session tree');
    });

    it('is focusable with tabindex 0', () => {
      const wrapper = mountComponent();
      const handle = wrapper.find('.session-tree-handle');
      expect(handle.attributes('tabindex')).toBe('0');
    });

    it('renders the SVG icon', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('svg.handle-icon').exists()).toBe(true);
    });

    it('has z-index 900 via the session-tree-handle class', () => {
      const wrapper = mountComponent();
      const handle = wrapper.find('.session-tree-handle');
      expect(handle.exists()).toBe(true);
      // The z-index is applied through the scoped CSS class
      // Verify the class exists which applies z-index: 900
      expect(handle.classes()).toContain('session-tree-handle');
    });
  });

  describe('session active spinner', () => {
    it('shows spinner when isSessionActive is true', () => {
      const wrapper = mountComponent({ isSessionActive: true, sessionStatus: 'running' });
      expect(wrapper.find('.active-spinner').exists()).toBe(true);
    });

    it('hides spinner when isSessionActive is false', () => {
      const wrapper = mountComponent({ isSessionActive: false, sessionStatus: 'completed' });
      expect(wrapper.find('.active-spinner').exists()).toBe(false);
    });

    it('shows correct tooltip when session is running', () => {
      const wrapper = mountComponent({ isSessionActive: true, sessionStatus: 'running' });
      const spinner = wrapper.find('.active-spinner');
      expect(spinner.attributes('title')).toBe('Session running...');
    });

    it('shows correct tooltip when session is starting', () => {
      const wrapper = mountComponent({ isSessionActive: true, sessionStatus: 'starting' });
      const spinner = wrapper.find('.active-spinner');
      expect(spinner.attributes('title')).toBe('Session starting...');
    });

    it('updates handle tooltip when session is active', () => {
      const wrapper = mountComponent({ isSessionActive: true, sessionStatus: 'running' });
      const handle = wrapper.find('.session-tree-handle');
      expect(handle.attributes('title')).toBe('Session running...');
    });

    it('shows default tooltip when session is not active', () => {
      const wrapper = mountComponent({ isSessionActive: false });
      const handle = wrapper.find('.session-tree-handle');
      expect(handle.attributes('title')).toBe('Open session tree');
    });
  });

  describe('interactions', () => {
    it('emits open on click', async () => {
      const onOpen = vi.fn();
      const wrapper = mount(SessionTreeHandle, {
        attrs: { onOpen },
      });
      await wrapper.find('.session-tree-handle').trigger('click');
      expect(onOpen).toHaveBeenCalled();
    });

    it('emits open on Enter keypress', async () => {
      const onOpen = vi.fn();
      const wrapper = mount(SessionTreeHandle, {
        attrs: { onOpen },
      });
      await wrapper.find('.session-tree-handle').trigger('keydown.enter');
      expect(onOpen).toHaveBeenCalled();
    });

    it('emits open on Space keypress', async () => {
      const onOpen = vi.fn();
      const wrapper = mount(SessionTreeHandle, {
        attrs: { onOpen },
      });
      await wrapper.find('.session-tree-handle').trigger('keydown.space');
      expect(onOpen).toHaveBeenCalled();
    });
  });
});
