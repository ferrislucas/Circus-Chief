import { describe, it, expect } from 'vitest';
import { resolveQueueState } from './queuedState.js';

describe('resolveQueueState', () => {
  it('prefers card-API queue fields when present', () => {
    expect(resolveQueueState(
      { cardId: 'c', laneId: 'l', laneName: 'Lane', entryState: 'queued', queuePosition: 2 },
      null
    )).toMatchObject({ entryState: 'queued', queuePosition: 2 });
  });

  it('falls back to the kanban store card when the card API carries no queue fields', () => {
    expect(resolveQueueState(
      { cardId: 'c', laneId: 'l', laneName: 'Lane' },
      { id: 'c', entryState: 'queued', queuePosition: 1 }
    )).toMatchObject({ entryState: 'queued', queuePosition: 1 });
  });

  it('falls back to the store when the session has no kanban object at all', () => {
    expect(resolveQueueState(
      null,
      { id: 'c', entryStatus: 'queued' }
    )).toMatchObject({ entryStatus: 'queued' });
  });

  it('returns null when neither source reports a queued entry', () => {
    expect(resolveQueueState(null, null)).toBeNull();
    expect(resolveQueueState(
      { cardId: 'c', laneId: 'l', laneName: 'Lane' },
      { id: 'c', entryState: 'running', queuePosition: null }
    )).toBeNull();
  });
});
