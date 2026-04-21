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

  describe('reactive tooltip (Step 4)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(START);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('refreshes the Started <time> title while the interval ticks', async () => {
      const run = {
        runId: 'r1',
        buttonId: 'b1',
        status: 'running',
        startedAt: START,
        exitCode: null,
      };
      const wrapper = mount(RunTimestamps, { props: { run } });

      const started = wrapper.find('time');
      const initialTitle = started.attributes('title');
      expect(initialTitle).toMatch(/just now/);

      // Advance both the system clock and the interval; nowTick.value is
      // mutated on each tick, which invalidates the :title computation.
      vi.advanceTimersByTime(65_000);
      await nextTick();

      const updatedTitle = wrapper.find('time').attributes('title');
      expect(updatedTitle).toMatch(/1 minute ago/);
      expect(updatedTitle).not.toBe(initialTitle);
    });

    it('renders a past-relative tooltip for a completed run without ticking', () => {
      // System clock is at START; startedAt is 2 minutes earlier.
      const run = {
        runId: 'r1',
        buttonId: 'b1',
        status: 'success',
        startedAt: START - 120_000,
        completedAt: START,
        exitCode: 0,
      };
      const wrapper = mount(RunTimestamps, { props: { run } });

      const startedTitle = wrapper.findAll('time')[0].attributes('title');
      expect(startedTitle).toMatch(/2 minutes ago/);
    });
  });

  describe('stopTicking preserves elapsedTime (Step 5)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(START);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('keeps the last-observed counter when transitioning to success', async () => {
      const run = {
        runId: 'r1',
        buttonId: 'b1',
        status: 'running',
        startedAt: START,
        exitCode: null,
      };
      const wrapper = mount(RunTimestamps, { props: { run } });

      vi.advanceTimersByTime(12_000);
      await nextTick();
      expect(wrapper.vm.elapsedTime).toBe('0:12');

      await wrapper.setProps({
        run: { ...run, status: 'success', completedAt: START + 12_000, exitCode: 0 },
      });
      await nextTick();

      // The exposed ref must NOT flick back to "0:00"; parent components
      // that mirror it (CommandButtonItem footer) would otherwise show a
      // stale zero immediately after completion.
      expect(wrapper.vm.elapsedTime).toBe('0:12');
    });

    it('initializes elapsedTime to "0:00" for a non-running fresh mount', () => {
      const run = {
        runId: 'r1',
        buttonId: 'b1',
        status: 'success',
        startedAt: START,
        completedAt: START + 8000,
        exitCode: 0,
      };
      const wrapper = mount(RunTimestamps, { props: { run } });
      expect(wrapper.vm.elapsedTime).toBe('0:00');
    });

    it('resets elapsedTime to "0:00" on each entry into running state', async () => {
      // Start idle with a stale "0:42" value in the exposed ref would be a
      // problem IF stopTicking previously mutated it — it no longer does.
      // This test locks the contract that startTicking resets before tick(),
      // so even after a prior running-then-idle sequence the counter starts
      // at 0:00 when re-entering running state.
      const idleRun = {
        runId: 'r0',
        buttonId: 'b1',
        status: 'success',
        startedAt: START - 10_000,
        completedAt: START,
        exitCode: 0,
      };
      const wrapper = mount(RunTimestamps, { props: { run: idleRun } });
      expect(wrapper.vm.elapsedTime).toBe('0:00');

      // Transition into running with a fresh start timestamp.
      await wrapper.setProps({
        run: {
          runId: 'r1',
          buttonId: 'b1',
          status: 'running',
          startedAt: START,
          exitCode: null,
        },
      });
      await nextTick();

      // tick() runs immediately inside startTicking; system time is exactly
      // START so the elapsed is zero seconds.
      expect(wrapper.vm.elapsedTime).toBe('0:00');
    });
  });
});
