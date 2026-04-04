import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import CommandButtonStatusBar from './CommandButtonStatusBar.vue';

describe('CommandButtonStatusBar', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders nothing when buttonStatuses is empty', () => {
    const wrapper = mount(CommandButtonStatusBar, {
      props: {
        buttonStatuses: [],
      },
    });
    expect(wrapper.find('.command-status-bar').exists()).toBe(false);
  });

  it('renders status indicators for each button status', () => {
    const buttonStatuses = [
      {
        buttonId: 'btn-1',
        label: 'Test Command',
        status: 'running',
        latestRun: { runId: 'run-1', status: 'running' },
      },
      {
        buttonId: 'btn-2',
        label: 'Build',
        status: 'success',
        latestRun: { runId: 'run-2', status: 'success', exitCode: 0 },
      },
    ];

    const wrapper = mount(CommandButtonStatusBar, {
      props: { buttonStatuses },
    });

    expect(wrapper.find('.command-status-bar').exists()).toBe(true);
    const indicators = wrapper.findAll('.button-status-indicator');
    expect(indicators).toHaveLength(2);
  });

  it('displays correct status icon for running state', () => {
    const buttonStatuses = [
      {
        buttonId: 'btn-1',
        label: 'Test',
        status: 'running',
        latestRun: { runId: 'run-1', status: 'running' },
      },
    ];

    const wrapper = mount(CommandButtonStatusBar, {
      props: { buttonStatuses },
    });

    const indicator = wrapper.find('.button-status-indicator');
    expect(indicator.text()).toBe('⊙');
    expect(indicator.classes()).toContain('button-status-running');
  });

  it('displays correct status icon for success state', () => {
    const buttonStatuses = [
      {
        buttonId: 'btn-1',
        label: 'Test',
        status: 'success',
        latestRun: { runId: 'run-1', status: 'success', exitCode: 0 },
      },
    ];

    const wrapper = mount(CommandButtonStatusBar, {
      props: { buttonStatuses },
    });

    const indicator = wrapper.find('.button-status-indicator');
    expect(indicator.text()).toBe('✓');
    expect(indicator.classes()).toContain('button-status-success');
  });

  it('displays correct status icon for error state', () => {
    const buttonStatuses = [
      {
        buttonId: 'btn-1',
        label: 'Test',
        status: 'error',
        latestRun: { runId: 'run-1', status: 'error', exitCode: 1 },
      },
    ];

    const wrapper = mount(CommandButtonStatusBar, {
      props: { buttonStatuses },
    });

    const indicator = wrapper.find('.button-status-indicator');
    expect(indicator.text()).toBe('✕');
    expect(indicator.classes()).toContain('button-status-error');
  });

  it('shows tooltip with button label and status', () => {
    const buttonStatuses = [
      {
        buttonId: 'btn-1',
        label: 'Build Project',
        status: 'running',
        latestRun: { runId: 'run-1', status: 'running' },
      },
    ];

    const wrapper = mount(CommandButtonStatusBar, {
      props: { buttonStatuses },
    });

    const indicator = wrapper.find('.button-status-indicator');
    expect(indicator.attributes('title')).toBe('Build Project: running');
  });

  it('opens modal when indicator is clicked', async () => {
    const buttonStatuses = [
      {
        buttonId: 'btn-1',
        label: 'Test',
        status: 'success',
        latestRun: { runId: 'run-1', status: 'success', exitCode: 0 },
      },
    ];

    const wrapper = mount(CommandButtonStatusBar, {
      props: { buttonStatuses },
      global: {
        stubs: {
          ButtonStatusModal: true,
        },
      },
    });

    const indicator = wrapper.find('.button-status-indicator');
    await indicator.trigger('click');

    // Modal should appear
    expect(wrapper.findComponent({ name: 'ButtonStatusModal' }).exists()).toBe(true);
  });

  it('passes command property to modal when available', async () => {
    const buttonStatuses = [
      {
        buttonId: 'btn-1',
        label: 'Build',
        command: 'npm run build',
        status: 'success',
        latestRun: { runId: 'run-1', status: 'success', exitCode: 0 },
      },
    ];

    const wrapper = mount(CommandButtonStatusBar, {
      props: { buttonStatuses },
      global: {
        stubs: {
          ButtonStatusModal: true,
        },
      },
    });

    const indicator = wrapper.find('.button-status-indicator');
    await indicator.trigger('click');

    // Verify modal is rendered with the correct props
    const modal = wrapper.findComponent({ name: 'ButtonStatusModal' });
    expect(modal.exists()).toBe(true);
    expect(modal.props('button')).toEqual({ id: 'btn-1', label: 'Build', command: 'npm run build' });
  });

  it('passes sessionId prop to ButtonStatusModal', async () => {
    const buttonStatuses = [
      {
        buttonId: 'btn-1',
        label: 'Build',
        command: 'npm run build',
        status: 'success',
        latestRun: { runId: 'run-1', status: 'success', exitCode: 0 },
      },
    ];

    const wrapper = mount(CommandButtonStatusBar, {
      props: { buttonStatuses, sessionId: 'session-abc' },
      global: {
        stubs: {
          ButtonStatusModal: true,
        },
      },
    });

    const indicator = wrapper.find('.button-status-indicator');
    await indicator.trigger('click');

    const modal = wrapper.findComponent({ name: 'ButtonStatusModal' });
    expect(modal.exists()).toBe(true);
    expect(modal.props('sessionId')).toBe('session-abc');
  });
});
