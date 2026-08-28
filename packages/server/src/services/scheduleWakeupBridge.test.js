import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../database.js', () => ({
  sessions: {
    getById: vi.fn(),
    update: vi.fn(),
  },
  messages: {
    getByConversationId: vi.fn(),
    getLastByConversationIdAndRole: vi.fn(),
  },
  conversations: {
    getActiveBySessionId: vi.fn(),
  },
  workLogs: {
    create: vi.fn((sessionId, type, content, options) => ({
      id: 'log-1', sessionId, type, content, ...options,
    })),
  },
}));

vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
}));

vi.mock('./workflowSessionService.js', () => ({
  withActiveLaneRunOwnership: vi.fn((_sessionId, mutation) => mutation()),
}));

import { sessions, messages, conversations, workLogs } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { withActiveLaneRunOwnership } from './workflowSessionService.js';
import {
  captureScheduleWakeup as captureWakeupForTurn,
  applyPendingWakeup as applyWakeupForTurn,
  hasPendingWakeup as hasPendingWakeupForTurn,
  clearPendingWakeup as clearWakeupForTurn,
  recordExplicitSchedule as recordExplicitScheduleForTurn,
  clampDelaySeconds,
  resolveWakeupPrompt,
  AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
  wakeupTurnStates,
  __resetWakeupTurnStatesForTest,
  WAKEUP_MIN_DELAY_SECONDS,
  WAKEUP_MAX_DELAY_SECONDS,
} from './scheduleWakeupBridge.js';

const SESSION_ID = 'session-1';
let turnController;

function captureScheduleWakeup(sessionId, toolUseBlocks) {
  return captureWakeupForTurn(sessionId, turnController, toolUseBlocks);
}

function applyPendingWakeup(sessionId) {
  return applyWakeupForTurn(sessionId, turnController);
}

function clearPendingWakeup(sessionId) {
  return clearWakeupForTurn(sessionId, turnController);
}

function recordExplicitSchedule(sessionId) {
  return recordExplicitScheduleForTurn(sessionId, turnController);
}

const pendingWakeups = {
  clear: () => __resetWakeupTurnStatesForTest(),
  get: () => wakeupTurnStates.get(turnController)?.pendingWakeup,
  has: () => Boolean(wakeupTurnStates.get(turnController)?.pendingWakeup),
};

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
  turnController = new AbortController();
  pendingWakeups.clear();
  clearPendingWakeup(SESSION_ID);
  sessions.update.mockImplementation((id, data) => ({ id, ...data }));
  conversations.getActiveBySessionId.mockReturnValue(null);
  messages.getByConversationId.mockReturnValue([]);
  messages.getLastByConversationIdAndRole.mockReturnValue(null);
  withActiveLaneRunOwnership.mockImplementation((_sessionId, mutation) => mutation());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('clampDelaySeconds', () => {
  it('clamps to the SDK-documented bounds', () => {
    expect(clampDelaySeconds(10)).toBe(WAKEUP_MIN_DELAY_SECONDS);
    expect(clampDelaySeconds(99999)).toBe(WAKEUP_MAX_DELAY_SECONDS);
    expect(clampDelaySeconds(270)).toBe(270);
  });

  it('coerces a numeric string (models sometimes emit these) instead of dropping the wakeup', () => {
    expect(clampDelaySeconds('600')).toBe(600);
    expect(clampDelaySeconds('10')).toBe(WAKEUP_MIN_DELAY_SECONDS);
  });

  it('returns null for unusable input', () => {
    expect(clampDelaySeconds(undefined)).toBeNull();
    expect(clampDelaySeconds(NaN)).toBeNull();
    expect(clampDelaySeconds(Infinity)).toBeNull();
    expect(clampDelaySeconds('')).toBeNull();
    expect(clampDelaySeconds('   ')).toBeNull();
    expect(clampDelaySeconds('not-a-number')).toBeNull();
  });
});

