import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import BranchEditor from './BranchEditor.vue';

describe('BranchEditor', () => {
  const defaultProps = {
    messageId: 'msg-123',
  };

  let wrapper;

  function mountComponent(props = {}, options = {}) {
    wrapper = mount(BranchEditor, {
      props: { ...defaultProps, ...props },
      ...options,
    });
    return wrapper;
  }

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe('rendering', () => {
    it('renders prompt textarea', () => {
      wrapper = mountComponent();
      expect(wrapper.find('textarea').exists()).toBe(true);
    });

    it('does NOT render name input field', () => {
      wrapper = mountComponent();
      // Name field should be completely removed
      expect(wrapper.findAll('input[type="text"]')).toHaveLength(0);
      expect(wrapper.text()).not.toContain('Branch name');
    });

    it('shows correct label for prompt field', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('New prompt');
      expect(wrapper.text()).toContain('replaces original');
    });

    it('shows "Branch & Submit" button text', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('Branch & Submit');
    });
  });

  describe('submit button state', () => {
    it('disables submit button when prompt is empty', () => {
      wrapper = mountComponent();
      const buttons = wrapper.findAll('button');
      const submitBtn = buttons.find(b => b.text().includes('Branch & Submit'));
      expect(submitBtn.attributes('disabled')).toBeDefined();
    });

    it('enables submit button when prompt has content', async () => {
      wrapper = mountComponent();
      const textarea = wrapper.find('textarea');
      await textarea.setValue('My new prompt');
      await nextTick();

      const buttons = wrapper.findAll('button');
      const submitBtn = buttons.find(b => b.text().includes('Branch & Submit'));
      expect(submitBtn.attributes('disabled')).toBeUndefined();
    });
  });

  describe('form submission behavior', () => {
    it('handleCreate emits create event with correct payload', async () => {
      // Mount with onXxx handler to capture emits
      const createHandler = vi.fn();
      wrapper = mountComponent({}, {
        attrs: {
          onCreate: createHandler,
        },
      });

      // Set the prompt value
      const textarea = wrapper.find('textarea');
      await textarea.setValue('My replacement prompt');
      await nextTick();

      // Call handleCreate via exposed method
      wrapper.vm.handleCreate();

      expect(createHandler).toHaveBeenCalledTimes(1);
      expect(createHandler).toHaveBeenCalledWith({
        messageId: 'msg-123',
        prompt: 'My replacement prompt',
      });
    });

    it('payload does NOT include name property', async () => {
      const createHandler = vi.fn();
      wrapper = mountComponent({}, {
        attrs: {
          onCreate: createHandler,
        },
      });

      const textarea = wrapper.find('textarea');
      await textarea.setValue('My prompt');
      await nextTick();

      wrapper.vm.handleCreate();

      expect(createHandler).toHaveBeenCalledTimes(1);
      const payload = createHandler.mock.calls[0][0];
      expect(payload).not.toHaveProperty('name');
    });

    it('trims whitespace from prompt', async () => {
      const createHandler = vi.fn();
      wrapper = mountComponent({}, {
        attrs: {
          onCreate: createHandler,
        },
      });

      const textarea = wrapper.find('textarea');
      await textarea.setValue('  My prompt with spaces  ');
      await nextTick();

      wrapper.vm.handleCreate();

      expect(createHandler.mock.calls[0][0].prompt).toBe('My prompt with spaces');
    });

    it('does not emit when prompt is empty', async () => {
      const createHandler = vi.fn();
      wrapper = mountComponent({}, {
        attrs: {
          onCreate: createHandler,
        },
      });

      // Don't set any value - prompt is empty
      wrapper.vm.handleCreate();

      expect(createHandler).not.toHaveBeenCalled();
    });
  });

  describe('cancel behavior', () => {
    it('handleCancel emits cancel event', async () => {
      const cancelHandler = vi.fn();
      wrapper = mountComponent({}, {
        attrs: {
          onCancel: cancelHandler,
        },
      });

      wrapper.vm.handleCancel();

      expect(cancelHandler).toHaveBeenCalledTimes(1);
    });
  });
});
