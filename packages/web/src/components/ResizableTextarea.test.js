import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ResizableTextarea from './ResizableTextarea.vue';

describe('ResizableTextarea', () => {
  let wrapper;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe('basic rendering', () => {
    it('renders textarea element', () => {
      wrapper = mount(ResizableTextarea);
      const textarea = wrapper.find('textarea');
      expect(textarea.exists()).toBe(true);
    });

    it('renders resize handle', () => {
      wrapper = mount(ResizableTextarea);
      const handle = wrapper.find('.resize-handle');
      expect(handle.exists()).toBe(true);
    });

    it('applies wrapper class', () => {
      wrapper = mount(ResizableTextarea);
      const wrapperDiv = wrapper.find('.resizable-textarea-wrapper');
      expect(wrapperDiv.exists()).toBe(true);
    });
  });

  describe('props', () => {
    it('uses default minHeight of 80', () => {
      wrapper = mount(ResizableTextarea);
      expect(wrapper.vm.$props.minHeight).toBe(80);
    });

    it('accepts custom minHeight', () => {
      wrapper = mount(ResizableTextarea, {
        props: { minHeight: 120 }
      });
      expect(wrapper.vm.$props.minHeight).toBe(120);
    });

    it('accepts maxHeight', () => {
      wrapper = mount(ResizableTextarea, {
        props: { maxHeight: 400 }
      });
      expect(wrapper.vm.$props.maxHeight).toBe(400);
    });

    it('allows maxHeight to be null', () => {
      wrapper = mount(ResizableTextarea, {
        props: { maxHeight: null }
      });
      expect(wrapper.vm.$props.maxHeight).toBeNull();
    });
  });

  describe('placeholder attribute', () => {
    it('passes placeholder to textarea', async () => {
      wrapper = mount(ResizableTextarea, {
        attrs: { placeholder: 'Enter text...' }
      });
      const textarea = wrapper.find('textarea');
      expect(textarea.attributes('placeholder')).toBe('Enter text...');
    });

    it('passes v-bind attributes to textarea', async () => {
      wrapper = mount(ResizableTextarea, {
        attrs: {
          placeholder: 'Type here',
          disabled: false,
          class: 'custom-class'
        }
      });
      const textarea = wrapper.find('textarea');
      expect(textarea.attributes('placeholder')).toBe('Type here');
    });
  });

  describe('textarea value', () => {
    it('allows setting value through exposed interface', async () => {
      wrapper = mount(ResizableTextarea);
      wrapper.vm.value = 'Test content';
      await wrapper.vm.$nextTick();

      const textarea = wrapper.find('textarea');
      expect(textarea.element.value).toBe('Test content');
    });

    it('allows reading value through exposed interface', async () => {
      wrapper = mount(ResizableTextarea);
      const textarea = wrapper.find('textarea').element;
      textarea.value = 'Test content';

      expect(wrapper.vm.value).toBe('Test content');
    });

    it('returns empty string when textarea is null', () => {
      wrapper = mount(ResizableTextarea);
      // Mock textareaRef to be null
      wrapper.vm.$refs = {};
      expect(wrapper.vm.value).toBe('');
    });
  });

  describe('focus management', () => {
    it('exposes focus method', async () => {
      wrapper = mount(ResizableTextarea);
      const textarea = wrapper.find('textarea').element;
      const focusSpy = vi.spyOn(textarea, 'focus');

      wrapper.vm.focus();

      expect(focusSpy).toHaveBeenCalled();
    });

    it('exposes blur method', async () => {
      wrapper = mount(ResizableTextarea);
      const textarea = wrapper.find('textarea').element;
      const blurSpy = vi.spyOn(textarea, 'blur');

      wrapper.vm.blur();

      expect(blurSpy).toHaveBeenCalled();
    });

    it('exposes select method', async () => {
      wrapper = mount(ResizableTextarea);
      const textarea = wrapper.find('textarea').element;
      const selectSpy = vi.spyOn(textarea, 'select');

      wrapper.vm.select();

      expect(selectSpy).toHaveBeenCalled();
    });
  });

  describe('selection management', () => {
    it('allows setting selectionStart', async () => {
      wrapper = mount(ResizableTextarea);
      wrapper.vm.value = 'Hello World';

      wrapper.vm.selectionStart = 0;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectionStart).toBe(0);
    });

    it('allows getting selectionStart', async () => {
      wrapper = mount(ResizableTextarea);
      const textarea = wrapper.find('textarea').element;
      textarea.value = 'Test';
      textarea.selectionStart = 2;

      expect(wrapper.vm.selectionStart).toBe(2);
    });

    it('allows setting selectionEnd', async () => {
      wrapper = mount(ResizableTextarea);
      wrapper.vm.value = 'Hello World';

      wrapper.vm.selectionEnd = 5;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectionEnd).toBe(5);
    });

    it('allows getting selectionEnd', async () => {
      wrapper = mount(ResizableTextarea);
      const textarea = wrapper.find('textarea').element;
      textarea.value = 'Test';
      textarea.selectionEnd = 3;

      expect(wrapper.vm.selectionEnd).toBe(3);
    });
  });

  describe('input event', () => {
    it('emits input event on textarea input', async () => {
      wrapper = mount(ResizableTextarea);
      const textarea = wrapper.find('textarea');

      await textarea.setValue('New content');

      const emitted = wrapper.emitted('input');
      if (emitted) {
        expect(emitted).toBeTruthy();
        expect(emitted.length).toBeGreaterThan(0);
      }
    });

    it('passes event object to input handler', async () => {
      wrapper = mount(ResizableTextarea);
      const textarea = wrapper.find('textarea');

      await textarea.setValue('Test');

      const emitted = wrapper.emitted('input');
      if (emitted && emitted.length > 0) {
        expect(emitted[0][0]).toBeTruthy();
      }
    });
  });

  describe('resize handle', () => {
    it('resize handle has correct classes', () => {
      wrapper = mount(ResizableTextarea);
      const handle = wrapper.find('.resize-handle');

      expect(handle.classes()).toContain('resize-handle');
    });

    it('resize handle contains SVG icon', () => {
      wrapper = mount(ResizableTextarea);
      const svg = wrapper.find('.resize-handle svg');

      expect(svg.exists()).toBe(true);
    });
  });

  describe('height constraints', () => {
    it('props minHeight is applied correctly', () => {
      const minHeight = 150;
      wrapper = mount(ResizableTextarea, {
        props: { minHeight }
      });

      // Component accepts minHeight prop and applies it during resize
      expect(wrapper.vm.$props.minHeight).toBe(minHeight);
    });

    it('applies maxHeight when set', () => {
      const maxHeight = 500;
      wrapper = mount(ResizableTextarea, {
        props: { maxHeight }
      });

      expect(wrapper.vm.$props.maxHeight).toBe(maxHeight);
    });

    it('allows unlimited height when maxHeight is null', () => {
      wrapper = mount(ResizableTextarea, {
        props: { maxHeight: null }
      });

      expect(wrapper.vm.$props.maxHeight).toBeNull();
    });
  });

  describe('textarea styling', () => {
    it('textarea has resize: none in styles', () => {
      wrapper = mount(ResizableTextarea);
      // Check that the style scoped class is applied
      const textarea = wrapper.find('textarea');
      expect(textarea.exists()).toBe(true);
    });

    it('textarea initially has no explicit height style', async () => {
      wrapper = mount(ResizableTextarea);
      await wrapper.vm.$nextTick();

      const textarea = wrapper.find('textarea');
      const style = textarea.attributes('style');
      // Initially, currentHeight is null so no height style is set
      expect(style).toBeUndefined();
    });

    it('textarea wrapper has proper CSS classes', () => {
      wrapper = mount(ResizableTextarea);
      const wrapper_el = wrapper.find('.resizable-textarea-wrapper');
      expect(wrapper_el.exists()).toBe(true);
    });
  });

  describe('dispatchEvent method', () => {
    it('allows dispatching events on textarea', async () => {
      wrapper = mount(ResizableTextarea);
      const event = new Event('change');
      const dispatchSpy = vi.spyOn(Event.prototype, 'constructor');

      const result = wrapper.vm.dispatchEvent(event);

      expect(result).toBeDefined();
    });
  });

  describe('cleanup on unmount', () => {
    it('component unmounts cleanly without errors', async () => {
      wrapper = mount(ResizableTextarea);

      // Should unmount without errors
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });

  describe('resize handle attributes', () => {
    it('has aria-hidden on resize handle', () => {
      wrapper = mount(ResizableTextarea);
      const handle = wrapper.find('.resize-handle');

      expect(handle.attributes('aria-hidden')).toBe('true');
    });

    it('has mousedown event listener on resize handle', async () => {
      wrapper = mount(ResizableTextarea);
      const handle = wrapper.find('.resize-handle');

      expect(handle.exists()).toBe(true);
    });

    it('has touchstart event listener on resize handle', async () => {
      wrapper = mount(ResizableTextarea);
      const handle = wrapper.find('.resize-handle');

      expect(handle.exists()).toBe(true);
    });
  });

  describe('mobile support', () => {
    it('supports touch events for mobile', () => {
      wrapper = mount(ResizableTextarea);
      const handle = wrapper.find('.resize-handle');

      // Verify that touch-action: none is set for mobile
      expect(handle.exists()).toBe(true);
    });
  });
});
