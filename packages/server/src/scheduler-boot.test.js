import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SchedulerService } from './services/schedulerService.js';

/**
 * This test imports the scheduler service directly (not index.js) and
 * exercises the boot-time gate that index.js delegates to. Using fake
 * timers lets us assert polling vs. non-polling behavior without waiting
 * 30 real seconds.
 */
describe('scheduler boot gate', () => {
  let scheduler;
  let sessionManager;

  beforeEach(() => {
    scheduler = new SchedulerService();
    sessionManager = { runSession: vi.fn() };
    vi.useFakeTimers();
  });

  afterEach(() => {
    scheduler.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('does not poll when VCR_MODE=replay', () => {
    const checkSpy = vi.spyOn(scheduler, 'checkScheduledSessions');
    const started = scheduler.startIfEnabled(sessionManager, { VCR_MODE: 'replay' });

    expect(started).toBe(false);
    // Advance well past pollInterval — no poll should have fired.
    vi.advanceTimersByTime(scheduler.pollInterval * 3);
    expect(checkSpy).not.toHaveBeenCalled();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('schedules polling at pollInterval when VCR_MODE is unset', () => {
    const checkSpy = vi.spyOn(scheduler, 'checkScheduledSessions')
      .mockImplementation(() => {});
    const started = scheduler.startIfEnabled(sessionManager, {});

    expect(started).toBe(true);
    // Immediate check runs inside start()
    expect(checkSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(scheduler.pollInterval);
    expect(checkSpy).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(scheduler.pollInterval);
    expect(checkSpy).toHaveBeenCalledTimes(3);
  });
});
