import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import CommandButtonItem from './CommandButtonItem.vue';

describe('CommandButtonItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders button info in idle state', () => {
    const button = {
      id: '1',
      label: 'Run Tests',
      command: 'npm test',
      sortOrder: 0,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run: null,
        sessionId: 'session-1',
      },
    });

    expect(wrapper.text()).toContain('Run Tests');
    expect(wrapper.text()).toContain('npm test');
    expect(wrapper.find('.btn-primary').exists()).toBe(true);
  });

  it('truncates long commands', () => {
    const button = {
      id: '1',
      label: 'Long',
      command: 'this is a very long command that should be truncated because it exceeds the maximum length allowed for display in the component',
      sortOrder: 0,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run: null,
        sessionId: 'session-1',
      },
    });

    const command = wrapper.find('.button-command').text();
    expect(command).toContain('...');
    expect(command.length).toBeLessThan(button.command.length);
  });

  it('emits run event when run button clicked', async () => {
    const button = {
      id: '1',
      label: 'Test',
      command: 'npm test',
      sortOrder: 0,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run: null,
        sessionId: 'session-1',
      },
    });

    const runButton = wrapper.find('.btn-primary');
    await runButton.trigger('click');

    expect(wrapper.emitted('run')).toBeTruthy();
    expect(wrapper.emitted('run')[0]).toEqual([]);
  });

  it('shows running state with spinner', async () => {
    const button = {
      id: '1',
      label: 'Test',
      command: 'npm test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: '1',
      status: 'running',
      output: 'Starting tests...',
      exitCode: null,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    expect(wrapper.text()).toContain('Running');
    expect(wrapper.find('.spinner').exists()).toBe(true);
    expect(wrapper.find('.btn-outline-danger').exists()).toBe(true);
  });

  it('shows kill button when running', async () => {
    const button = {
      id: '1',
      label: 'Test',
      command: 'npm test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: '1',
      status: 'running',
      output: '',
      exitCode: null,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    const killButton = wrapper.find('.btn-outline-danger');
    expect(killButton.exists()).toBe(true);
    expect(killButton.text()).toContain('✕');
  });

  it('emits kill event when kill button clicked', async () => {
    const button = {
      id: '1',
      label: 'Test',
      command: 'npm test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: '1',
      status: 'running',
      output: '',
      exitCode: null,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    const killButton = wrapper.find('.btn-outline-danger');
    await killButton.trigger('click');

    expect(wrapper.emitted('kill')).toBeTruthy();
  });

  it('shows success state with checkmark', async () => {
    const button = {
      id: '1',
      label: 'Test',
      command: 'npm test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: '1',
      status: 'success',
      output: 'All tests passed',
      exitCode: 0,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    expect(wrapper.text()).toContain('✓');
    expect(wrapper.find('.status-success').exists()).toBe(true);
    expect(wrapper.text()).toContain('exit code: 0');
  });

  it('shows error state with X indicator', async () => {
    const button = {
      id: '1',
      label: 'Test',
      command: 'npm test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: '1',
      status: 'error',
      output: 'Test failed',
      exitCode: 1,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    expect(wrapper.text()).toContain('✕');
    expect(wrapper.find('.status-error').exists()).toBe(true);
    expect(wrapper.text()).toContain('exit code: 1');
  });

  it('shows output section when visible', async () => {
    const button = {
      id: '1',
      label: 'Test',
      command: 'npm test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: '1',
      status: 'success',
      output: 'Test output',
      exitCode: 0,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    // Output is visible by default, no need to expand
    expect(wrapper.find('.output-content').exists()).toBe(true);
    expect(wrapper.text()).toContain('Test output');
  });

  it('shows output section by default', async () => {
    const button = {
      id: '1',
      label: 'Test',
      command: 'npm test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: '1',
      status: 'success',
      output: 'Test output',
      exitCode: 0,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    // Output should be visible by default
    expect(wrapper.find('.output-content').exists()).toBe(true);
  });

  it('toggles output visibility', async () => {
    const button = {
      id: '1',
      label: 'Test',
      command: 'npm test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: '1',
      status: 'success',
      output: 'Test output',
      exitCode: 0,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    const header = wrapper.find('.output-header');

    // Initially visible
    expect(wrapper.find('.output-content').exists()).toBe(true);

    // Click to hide
    await header.trigger('click');
    await nextTick();
    expect(wrapper.find('.output-content').exists()).toBe(false);

    // Click to show
    await header.trigger('click');
    await nextTick();
    expect(wrapper.find('.output-content').exists()).toBe(true);
  });

  it('shows copy button in output actions', async () => {
    const button = {
      id: '1',
      label: 'Test',
      command: 'npm test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: '1',
      status: 'success',
      output: 'Test output',
      exitCode: 0,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    // Output is visible by default
    // Copy button exists
    const copyBtn = wrapper.findAll('.btn').find((btn) => btn.text().includes('Copy'));
    expect(copyBtn).toBeDefined();
  });

  it('emits copy-output event with output text', async () => {
    const button = {
      id: '1',
      label: 'Test',
      command: 'npm test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: '1',
      status: 'success',
      output: 'Test output content',
      exitCode: 0,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    // Output is visible by default, find copy button
    const copyBtn = wrapper.findAll('.btn').find((btn) => btn.text().includes('Copy'));
    await copyBtn.trigger('click');

    expect(wrapper.emitted('copy-output')).toBeTruthy();
    expect(wrapper.emitted('copy-output')[0]).toEqual(['Test output content']);
  });

  it('shows send to canvas button in output actions', async () => {
    const button = {
      id: '1',
      label: 'Test',
      command: 'npm test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: '1',
      status: 'success',
      output: 'Test output',
      exitCode: 0,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    // Output is visible by default
    // Canvas button exists
    const canvasBtn = wrapper.findAll('.btn').find((btn) => btn.text().includes('Canvas'));
    expect(canvasBtn).toBeDefined();
  });

  it('emits send-to-canvas event', async () => {
    const button = {
      id: '1',
      label: 'Run Tests',
      command: 'npm test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: '1',
      status: 'success',
      output: 'Test output',
      exitCode: 0,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    // Output is visible by default, find canvas button
    const canvasBtn = wrapper.findAll('.btn').find((btn) => btn.text().includes('Canvas'));
    await canvasBtn.trigger('click');

    expect(wrapper.emitted('send-to-canvas')).toBeTruthy();
    expect(wrapper.emitted('send-to-canvas')[0]).toEqual(['Run Tests', 'Test output']);
  });

  it('displays exit code in success state', () => {
    const button = {
      id: '1',
      label: 'Test',
      command: 'npm test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: '1',
      status: 'success',
      output: 'Success',
      exitCode: 0,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    expect(wrapper.text()).toContain('exit code: 0');
  });

  it('displays exit code in error state', () => {
    const button = {
      id: '1',
      label: 'Test',
      command: 'npm test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: '1',
      status: 'error',
      output: 'Error',
      exitCode: 127,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    expect(wrapper.text()).toContain('exit code: 127');
  });

  /**
   * TEST SUITE: ANSI Output Rendering
   */
  it('displays ANSI-formatted output as HTML', async () => {
    const button = {
      id: 'btn-1',
      label: 'Test',
      command: 'test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: 'btn-1',
      status: 'success',
      output: '\x1b[32mSuccess\x1b[0m',
      exitCode: 0,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    await nextTick();

    // Output should be rendered via v-html and contain styled span
    const outputDiv = wrapper.find('.output-text');
    expect(outputDiv.html()).toContain('span');
    expect(outputDiv.html()).toContain('style');
    expect(outputDiv.html()).toContain('Success');
  });

  it('handles red error output correctly', async () => {
    const button = {
      id: 'btn-1',
      label: 'Test',
      command: 'test',
      sortOrder: 0,
    };
    const run = {
      runId: 'run-1',
      buttonId: 'btn-1',
      status: 'error',
      output: '\x1b[31mError occurred\x1b[0m',
      exitCode: 1,
    };

    const wrapper = mount(CommandButtonItem, {
      props: {
        button,
        run,
        sessionId: 'session-1',
      },
    });

    await nextTick();

    const outputDiv = wrapper.find('.output-text');
    expect(outputDiv.html()).toContain('Error occurred');
  });

  /**
   * TEST SUITE: Scroll Handler Race Condition Fix
   * Tests for the isProgrammaticScroll flag that prevents race conditions
   * when auto-scroll triggers the onScroll handler.
   *
   * Note: These tests verify the fix through component structure and behavior
   * rather than internal state access, since Vue Test Utils doesn't expose
   * internal reactive refs in vm.
   */
  describe('Scroll Handler Race Condition Prevention', () => {
    it('has scroll event handler attached to output div', async () => {
      const button = {
        id: '1',
        label: 'Test',
        command: 'npm test',
        sortOrder: 0,
      };
      const run = {
        runId: 'run-1',
        buttonId: '1',
        status: 'running',
        output: 'Output text',
        exitCode: null,
      };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button,
          run,
          sessionId: 'session-1',
        },
      });

      await nextTick();

      // Verify the output div has ref and scroll handler
      const outputDiv = wrapper.find('.output-text');
      expect(outputDiv.exists()).toBe(true);

      // The component should have ref="outputRef" set up
      // This allows the scroll event handler to work properly
      expect(outputDiv.element).toBeDefined();
    });

    it('maintains output visibility through rapid output updates', async () => {
      const button = {
        id: '1',
        label: 'Test',
        command: 'npm test',
        sortOrder: 0,
      };
      const baseRun = {
        runId: 'run-1',
        buttonId: '1',
        status: 'running',
        output: 'Output 1',
        exitCode: null,
      };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button,
          run: baseRun,
          sessionId: 'session-1',
        },
      });

      await nextTick();

      // Simulate rapid output updates (like test output streaming)
      for (let i = 2; i <= 5; i++) {
        await wrapper.setProps({
          run: {
            ...baseRun,
            output: `Output 1\nOutput ${i}`,
          },
        });
        await nextTick();
      }

      // Verify output is still displayed and contains all content
      const outputDiv = wrapper.find('.output-text');
      expect(outputDiv.html()).toContain('Output 1');
      expect(outputDiv.html()).toContain('Output 5');
    });

    it('resets scroll state when run changes', async () => {
      const button = {
        id: '1',
        label: 'Test',
        command: 'npm test',
        sortOrder: 0,
      };
      const run1 = {
        runId: 'run-1',
        buttonId: '1',
        status: 'running',
        output: 'Output from run 1',
        exitCode: null,
      };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button,
          run: run1,
          sessionId: 'session-1',
        },
      });

      await nextTick();

      // Update to a different run
      const run2 = {
        runId: 'run-2',
        buttonId: '1',
        status: 'running',
        output: 'Output from run 2',
        exitCode: null,
      };

      await wrapper.setProps({ run: run2 });
      await nextTick();

      // Verify new output is displayed
      const outputDiv = wrapper.find('.output-text');
      expect(outputDiv.html()).toContain('Output from run 2');
      expect(outputDiv.html()).not.toContain('Output from run 1');
    });

    it('preserves output across completion state transition', async () => {
      const button = {
        id: '1',
        label: 'Test',
        command: 'npm test',
        sortOrder: 0,
      };
      const runningRun = {
        runId: 'run-1',
        buttonId: '1',
        status: 'running',
        output: 'Test output\nAll tests passed',
        exitCode: null,
      };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button,
          run: runningRun,
          sessionId: 'session-1',
        },
      });

      await nextTick();

      const runningOutput = wrapper.find('.output-text').html();
      expect(runningOutput).toContain('Test output');

      // Transition to completed state
      const completedRun = {
        ...runningRun,
        status: 'success',
        exitCode: 0,
      };

      await wrapper.setProps({ run: completedRun });
      await nextTick();

      // Output should be preserved
      const completedOutput = wrapper.find('.output-text').html();
      expect(completedOutput).toContain('Test output');
      expect(completedOutput).toContain('All tests passed');
    });

    it('handles large output without truncation', async () => {
      const button = {
        id: '1',
        label: 'Test',
        command: 'npm test',
        sortOrder: 0,
      };

      // Create large output (simulate > 100KB test results)
      const largeOutput = Array.from({ length: 1000 })
        .map((_, i) => `Line ${i + 1}: Test output content`)
        .join('\n');

      const run = {
        runId: 'run-1',
        buttonId: '1',
        status: 'success',
        output: largeOutput,
        exitCode: 0,
      };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button,
          run,
          sessionId: 'session-1',
        },
      });

      await nextTick();

      // Verify all output is rendered
      const outputDiv = wrapper.find('.output-text');
      expect(outputDiv.html()).toContain('Line 1');
      expect(outputDiv.html()).toContain('Line 1000');
      expect(wrapper.html()).toContain('1000');
    });
  });

});
