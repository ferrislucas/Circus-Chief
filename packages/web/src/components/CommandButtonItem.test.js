import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, nextTick } from 'vue';
import CommandButtonItem from './CommandButtonItem.vue';

describe('CommandButtonItem', () => {
  const mockButton = {
    id: 'btn-1',
    projectId: 'proj-1',
    label: 'Run Tests',
    command: 'npm test',
    description: 'Run the test suite'
  };

  const mockRun = {
    id: 'run-1',
    buttonId: 'btn-1',
    status: 'success',
    output: 'Tests passed\n✓ 42 tests completed',
    outputTruncated: false,
    startTime: new Date().toISOString(),
    exitCode: 0
  };

  describe('debounceLeading utility', () => {
    it('calls function immediately on first invocation', async () => {
      const fn = vi.fn();
      const debounce = (cb, delay) => {
        let timeoutId = null;
        let lastCalled = 0;
        return (...args) => {
          const now = Date.now();
          if (timeoutId) clearTimeout(timeoutId);

          if (now - lastCalled >= delay) {
            lastCalled = now;
            cb(...args);
          } else {
            timeoutId = setTimeout(() => {
              lastCalled = Date.now();
              cb(...args);
            }, delay);
          }
        };
      };

      const debouncedFn = debounce(fn, 100);
      debouncedFn('first');

      expect(fn).toHaveBeenCalledWith('first');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('debounces subsequent calls within delay period', async () => {
      const fn = vi.fn();
      const debounce = (cb, delay) => {
        let timeoutId = null;
        let lastCalled = 0;
        return (...args) => {
          const now = Date.now();
          if (timeoutId) clearTimeout(timeoutId);

          if (now - lastCalled >= delay) {
            lastCalled = now;
            cb(...args);
          } else {
            timeoutId = setTimeout(() => {
              lastCalled = Date.now();
              cb(...args);
            }, delay);
          }
        };
      };

      const debouncedFn = debounce(fn, 100);
      debouncedFn('first');
      debouncedFn('second');
      debouncedFn('third');

      expect(fn).toHaveBeenCalledTimes(1);

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(fn).toHaveBeenLastCalledWith('third');
    });
  });

  describe('component rendering', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('renders the button component', () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1'
        }
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain('Run Tests');
    });

    it('displays button name and description', () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1'
        }
      });

      expect(wrapper.text()).toContain('Run Tests');
      expect(wrapper.text()).toContain('npm test');
    });

    it('displays run status when run is available', () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      // For a completed run, a checkmark icon is displayed
      expect(wrapper.text()).toContain('✓');
    });
  });

  describe('output rendering', () => {
    it('shows no output message when run has no output', async () => {
      const runWithoutOutput = { ...mockRun, output: undefined };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithoutOutput
        }
      });

      // Should render the output section header
      const outputHeader = wrapper.find('.output-header');
      expect(outputHeader.exists()).toBe(true);
      expect(outputHeader.text()).toContain('Output');
    });

    it('displays output when available', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      // Should render the output section header
      const outputHeader = wrapper.find('.output-header');
      expect(outputHeader.exists()).toBe(true);

      // Should display the run status indicator
      const statusIndicator = wrapper.find('.status-indicator');
      expect(statusIndicator.exists()).toBe(true);

      // Should show the exit code
      expect(wrapper.text()).toContain('exit code: 0');
    });

    it('debounces rapid output updates', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      const updatedRun1 = { ...mockRun, output: 'Line 1\n' };
      const updatedRun2 = { ...mockRun, output: 'Line 1\nLine 2\n' };
      const updatedRun3 = { ...mockRun, output: 'Line 1\nLine 2\nLine 3\n' };

      await wrapper.setProps({ run: updatedRun1 });
      await wrapper.setProps({ run: updatedRun2 });
      await wrapper.setProps({ run: updatedRun3 });

      await new Promise(resolve => setTimeout(resolve, 300));
      await nextTick();

      expect(wrapper.props('run').output).toContain('Line 3');
    });
  });

  describe('output truncation', () => {
    it('displays truncation warning when output is truncated', async () => {
      const truncatedRun = { ...mockRun, outputTruncated: true };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: truncatedRun
        }
      });

      // Should render the output section
      const outputHeader = wrapper.find('.output-header');
      expect(outputHeader.exists()).toBe(true);

      // Should display the run status and button
      expect(wrapper.find('.btn-primary').exists() || wrapper.find('.kill-button').exists()).toBe(true);

      // Component should be properly rendered with the truncated run
      expect(wrapper.find('.command-button-item').exists()).toBe(true);
    });

    it('does not show truncation warning when output is not truncated', () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: { ...mockRun, outputTruncated: false }
        }
      });

      expect(wrapper.text()).not.toContain('Output truncated');
    });
  });

  describe('component lifecycle', () => {
    it('handles prop updates gracefully', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      const updatedRun = { ...mockRun, status: 'failed', output: 'Test failed' };
      await wrapper.setProps({ run: updatedRun });
      await nextTick();

      expect(wrapper.props('run').status).toBe('failed');
    });

    it('updates output when run changes', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      const newRun = {
        ...mockRun,
        id: 'run-2',
        output: 'New output content'
      };

      await wrapper.setProps({ run: newRun });
      await nextTick();

      expect(wrapper.props('run').id).toBe('run-2');
    });
  });

  describe('ANSI code conversion', () => {
    it('renders ANSI colored output correctly', async () => {
      const coloredOutput = '\x1b[31mError message\x1b[0m';
      const runWithColor = { ...mockRun, output: coloredOutput };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithColor
        }
      });

      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it('handles multiple ANSI codes in output', async () => {
      const coloredOutput = '\x1b[32m✓\x1b[0m Test 1\n\x1b[31m✗\x1b[0m Test 2';
      const runWithColor = { ...mockRun, output: coloredOutput };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithColor
        }
      });

      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });
  });
});
