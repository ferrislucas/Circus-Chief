import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../database.js', () => ({
  sessions: {
    getById: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('./workflowSessionService.js', () => ({
  withActiveLaneRunOwnership: vi.fn((_sessionId, mutation) => mutation()),
}));

import { sessions } from '../database.js';
import { withActiveLaneRunOwnership } from './workflowSessionService.js';
import {
  captureScheduleWakeup,
  applyPendingWakeup,
  clearPendingWakeup,
  clampDelaySeconds,
  resolveWakeupPrompt,
  pendingWakeups,
  WAKEUP_MIN_DELAY_SECONDS,
  WAKEUP_MAX_DELAY_SECONDS,
} from './scheduleWakeupBridge.js';

const SESSION_ID = 'session-1';

/** Build a ScheduleWakeup tool_use block. */
function wakeupBlock(input, id = 'tool-1') {
  return { type: 'tool_use', id, name: 'ScheduleWakeup', input };
}

/** A session with no existing schedule. */
function unscheduledSession(overrides = {}) {
  return {
    id: SESSION_ID,
    projectId: 'project-1',
    scheduledAt: null,
    pendingPrompt: null,
    laneRunId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingWakeups.clear();
  sessions.update.mockImplementation((id, data) => ({ id, ...data }));
  withActiveLaneRunOwnership.mockImplementation((_sessionId, mutation) => mutation());
});

describe('clampDelaySeconds', () => {
  it('clamps to the SDK-documented bounds', () => {
    expect(clampDelaySeconds(10)).toBe(WAKEUP_MIN_DELAY_SECONDS);
    expect(clampDelaySeconds(99999)).toBe(WAKEUP_MAX_DELAY_SECONDS);
    expect(clampDelaySeconds(270)).toBe(270);
  });

  it('returns null for unusable input', () => {
    expect(clampDelaySeconds(undefined)).toBeNull();
    expect(clampDelaySeconds('600')).toBeNull();
    expect(clampDelaySeconds(NaN)).toBeNull();
    expect(clampDelaySeconds(Infinity)).toBeNull();
  });
});

describe('resolveWakeupPrompt', () => {
  it('keeps a real prompt, trimmed', () => {
    expect(resolveWakeupPrompt('  Continue: check the E2E log  ')).toBe('Continue: check the E2E log');
  });

  it('falls back for prompts the SDK would resolve from loop state', () => {
    expect(resolveWakeupPrompt('<<autonomous-loop-dynamic>>')).toBe('Continue');
    expect(resolveWakeupPrompt('<<autonomous-loop>>')).toBe('Continue');
  });

  it('falls back for missing or empty prompts', () => {
    expect(resolveWakeupPrompt(undefined)).toBe('Continue');
    expect(resolveWakeupPrompt('')).toBe('Continue');
    expect(resolveWakeupPrompt('   ')).toBe('Continue');
    expect(resolveWakeupPrompt({ not: 'a string' })).toBe('Continue');
  });
});

describe('captureScheduleWakeup', () => {
  it('records a wakeup without touching the database', () => {
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 270, reason: 'polling CI', prompt: 'Continue: check CI' })]);

    expect(sessions.update).not.toHaveBeenCalled();
    expect(pendingWakeups.get(SESSION_ID)).toMatchObject({
      delaySeconds: 270,
      prompt: 'Continue: check CI',
      reason: 'polling CI',
    });
  });

  it('ignores unrelated tools', () => {
    captureScheduleWakeup(SESSION_ID, [
      { type: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [] } },
      { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' } },
    ]);

    expect(pendingWakeups.has(SESSION_ID)).toBe(false);
  });

  it('is a no-op for empty or non-array input', () => {
    captureScheduleWakeup(SESSION_ID, []);
    captureScheduleWakeup(SESSION_ID, undefined);
    expect(pendingWakeups.has(SESSION_ID)).toBe(false);
  });

  it('lets the last call in a message win', () => {
    captureScheduleWakeup(SESSION_ID, [
      wakeupBlock({ delaySeconds: 60, reason: 'first', prompt: 'first' }, 't1'),
      wakeupBlock({ delaySeconds: 1200, reason: 'second', prompt: 'second' }, 't2'),
    ]);

    expect(pendingWakeups.get(SESSION_ID)).toMatchObject({ delaySeconds: 1200, prompt: 'second' });
  });

  it('lets a later message supersede an earlier one', () => {
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'early' }, 't1')]);
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 900, prompt: 'late' }, 't2')]);

    expect(pendingWakeups.get(SESSION_ID)).toMatchObject({ delaySeconds: 900, prompt: 'late' });
  });

  it('clamps at capture time', () => {
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 5, prompt: 'p' })]);
    expect(pendingWakeups.get(SESSION_ID).delaySeconds).toBe(WAKEUP_MIN_DELAY_SECONDS);
  });

  it('drops a wakeup with an unusable delay rather than guessing', () => {
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ reason: 'no delay', prompt: 'p' })]);
    expect(pendingWakeups.has(SESSION_ID)).toBe(false);
  });

  it('keeps sessions isolated from each other', () => {
    captureScheduleWakeup('session-a', [wakeupBlock({ delaySeconds: 100, prompt: 'a' })]);
    captureScheduleWakeup('session-b', [wakeupBlock({ delaySeconds: 200, prompt: 'b' })]);

    expect(pendingWakeups.get('session-a')).toMatchObject({ prompt: 'a' });
    expect(pendingWakeups.get('session-b')).toMatchObject({ prompt: 'b' });
  });
});

