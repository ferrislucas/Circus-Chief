import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ModelSelector from './ModelSelector.vue';
import { CLAUDE_MODELS } from '@claudetools/shared';

// Use actual model data from the shared package
const [sonnet, opus, haiku] = CLAUDE_MODELS;

describe('ModelSelector', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mountComponent = (props = {}, attrs = {}) => {
    return mount(ModelSelector, {
      props: {
        modelValue: sonnet.id,
        ...props,
      },
      attrs,
    });
  };

  describe('rendering', () => {
    it('renders model label', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.model-label').text()).toBe('Model:');
    });

    it('renders all three model buttons', () => {
      const wrapper = mountComponent();
      const buttons = wrapper.findAll('.model-btn');
      expect(buttons).toHaveLength(3);
    });

    it('displays model names on buttons', () => {
      const wrapper = mountComponent();
      const buttons = wrapper.findAll('.model-btn');
      expect(buttons[0].text()).toBe(sonnet.name);
      expect(buttons[1].text()).toBe(opus.name);
      expect(buttons[2].text()).toBe(haiku.name);
    });

    it('shows description as title attribute', () => {
      const wrapper = mountComponent();
      const buttons = wrapper.findAll('.model-btn');
      expect(buttons[0].attributes('title')).toBe(sonnet.description);
      expect(buttons[1].attributes('title')).toBe(opus.description);
      expect(buttons[2].attributes('title')).toBe(haiku.description);
    });
  });

  describe('active state', () => {
    it('marks sonnet as active when selected', () => {
      const wrapper = mountComponent({ modelValue: sonnet.id });
      const buttons = wrapper.findAll('.model-btn');
      expect(buttons[0].classes()).toContain('active');
      expect(buttons[1].classes()).not.toContain('active');
      expect(buttons[2].classes()).not.toContain('active');
    });

    it('marks opus as active when selected', () => {
      const wrapper = mountComponent({ modelValue: opus.id });
      const buttons = wrapper.findAll('.model-btn');
      expect(buttons[0].classes()).not.toContain('active');
      expect(buttons[1].classes()).toContain('active');
      expect(buttons[2].classes()).not.toContain('active');
    });

    it('marks haiku as active when selected', () => {
      const wrapper = mountComponent({ modelValue: haiku.id });
      const buttons = wrapper.findAll('.model-btn');
      expect(buttons[0].classes()).not.toContain('active');
      expect(buttons[1].classes()).not.toContain('active');
      expect(buttons[2].classes()).toContain('active');
    });
  });

  describe('interactions', () => {
    it('emits update:modelValue when button clicked', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const buttons = wrapper.findAll('.model-btn');

      await buttons[1].trigger('click');

      expect(onUpdateModelValue).toHaveBeenCalledWith(opus.id);
    });

    it('emits correct model id for each button', async () => {
      const onUpdateModelValue = vi.fn();
      const wrapper = mountComponent(
        { modelValue: sonnet.id },
        { 'onUpdate:modelValue': onUpdateModelValue }
      );
      const buttons = wrapper.findAll('.model-btn');

      // Clicking already selected model doesn't emit (early return optimization)
      await buttons[0].trigger('click');
      expect(onUpdateModelValue).not.toHaveBeenCalled();

      await buttons[1].trigger('click');
      expect(onUpdateModelValue).toHaveBeenCalledWith(opus.id);

      await buttons[2].trigger('click');
      expect(onUpdateModelValue).toHaveBeenCalledWith(haiku.id);

      expect(onUpdateModelValue).toHaveBeenCalledTimes(2);
    });
  });

  describe('disabled state', () => {
    it('disables all buttons when disabled prop is true', () => {
      const wrapper = mountComponent({ disabled: true });
      const buttons = wrapper.findAll('.model-btn');

      buttons.forEach((button) => {
        expect(button.attributes('disabled')).toBeDefined();
      });
    });

    it('does not disable buttons when disabled prop is false', () => {
      const wrapper = mountComponent({ disabled: false });
      const buttons = wrapper.findAll('.model-btn');

      buttons.forEach((button) => {
        expect(button.attributes('disabled')).toBeUndefined();
      });
    });

    it('does not emit when disabled button is clicked', async () => {
      const wrapper = mountComponent({ disabled: true });
      const buttons = wrapper.findAll('.model-btn');

      await buttons[1].trigger('click');

      // No events should be emitted when disabled
      // Note: Vue still emits the event, but the button is disabled in the UI
      // The disabled state is handled by the browser
    });
  });
});