describe('resolveWakeupPrompt', () => {
  it('keeps a real prompt, trimmed', () => {
    expect(resolveWakeupPrompt('  Continue: check the E2E log  ')).toBe('Continue: check the E2E log');
  });

  it('leaves the supported dynamic sentinel for context-aware handling and rejects the CronCreate-only sentinel', () => {
    expect(resolveWakeupPrompt(AUTONOMOUS_LOOP_DYNAMIC_SENTINEL)).toBe(AUTONOMOUS_LOOP_DYNAMIC_SENTINEL);
    expect(resolveWakeupPrompt('<<autonomous-loop>>')).toBeNull();
  });

  it('falls back to Continue only for missing or empty prompts', () => {
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

  it('defers the dynamic autonomous-loop sentinel context resolution until apply time', () => {
    conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-loop', claudeSessionId: 'claude-loop' });
    messages.getLastByConversationIdAndRole.mockReturnValue({ id: 'user-loop', role: 'user', content: '/loop' });

    captureScheduleWakeup(SESSION_ID, [wakeupBlock({
      delaySeconds: 600,
      reason: 'wait for the external job',
      prompt: AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
    })]);

    // Context resolution is deferred to apply time: the conversation is only
    // read once the turn ends, not on every capture.
    expect(messages.getByConversationId).not.toHaveBeenCalled();
    expect(messages.getLastByConversationIdAndRole).not.toHaveBeenCalled();
    expect(pendingWakeups.get(SESSION_ID)).toMatchObject({
      isAutonomousLoop: true,
      deferredSentinel: true,
    });
  });

  it('refuses the dynamic sentinel when no resumable conversation can preserve loop context', () => {
    conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-loop', claudeSessionId: null });

    captureScheduleWakeup(SESSION_ID, [wakeupBlock({
      delaySeconds: 600,
      prompt: AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
    })]);

    // Deferred to apply time: capture keeps the deferred marker...
    expect(pendingWakeups.has(SESSION_ID)).toBe(true);

    // ...and apply drops it once the loop context turns out to be unresolvable.
    sessions.getById.mockReturnValue(unscheduledSession());
    expect(applyPendingWakeup(SESSION_ID)).toBe(false);
    expect(workLogs.create).toHaveBeenCalledWith(
      SESSION_ID,
      'tool_output',
      expect.stringContaining('cannot safely reconstruct'),
      expect.objectContaining({ toolName: 'ScheduleWakeup' })
    );
  });

  it('refuses the dynamic sentinel outside a persisted /loop invocation instead of scheduling unrelated work', () => {
    conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-other', claudeSessionId: 'claude-other' });
    messages.getLastByConversationIdAndRole.mockReturnValue({ id: 'user-other', role: 'user', content: 'Fix the failing test' });

    captureScheduleWakeup(SESSION_ID, [wakeupBlock({
      delaySeconds: 600,
      prompt: AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
    })]);

    expect(pendingWakeups.has(SESSION_ID)).toBe(true);

    sessions.getById.mockReturnValue(unscheduledSession());
    expect(applyPendingWakeup(SESSION_ID)).toBe(false);
    expect(workLogs.create).toHaveBeenCalledWith(
      SESSION_ID,
      'tool_output',
      expect.stringContaining('cannot safely reconstruct'),
      expect.objectContaining({ toolName: 'ScheduleWakeup' })
    );
  });

  it('drops a wakeup with an unusable delay rather than guessing, and logs why', () => {
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ reason: 'no delay', prompt: 'p' })]);

    expect(pendingWakeups.has(SESSION_ID)).toBe(false);
    expect(workLogs.create).toHaveBeenCalledWith(
      SESSION_ID,
      'tool_output',
      expect.stringContaining('non-numeric delaySeconds'),
      expect.objectContaining({ toolName: 'ScheduleWakeup' })
    );
    expect(broadcastToSession).toHaveBeenCalled();
  });

  it('cancels an earlier wakeup when a later call has an unusable delay', () => {
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'earlier' }, 't1')]);
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 'not-a-number', prompt: 'later' }, 't2')]);

    expect(pendingWakeups.has(SESSION_ID)).toBe(false);
  });

  it('refuses the CronCreate-only loop sentinel rather than substituting Continue, and logs why', () => {
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 600, prompt: '<<autonomous-loop>>' })]);

    expect(pendingWakeups.has(SESSION_ID)).toBe(false);
    expect(workLogs.create).toHaveBeenCalledWith(
      SESSION_ID,
      'tool_output',
      expect.stringContaining('unsupported SDK loop sentinel'),
      expect.objectContaining({ toolName: 'ScheduleWakeup' })
    );
  });

  it('cancels an earlier wakeup when a later call uses an unsupported sentinel', () => {
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'earlier' }, 't1')]);
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 600, prompt: '<<autonomous-loop>>' }, 't2')]);

    expect(pendingWakeups.has(SESSION_ID)).toBe(false);
  });

  it('keeps sessions isolated from each other', () => {
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    captureWakeupForTurn('session-a', controllerA, [wakeupBlock({ delaySeconds: 100, prompt: 'a' })]);
    captureWakeupForTurn('session-b', controllerB, [wakeupBlock({ delaySeconds: 200, prompt: 'b' })]);

    expect(wakeupTurnStates.get(controllerA)?.pendingWakeup).toMatchObject({ prompt: 'a' });
    expect(wakeupTurnStates.get(controllerB)?.pendingWakeup).toMatchObject({ prompt: 'b' });

    clearWakeupForTurn('session-a', controllerA);
    clearWakeupForTurn('session-b', controllerB);
  });

  describe('tool_use id dedup', () => {
    it('ignores a redelivery of the same tool_use id rather than treating it as a new call', () => {
      const block = wakeupBlock({ delaySeconds: 300, prompt: 'first' }, 'tool-dup');
      captureScheduleWakeup(SESSION_ID, [block]);
      const capturedAt = pendingWakeups.get(SESSION_ID).capturedAt;

      // The stream redelivers the identical partial-message content.
      captureScheduleWakeup(SESSION_ID, [block]);

      expect(pendingWakeups.get(SESSION_ID).capturedAt).toBe(capturedAt);
      expect(pendingWakeups.get(SESSION_ID)).toMatchObject({ prompt: 'first' });
    });

    it('does not let a stale redelivery of an earlier call override a genuinely later one', () => {
      const early = wakeupBlock({ delaySeconds: 60, prompt: 'early' }, 'tool-a');
      const late = wakeupBlock({ delaySeconds: 900, prompt: 'late' }, 'tool-b');

      captureScheduleWakeup(SESSION_ID, [early]);
      captureScheduleWakeup(SESSION_ID, [late]);
      // A redelivery of the original (now-stale) partial batch arrives after.
      captureScheduleWakeup(SESSION_ID, [early, late]);

      expect(pendingWakeups.get(SESSION_ID)).toMatchObject({ prompt: 'late' });
    });

    it('still applies last-call-wins across two genuinely new ids', () => {
      captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'a' }, 't1')]);
      captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'b' }, 't2')]);

      expect(pendingWakeups.get(SESSION_ID)).toMatchObject({ prompt: 'b' });
    });
  });
});

