import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import RunTimestamps from './RunTimestamps.vue';

// A fixed reference instant: 2026-01-01T14:32:05 local time.
const START = new Date(2026, 0, 1, 14, 32, 5).getTime();
const END = START + 42_000; // 42 seconds later

describe('RunTimestamps', () => {
  it('renders "Not yet run" when run is null', () => {
    const wrapper = mount(RunTimestamps, { props: { run: null } });
    expect(wrapper.text()).toContain('Not yet run');
  });

  it('renders Started / Ended / duration for a completed success run', () => {
    const run = {
      runId: 'r1',
      buttonId: 'b1',
      status: 'success',
      startedAt: START,
      completedAt: END,
      exitCode: 0,
    };
    const wrapper = mount(RunTimestamps, { props: { run } });
    const text = wrapper.text();
    expect(text).toContain('Started');
    expect(text).toContain('Ended');
    expect(text).toContain('42s');
  });

  it('renders Started / Ended for an errored run', () => {
    const run = {
      runId: 'r1',
      buttonId: 'b1',
      status: 'error',
      startedAt: START,
      completedAt: START + 4000,
      exitCode: 1,
    };
    const wrapper = mount(RunTimestamps, { props: { run } });
    const text = wrapper.text();
    expect(text).toContain('Started');
    expect(text).toContain('Ended');
    expect(text).toContain('4s');
  });

  it('renders "Killed at" for a killed run', () => {
    const run = {
      runId: 'r1',
      buttonId: 'b1',
      status: 'killed',
      startedAt: START,
      completedAt: START + 5000,
      exitCode: -1,
    };
    const wrapper = mount(RunTimestamps, { props: { run } });
    expect(wrapper.text()).toContain('Killed at');
  });

  it('each <time> element has datetime, title, and aria-label attributes', () => {
    const run = {
      runId: 'r1',
      buttonId: 'b1',
      status: 'success',
      startedAt: START,
      completedAt: END,
      exitCode: 0,
    };
    const wrapper = mount(RunTimestamps, { props: { run } });
    const times = wrapper.findAll('time');
    expect(times.length).toBeGreaterThanOrEqual(2);
    for (const t of times) {
      expect(t.attributes('datetime')).toBeTruthy();
      expect(t.attributes('title')).toBeTruthy();
      expect(t.attributes('aria-label')).toBeTruthy();
    }
  });

  describe('running state timer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(START);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('renders Started / Running… / elapsed and ticks every second', async () => {
      const run = {
        runId: 'r1',
        buttonId: 'b1',
        status: 'running',
        startedAt: START,
        exitCode: null,
      };
      const wrapper = mount(RunTimestamps, { props: { run } });

      expect(wrapper.text()).toContain('Started');
      expect(wrapper.text()).toContain('Running…');
      // Initial tick should render 0:00
      expect(wrapper.find('[data-testid="run-timestamps-elapsed"]').text()).toBe('0:00');

      // Advance 12 seconds — the interval + system time together should
      // produce "0:12".
      vi.advanceTimersByTime(12_000);
      await nextTick();
      expect(wrapper.find('[data-testid="run-timestamps-elapsed"]').text()).toBe('0:12');
    });

    it('stops the interval when the run transitions away from "running"', async () => {
      const run = {
        runId: 'r1',
        buttonId: 'b1',
        status: 'running',
        startedAt: START,
        exitCode: null,
      };
      const wrapper = mount(RunTimestamps, { props: { run } });

      const clearSpy = vi.spyOn(globalThis, 'clearInterval');

      await wrapper.setProps({
        run: { ...run, status: 'success', completedAt: START + 5000, exitCode: 0 },
      });
      await nextTick();

      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });

    it('clears the interval on unmount', async () => {
      const run = {
        runId: 'r1',
        buttonId: 'b1',
        status: 'running',
        startedAt: START,
        exitCode: null,
      };
      const wrapper = mount(RunTimestamps, { props: { run } });

      const clearSpy = vi.spyOn(globalThis, 'clearInterval');
      wrapper.unmount();
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });

  it('exposes a reactive elapsedTime via defineExpose', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const run = {
      runId: 'r1',
      buttonId: 'b1',
      status: 'running',
      startedAt: START,
      exitCode: null,
    };
    const wrapper = mount(RunTimestamps, { props: { run } });
    expect(wrapper.vm.elapsedTime).toBe('0:00');

    vi.advanceTimersByTime(3000);
    await nextTick();
    expect(wrapper.vm.elapsedTime).toBe('0:03');

    vi.useRealTimers();
  });
});
