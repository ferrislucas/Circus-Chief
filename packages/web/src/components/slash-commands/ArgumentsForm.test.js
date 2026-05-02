import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ArgumentsForm from './ArgumentsForm.vue';
import argumentsFormSource from './ArgumentsForm.vue?raw';

describe('ArgumentsForm.vue', () => {
  describe('skill rendering', () => {
    it('renders skill args input for skills', () => {
      const skill = {
        name: 'my-skill',
        isSkill: true,
        description: 'A test skill',
        argumentHint: '[filename]',
      };

      const wrapper = mount(ArgumentsForm, {
        props: {
          command: skill,
        },
      });

      const input = wrapper.find('[data-testid="skill-args-input"]');
      expect(input.exists()).toBe(true);
      expect(input.attributes('placeholder')).toBe('[filename]');
    });

    it('displays argumentHint as a hint label for skills', () => {
      const skill = {
        name: 'process',
        isSkill: true,
        argumentHint: '[target]',
      };

      const wrapper = mount(ArgumentsForm, {
        props: {
          command: skill,
        },
      });

      const hint = wrapper.find('.hint');
      expect(hint.exists()).toBe(true);
      expect(hint.text()).toBe('[target]');
    });

    it('does not render argumentHint label if not provided', () => {
      const skill = {
        name: 'simple',
        isSkill: true,
      };

      const wrapper = mount(ArgumentsForm, {
        props: {
          command: skill,
        },
      });

      const hint = wrapper.find('.hint');
      expect(hint.exists()).toBe(false);
    });

    it('uses default placeholder when argumentHint is not provided', () => {
      const skill = {
        name: 'simple',
        isSkill: true,
      };

      const wrapper = mount(ArgumentsForm, {
        props: {
          command: skill,
        },
      });

      const input = wrapper.find('[data-testid="skill-args-input"]');
      expect(input.attributes('placeholder')).toBe('Enter arguments...');
    });

    it('does not render structured argument fields for skills', () => {
      const skill = {
        name: 'my-skill',
        isSkill: true,
        argumentHint: '[file]',
      };

      const wrapper = mount(ArgumentsForm, {
        props: {
          command: skill,
        },
      });

      const argFields = wrapper.findAll('.form-field');
      // Should only have one field (the skill args input)
      expect(argFields.length).toBe(1);
    });
  });

  describe('command rendering', () => {
    it('renders structured argument fields for commands', () => {
      const command = {
        name: 'deploy',
        description: 'Deploy the app',
        arguments: [
          { name: 'env', label: 'Environment', type: 'text', required: true },
          { name: 'verbose', label: 'Verbose', type: 'text', required: false },
        ],
      };

      const wrapper = mount(ArgumentsForm, {
        props: {
          command,
        },
      });

      const envField = wrapper.find('[data-testid="arg-env"]');
      const verboseField = wrapper.find('[data-testid="arg-verbose"]');

      expect(envField.exists()).toBe(true);
      expect(verboseField.exists()).toBe(true);
    });

    it('does not render skill args input for commands', () => {
      const command = {
        name: 'deploy',
        arguments: [{ name: 'env', label: 'Environment', type: 'text', required: true }],
      };

      const wrapper = mount(ArgumentsForm, {
        props: {
          command,
        },
      });

      const skillInput = wrapper.find('[data-testid="skill-args-input"]');
      expect(skillInput.exists()).toBe(false);
    });
  });

  describe('skill validation', () => {
    it('allows empty skill args', () => {
      const skill = {
        name: 'my-skill',
        isSkill: true,
      };

      const wrapper = mount(ArgumentsForm, {
        props: {
          command: skill,
        },
      });

      const submitBtn = wrapper.find('[data-testid="execute-command-btn"]');
      expect(submitBtn.attributes('disabled')).toBeUndefined();
    });
  });

  describe('command validation', () => {
    it('does not submit when command has invalid required fields', async () => {
      const command = {
        name: 'deploy',
        arguments: [{ name: 'env', label: 'Environment', type: 'text', required: true }],
      };

      const wrapper = mount(ArgumentsForm, {
        props: {
          command,
        },
      });

      const form = wrapper.find('form');
      await form.trigger('submit');

      const submitEvent = wrapper.emitted('submit');
      expect(submitEvent).toBeFalsy();
    });
  });

  describe('button behavior', () => {
    it('renders back button', () => {
      const skill = {
        name: 'test',
        isSkill: true,
      };

      const wrapper = mount(ArgumentsForm, {
        props: {
          command: skill,
        },
      });

      const backBtn = wrapper.find('.btn-secondary');
      expect(backBtn.exists()).toBe(true);
      expect(backBtn.text()).toBe('Back');
    });
  });

  describe('executing state', () => {
    it('disables submit button when executing', () => {
      const skill = {
        name: 'test',
        isSkill: true,
      };

      const wrapper = mount(ArgumentsForm, {
        props: {
          command: skill,
          executing: true,
        },
      });

      const submitBtn = wrapper.find('[data-testid="execute-command-btn"]');
      expect(submitBtn.attributes('disabled')).toBeDefined();
    });

    it('shows loading spinner when executing', () => {
      const skill = {
        name: 'test',
        isSkill: true,
      };

      const wrapper = mount(ArgumentsForm, {
        props: {
          command: skill,
          executing: true,
        },
      });

      const spinner = wrapper.find('.loading-spinner');
      expect(spinner.exists()).toBe(true);
    });

    it('does not submit when executing', async () => {
      const skill = {
        name: 'test',
        isSkill: true,
      };

      const wrapper = mount(ArgumentsForm, {
        props: {
          command: skill,
          executing: true,
        },
      });

      const form = wrapper.find('form');
      await form.trigger('submit');

      const submitEvent = wrapper.emitted('submit');
      expect(submitEvent).toBeFalsy();
    });
  });

  describe('execute label', () => {
    it('displays custom execute label', () => {
      const skill = {
        name: 'test',
        isSkill: true,
      };

      const wrapper = mount(ArgumentsForm, {
        props: {
          command: skill,
          executeLabel: 'Insert Command',
        },
      });

      const submitBtn = wrapper.find('[data-testid="execute-command-btn"]');
      expect(submitBtn.text()).toContain('Insert Command');
    });

    it('displays default execute label', () => {
      const skill = {
        name: 'test',
        isSkill: true,
      };

      const wrapper = mount(ArgumentsForm, {
        props: {
          command: skill,
        },
      });

      const submitBtn = wrapper.find('[data-testid="execute-command-btn"]');
      expect(submitBtn.text()).toContain('Execute Command');
    });
  });

  describe('style tokens', () => {
    it('uses defined theme tokens for argument form styling', () => {
      const source = argumentsFormSource;

      expect(source).not.toMatch(/--color-(accent|accent-rgb|bg-hover|border-hover|primary-hover)\b/);
      expect(source).toContain('--color-primary');
      expect(source).toContain('--color-primary-soft');
      expect(source).toContain('--color-background-mute');
      expect(source).toContain('--color-border');
    });
  });
});
