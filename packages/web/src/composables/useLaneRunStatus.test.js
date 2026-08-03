import { describe, expect, it } from 'vitest';
import { laneRunLabel } from './useLaneRunStatus.js';

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
