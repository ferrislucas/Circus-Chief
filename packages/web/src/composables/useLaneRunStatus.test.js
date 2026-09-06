import { describe, expect, it } from 'vitest';
import { isPausedLaneRun, laneRunLabel } from './useLaneRunStatus.js';

describe('laneRunLabel', () => {
  it('identifies a closed root waiting on one descendant', () => {
    expect(laneRunLabel({
      status: 'open',
      openCount: 1,
      rootOwnWorkState: 'closed_successfully',
    })).toBe('waiting for descendants');
  });

  it('identifies a root still doing its own work as running', () => {
    expect(laneRunLabel({
      status: 'open',
      openCount: 1,
      rootOwnWorkState: 'open',
    })).toBe('automation running');
  });
});

describe('isPausedLaneRun', () => {
  it.each(['user_stop_pause', 'provider_limit_pause'])('recognizes %s as resumable', (blockerKind) => {
    expect(isPausedLaneRun({ status: 'open', blockerKind })).toBe(true);
  });

  it('does not use display text or offer resume for terminal runs', () => {
    expect(isPausedLaneRun({ status: 'open', blockingReason: 'Paused — provider limit or outage' })).toBe(false);
    expect(isPausedLaneRun({ status: 'cancelled', blockerKind: 'user_stop_pause' })).toBe(false);
  });
});
