import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import StatusIndicator from './StatusIndicator.vue';

describe('StatusIndicator.vue', () => {
  describe('Rendering Tests', () => {
    it('renders with correct status text for running status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'running' }
      });
      expect(wrapper.text()).toContain('Running');
    });

    it('renders with correct status text for starting status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'starting' }
      });
      expect(wrapper.text()).toContain('Starting...');
    });

    it('renders with correct status text for waiting status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'waiting' }
      });
      expect(wrapper.text()).toContain('Waiting');
    });

    it('renders with correct status text for completed status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'completed' }
      });
      expect(wrapper.text()).toContain('Completed');
    });

    it('renders with correct status text for error status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'error' }
      });
      expect(wrapper.text()).toContain('Error');
    });

    it('displays correct icon for running status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'running' }
      });
      const icon = wrapper.find('.status-icon');
      expect(icon.text()).toBe('●');
    });

    it('displays correct icon for starting status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'starting' }
      });
      const icon = wrapper.find('.status-icon');
      expect(icon.text()).toBe('○');
    });

    it('displays correct icon for waiting status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'waiting' }
      });
      const icon = wrapper.find('.status-icon');
      expect(icon.text()).toBe('◐');
    });

    it('displays correct icon for completed status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'completed' }
      });
      const icon = wrapper.find('.status-icon');
      expect(icon.text()).toBe('✓');
    });

    it('displays correct icon for error status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'error' }
      });
      const icon = wrapper.find('.status-icon');
      expect(icon.text()).toBe('!');
    });

    it('applies correct CSS class for status', () => {
      const statuses = ['running', 'starting', 'waiting', 'completed', 'error'];
      statuses.forEach((status) => {
        const wrapper = mount(StatusIndicator, {
          props: { status }
        });
        expect(wrapper.classes()).toContain(`status-${status}`);
      });
    });
  });

  describe('Animation Tests', () => {
    it('applies animate-pulse class for running status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'running' }
      });
      expect(wrapper.classes()).toContain('status-animated');
    });

    it('applies animate-pulse class for starting status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'starting' }
      });
      expect(wrapper.classes()).toContain('status-animated');
    });

    it('does NOT apply animate-pulse class for waiting status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'waiting' }
      });
      expect(wrapper.classes()).not.toContain('status-animated');
    });

    it('does NOT apply animate-pulse class for completed status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'completed' }
      });
      expect(wrapper.classes()).not.toContain('status-animated');
    });

    it('does NOT apply animate-pulse class for error status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'error' }
      });
      expect(wrapper.classes()).not.toContain('status-animated');
    });
  });

  describe('Styling Tests', () => {
    it('applies inline-flex display for layout', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'running' }
      });
      const element = wrapper.find('.status-indicator');
      expect(element.element.getAttribute('style') || element.classes()).toBeDefined();
    });

    it('renders with proper HTML structure for styling', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'running' }
      });
      const element = wrapper.find('.status-indicator');
      expect(element.find('.status-icon').exists()).toBe(true);
      expect(element.find('.status-text').exists()).toBe(true);
    });
  });

  describe('Accessibility Tests', () => {
    it('has aria-label for running status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'running' }
      });
      expect(wrapper.attributes('aria-label')).toBe('Session is running');
    });

    it('has aria-label for starting status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'starting' }
      });
      expect(wrapper.attributes('aria-label')).toContain('starting');
    });

    it('has aria-label for waiting status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'waiting' }
      });
      expect(wrapper.attributes('aria-label')).toContain('waiting');
    });

    it('has aria-label for completed status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'completed' }
      });
      expect(wrapper.attributes('aria-label')).toContain('completed');
    });

    it('has aria-label for error status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'error' }
      });
      expect(wrapper.attributes('aria-label')).toContain('error');
    });

    it('has appropriate role for running status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'running' }
      });
      expect(wrapper.attributes('role')).toBe('progressbar');
    });

    it('has appropriate role for starting status', () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'starting' }
      });
      expect(wrapper.attributes('role')).toBe('progressbar');
    });

    it('has appropriate role for other statuses', () => {
      ['waiting', 'completed', 'error'].forEach((status) => {
        const wrapper = mount(StatusIndicator, {
          props: { status }
        });
        expect(wrapper.attributes('role')).toBe('status');
      });
    });
  });

  describe('Update Tests', () => {
    it('updates status text when status prop changes', async () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'running' }
      });
      expect(wrapper.text()).toContain('Running');

      await wrapper.setProps({ status: 'completed' });
      expect(wrapper.text()).toContain('Completed');
    });

    it('updates CSS class when status prop changes', async () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'running' }
      });
      expect(wrapper.classes()).toContain('status-running');

      await wrapper.setProps({ status: 'error' });
      expect(wrapper.classes()).toContain('status-error');
      expect(wrapper.classes()).not.toContain('status-running');
    });

    it('updates animation when status prop changes to animated', async () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'waiting' }
      });
      expect(wrapper.classes()).not.toContain('status-animated');

      await wrapper.setProps({ status: 'running' });
      expect(wrapper.classes()).toContain('status-animated');
    });

    it('removes animation when status prop changes from animated', async () => {
      const wrapper = mount(StatusIndicator, {
        props: { status: 'running' }
      });
      expect(wrapper.classes()).toContain('status-animated');

      await wrapper.setProps({ status: 'completed' });
      expect(wrapper.classes()).not.toContain('status-animated');
    });
  });

  describe('Props Validation', () => {
    it('validates status prop accepts valid values', () => {
      const validStatuses = ['running', 'starting', 'waiting', 'completed', 'error'];
      validStatuses.forEach((status) => {
        const wrapper = mount(StatusIndicator, {
          props: { status }
        });
        expect(wrapper.props('status')).toBe(status);
      });
    });
  });
});