describe('applyPendingWakeup', () => {
  it('writes status, scheduledAt, and pendingPrompt when a wakeup is pending', () => {
    sessions.getById.mockReturnValue(unscheduledSession());
    const before = Date.now();
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 600, reason: 'r', prompt: 'Continue: check log' })]);

    expect(applyPendingWakeup(SESSION_ID)).toBe(true);

    expect(sessions.update).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({
      status: 'scheduled',
      pendingPrompt: 'Continue: check log',
      pendingConversationId: null,
    }));
    const { scheduledAt } = sessions.update.mock.calls[0][1];
    // scheduledAt honours the SDK's promise (capturedAt + delay), which is
    // ~600s from the capture a few ms ago. The lower bound is relaxed to
    // absorb the capture<->apply clock jitter, not to test clock precision.
    expect(scheduledAt).toBeGreaterThanOrEqual(before + 590 * 1000);
    expect(scheduledAt).toBeLessThanOrEqual(Date.now() + 600 * 1000);
  });

  it('persists the autonomous-loop conversation selector so the scheduler resumes its exact user message', () => {
    sessions.getById.mockReturnValue(unscheduledSession());
    conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-loop', claudeSessionId: 'claude-loop' });
    messages.getLastByConversationIdAndRole.mockReturnValue({ id: 'user-loop', role: 'user', content: '/loop' });
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({
      delaySeconds: 600,
      prompt: AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
    })]);

    expect(applyPendingWakeup(SESSION_ID)).toBe(true);
    expect(messages.getLastByConversationIdAndRole).toHaveBeenCalledWith('conv-loop', 'user');
    expect(sessions.update).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({
      pendingPrompt: 'Continue',
      pendingConversationId: 'conv-loop',
    }));
  });

  it('severs a stale pendingModel instead of inheriting it from a superseded schedule', () => {
    // Repro: an explicit POST /:id/schedule wrote pendingModel=M in a prior
    // turn; the wakeup supersedes the schedule but must NOT adopt M. A wakeup
    // has no model component (SDK input is only delaySeconds/prompt/reason).
    sessions.getById.mockReturnValue(unscheduledSession({ pendingModel: 'deepseek-v4-pro-0813' }));
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 600, prompt: 'wakeup prompt' })]);

    expect(applyPendingWakeup(SESSION_ID)).toBe(true);
    expect(sessions.update).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({
      pendingPrompt: 'wakeup prompt',
      pendingModel: null,
    }));
  });

  it('keeps the autonomous-loop sentinel resume free of a stale pendingModel that would force a fresh conversation', () => {
    // A stale pendingModel != session.model sets modelChanged=true at launch,
    // which disables canResume — the exact failure mode that drops the loop's
    // Claude conversation context. The sentinel path must leave nothing behind
    // that can force that.
    sessions.getById.mockReturnValue(unscheduledSession({ pendingModel: 'X' }));
    conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-loop', claudeSessionId: 'claude-loop' });
    messages.getLastByConversationIdAndRole.mockReturnValue({ id: 'user-loop', role: 'user', content: '/loop' });
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({
      delaySeconds: 600,
      prompt: AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
    })]);

    expect(applyPendingWakeup(SESSION_ID)).toBe(true);
    expect(sessions.update).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({
      pendingConversationId: 'conv-loop',
      pendingModel: null,
    }));
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

  it('fires no sooner than now when the turn already overran the requested delay', () => {
    sessions.getById.mockReturnValue(unscheduledSession());
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'p' })]);
    // Simulate a turn that ran well past the requested delay: capturedAt is
    // old, so the SDK-promised capturedAt + delay is already in the past and
    // the fire time must collapse to *now*, never earlier.
    pendingWakeups.get(SESSION_ID).capturedAt = Date.now() - 10 * 60 * 1000;

    const before = Date.now();
    expect(applyPendingWakeup(SESSION_ID)).toBe(true);
    const { scheduledAt } = sessions.update.mock.calls[0][1];

    expect(scheduledAt).toBeGreaterThanOrEqual(before);
    expect(scheduledAt).toBeLessThanOrEqual(before + 60 * 1000);
  });

  it('fires at capturedAt + delay when the turn finished before the requested delay elapsed', () => {
    sessions.getById.mockReturnValue(unscheduledSession());
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'p' })]);
    const { capturedAt } = pendingWakeups.get(SESSION_ID);

    expect(applyPendingWakeup(SESSION_ID)).toBe(true);
    const { scheduledAt } = sessions.update.mock.calls[0][1];

    // A short turn keeps the SDK's promise: capturedAt + delay (≈55s from now),
    // not "now + delay" (60s from now).
    expect(scheduledAt).toBeGreaterThanOrEqual(capturedAt + 60 * 1000 - 1000);
    expect(scheduledAt).toBeLessThanOrEqual(capturedAt + 60 * 1000 + 1000);
  });

  it('does not touch rescheduleCount (characterization)', () => {
    // Pinning today's behavior: applyPendingWakeup never writes rescheduleCount.
    // Retry-governance for wakeups is the open issue-1 decision, deliberately
    // out of scope — if a future change adds reschedule-counting, this test is
    // the visible place to update it rather than letting it drift silently.
    sessions.getById.mockReturnValue(unscheduledSession());
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'p' })]);

    expect(applyPendingWakeup(SESSION_ID)).toBe(true);
    expect(sessions.update.mock.calls[0][1]).not.toHaveProperty('rescheduleCount');
  });

  describe('precedence against an explicit REST schedule', () => {
    it('yields when the explicit schedule was recorded after the wakeup was captured', () => {
      sessions.getById.mockReturnValue(unscheduledSession({
        scheduledAt: Date.now() + 3_600_000,
        pendingPrompt: 'Explicitly scheduled prompt',
      }));
      captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'wakeup prompt' })]);
      recordExplicitSchedule(SESSION_ID); // happens later in the same turn

      expect(applyPendingWakeup(SESSION_ID)).toBe(false);
      expect(sessions.update).not.toHaveBeenCalled();
      expect(workLogs.create).toHaveBeenCalledWith(
        SESSION_ID,
        'tool_output',
        expect.stringContaining('superseded'),
        expect.objectContaining({ toolName: 'ScheduleWakeup' })
      );
    });

    it('wins when the wakeup was captured after the explicit schedule (last call in the turn wins)', () => {
      recordExplicitSchedule(SESSION_ID); // an earlier POST /:id/schedule call this turn
      sessions.getById.mockReturnValue(unscheduledSession({
        scheduledAt: Date.now() + 3_600_000,
        pendingPrompt: 'Earlier explicit prompt',
      }));
      captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'later wakeup prompt' })]);

      expect(applyPendingWakeup(SESSION_ID)).toBe(true);
      expect(sessions.update).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({
        pendingPrompt: 'later wakeup prompt',
      }));
    });

    it('does not let a schedule row with no recorded explicit-write this turn block a wakeup (stale row)', () => {
      // scheduledAt/pendingPrompt present on the row, but recordExplicitSchedule
      // was never called this turn — nothing to actually race against.
      sessions.getById.mockReturnValue(unscheduledSession({
        scheduledAt: Date.now() + 3_600_000,
        pendingPrompt: 'Stale leftover prompt',
      }));
      captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'wakeup prompt' })]);

      expect(applyPendingWakeup(SESSION_ID)).toBe(true);
      expect(sessions.update).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({
        pendingPrompt: 'wakeup prompt',
      }));
    });

    it('lets a pre-turn user schedule lose to a wakeup captured this turn (characterization)', () => {
      // Pinning current precedence for the issue-3 scenario: a REST schedule
      // written *before* this turn started has no in-turn explicit-write marker,
      // so it is treated as a stale row and the wakeup wins. That replacement
      // must be visible in the transcript, never a silent overwrite.
      sessions.getById.mockReturnValue(unscheduledSession({
        scheduledAt: Date.now() + 3_600_000,
        pendingPrompt: 'Pre-turn explicit schedule prompt',
      }));
      captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'wakeup prompt' })]);

      expect(applyPendingWakeup(SESSION_ID)).toBe(true);
      const { scheduledAt, pendingPrompt } = sessions.update.mock.calls[0][1];
      expect(pendingPrompt).toBe('wakeup prompt');
      // The wakeup's ~60s fire time replaces the pre-turn schedule's 1h fire time.
      expect(scheduledAt).toBeGreaterThanOrEqual(Date.now() + 59_000);
      expect(scheduledAt).toBeLessThanOrEqual(Date.now() + 60_000);
      expect(workLogs.create).toHaveBeenCalledWith(
        SESSION_ID,
        'tool_output',
        expect.stringContaining('superseded a schedule that was set before this turn'),
        expect.objectContaining({ toolName: 'ScheduleWakeup' })
      );
    });
  });

  it('does not treat a stray scheduledAt without a prompt as an existing schedule', () => {
    sessions.getById.mockReturnValue(unscheduledSession({ scheduledAt: Date.now() + 1000, pendingPrompt: '  ' }));
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'wakeup prompt' })]);

    expect(applyPendingWakeup(SESSION_ID)).toBe(true);
    expect(sessions.update).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({
      pendingPrompt: 'wakeup prompt',
    }));
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

  it('drops the wakeup when the lane run was superseded mid-turn, and logs why', () => {
    sessions.getById.mockReturnValue(unscheduledSession({ laneRunId: 'run-1' }));
    withActiveLaneRunOwnership.mockReturnValue(null);
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'p' })]);

    expect(applyPendingWakeup(SESSION_ID)).toBe(false);
    expect(workLogs.create).toHaveBeenCalledWith(
      SESSION_ID,
      'tool_output',
      expect.stringContaining('lane run was superseded'),
      expect.objectContaining({ toolName: 'ScheduleWakeup' })
    );
  });

  it('does not fence non-workflow sessions', () => {
    sessions.getById.mockReturnValue(unscheduledSession());
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'p' })]);

    applyPendingWakeup(SESSION_ID);

    expect(withActiveLaneRunOwnership).not.toHaveBeenCalled();
  });

  it('does not write a supersession work log when there is no existing schedule', () => {
    sessions.getById.mockReturnValue(unscheduledSession());
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'p' })]);

    expect(applyPendingWakeup(SESSION_ID)).toBe(true);
    expect(workLogs.create).not.toHaveBeenCalled();
  });

  it('logs drop paths as warnings rather than informational lines', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // In-turn explicit schedule supersession.
    sessions.getById.mockReturnValue(unscheduledSession({
      scheduledAt: Date.now() + 3_600_000,
      pendingPrompt: 'Explicit',
    }));
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'w' }, 'warn-supersede')]);
    recordExplicitSchedule(SESSION_ID);
    applyPendingWakeup(SESSION_ID);

    // Lane run superseded before the wakeup could be scheduled.
    sessions.getById.mockReturnValue(unscheduledSession({ laneRunId: 'run-1' }));
    withActiveLaneRunOwnership.mockReturnValue(null);
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'w' }, 'warn-lane')]);
    applyPendingWakeup(SESSION_ID);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('superseded by an explicit POST'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('lane run was superseded'));
    warnSpy.mockRestore();
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

  it('also clears the explicit-schedule recency marker', () => {
    recordExplicitSchedule(SESSION_ID);
    clearPendingWakeup(SESSION_ID);

    // With the marker cleared, a fresh wakeup this "turn" should not find a
    // competing explicit schedule to yield to.
    sessions.getById.mockReturnValue(unscheduledSession({
      scheduledAt: Date.now() + 3_600_000,
      pendingPrompt: 'Leftover from before the clear',
    }));
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'wakeup prompt' })]);

    expect(applyPendingWakeup(SESSION_ID)).toBe(true);
  });

  it('resets tool_use dedup so an id reused in a later turn is treated as new', () => {
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'turn one' }, 'tool-1')]);
    clearPendingWakeup(SESSION_ID);

    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'turn two' }, 'tool-1')]);

    expect(pendingWakeups.get(SESSION_ID)).toMatchObject({ prompt: 'turn two' });
  });
});

describe('__resetWakeupTurnStatesForTest', () => {
  it('empties turn state and returns the number of entries removed', () => {
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'p' })]);
    const controllerB = new AbortController();
    captureWakeupForTurn('session-b', controllerB, [wakeupBlock({ delaySeconds: 60, prompt: 'b' })]);

    expect(__resetWakeupTurnStatesForTest()).toBe(2);
    expect(wakeupTurnStates.size).toBe(0);
  });
});

describe('hasPendingWakeup', () => {
  it('returns true while a captured wakeup is pending, and false after it is consumed', () => {
    captureScheduleWakeup(SESSION_ID, [wakeupBlock({ delaySeconds: 60, prompt: 'p' })]);
    expect(hasPendingWakeupForTurn(SESSION_ID, turnController)).toBe(true);

    sessions.getById.mockReturnValue(unscheduledSession());
    expect(applyPendingWakeup(SESSION_ID)).toBe(true);
    expect(hasPendingWakeupForTurn(SESSION_ID, turnController)).toBe(false);
  });

  it('returns false when nothing was captured', () => {
    expect(hasPendingWakeupForTurn(SESSION_ID, turnController)).toBe(false);
  });
});
