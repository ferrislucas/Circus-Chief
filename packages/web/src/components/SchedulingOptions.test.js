import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import SchedulingOptions from './SchedulingOptions.vue';

describe('SchedulingOptions.vue', () => {
  const defaultModelValue = {
    scheduledAt: null,
    autoRescheduleEnabled: false,
    rescheduleDelayMinutes: 15,
    rescheduleOnTokenLimit: true,
    rescheduleOnServiceError: true,
    maxRescheduleCount: null,
    maxTotalTokens: null,
    rescheduleAtTokenCount: null,
  };

  describe('header and toggle', () => {
    it('renders scheduling header button', () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: defaultModelValue,
        },
      });

      const header = wrapper.find('.scheduling-header');
      expect(header.exists()).toBe(true);
      expect(header.text()).toContain('Scheduling Options');
    });

    it('starts with collapsed content', () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: defaultModelValue,
        },
      });

      expect(wrapper.find('.scheduling-content').exists()).toBe(false);
    });

    it('expands content when header is clicked', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: defaultModelValue,
        },
      });

      await wrapper.find('.scheduling-header').trigger('click');
      expect(wrapper.find('.scheduling-content').exists()).toBe(true);
    });

    it('collapses content when header is clicked again', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: defaultModelValue,
        },
      });

      const header = wrapper.find('.scheduling-header');
      await header.trigger('click');
      expect(wrapper.find('.scheduling-content').exists()).toBe(true);

      await header.trigger('click');
      expect(wrapper.find('.scheduling-content').exists()).toBe(false);
    });

    it('rotates chevron icon when expanded', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: defaultModelValue,
        },
      });

      let chevron = wrapper.find('.chevron-icon');
      expect(chevron.classes()).not.toContain('rotate-180');

      await wrapper.find('.scheduling-header').trigger('click');
      chevron = wrapper.find('.chevron-icon');
      expect(chevron.classes()).toContain('rotate-180');
    });
  });

  describe('form inputs existence', () => {
    it('renders scheduled-at input when expanded', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: defaultModelValue,
        },
      });

      await wrapper.find('.scheduling-header').trigger('click');
      const input = wrapper.find('#scheduled-at');
      expect(input.exists()).toBe(true);
    });

    it('renders auto-reschedule checkbox when expanded', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: defaultModelValue,
        },
      });

      await wrapper.find('.scheduling-header').trigger('click');
      const checkbox = wrapper.find('input[type="checkbox"]');
      expect(checkbox.exists()).toBe(true);
    });

    it('shows reschedule settings only when auto-reschedule is enabled', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: {
            ...defaultModelValue,
            autoRescheduleEnabled: false,
          },
        },
      });

      await wrapper.find('.scheduling-header').trigger('click');
      expect(wrapper.find('.reschedule-settings').exists()).toBe(false);
    });

    it('shows reschedule settings when auto-reschedule is enabled', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: {
            ...defaultModelValue,
            autoRescheduleEnabled: true,
          },
        },
      });

      await wrapper.find('.scheduling-header').trigger('click');
      expect(wrapper.find('.reschedule-settings').exists()).toBe(true);
    });
  });

  describe('reschedule triggers', () => {
    it('renders two trigger checkboxes when auto-reschedule is enabled', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: {
            ...defaultModelValue,
            autoRescheduleEnabled: true,
          },
        },
      });

      await wrapper.find('.scheduling-header').trigger('click');
      const triggerCheckboxes = wrapper.findAll('.checkbox-option input[type="checkbox"]');
      expect(triggerCheckboxes.length).toBe(2);
    });
  });

  describe('reschedule delay', () => {
    it('renders delay dropdown when auto-reschedule is enabled', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: {
            ...defaultModelValue,
            autoRescheduleEnabled: true,
          },
        },
      });

      await wrapper.find('.scheduling-header').trigger('click');
      const delaySelect = wrapper.find('#reschedule-delay');
      expect(delaySelect.exists()).toBe(true);
    });

    it('has predefined delay options', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: {
            ...defaultModelValue,
            autoRescheduleEnabled: true,
          },
        },
      });

      await wrapper.find('.scheduling-header').trigger('click');
      const options = wrapper.findAll('#reschedule-delay option');
      expect(options.length).toBeGreaterThan(0);
      const optionValues = options.map((o) => o.element.value);
      expect(optionValues).toContain('15');
      expect(optionValues).toContain('30');
    });
  });

  describe('limits section', () => {
    it('renders limits section only when auto-reschedule is enabled', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: defaultModelValue,
        },
      });

      await wrapper.find('.scheduling-header').trigger('click');
      expect(wrapper.find('.limits-section').exists()).toBe(false);

      // Now with auto-reschedule enabled
      const wrapper2 = mount(SchedulingOptions, {
        props: {
          modelValue: {
            ...defaultModelValue,
            autoRescheduleEnabled: true,
          },
        },
      });

      await wrapper2.find('.scheduling-header').trigger('click');
      expect(wrapper2.find('.limits-section').exists()).toBe(true);
    });

    it('has inputs for max reschedule count, max tokens, and soft threshold', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: {
            ...defaultModelValue,
            autoRescheduleEnabled: true,
          },
        },
      });

      await wrapper.find('.scheduling-header').trigger('click');
      expect(wrapper.find('#max-reschedule-count').exists()).toBe(true);
      expect(wrapper.find('#max-total-tokens').exists()).toBe(true);
      expect(wrapper.find('#reschedule-at-token-count').exists()).toBe(true);
    });

    it('validates max reschedule count input constraints', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: {
            ...defaultModelValue,
            autoRescheduleEnabled: true,
          },
        },
      });

      await wrapper.find('.scheduling-header').trigger('click');
      const countInput = wrapper.find('#max-reschedule-count');
      expect(countInput.attributes('min')).toBe('1');
      expect(countInput.attributes('max')).toBe('100');
    });

    it('validates max total tokens input constraints', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: {
            ...defaultModelValue,
            autoRescheduleEnabled: true,
          },
        },
      });

      await wrapper.find('.scheduling-header').trigger('click');
      const tokenInput = wrapper.find('#max-total-tokens');
      expect(tokenInput.attributes('min')).toBe('1000');
      expect(tokenInput.attributes('step')).toBe('1000');
    });

    it('validates soft token threshold input constraints', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: {
            ...defaultModelValue,
            autoRescheduleEnabled: true,
          },
        },
      });

      await wrapper.find('.scheduling-header').trigger('click');
      const thresholdInput = wrapper.find('#reschedule-at-token-count');
      expect(thresholdInput.attributes('min')).toBe('10000');
      expect(thresholdInput.attributes('step')).toBe('10000');
    });
  });

  describe('edge cases', () => {
    it('handles undefined modelValue gracefully', () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: undefined,
        },
      });

      expect(wrapper.find('.scheduling-header').exists()).toBe(true);
    });

    it('handles empty object as modelValue', () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: {},
        },
      });

      expect(wrapper.find('.scheduling-header').exists()).toBe(true);
    });

    it('renders with complete scheduling configuration', async () => {
      const fullConfig = {
        scheduledAt: Date.now() + 3600000,
        autoRescheduleEnabled: true,
        rescheduleDelayMinutes: 30,
        rescheduleOnTokenLimit: true,
        rescheduleOnServiceError: true,
        maxRescheduleCount: 10,
        maxTotalTokens: 500000,
        rescheduleAtTokenCount: 300000,
      };

      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: fullConfig,
        },
      });

      await wrapper.find('.scheduling-header').trigger('click');
      expect(wrapper.find('.scheduling-content').exists()).toBe(true);
      expect(wrapper.find('.reschedule-settings').exists()).toBe(true);
      expect(wrapper.find('.limits-section').exists()).toBe(true);
    });
  });

  describe('accessibility', () => {
    it('has proper aria-expanded attribute on header', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: defaultModelValue,
        },
      });

      const header = wrapper.find('.scheduling-header');
      expect(header.attributes('aria-expanded')).toBe('false');

      await header.trigger('click');
      expect(header.attributes('aria-expanded')).toBe('true');
    });

    it('has proper labels for form inputs', async () => {
      const wrapper = mount(SchedulingOptions, {
        props: {
          modelValue: {
            ...defaultModelValue,
            autoRescheduleEnabled: true,
          },
        },
      });

      await wrapper.find('.scheduling-header').trigger('click');
      expect(wrapper.find('label[for="scheduled-at"]').exists()).toBe(true);
      expect(wrapper.find('label[for="reschedule-delay"]').exists()).toBe(true);
      expect(wrapper.find('label[for="max-reschedule-count"]').exists()).toBe(true);
    });
  });
});
