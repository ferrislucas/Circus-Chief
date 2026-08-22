import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database.js', () => ({
  sessions: { getById: vi.fn(), update: vi.fn() },
}));
vi.mock('./streamEventHandler.js', () => ({
  activeSessions: new Map(),
  broadcastSessionStatus: vi.fn(),
}));
vi.mock('./workflowSessionService.js', () => ({ closeOwnWork: vi.fn() }));

import { sessions } from '../database.js';
import { activeSessions, broadcastSessionStatus } from './streamEventHandler.js';
import { closeOwnWork } from './workflowSessionService.js';
import { reapWedgedTurn, runStreamWatchdog, STREAM_WATCHDOG_ABORT_GRACE_MS } from './streamWatchdog.js';

describe('streamWatchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeSessions.clear();
  });

  it('reaps an aborted stream after its grace period and closes its lane obligation', () => {
    const controller = new AbortController();
    controller.abort();
    const entry = { controller, abortedSeenAt: 1_000 };
    activeSessions.set('worker-1', entry);
    sessions.getById.mockReturnValue({ id: 'worker-1', laneRunId: 'run-1', ownWorkState: 'open' });

    expect(runStreamWatchdog(1_000 + STREAM_WATCHDOG_ABORT_GRACE_MS)).toBe(1);
    expect(activeSessions.has('worker-1')).toBe(false);
    expect(sessions.update).toHaveBeenCalledWith('worker-1', { status: 'stopped', executionState: 'stopped' });
    expect(broadcastSessionStatus).toHaveBeenCalledWith('worker-1', 'stopped');
    expect(closeOwnWork).toHaveBeenCalledWith('worker-1', 'cancelled', 'provider stream wedged (watchdog)');
  });

  it('leaves an aborted stream alone during its grace period', () => {
    const controller = new AbortController();
    controller.abort();
    activeSessions.set('worker-1', { controller, abortedSeenAt: 1_000 });

    expect(runStreamWatchdog(1_000 + STREAM_WATCHDOG_ABORT_GRACE_MS - 1)).toBe(0);
    expect(activeSessions.has('worker-1')).toBe(true);
    expect(sessions.update).not.toHaveBeenCalled();
  });

  it('does nothing for a healthy registry', () => {
    const controller = new AbortController();
    activeSessions.set('worker-1', { controller, turnStartedAt: 1 });

    expect(runStreamWatchdog(1_000_000)).toBe(0);
    expect(sessions.update).not.toHaveBeenCalled();
    expect(broadcastSessionStatus).not.toHaveBeenCalled();
  });

  it('does not let a stale entry reap a replacement turn', () => {
    const stale = { controller: new AbortController() };
    const replacement = { controller: new AbortController() };
    activeSessions.set('worker-1', replacement);

    expect(reapWedgedTurn('worker-1', stale)).toBe(false);
    expect(sessions.update).not.toHaveBeenCalled();
  });
});