describe('applyPendingWakeup', () => {
  it('writes scheduledAt and pendingPrompt when a wakeup is pending', () => {
    sessions.getById.mockReturnValue(unscheduledSession());
    const before = Date.now();
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 600, reason: 'r', prompt: 'Continue: check log' })]);

    expect(applyPendingWakeup(SESSION_ID)).toBe(true);

    expect(sessions.update).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({
      pendingPrompt: 'Continue: check log',
      pendingConversationId: null,
    }));
    const { scheduledAt } = sessions.update.mock.calls[0][1];
    expect(scheduledAt).toBeGreaterThanOrEqual(before + 600 * 1000);
    expect(scheduledAt).toBeLessThanOrEqual(Date.now() + 600 * 1000);
  });

  it('is a no-op when nothing was captured', () => {
    expect(applyPendingWakeup(SESSION_ID)).toBe(false);
    expect(sessions.getById).not.toHaveBeenCalled();
    expect(sessions.update).not.toHaveBeenCalled();
  });

  it('consumes the wakeup so a second call does not reschedule', () => {
    sessions.getById.mockReturnValue(unscheduledSession());
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'p' })]);

    expect(applyPendingWakeup(SESSION_ID)).toBe(true);
    expect(applyPendingWakeup(SESSION_ID)).toBe(false);
    expect(sessions.update).toHaveBeenCalledTimes(1);
  });

  it('yields to an explicit REST schedule made during the same turn', () => {
    sessions.getById.mockReturnValue(unscheduledSession({
      scheduledAt: Date.now() + 3_600_000,
      pendingPrompt: 'Explicitly scheduled prompt',
    }));
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'wakeup prompt' })]);

    expect(applyPendingWakeup(SESSION_ID)).toBe(false);
    expect(sessions.update).not.toHaveBeenCalled();
  });

  it('does not treat a stray scheduledAt without a prompt as an existing schedule', () => {
    sessions.getById.mockReturnValue(unscheduledSession({ scheduledAt: Date.now() + 1000, pendingPrompt: '  ' }));
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'wakeup prompt' })]);

    expect(applyPendingWakeup(SESSION_ID)).toBe(true);
    expect(sessions.update).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({
      pendingPrompt: 'wakeup prompt',
    }));
  });

  it('forces the timestamp into the future when the turn outlived the delay', () => {
    sessions.getById.mockReturnValue(unscheduledSession());
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'p' })]);
    // Simulate a turn that ran well past the requested delay.
    pendingWakeups.get(SESSION_ID).capturedAt = Date.now() - 10 * 60 * 1000;

    expect(applyPendingWakeup(SESSION_ID)).toBe(true);
    expect(sessions.update.mock.calls[0][1].scheduledAt).toBeGreaterThan(Date.now());
  });

  it('returns false when the session no longer exists', () => {
    sessions.getById.mockReturnValue(null);
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'p' })]);

    expect(applyPendingWakeup(SESSION_ID)).toBe(false);
    expect(sessions.update).not.toHaveBeenCalled();
  });

  it('fences the write behind lane-run ownership for workflow sessions', () => {
    sessions.getById.mockReturnValue(unscheduledSession({ laneRunId: 'run-1' }));
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'p' })]);

    applyPendingWakeup(SESSION_ID);

    expect(withActiveLaneRunOwnership).toHaveBeenCalledWith(SESSION_ID, expect.any(Function));
  });

  it('drops the wakeup when the lane run was superseded mid-turn', () => {
    sessions.getById.mockReturnValue(unscheduledSession({ laneRunId: 'run-1' }));
    withActiveLaneRunOwnership.mockReturnValue(null);
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'p' })]);

    expect(applyPendingWakeup(SESSION_ID)).toBe(false);
  });

  it('does not fence non-workflow sessions', () => {
    sessions.getById.mockReturnValue(unscheduledSession());
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'p' })]);

    applyPendingWakeup(SESSION_ID);

    expect(withActiveLaneRunOwnership).not.toHaveBeenCalled();
  });
});

describe('clearPendingWakeup', () => {
  it('discards a captured wakeup without applying it', () => {
    sessions.getById.mockReturnValue(unscheduledSession());
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'p' })]);

    clearPendingWakeup(SESSION_ID);

    expect(applyPendingWakeup(SESSION_ID)).toBe(false);
    expect(sessions.update).not.toHaveBeenCalled();
  });
});
