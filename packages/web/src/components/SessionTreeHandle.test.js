import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import SessionTreeHandle from './SessionTreeHandle.vue';

describe('SessionTreeHandle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mountComponent() {
    return mount(SessionTreeHandle);
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
