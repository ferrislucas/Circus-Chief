import { sessions } from '../database.js';
import { activeSessions, broadcastSessionStatus } from './streamEventHandler.js';
import { closeOwnWork } from './workflowSessionService.js';

const positiveEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

export const STREAM_WATCHDOG_INTERVAL_MS = positiveEnv('STREAM_WATCHDOG_INTERVAL_MS', 15_000);
export const STREAM_WATCHDOG_ABORT_GRACE_MS = positiveEnv('STREAM_WATCHDOG_ABORT_GRACE_MS', 5 * 60_000);
// A healthy provider may be silent while a tool runs, so this is opt-in.
export const STREAM_WATCHDOG_SILENCE_MS = positiveEnv('STREAM_WATCHDOG_SILENCE_MS', 0);

let timer = null;

/** Reap one provably dead turn. Exported to keep watchdog behavior unit-testable. */
export function reapWedgedTurn(sessionId, entry, reason = 'provider stream wedged (watchdog)') {
  if (activeSessions.get(sessionId) !== entry) return false;
  entry.controller?.abort();
  activeSessions.delete(sessionId);
  const session = sessions.getById(sessionId);
  if (!session) return false;
  sessions.update(sessionId, { status: 'stopped', executionState: 'stopped' });
  broadcastSessionStatus(sessionId, 'stopped');
  if (session.laneRunId && session.ownWorkState === 'open') {
    closeOwnWork(sessionId, 'cancelled', reason);
  }
  return true;
}

export function runStreamWatchdog(now = Date.now()) {
  let reaped = 0;
  for (const [sessionId, entry] of activeSessions) {
    if (!entry?.controller) continue;
    if (entry.controller.signal.aborted) {
      entry.abortedSeenAt ??= now;
      if (now - entry.abortedSeenAt >= STREAM_WATCHDOG_ABORT_GRACE_MS
        && reapWedgedTurn(sessionId, entry)) reaped++;
      continue;
    }
    if (STREAM_WATCHDOG_SILENCE_MS > 0
      && now - (entry.lastEventAt ?? entry.turnStartedAt ?? now) >= STREAM_WATCHDOG_SILENCE_MS
      && reapWedgedTurn(sessionId, entry)) reaped++;
  }
  return reaped;
}

export function startStreamWatchdog() {
  if (timer) return timer;
  timer = setInterval(() => runStreamWatchdog(), STREAM_WATCHDOG_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

export function stopStreamWatchdog() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
