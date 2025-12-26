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

  it('shows output section when expanded', async () => {
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

    // Click to expand output
    await wrapper.find('.output-header').trigger('click');
    await nextTick();

    expect(wrapper.find('.output-content').exists()).toBe(true);
    expect(wrapper.text()).toContain('Test output');
  });

  it('hides output section by default', async () => {
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

    // Output should not be visible initially
    expect(wrapper.find('.output-content').exists()).toBe(false);
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

    // Initially hidden
    expect(wrapper.find('.output-content').exists()).toBe(false);

    // Click to show
    await header.trigger('click');
    await nextTick();
    expect(wrapper.find('.output-content').exists()).toBe(true);

    // Click to hide
    await header.trigger('click');
    await nextTick();
    expect(wrapper.find('.output-content').exists()).toBe(false);
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

    // Expand output
    await wrapper.find('.output-header').trigger('click');
    await nextTick();

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

    // Expand and find copy button
    await wrapper.find('.output-header').trigger('click');
    await nextTick();
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

    // Expand output
    await wrapper.find('.output-header').trigger('click');
    await nextTick();

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

    // Expand and find canvas button
    await wrapper.find('.output-header').trigger('click');
    await nextTick();
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
});
